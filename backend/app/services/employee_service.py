from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import Conflict, NotFound, ValidationFailed
from app.models import Attendance, Department, Designation, Employee, User
from app.models.base import utcnow
from app.repositories import employee_repo, ledger_repo
from app.services import audit_service, policy_service, recalc_service

CALC_FIELDS = {"date_of_joining", "confirmation_date", "exit_date", "employment_type", "weekly_off"}


def add_months(d: date, months: int) -> date:
    y, m = divmod(d.month - 1 + months, 12)
    y += d.year
    m += 1
    import calendar
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


def get(db: Session, emp_id: int) -> Employee:
    emp = db.get(Employee, emp_id)
    if not emp or emp.deleted_at:
        raise NotFound("Employee not found")
    return emp


def snapshot(emp: Employee) -> dict[str, Any]:
    return {c: getattr(emp, c) for c in ("code", "full_name", "department_id", "designation_id", "manager_id",
                                          "function_manager_id",
                                          "date_of_joining", "probation_end_date", "confirmation_date", "exit_date",
                                          "employment_type", "weekly_off", "email", "phone",
                                          "status", "date_of_birth")}


def _validate(db: Session, data: dict[str, Any], emp: Employee | None = None) -> None:
    code = data.get("code")
    if code:
        other = employee_repo.by_code(db, code)
        if other and (emp is None or other.id != emp.id):
            raise Conflict(f"Employee code '{code}' already exists", code="duplicate_code")
    doj = data.get("date_of_joining", emp.date_of_joining if emp else None)
    for f in ("exit_date", "confirmation_date", "probation_end_date"):
        v = data.get(f, getattr(emp, f, None) if emp else None)
        if v and doj and v < doj:
            raise ValidationFailed(f"{f.replace('_', ' ').capitalize()} cannot be before date of joining")
    et = data.get("employment_type")
    if et and et not in ("probation", "permanent", "contract", "intern"):
        raise ValidationFailed("Invalid employment type")
    wo = data.get("weekly_off")
    if wo is not None:
        parts = [p for p in str(wo).split(",") if p.strip()]
        if not all(p.strip().isdigit() and 0 <= int(p) <= 6 for p in parts):
            raise ValidationFailed("Weekly off must be weekday numbers 0 (Mon) to 6 (Sun)")
    for field, label in (("manager_id", "manager"), ("function_manager_id", "function manager")):
        mgr = data.get(field)
        if mgr and emp and mgr == emp.id:
            raise ValidationFailed(f"An employee cannot be their own {label}")


def create(db: Session, data: dict[str, Any], user) -> Employee:
    _validate(db, data)
    if not data.get("probation_end_date") and data.get("employment_type", "probation") == "probation":
        months = int(policy_service.get(db, "probation_months") or 6)
        data["probation_end_date"] = add_months(data["date_of_joining"], months)
    if data.get("exit_date"):
        data["status"] = "exited"
    emp = Employee(**data)
    db.add(emp)
    db.flush()
    audit_service.log(db, user, "employee.create", "employee", emp.id, f"Created {emp.code} {emp.full_name}",
                      None, snapshot(emp))
    recalc_service.recalc_employee_from(db, emp, emp.date_of_joining, user)
    return emp


def update(db: Session, emp: Employee, data: dict[str, Any], user) -> Employee:
    _validate(db, data, emp)
    old = snapshot(emp)
    for k, v in data.items():
        setattr(emp, k, v)
    if "exit_date" in data:
        emp.status = "exited" if emp.exit_date else ("active" if emp.status == "exited" else emp.status)
    db.flush()
    new = snapshot(emp)
    changed = {k for k in new if old.get(k) != new.get(k)}
    if changed:
        audit_service.log(db, user, "employee.update", "employee", emp.id,
                          f"Updated {emp.code}: {', '.join(sorted(changed))}",
                          {k: old[k] for k in changed}, {k: new[k] for k in changed})
    if changed & CALC_FIELDS:
        dates = [d for d in (old["date_of_joining"], new["date_of_joining"], old["confirmation_date"],
                             new["confirmation_date"], old["exit_date"], new["exit_date"]) if d]
        start = min(dates) if ("weekly_off" not in changed and "employment_type" not in changed) \
            else emp.date_of_joining
        recalc_service.recalc_employee_from(db, emp, start, user)
    return emp


