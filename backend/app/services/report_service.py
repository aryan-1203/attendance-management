"""Cycle close, pay-days report, muster roll, leave register, LOP summary, employee statement."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import ValidationFailed
from app.engine.calendar import daterange
from app.models import (CycleSnapshot, Employee, LeaveLedger, LeaveRequest, RegularizationRequest, ReportRun,
                        SalaryCycle)
from app.repositories import attendance_repo, employee_repo
from app.services import attendance_service, audit_service, cycle_service, email_service, policy_service, \
    recalc_service
from app.utils import excel_styles as xs
from app.utils.timeutil import today

D0 = Decimal("0")

PAY_COLUMNS = [
    xs.Col("code", "Emp Code"), xs.Col("full_name", "Name"), xs.Col("department", "Department"),
    xs.Col("date_of_joining", "DOJ", "date"), xs.Col("employment_type", "Employment Type"),
    xs.Col("cycle_days", "Cycle Days", "int"), xs.Col("eligible_days", "Eligible Days", "days", True),
    xs.Col("weekly_offs", "Sundays / WO", "days", True), xs.Col("holidays", "Holidays", "days", True),
    xs.Col("present_days", "Present", "days", True), xs.Col("half_days", "Half-days", "days", True),
    xs.Col("paid_leave_used", "Paid Leaves Used", "days", True), xs.Col("comp_off_used", "Comp-offs Used", "days", True),
    xs.Col("lop_days", "LOP Days", "days", True), xs.Col("payable_days", "Payable Days", "days", True),
    xs.Col("opening_usable", "Opening Balance", "days", True), xs.Col("accrued", "Accrued", "days", True),
    xs.Col("used", "Used", "days", True), xs.Col("closing_usable", "Closing Usable", "days", True),
    xs.Col("closing_locked", "Locked (Probation)", "days", True), xs.Col("remarks", "Remarks", width=48),
]
DEC_KEYS = {"eligible_days", "weekly_offs", "holidays", "present_days", "half_days", "paid_leave_used",
            "comp_off_used", "lop_days", "payable_days", "opening_usable", "accrued", "used", "closing_usable", "closing_locked",
            "comp_off_balance", "unmarked_days"}


def _row(emp: Employee, res) -> dict[str, Any]:
    s = res.summary
    return {
        "employee_id": emp.id, "code": emp.code, "full_name": emp.full_name,
        "department": emp.department.name if emp.department else "", "date_of_joining": emp.date_of_joining,
        "employment_type": emp.employment_type.capitalize(), "cycle_days": s.cycle_days,
        "eligible_days": Decimal(s.eligible_days), "weekly_offs": Decimal(s.weekly_offs),
        "holidays": Decimal(s.holidays), "present_days": Decimal(s.present_days), "half_days": Decimal(s.half_days),
        "paid_leave_used": s.paid_leave_used, "comp_off_used": s.comp_off_used, "lop_days": s.lop_days,
        "payable_days": s.payable_days, "opening_usable": s.opening_usable,
        "accrued": s.accrued, "used": s.paid_leave_used, "closing_usable": s.closing_usable,
        "closing_locked": s.closing_locked, "comp_off_balance": s.closing_comp_off,
        "unmarked_days": Decimal(s.unmarked_days), "exited_in_cycle": s.exited_in_cycle,
        "joined_in_cycle": s.joined_in_cycle, "remarks": "; ".join(res.remarks),
    }


def _to_json(row: dict) -> dict:
    return {k: (str(v) if isinstance(v, Decimal) else v.isoformat() if isinstance(v, date) else v)
            for k, v in row.items()}


def _from_json(row: dict) -> dict:
    out = dict(row)
    for k in DEC_KEYS:
        if k in out and out[k] is not None:
            out[k] = Decimal(str(out[k]))
    if isinstance(out.get("date_of_joining"), str):
        out["date_of_joining"] = date.fromisoformat(out["date_of_joining"])
    return out


def pay_days_rows(db: Session, cycle: SalaryCycle, employee_ids: list[int] | None = None) -> list[dict[str, Any]]:
    if cycle.status == "locked":
        snaps = list(db.scalars(select(CycleSnapshot).where(CycleSnapshot.cycle_id == cycle.id)))
        if snaps:
            rows = [_from_json(s.data) for s in snaps]
            if employee_ids is not None:
                rows = [r for r in rows if r["employee_id"] in set(employee_ids)]
            return sorted(rows, key=lambda r: r["code"])
    emps = employee_repo.employed_between(db, cycle.start_date, cycle.end_date)
    if employee_ids is not None:
        emps = [e for e in emps if e.id in set(employee_ids)]
    ctx = recalc_service.build_context(db, cycle, [e.id for e in emps])
    return [_row(e, recalc_service.compute(db, e, cycle, ctx)) for e in emps]


def totals(rows: list[dict]) -> dict[str, Decimal]:
    keys = ("eligible_days", "lop_days", "payable_days",
            "paid_leave_used", "comp_off_used")
    return {k: sum((r[k] for r in rows), D0) for k in keys} | {"employees": len(rows)}


# -------------------------------------------------------------------------------- close wizard
def close_checks(db: Session, cycle: SalaryCycle) -> dict[str, Any]:
    t = today()
    upto = min(cycle.end_date, t)
    emps = employee_repo.employed_between(db, cycle.start_date, cycle.end_date)
    hol = attendance_repo.public_holidays(db, cycle.start_date, cycle.end_date)
    marks = {(a.employee_id, a.date) for a in attendance_repo.for_range(db, cycle.start_date, upto, [e.id for e in emps])}
    unmarked = []
    for e in emps:
        missing = [d for d in daterange(cycle.start_date, upto)
                   if attendance_service.auto_code(e, d, hol) is None and (e.id, d) not in marks]
        if missing:
            unmarked.append({"employee_id": e.id, "code": e.code, "full_name": e.full_name, "count": len(missing),
                             "dates": [d.isoformat() for d in missing[:31]]})
    pend_leave = list(db.scalars(select(LeaveRequest).where(
        LeaveRequest.status == "pending", LeaveRequest.start_date <= cycle.end_date,
        LeaveRequest.end_date >= cycle.start_date)))
    pend_reg = list(db.scalars(select(RegularizationRequest).where(
        RegularizationRequest.status == "pending", RegularizationRequest.date >= cycle.start_date,
        RegularizationRequest.date <= cycle.end_date)))
    rows = pay_days_rows(db, cycle)
    anomalies = []
    for r in rows:
        if r["closing_usable"] < 0:
            anomalies.append({"code": r["code"], "full_name": r["full_name"], "issue": f"Negative balance {r['closing_usable']}"})
        if r["lop_days"] >= 5:
            anomalies.append({"code": r["code"], "full_name": r["full_name"], "issue": f"High LOP ({r['lop_days']} days)"})
        if r["exited_in_cycle"] and (r["closing_usable"] + r["closing_locked"]) > 0:
            anomalies.append({"code": r["code"], "full_name": r["full_name"],
                              "issue": f"Exited – {r['closing_usable']} day(s) to encash"})
    for e in emps:
        if e.employment_type == "probation" and not e.confirmation_date and e.probation_end_date \
                and e.probation_end_date <= cycle.end_date:
            anomalies.append({"code": e.code, "full_name": e.full_name,
                              "issue": f"Probation ended {e.probation_end_date:%d %b %Y} but not confirmed"})

    def check(key, label, items, severity):
        return {"key": key, "label": label, "status": "ok" if not items else severity, "count": len(items),
                "items": items}

    checks = [
        check("cycle_ended", "Cycle period has ended",
              [] if cycle.end_date < t else [{"issue": f"Cycle ends {cycle.end_date:%d %b %Y}"}], "warning"),
        check("unmarked", "All working days marked", unmarked, "warning"),
        check("pending_leave", "No pending leave requests",
              [{"id": r.id, "code": r.employee.code, "full_name": r.employee.full_name,
                "issue": f"{r.start_date:%d %b} – {r.end_date:%d %b}"} for r in pend_leave], "warning"),
        check("pending_regularization", "No pending attendance corrections",
              [{"id": r.id, "code": r.employee.code, "full_name": r.employee.full_name,
                "issue": f"{r.date:%d %b}: {r.current_status} → {r.requested_status}"} for r in pend_reg], "warning"),
        check("anomalies", "No anomalies", anomalies, "warning"),
    ]
    return {"cycle_id": cycle.id, "status": cycle.status, "checks": checks, "totals": totals(rows),
            "ready": all(c["status"] == "ok" for c in checks)}


def lock_cycle(db: Session, cycle: SalaryCycle, user, acknowledge_warnings: bool = False) -> dict[str, Any]:
    checks = close_checks(db, cycle)
    if not checks["ready"] and not acknowledge_warnings:
        raise ValidationFailed("Some checks need attention. Review them and confirm to lock anyway.",
                               code="checks_pending", details=checks)
    earlier_open = db.scalar(select(SalaryCycle).where(SalaryCycle.start_date < cycle.start_date,
                                                       SalaryCycle.status == "open"))
    if earlier_open:
        raise ValidationFailed(f"Lock earlier cycle {earlier_open.label} first", code="earlier_cycle_open")
    recalc_service.recalc_cycle_all(db, cycle, user)
    rows = pay_days_rows(db, cycle)
    db.execute(delete(CycleSnapshot).where(CycleSnapshot.cycle_id == cycle.id))
    for r in rows:
        db.add(CycleSnapshot(cycle_id=cycle.id, employee_id=r["employee_id"], data=_to_json(r)))
    cycle_service.lock(db, cycle, user)
    return {"cycle_id": cycle.id, "status": cycle.status, "employees": len(rows), "totals": totals(rows)}


def unlock_cycle(db: Session, cycle: SalaryCycle, user, reason: str) -> SalaryCycle:
    later_locked = db.scalar(select(SalaryCycle).where(SalaryCycle.start_date > cycle.start_date,
                                                       SalaryCycle.status == "locked"))
    if later_locked:
        raise ValidationFailed(f"Unlock the later cycle {later_locked.label} first", code="later_cycle_locked")
    cycle_service.unlock(db, cycle, user, reason)
    db.execute(delete(CycleSnapshot).where(CycleSnapshot.cycle_id == cycle.id))
    return cycle


# -------------------------------------------------------------------------------- excel builders
def _title(db: Session, report: str, cycle: SalaryCycle | None, user) -> xs.TitleBlock:
    return xs.TitleBlock(company=policy_service.get(db, "company_name"), report=report,
                         period=cycle.label if cycle else None, generated_by=getattr(user, "full_name", None),
                         generated_on=datetime.now())




def pay_days_xlsx(db: Session, cycle: SalaryCycle, user) -> bytes:
    wb = xs.new_workbook()
    ws = wb.active
    ws.title = "Pay Days"
    rows = pay_days_rows(db, cycle)
    xs.write_table(ws, PAY_COLUMNS, rows, title=_title(db, "Salary Pay-Days Report", cycle, user), freeze_cols=2)
    return xs.to_bytes(wb)


def muster_xlsx(db: Session, cycle: SalaryCycle, user) -> bytes:
    wb = xs.new_workbook()
    ws = wb.active
    ws.title = "Muster Roll"
    emps = employee_repo.employed_between(db, cycle.start_date, cycle.end_date)
    grid = attendance_service.grid(db, cycle, emps)
    rows_pd = {r["employee_id"]: r for r in pay_days_rows(db, cycle)}
    days = list(daterange(cycle.start_date, cycle.end_date))
    cols = [xs.Col("code", "Emp Code"), xs.Col("full_name", "Name"), xs.Col("department", "Department")]
    cols += [xs.Col(f"d{i}", f"{d:%d}\n{d:%a}", "code", width=5.5) for i, d in enumerate(days)]
    counts = ["P", "A", "HD", "L", "WO", "H", "CO"]
    cols += [xs.Col(f"n_{c}", c, "int", True, 6) for c in counts]
    cols += [xs.Col("lop_days", "LOP", "days", True, 7), xs.Col("payable_days", "Payable", "days", True, 8)]
    data = []
    for e in grid["employees"]:
        row = {"code": e["code"], "full_name": e["full_name"], "department": e["department"] or ""}
        for i, cell in enumerate(e["cells"]):
            row[f"d{i}"] = cell["s"] or ""
        pd = rows_pd.get(e["id"], {})
        row["lop_days"] = pd.get("lop_days", D0)
        row["payable_days"] = pd.get("payable_days", D0)
        data.append(row)
    info = xs.write_table(ws, cols, data, title=_title(db, "Muster Roll", cycle, user),
                          freeze_cols=3)
    # per-row COUNTIF formulas for the status counts
    from openpyxl.utils import get_column_letter
    first_day_col, last_day_col = 4, 3 + len(days)
    rng = f"{get_column_letter(first_day_col)}{{r}}:{get_column_letter(last_day_col)}{{r}}"
    for ri in range(info["first"], info["last"] + 1):
        for ci, code in enumerate(counts, start=last_day_col + 1):
            c = ws.cell(row=ri, column=ci, value=f'=COUNTIF({rng.format(r=ri)},"{code}")')
            c.font = xs.font()
            c.number_format = xs.INT_FORMAT
    ws.row_dimensions[info["header_row"]].height = 26
    legend_row = (info["total_row"] or info["last"]) + 2
    xs.section_heading(ws, legend_row, "Legend")
    legend = [("P", "Present"), ("A", "Absent"), ("HD", "Half-day"), ("L", "Approved leave"), ("WO", "Weekly off"),
              ("H", "Holiday"), ("CO", "Comp-off used"), ("WFH", "Work from home"), ("OD", "On duty"),
              ("NJ", "Not joined"), ("EX", "Exited")]
    for i, (k, v) in enumerate(legend):
        a = ws.cell(row=legend_row + 1 + i, column=1, value=k)
        a.font = xs.font(bold=True)
        b = ws.cell(row=legend_row + 1 + i, column=2, value=v)
        b.font = xs.font()
    return xs.to_bytes(wb)


def leave_register_xlsx(db: Session, cycle: SalaryCycle, user) -> bytes:
    wb = xs.new_workbook()
    ws = wb.active
    ws.title = "Leave Register"
    rows = []
    stmt = (select(LeaveLedger, Employee).join(Employee, Employee.id == LeaveLedger.employee_id)
            .where(LeaveLedger.entry_date >= cycle.start_date, LeaveLedger.entry_date <= cycle.end_date)
            .order_by(Employee.code, LeaveLedger.entry_date, LeaveLedger.id))
    for led, emp in db.execute(stmt):
        rows.append({"code": emp.code, "full_name": emp.full_name, "entry_date": led.entry_date,
                     "entry_type": led.entry_type.replace("_", " ").title(), "bucket": led.bucket.replace("_", "-"),
                     "amount": Decimal(led.amount), "note": led.note, "reference": led.reference or "",
                     "reversal": "Yes" if led.reversal_of_id else ""})
    cols = [xs.Col("code", "Emp Code"), xs.Col("full_name", "Name"), xs.Col("entry_date", "Date", "date"),
            xs.Col("entry_type", "Type"), xs.Col("bucket", "Bucket"), xs.Col("amount", "Days", "days", True),
            xs.Col("note", "Note", width=40), xs.Col("reference", "Reference"), xs.Col("reversal", "Reversal")]
    xs.write_table(ws, cols, rows, title=_title(db, "Leave Register", cycle, user))
    # balances sheet
    ws2 = wb.create_sheet("Balances")
    pd = pay_days_rows(db, cycle)
    cols2 = [xs.Col("code", "Emp Code"), xs.Col("full_name", "Name"), xs.Col("opening_usable", "Opening", "days", True),
             xs.Col("accrued", "Accrued", "days", True), xs.Col("used", "Used", "days", True),
             xs.Col("lop_days", "LOP", "days", True), xs.Col("closing_usable", "Closing Usable", "days", True),
             xs.Col("closing_locked", "Locked", "days", True), xs.Col("comp_off_balance", "Comp-off", "days", True)]
    xs.write_table(ws2, cols2, pd, title=_title(db, "Leave Balances", cycle, user))
    return xs.to_bytes(wb)


def lop_summary_xlsx(db: Session, cycle: SalaryCycle, user) -> bytes:
    wb = xs.new_workbook()
    ws = wb.active
    ws.title = "LOP Summary"
    rows = [r for r in pay_days_rows(db, cycle) if r["lop_days"] > 0]
    cols = [xs.Col("code", "Emp Code"), xs.Col("full_name", "Name"), xs.Col("department", "Department"),
            xs.Col("lop_days", "LOP Days", "days", True), xs.Col("payable_days", "Payable Days", "days", True),
            xs.Col("remarks", "Remarks", width=40)]
    xs.write_table(ws, cols, rows, title=_title(db, "LOP Summary", cycle, user))
    ws2 = wb.create_sheet("By Department")
    dept: dict[str, dict[str, Any]] = {}
    for r in rows:
        d = dept.setdefault(r["department"] or "—", {"department": r["department"] or "—", "employees": 0,
                                                       "lop_days": D0})
        d["employees"] += 1
        d["lop_days"] += r["lop_days"]
    cols2 = [xs.Col("department", "Department"), xs.Col("employees", "Employees", "int", True),
             xs.Col("lop_days", "LOP Days", "days", True)]
    xs.write_table(ws2, cols2, sorted(dept.values(), key=lambda x: x["department"]),
                   title=_title(db, "LOP by Department", cycle, user))
    return xs.to_bytes(wb)


def statement_data(db: Session, emp: Employee, cycle: SalaryCycle) -> dict[str, Any]:
    summ = attendance_service.employee_cycle_summary(db, emp, cycle)
    pd = pay_days_rows(db, cycle, [emp.id])
    ledger = list(db.scalars(select(LeaveLedger).where(LeaveLedger.employee_id == emp.id,
                                                       LeaveLedger.entry_date >= cycle.start_date,
                                                       LeaveLedger.entry_date <= cycle.end_date)
                             .order_by(LeaveLedger.entry_date, LeaveLedger.id)))
    return {"employee": emp, "cycle": cycle, "summary": summ, "pay": pd[0] if pd else None, "ledger": ledger}


def statement_xlsx(db: Session, emp: Employee, cycle: SalaryCycle, user) -> bytes:
    data = statement_data(db, emp, cycle)
    wb = xs.new_workbook()
    ws = wb.active
    ws.title = "Statement"
    r = xs.write_title(ws, _title(db, f"Monthly Statement — {emp.full_name} ({emp.code})", cycle, user), 2)
    s = data["summary"]
    pairs = [("Department", emp.department.name if emp.department else "", "text"),
             ("Date of joining", emp.date_of_joining, "date"), ("Employment type", emp.employment_type.title(), "text"),
             ("Cycle days", s["cycle_days"], "int"), ("Eligible days", s["eligible_days"], "days"),
             ("Present", s["present_days"], "days"), ("Half-days", s["half_days"], "days"),
             ("Paid leave used", s["paid_leave_used"], "days"), ("Comp-off used", s["comp_off_used"], "days"),
             ("LOP days", s["lop_days"], "days"), ("Payable days", s["payable_days"], "days"),
             ("Opening balance", s["opening_usable"], "days"), ("Accrued", s["accrued"], "days"),
             ("Closing usable", s["closing_usable"], "days"), ("Locked (probation)", s["closing_locked"], "days")]
    r = xs.write_key_values(ws, pairs, r)
    xs.section_heading(ws, r, "Day-wise attendance")
    day_rows = [{"date": d["date"], "weekday": d["date"].strftime("%a"), "status": d["status"],
                 "paid_leave": d["paid_leave"], "lop": d["lop"], "note": d["note"]} for d in s["days"]]
    cols = [xs.Col("date", "Date", "date"), xs.Col("weekday", "Day"), xs.Col("status", "Status", "code"),
            xs.Col("paid_leave", "Paid Leave", "days", True), xs.Col("lop", "LOP", "days", True),
            xs.Col("note", "Note", width=30)]
    xs.write_table(ws, cols, day_rows, start_row=r + 1)
    ws.freeze_panes = None
    ws2 = wb.create_sheet("Ledger")
    lrows = [{"entry_date": x.entry_date, "entry_type": x.entry_type.replace("_", " ").title(), "bucket": x.bucket,
              "amount": Decimal(x.amount), "note": x.note} for x in data["ledger"]]
    xs.write_table(ws2, [xs.Col("entry_date", "Date", "date"), xs.Col("entry_type", "Type"), xs.Col("bucket", "Bucket"),
                         xs.Col("amount", "Days", "days", True), xs.Col("note", "Note", width=44)], lrows,
                   title=_title(db, f"Leave Ledger — {emp.full_name}", cycle, user))
    return xs.to_bytes(wb)


# -------------------------------------------------------------------------------- persistence / email
def save_run(db: Session, cycle: SalaryCycle | None, report_type: str, fmt: str, content: bytes, user) -> ReportRun:
    folder = Path(settings.report_dir)
    folder.mkdir(parents=True, exist_ok=True)
    name = f"{report_type}_{cycle.start_date:%Y%m%d}_{datetime.now():%Y%m%d%H%M%S%f}.{fmt}" if cycle else \
        f"{report_type}_{datetime.now():%Y%m%d%H%M%S%f}.{fmt}"
    path = folder / name
    path.write_bytes(content)
    run = ReportRun(cycle_id=cycle.id if cycle else None, report_type=report_type, fmt=fmt, file_path=str(path),
                    generated_by_id=getattr(user, "id", None))
    db.add(run)
    db.flush()
    return run


def email_accounts(db: Session, cycle: SalaryCycle, user, to: list[str] | None = None) -> dict[str, Any]:
    from app.services import pdf_service
    recipients = to or [e.strip() for e in (policy_service.get(db, "accounts_email") or "").split(",") if e.strip()]
    if not recipients:
        raise ValidationFailed("Set the Accounts email in Settings first")
    xlsx = pay_days_xlsx(db, cycle, user)
    pdf = pdf_service.pay_days_pdf(db, cycle, pay_days_rows(db, cycle), user)
    run = save_run(db, cycle, "pay_days", "xlsx", xlsx, user)
    t = totals(pay_days_rows(db, cycle))
    company = policy_service.get(db, "company_name")
    body = (f"Hello,\n\nPlease find attached the Salary Pay-Days Report for {cycle.label}"
            f"{' (LOCKED)' if cycle.status == 'locked' else ' (PROVISIONAL – cycle not yet locked)'}.\n\n"
            f"Employees: {t['employees']}\nTotal payable days: {t['payable_days']}\nTotal LOP days: {t['lop_days']}\n\n"
            f"Salary amounts are calculated by Accounts from these days.\n\nRegards,\n{user.full_name}\n{company}")
    fname = f"PayDays_{cycle.start_date:%Y%m%d}-{cycle.end_date:%Y%m%d}"
    result = email_service.send(db, recipients, f"{company}: Pay-Days Report {cycle.label}", body, [
        (f"{fname}.xlsx", xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        (f"{fname}.pdf", pdf, "application/pdf")])
    from app.models.base import utcnow
    run.emailed_to = ", ".join(recipients)
    run.emailed_at = utcnow()
    audit_service.log(db, user, "report.email", "salary_cycle", cycle.id,
                      f"Emailed pay-days report for {cycle.label} to {run.emailed_to}")
    return {"sent_to": recipients, "mode": result["mode"], "report_run_id": run.id}
