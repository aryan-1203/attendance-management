"""Bridges the database and the pure engine.

recalc(employee, cycle):
  1. opening balances = replay of active ledger rows dated <= cycle end, excluding this cycle's system rows
  2. run the engine on the cycle's attendance + holidays
  3. diff the engine postings against this cycle's active system rows (multiset of
     (date, type, bucket, amount, note, ref)); reverse rows that disappeared, post rows that are new.
Running it twice is a no-op (idempotent). Locked cycles are never touched.
"""
from collections import Counter
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.engine import Balances, CycleInput, DayMark, EmployeeProfile, compute_cycle
from app.engine.ledger import balances_from_rows
from app.engine.types import CycleResult, Policy
from app.models import CompOff, Employee, LeaveLedger, SalaryCycle
from app.repositories import attendance_repo, cycle_repo, employee_repo, ledger_repo
from app.services import policy_service
from app.utils.timeutil import today


def profile_of(emp: Employee) -> EmployeeProfile:
    return EmployeeProfile(
        date_of_joining=emp.date_of_joining,
        employment_type=emp.employment_type,
        confirmation_date=emp.confirmation_date,
        exit_date=emp.exit_date,
        weekly_off=frozenset(emp.weekly_off_days),
    )


@dataclass
class CalcContext:
    """Per-cycle shared data so a full-cycle recalc does not re-query holidays/attendance per employee."""
    cycle: SalaryCycle
    policy: Policy
    holidays: dict[date, str]
    marks: dict[int, dict[date, DayMark]]


def build_context(db: Session, cycle: SalaryCycle, employee_ids: list[int] | None = None,
                  policy: Policy | None = None) -> CalcContext:
    pad = timedelta(days=14)  # neighbours for the sandwich rule
    hol = attendance_repo.public_holidays(db, cycle.start_date - pad, cycle.end_date + pad)
    marks: dict[int, dict[date, DayMark]] = {}
    for a in attendance_repo.for_range(db, cycle.start_date - pad, cycle.end_date + pad, employee_ids):
        marks.setdefault(a.employee_id, {})[a.date] = DayMark(a.status, bool(a.is_late))
    return CalcContext(cycle, policy or policy_service.engine_policy(db), hol, marks)


def opening_balances(db: Session, emp_id: int, cycle: SalaryCycle, expiry_days: int) -> Balances:
    rows = ledger_repo.active_rows(db, emp_id, up_to=cycle.end_date, exclude_cycle_id=cycle.id)
    # rows dated inside this cycle that belong to later processing (other cycles) cannot exist; manual
    # adjustments dated inside the cycle are treated as available from the cycle start.
    return balances_from_rows(ledger_repo.to_engine_rows(rows), expiry_days)


def compute(db: Session, emp: Employee, cycle: SalaryCycle, ctx: CalcContext | None = None,
            extra_marks: dict[date, DayMark] | None = None, opening: Balances | None = None) -> CycleResult:
    """Dry-run: compute results without writing anything."""
    ctx = ctx or build_context(db, cycle, [emp.id])
    att = dict(ctx.marks.get(emp.id, {}))
    if extra_marks:
        att.update(extra_marks)
    if opening is None:
        opening = opening_balances(db, emp.id, cycle, ctx.policy.comp_off_expiry_days)
    return compute_cycle(CycleInput(cycle.start_date, cycle.end_date, profile_of(emp), ctx.policy, opening, att,
                                    ctx.holidays, as_of=today()))


def recalc(db: Session, emp: Employee, cycle: SalaryCycle, user=None, ctx: CalcContext | None = None
           ) -> tuple[CycleResult, int]:
    """Returns (result, number_of_ledger_rows_written)."""
    if cycle.status == "locked":
        return compute(db, emp, cycle, ctx), 0
    result = compute(db, emp, cycle, ctx)
    existing = ledger_repo.active_system_rows_for_cycle(db, emp.id, cycle.id)

    def key(entry_date, entry_type, bucket, amount, note, ref):
        return (entry_date, entry_type, bucket, Decimal(amount).quantize(Decimal("0.01")), note or "", ref or "")

    old_keys = Counter(key(r.entry_date, r.entry_type, r.bucket, r.amount, r.note, r.reference) for r in existing)
    new_keys = Counter(key(*p.key()) for p in result.postings)
    if old_keys == new_keys:
        return result, 0

    to_reverse = old_keys - new_keys
    to_post = new_keys - old_keys
    written = 0
    uid = getattr(user, "id", None)
    for row in existing:
        k = key(row.entry_date, row.entry_type, row.bucket, row.amount, row.note, row.reference)
        if to_reverse[k] > 0:
            to_reverse[k] -= 1
            db.add(LeaveLedger(employee_id=emp.id, entry_date=row.entry_date, entry_type=row.entry_type,
                               bucket=row.bucket, amount=-Decimal(row.amount), cycle_id=cycle.id,
                               reference=row.reference, note=f"Reversal (recalculation): {row.note}"[:500],
                               is_system=True, reversal_of_id=row.id, created_by_id=uid))
            written += 1
    for p in result.postings:
        k = key(*p.key())
        if to_post[k] > 0:
            to_post[k] -= 1
            db.add(LeaveLedger(employee_id=emp.id, entry_date=p.entry_date, entry_type=p.entry_type, bucket=p.bucket,
                               amount=p.amount, cycle_id=cycle.id, reference=p.reference, note=p.note,
                               is_system=True, created_by_id=uid))
            written += 1
    db.flush()
    return result, written


