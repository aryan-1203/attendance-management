from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import CycleLocked, NotFound, ValidationFailed
from app.engine.calendar import cycle_bounds, cycle_label
from app.models import SalaryCycle
from app.repositories import cycle_repo
from app.services import audit_service, policy_service
from app.utils.timeutil import today


def start_day(db: Session) -> int:
    return int(policy_service.get(db, "cycle_start_day"))


def get_or_create_for(db: Session, on: date) -> SalaryCycle:
    existing = cycle_repo.containing(db, on)
    if existing:
        return existing
    start, end = cycle_bounds(on, start_day(db))
    # never overlap with an existing cycle (start day may have been changed later)
    clash = cycle_repo.overlapping(db, start, end)
    if clash:
        last = clash[-1]
        if last.end_date < on:
            start = last.end_date + timedelta(days=1)
        else:
            end = clash[0].start_date - timedelta(days=1)
    due_days = int(policy_service.get(db, "report_due_days") or 0)
    cyc = SalaryCycle(start_date=start, end_date=end, label=cycle_label(start, end), status="open",
                      report_due_date=end + timedelta(days=due_days))
    db.add(cyc)
    db.flush()
    return cyc


def ensure_range(db: Session, start: date, end: date) -> list[SalaryCycle]:
    out = []
    cur = start
    while cur <= end:
        cyc = get_or_create_for(db, cur)
        out.append(cyc)
        cur = cyc.end_date + timedelta(days=1)
    return out


def current(db: Session) -> SalaryCycle:
    return get_or_create_for(db, today())


def get(db: Session, cycle_id: int) -> SalaryCycle:
    cyc = db.get(SalaryCycle, cycle_id)
    if not cyc:
        raise NotFound("Salary cycle not found")
    return cyc


def assert_open_for(db: Session, on: date) -> SalaryCycle:
    cyc = get_or_create_for(db, on)
    if cyc.status == "locked":
        raise CycleLocked(f"The cycle {cyc.label} is locked. Ask HR to unlock it before making changes.",
                          details={"cycle_id": cyc.id})
    return cyc


def list_cycles(db: Session) -> list[SalaryCycle]:
    ensure_through_today(db)
    return cycle_repo.all_cycles(db)


def go_live_date(db: Session) -> date:
    """Start of the earliest cycle. History before it is never created implicitly (use opening adjustments)."""
    first = db.scalar(select(func.min(SalaryCycle.start_date)))
    return first if first else current(db).start_date


def ensure_through_today(db: Session) -> None:
    first = db.scalar(select(func.min(SalaryCycle.start_date)))
    t = today()
    if first is None:
        get_or_create_for(db, t)
    else:
        ensure_range(db, first, t)


def lock(db: Session, cyc: SalaryCycle, user) -> SalaryCycle:
    if cyc.status == "locked":
        raise ValidationFailed("Cycle is already locked")
    from app.models.base import utcnow
    cyc.status = "locked"
    cyc.locked_by_id = user.id
    cyc.locked_at = utcnow()
    audit_service.log(db, user, "cycle.lock", "salary_cycle", cyc.id, f"Locked cycle {cyc.label}",
                      {"status": "open"}, {"status": "locked"})
    db.flush()
    return cyc


def unlock(db: Session, cyc: SalaryCycle, user, reason: str) -> SalaryCycle:
    if cyc.status != "locked":
        raise ValidationFailed("Cycle is not locked")
    if not reason or len(reason.strip()) < 5:
        raise ValidationFailed("A reason (at least 5 characters) is required to unlock a cycle")
    cyc.status = "open"
    cyc.unlock_reason = reason.strip()
    audit_service.log(db, user, "cycle.unlock", "salary_cycle", cyc.id, f"Unlocked cycle {cyc.label}: {reason}",
                      {"status": "locked"}, {"status": "open", "reason": reason})
    db.flush()
    return cyc
