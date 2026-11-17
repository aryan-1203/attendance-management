from collections import Counter, defaultdict
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.engine.calendar import daterange
from app.models import Attendance, Employee, LeaveLedger, LeaveRequest, RegularizationRequest
from app.repositories import attendance_repo, employee_repo, ledger_repo
from app.services import access, attendance_service, cycle_service, leave_service
from app.utils.timeutil import today

D0 = Decimal("0")


def _emp_brief(e: Employee) -> dict:
    return {"id": e.id, "code": e.code, "full_name": e.full_name, "photo_url": e.photo_url,
            "department": e.department.name if e.department else None}


def _upcoming(d: date | None, t: date, days: int = 7) -> date | None:
    if not d:
        return None
    for y in (t.year, t.year + 1):
        try:
            nd = d.replace(year=y)
        except ValueError:  # 29 Feb
            nd = date(y, 3, 1)
        if t <= nd <= t + timedelta(days=days):
            return nd
    return None


def overview(db: Session, user) -> dict[str, Any]:
    t = today()
    cyc = cycle_service.current(db)
    scope: set[int] | None = None
    if user.role_name == access.MANAGER:  # managers see their own team only
        scope = set(employee_repo.team_ids(db, user.employee_id or -1))
    tc = attendance_service.today_counts(db, t, scope)
    counts = tc["counts"]
    day_x = (t - cyc.start_date).days + 1
    emps = employee_repo.employed_between(db, cyc.start_date, cyc.end_date)
    if scope is not None:
        emps = [e for e in emps if e.id in scope]
    active_today = [e for e in emps if e.date_of_joining <= t and (not e.exit_date or e.exit_date >= t)]

    team_filter = None
    if user.role_name == access.MANAGER:
        team_filter = user.employee_id or -1
    pl = select(func.count()).select_from(LeaveRequest).join(Employee, Employee.id == LeaveRequest.employee_id).where(
        LeaveRequest.status == "pending")
    pr = select(func.count()).select_from(RegularizationRequest).join(
        Employee, Employee.id == RegularizationRequest.employee_id).where(RegularizationRequest.status == "pending")
    if team_filter:
        pl = pl.where(Employee.manager_id == team_filter)
        pr = pr.where(Employee.manager_id == team_filter)

    # celebrations
    birthdays, anniversaries = [], []
    for e in active_today:
        bd = _upcoming(e.date_of_birth, t)
        if bd:
            birthdays.append({**_emp_brief(e), "date": bd})
        an = _upcoming(e.date_of_joining, t)
        if an and an.year > e.date_of_joining.year:
            anniversaries.append({**_emp_brief(e), "date": an, "years": an.year - e.date_of_joining.year})

    # trend: attendance % per day of current cycle
    hol = attendance_repo.public_holidays(db, cyc.start_date, cyc.end_date)
    marks = attendance_repo.for_range(db, cyc.start_date, min(t, cyc.end_date), [e.id for e in emps])
    by_day: dict[date, dict[int, str]] = defaultdict(dict)
    for a in marks:
        by_day[a.date][a.employee_id] = a.status
    trend = []
    for d in daterange(cyc.start_date, min(t, cyc.end_date)):
        # expected = working-day staff who have been marked (unmarked people don't drag today's % down)
        working = [e for e in emps if attendance_service.auto_code(e, d, hol) is None and e.id in by_day[d]]
        if not working:
            trend.append({"date": d, "pct": None, "present": 0, "expected": 0})
            continue
        pres = Decimal(0)
        for e in working:
            s = by_day[d].get(e.id)
            pres += Decimal(1) if s in ("P", "WFH", "OD") else Decimal("0.5") if s == "HD" else 0
        trend.append({"date": d, "pct": float(round(pres * 100 / len(working), 1)), "present": float(pres),
                      "expected": len(working)})

    # LOP by department (current cycle)
    lop_stmt = (select(Employee.department_id, func.sum(LeaveLedger.amount))
                .join(Employee, Employee.id == LeaveLedger.employee_id)
                .where(LeaveLedger.bucket == "lop", LeaveLedger.entry_date >= cyc.start_date,
                       LeaveLedger.entry_date <= cyc.end_date)
                .group_by(Employee.department_id))
    if scope is not None:
        lop_stmt = lop_stmt.where(LeaveLedger.employee_id.in_(scope or {-1}))
    lop_rows = db.execute(lop_stmt).all()
    dept_names = {e.department_id: (e.department.name if e.department else "—") for e in emps}
    lop_by_dept = sorted([{"department": dept_names.get(dep, "—"), "lop_days": float(v or 0)}
                          for dep, v in lop_rows if v], key=lambda x: -x["lop_days"])

    # top absentees & Monday/Friday pattern (last 90 days)
    since = t - timedelta(days=90)
    absences = [(eid, d) for eid, d in db.execute(select(Attendance.employee_id, Attendance.date).where(
        Attendance.status == "A", Attendance.date >= since, Attendance.date <= t)).all()
        if scope is None or eid in scope]
    abs_count = Counter(eid for eid, _ in absences)
    monfri = Counter(eid for eid, d in absences if d.weekday() in (0, 4))
    emp_by_id = {e.id: e for e in db.scalars(employee_repo.base_query())}
    top_absentees = [{**_emp_brief(emp_by_id[eid]), "absences": n} for eid, n in abs_count.most_common(6)
                     if eid in emp_by_id]

    # utilisation in current leave year
    ys, ye = leave_service.leave_year_bounds(db, t.year)
    if ys > t:
        ys, ye = leave_service.leave_year_bounds(db, t.year - 1)
    util_stmt = select(LeaveLedger.entry_type, func.sum(LeaveLedger.amount)).where(
        LeaveLedger.entry_date >= ys, LeaveLedger.entry_date <= min(ye, t),
        LeaveLedger.entry_type.in_(("ACCRUAL", "PROBATION_LOCK", "LEAVE_USED", "LOP"))).group_by(LeaveLedger.entry_type)
    if scope is not None:
        util_stmt = util_stmt.where(LeaveLedger.employee_id.in_(scope or {-1}))
    util = db.execute(util_stmt).all()
    u = {k: Decimal(v or 0) for k, v in util}
    accrued = u.get("ACCRUAL", D0) + u.get("PROBATION_LOCK", D0)
    used = -u.get("LEAVE_USED", D0)

    # alerts
    totals = ledger_repo.bucket_totals(db, [e.id for e in active_today], up_to=t)
    zero_bal = [_emp_brief(e) | {"usable": float(totals.get(e.id, {}).get("usable", D0))} for e in active_today
                if totals.get(e.id, {}).get("usable", D0) <= 0]
    pattern = [_emp_brief(emp_by_id[eid]) | {"count": n} for eid, n in monfri.most_common() if n >= 3
               and eid in emp_by_id]
    probation_due = [_emp_brief(e) | {"probation_end_date": e.probation_end_date} for e in active_today
                     if e.employment_type == "probation" and not e.confirmation_date and e.probation_end_date
                     and e.probation_end_date <= t + timedelta(days=15)]
    is_working_today = any(attendance_service.auto_code(e, t, hol) is None for e in active_today)

    return {
        "today": {"date": t, "total": tc["total"], "present": counts["P"], "wfh": counts["WFH"], "od": counts["OD"],
                  "absent": counts["A"], "half_day": counts["HD"], "on_leave": counts["L"] + counts["CO"],
                  "weekly_off": counts["WO"], "holiday": counts["H"], "unmarked": counts["unmarked"]},
        "cycle": {"id": cyc.id, "label": cyc.label, "start_date": cyc.start_date, "end_date": cyc.end_date,
                  "day": max(0, min(day_x, cyc.days)), "days": cyc.days, "days_remaining": max(0, (cyc.end_date - t).days),
                  "report_due_date": cyc.report_due_date,
                  "days_to_report": (cyc.report_due_date - t).days if cyc.report_due_date else None,
                  "status": cyc.status},
        "absent_today": [_emp_brief(e) for e in tc["absent"]],
        "on_leave_today": [_emp_brief(e) for e in tc["on_leave"]],
        "pending": {"leave": db.scalar(pl) or 0, "regularization": db.scalar(pr) or 0},
        "birthdays": sorted(birthdays, key=lambda x: x["date"]),
        "anniversaries": sorted(anniversaries, key=lambda x: x["date"]),
        "trend": trend, "lop_by_department": lop_by_dept, "top_absentees": top_absentees,
        "utilization": {"accrued": float(accrued), "used": float(used), "lop": float(u.get("LOP", D0)),
                        "pct": float(round(used * 100 / accrued, 1)) if accrued else 0.0,
                        "year_start": ys, "year_end": ye},
        "alerts": {
            "zero_balance": zero_bal[:20], "zero_balance_count": len(zero_bal),
            "monday_friday": pattern[:10],
            "unmarked_today": [_emp_brief(e) for e in tc["unmarked"]] if is_working_today else [],
            "probation_due": probation_due,
        },
    }
