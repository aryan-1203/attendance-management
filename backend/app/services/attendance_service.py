from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import NotFound, ValidationFailed
from app.engine.calendar import daterange
from app.models import Attendance, CycleSnapshot, Employee, SalaryCycle
from app.repositories import attendance_repo, employee_repo
from app.services import audit_service, cycle_service, recalc_service
from app.utils.timeutil import today

SETTABLE = {"P", "A", "HD", "L", "WO", "H", "CO", "WFH", "OD"}
FUTURE_OK = {"L", "CO", "WFH", "OD", "WO", "H"}


def auto_code(emp: Employee, on: date, holidays: dict[date, str]) -> str | None:
    if on < emp.date_of_joining:
        return "NJ"
    if emp.exit_date and on > emp.exit_date:
        return "EX"
    if on in holidays:
        return "H"
    if on.weekday() in emp.weekly_off_days:
        return "WO"
    return None


def grid(db: Session, cycle: SalaryCycle, employees: list[Employee]) -> dict[str, Any]:
    hol = attendance_repo.public_holidays(db, cycle.start_date, cycle.end_date)
    marks = attendance_repo.for_range(db, cycle.start_date, cycle.end_date, [e.id for e in employees])
    by: dict[tuple[int, date], Attendance] = {(a.employee_id, a.date): a for a in marks}
    t = today()
    days = [{"date": d, "weekday": d.weekday(), "is_holiday": d in hol, "holiday_name": hol.get(d),
             "is_today": d == t, "is_future": d > t} for d in daterange(cycle.start_date, cycle.end_date)]
    rows = []
    for e in employees:
        cells = []
        for d in daterange(cycle.start_date, cycle.end_date):
            a = by.get((e.id, d))
            auto = auto_code(e, d, hol)
            if auto in ("NJ", "EX"):
                cells.append({"s": auto, "auto": True, "src": None, "late": False, "note": None})
            elif a:
                cells.append({"s": a.status, "auto": False, "src": a.source, "late": a.is_late, "note": a.note})
            else:
                cells.append({"s": auto, "auto": True, "src": None, "late": False, "note": None})
        rows.append({"id": e.id, "code": e.code, "full_name": e.full_name, "photo_url": e.photo_url,
                     "department": e.department.name if e.department else None,
                     "department_id": e.department_id, "employment_type": e.employment_type,
                     "status": e.status, "date_of_joining": e.date_of_joining, "exit_date": e.exit_date,
                     "cells": cells})
    return {"cycle": cycle, "days": days, "employees": rows}


def _validate_change(emp: Employee, on: date, status: str | None, t: date) -> None:
    if status is not None and status not in SETTABLE:
        raise ValidationFailed(f"'{status}' is not a valid status. Use one of {', '.join(sorted(SETTABLE))}",
                               code="invalid_status")
    if on < emp.date_of_joining:
        raise ValidationFailed(f"{emp.code}: {on.isoformat()} is before date of joining", code="before_doj")
    if emp.exit_date and on > emp.exit_date:
        raise ValidationFailed(f"{emp.code}: {on.isoformat()} is after exit date", code="after_exit")
    if status and on > t and status not in FUTURE_OK:
        raise ValidationFailed(f"{status} cannot be marked for a future date ({on.isoformat()})", code="future_date")