def soft_delete(db: Session, emp: Employee, user) -> None:
    emp.deleted_at = utcnow()
    emp.status = "inactive"
    audit_service.log(db, user, "employee.delete", "employee", emp.id, f"Deleted {emp.code} {emp.full_name}",
                      snapshot(emp), None)
    db.flush()


def confirm(db: Session, emp: Employee, on: date, user) -> Employee:
    if on < emp.date_of_joining:
        raise ValidationFailed("Confirmation date cannot be before date of joining")
    return update(db, emp, {"confirmation_date": on, "employment_type": "permanent"}, user)


def record_exit(db: Session, emp: Employee, on: date, reason: str | None, user) -> Employee:
    return update(db, emp, {"exit_date": on, "exit_reason": reason}, user)


def get_or_create_department(db: Session, name: str | None) -> int | None:
    if not name:
        return None
    dep = db.scalar(select(Department).where(Department.name == name.strip()))
    if not dep:
        dep = Department(name=name.strip(), code=name.strip()[:3].upper())
        db.add(dep)
        db.flush()
    return dep.id


def get_or_create_designation(db: Session, name: str | None) -> int | None:
    if not name:
        return None
    des = db.scalar(select(Designation).where(Designation.name == name.strip()))
    if not des:
        des = Designation(name=name.strip())
        db.add(des)
        db.flush()
    return des.id


def heatmap(db: Session, emp: Employee, start: date, end: date) -> list[dict]:
    rows = db.scalars(select(Attendance).where(Attendance.employee_id == emp.id, Attendance.date >= start,
                                               Attendance.date <= end))
    by = {a.date: a.status for a in rows}
    from app.repositories.attendance_repo import public_holidays
    hol = public_holidays(db, start, end)
    out = []
    cur = start
    wo = set(emp.weekly_off_days)
    while cur <= end:
        if cur < emp.date_of_joining:
            code = "NJ"
        elif emp.exit_date and cur > emp.exit_date:
            code = "EX"
        else:
            code = by.get(cur) or ("H" if cur in hol else "WO" if cur.weekday() in wo else None)
        out.append({"date": cur, "status": code})
        cur += timedelta(days=1)
    return out


def ledger(db: Session, emp_id: int, limit: int = 500) -> list[dict]:
    from app.models import LeaveLedger
    rows = list(db.scalars(select(LeaveLedger).where(LeaveLedger.employee_id == emp_id)
                           .order_by(LeaveLedger.entry_date.desc(), LeaveLedger.id.desc()).limit(limit)))
    reversed_ids = set(db.scalars(select(LeaveLedger.reversal_of_id).where(
        LeaveLedger.employee_id == emp_id, LeaveLedger.reversal_of_id.is_not(None))))
    out = []
    for r in rows:
        out.append({"id": r.id, "entry_date": r.entry_date, "entry_type": r.entry_type, "bucket": r.bucket,
                    "amount": r.amount, "cycle_id": r.cycle_id, "reference": r.reference, "note": r.note,
                    "is_system": r.is_system, "reversal_of_id": r.reversal_of_id,
                    "is_reversed": r.id in reversed_ids, "created_at": r.created_at})
    return out


def user_for(db: Session, emp_id: int) -> User | None:
    return db.scalar(select(User).where(User.employee_id == emp_id))


def balances(db: Session, emp_id: int) -> dict[str, Decimal]:
    return recalc_service.balances_now(db, emp_id)


def all_balances(db: Session, emp_ids: list[int]) -> dict[int, dict[str, Decimal]]:
    from app.utils.timeutil import today
    return ledger_repo.bucket_totals(db, emp_ids, up_to=today())