def rebuild_comp_offs(db: Session, emp_id: int, expiry_days: int) -> None:
    """Refresh the comp_offs projection for one employee from active ledger rows."""
    db.execute(delete(CompOff).where(CompOff.employee_id == emp_id))
    rows = [r for r in ledger_repo.active_rows(db, emp_id) if r.bucket == "comp_off"]
    lots: list[CompOff] = []
    for r in rows:
        amt = Decimal(r.amount)
        if amt > 0:
            exp = (date.fromisoformat(r.reference.split(":", 1)[1]) if (r.reference or "").startswith("expires:")
                   else r.entry_date + timedelta(days=expiry_days))
            lots.append(CompOff(employee_id=emp_id, earned_date=r.entry_date, days=amt, used_days=Decimal(0),
                                expired_days=Decimal(0), expires_on=exp, status="available"))
            continue
        need = -amt
        target = date.fromisoformat(r.reference.split(":", 1)[1]) if (r.reference or "").startswith("lot:") else None
        for lot in sorted(lots, key=lambda x: (x.earned_date != target, x.expires_on)):
            free = lot.days - lot.used_days - lot.expired_days
            if need <= 0 or free <= 0:
                continue
            take = min(free, need)
            if r.entry_type == "COMP_OFF_EXPIRED":
                lot.expired_days += take
            else:
                lot.used_days += take
            need -= take
    for lot in lots:
        free = lot.days - lot.used_days - lot.expired_days
        lot.status = ("available" if free == lot.days else "partial" if free > 0 else
                      "expired" if lot.expired_days > 0 else "used")
        db.add(lot)
    db.flush()


def recalc_employee_from(db: Session, emp: Employee, from_date: date, user=None) -> int:
    """Recalculate every open cycle from the cycle containing from_date up to the current cycle."""
    from app.services import cycle_service

    t = today()
    start = max(from_date, emp.date_of_joining, cycle_service.go_live_date(db))
    if start > t:
        return 0
    cycle_service.ensure_range(db, start, t)
    written = 0
    pol = policy_service.engine_policy(db)
    for cyc in cycle_repo.from_date(db, start, until=t):
        if cyc.end_date < emp.date_of_joining or (emp.exit_date and cyc.start_date > emp.exit_date):
            continue
        ctx = build_context(db, cyc, [emp.id], pol)
        _, n = recalc(db, emp, cyc, user, ctx)
        written += n
    rebuild_comp_offs(db, emp.id, pol.comp_off_expiry_days)
    return written


def recalc_cycle_all(db: Session, cycle: SalaryCycle, user=None, employee_ids: list[int] | None = None) -> dict:
    if cycle.status == "locked":
        return {"cycle_id": cycle.id, "employees": 0, "rows": 0, "skipped": "locked"}
    emps = employee_repo.employed_between(db, cycle.start_date, cycle.end_date)
    if employee_ids is not None:
        emps = [e for e in emps if e.id in set(employee_ids)]
    ctx = build_context(db, cycle, [e.id for e in emps])
    rows = 0
    for emp in emps:
        _, n = recalc(db, emp, cycle, user, ctx)
        rows += n
    return {"cycle_id": cycle.id, "employees": len(emps), "rows": rows}


def recalc_open_from(db: Session, from_date: date, user=None, employee_ids: list[int] | None = None) -> list[dict]:
    """Recalculate all open cycles from from_date through today, in order (later cycles depend on earlier)."""
    from app.services import cycle_service

    t = today()
    from_date = max(from_date, cycle_service.go_live_date(db))
    if from_date > t:
        return []
    cycle_service.ensure_range(db, from_date, t)
    out = [recalc_cycle_all(db, c, user, employee_ids) for c in cycle_repo.from_date(db, from_date, until=t)]
    pol = policy_service.engine_policy(db)
    ids = employee_ids
    if ids is None:
        ids = [e.id for e in db.query(Employee).filter(Employee.deleted_at.is_(None))]
    for emp_id in ids:
        rebuild_comp_offs(db, emp_id, pol.comp_off_expiry_days)
    return out


def balances_now(db: Session, emp_id: int, as_of: date | None = None) -> dict[str, Decimal]:
    totals = ledger_repo.bucket_totals(db, [emp_id], up_to=as_of or today()).get(emp_id, {})
    return {"usable": totals.get("usable", Decimal(0)), "locked": totals.get("locked", Decimal(0)),
            "comp_off": totals.get("comp_off", Decimal(0)), "lop": totals.get("lop", Decimal(0))}