def apply_changes(db: Session, changes: list[dict[str, Any]], user, source: str = "manual",
                  recalc: bool = True) -> dict[str, Any]:
    """changes: [{employee_id, date, status (None = clear), note?, is_late?}]. All-or-nothing."""
    if not changes:
        return {"applied": [], "previous": [], "ledger_rows": 0}
    t = today()
    emps: dict[int, Employee] = {}
    open_cycles: dict[date, SalaryCycle] = {}
    for ch in changes:
        emp = emps.get(ch["employee_id"]) or db.get(Employee, ch["employee_id"])
        if not emp or emp.deleted_at:
            raise NotFound(f"Employee {ch['employee_id']} not found")
        emps[emp.id] = emp
        _validate_change(emp, ch["date"], ch.get("status"), t)
        if ch["date"] not in open_cycles:
            open_cycles[ch["date"]] = cycle_service.assert_open_for(db, ch["date"])

    applied, previous = [], []
    earliest: dict[int, date] = {}
    for ch in changes:
        emp = emps[ch["employee_id"]]
        on, status = ch["date"], ch.get("status")
        row = attendance_repo.get(db, emp.id, on)
        previous.append({"employee_id": emp.id, "date": on, "status": row.status if row else None,
                         "note": row.note if row else None, "is_late": bool(row.is_late) if row else False})
        if status is None:
            if row:
                db.delete(row)
        elif row:
            row.status = status
            row.source = source
            row.note = ch.get("note", row.note)
            row.is_late = bool(ch.get("is_late", row.is_late))
            row.updated_by_id = getattr(user, "id", None)
        else:
            db.add(Attendance(employee_id=emp.id, date=on, status=status, source=source, note=ch.get("note"),
                              is_late=bool(ch.get("is_late", False)), updated_by_id=getattr(user, "id", None),
                              import_batch_id=ch.get("import_batch_id")))
        applied.append({"employee_id": emp.id, "date": on, "status": status})
        earliest[emp.id] = min(on, earliest.get(emp.id, on))
    db.flush()

    changed = [(p, a) for p, a in zip(previous, applied) if p["status"] != a["status"]]
    if changed:
        audit_service.log(
            db, user, f"attendance.{source}", "attendance", "",
            f"{len(changed)} attendance change(s)" + (
                f": {emps[changed[0][1]['employee_id']].code} {changed[0][1]['date']} "
                f"{changed[0][0]['status'] or '—'}→{changed[0][1]['status'] or '—'}" if len(changed) == 1 else ""),
            [{"employee_id": p["employee_id"], "date": p["date"], "status": p["status"]} for p, _ in changed[:200]],
            [a for _, a in changed[:200]])
    rows = 0
    if recalc:
        for emp_id, start in earliest.items():
            rows += recalc_service.recalc_employee_from(db, emps[emp_id], start, user)
    return {"applied": applied, "previous": previous, "ledger_rows": rows}


def mark_all_present(db: Session, on: date, user, employee_ids: list[int] | None = None) -> dict[str, Any]:
    if on > today():
        raise ValidationFailed("Cannot mark attendance for a future date")
    cycle_service.assert_open_for(db, on)
    hol = attendance_repo.public_holidays(db, on, on)
    emps = employee_repo.employed_between(db, on, on)
    if employee_ids is not None:
        wanted = set(employee_ids)
        emps = [e for e in emps if e.id in wanted]
    existing = {a.employee_id for a in attendance_repo.for_range(db, on, on, [e.id for e in emps])}
    changes = [{"employee_id": e.id, "date": on, "status": "P"} for e in emps
               if e.id not in existing and auto_code(e, on, hol) is None]
    result = apply_changes(db, changes, user, "manual")
    result["count"] = len(changes)
    return result


def mark_range(db: Session, start: date, end: date, status: str, user,
               employee_ids: list[int] | None = None, only_unmarked: bool = False) -> dict[str, Any]:
    """Apply P or A across a date range for all (or selected) employees.

    Skips Sundays/holidays/NJ/EX, future dates, leave-sourced marks, and days already at `status`.
    When only_unmarked is True, also skips any day that already has a mark.
    """
    if status not in ("P", "A"):
        raise ValidationFailed("Range mark supports only Present (P) or Absent (A)", code="invalid_status")
    if end < start:
        raise ValidationFailed("End date must be on or after start date", code="invalid_range")
    t = today()
    if start > t:
        raise ValidationFailed("Cannot mark attendance for a future date range", code="future_date")
    end = min(end, t)
    if (end - start).days > 62:
        raise ValidationFailed("Date range cannot exceed 62 days", code="range_too_long")

    for d in daterange(start, end):
        cycle_service.assert_open_for(db, d)

    hol = attendance_repo.public_holidays(db, start, end)
    emps = employee_repo.employed_between(db, start, end)
    if employee_ids is not None:
        wanted = set(employee_ids)
        emps = [e for e in emps if e.id in wanted]
    if not emps:
        result = apply_changes(db, [], user, "manual")
        result["count"] = 0
        return result

    emp_ids = [e.id for e in emps]
    existing = {(a.employee_id, a.date): a for a in attendance_repo.for_range(db, start, end, emp_ids)}
    changes: list[dict[str, Any]] = []
    for e in emps:
        for d in daterange(start, end):
            if auto_code(e, d, hol) is not None:
                continue
            row = existing.get((e.id, d))
            if row:
                if only_unmarked:
                    continue
                if row.source == "leave":
                    continue
                if row.status == status:
                    continue
            changes.append({"employee_id": e.id, "date": d, "status": status})

    result = apply_changes(db, changes, user, "manual")
    result["count"] = len(changes)
    return result


SNAPSHOT_FIELDS = ("eligible_days", "present_days", "half_days", "weekly_offs", "holidays", "unmarked_days",
                   "paid_leave_used", "comp_off_used", "lop_days", "payable_days", "opening_usable", "accrued",
                   "closing_usable", "closing_locked")
INT_FIELDS = {"eligible_days", "present_days", "half_days", "weekly_offs", "holidays", "unmarked_days"}


def employee_cycle_summary(db: Session, emp: Employee, cycle: SalaryCycle) -> dict[str, Any]:
    res = recalc_service.compute(db, emp, cycle)
    s = res.summary
    bal = recalc_service.balances_now(db, emp.id)
    out = _summary_dict(emp, cycle, res, s, bal)
    if cycle.status == "locked":  # a locked cycle shows the frozen figures its reports were sent with
        snap = db.scalar(select(CycleSnapshot).where(CycleSnapshot.cycle_id == cycle.id,
                                                     CycleSnapshot.employee_id == emp.id))
        if snap:
            for k in SNAPSHOT_FIELDS:
                if snap.data.get(k) is None:
                    continue
                v = Decimal(str(snap.data[k]))
                if k in INT_FIELDS:
                    if v == v.to_integral():
                        out[k] = int(v)
                else:
                    out[k] = v
            out["projected_payable_days"] = out["payable_days"]
            out["remarks"] = [x for x in (snap.data.get("remarks") or "").split("; ") if x]
            out["pending_days"] = 0
    return out


def _summary_dict(emp: Employee, cycle: SalaryCycle, res, s, bal) -> dict[str, Any]:
    return {
        "employee_id": emp.id, "cycle_id": cycle.id,
        "balance": {"usable": bal["usable"], "locked": bal["locked"], "comp_off": bal["comp_off"]},
        "cycle_days": s.cycle_days, "eligible_days": s.eligible_days, "present_days": s.present_days,
        "half_days": s.half_days, "absent_days": s.absent_days, "leave_days": s.leave_days,
        "weekly_offs": s.weekly_offs, "holidays": s.holidays, "unmarked_days": s.unmarked_days,
        "pending_days": s.pending_days, "paid_leave_used": s.paid_leave_used, "comp_off_used": s.comp_off_used,
        "lop_days": s.lop_days, "payable_days": s.payable_days, "projected_payable_days": s.payable_days,
        "opening_usable": s.opening_usable, "accrued": s.accrued, "closing_usable": s.closing_usable,
        "closing_locked": s.closing_locked, "remarks": res.remarks, "warnings": res.warnings,
        "on_probation": s.on_probation_at_end,
        "days": [{"date": d.date, "status": d.status, "paid_leave": d.paid_leave, "lop": d.lop,
                  "comp_off_used": d.comp_off_used, "comp_off_earned": d.comp_off_earned, "note": d.note}
                 for d in res.days],
    }


def today_counts(db: Session, on: date, employee_ids: set[int] | None = None) -> dict[str, Any]:
    emps = employee_repo.employed_between(db, on, on)
    if employee_ids is not None:
        emps = [e for e in emps if e.id in employee_ids]
    hol = attendance_repo.public_holidays(db, on, on)
    marks = {a.employee_id: a.status for a in attendance_repo.for_range(db, on, on, [e.id for e in emps])}
    counts = {k: 0 for k in ("P", "A", "HD", "L", "WFH", "OD", "CO", "WO", "H", "unmarked")}
    absent, on_leave, unmarked = [], [], []
    for e in emps:
        code = marks.get(e.id) or auto_code(e, on, hol)
        if code is None:
            counts["unmarked"] += 1
            unmarked.append(e)
            continue
        counts[code] = counts.get(code, 0) + 1
        if code == "A":
            absent.append(e)
        elif code in ("L", "CO"):
            on_leave.append(e)
    return {"date": on, "total": len(emps), "counts": counts, "absent": absent, "on_leave": on_leave,
            "unmarked": unmarked}


def working_days(emp: Employee, start: date, end: date, holidays: dict[date, str]) -> list[date]:
    return [d for d in daterange(start, end) if auto_code(emp, d, holidays) is None]


def clear_range_by_source(db: Session, emp_id: int, start: date, end: date, source: str, note_prefix: str) -> int:
    n = 0
    for a in attendance_repo.for_range(db, start, end, [emp_id]):
        if a.source == source and (a.note or "").startswith(note_prefix):
            db.delete(a)
            n += 1
    db.flush()
    return n


