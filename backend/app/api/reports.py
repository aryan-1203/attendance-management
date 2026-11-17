from fastapi import APIRouter, Query
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import DB, CurrentUser, HROnly, HRorAccounts, Staff, resolve_employee
from app.core.errors import Forbidden, NotFound
from app.models import ReportRun, User
from app.schemas.ops import EmailReportIn, ReportRunOut
from app.services import access, cycle_service, dashboard_service, pdf_service, report_service

router = APIRouter(prefix="/reports", tags=["reports"])
dashboard = APIRouter(prefix="/dashboard", tags=["dashboard"])
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

BUILDERS = {"pay-days": report_service.pay_days_xlsx, "muster-roll": report_service.muster_xlsx,
            "leave-register": report_service.leave_register_xlsx, "lop-summary": report_service.lop_summary_xlsx}


def _cycle_for_role(db, user, cycle_id):
    cyc = cycle_service.get(db, cycle_id) if cycle_id else cycle_service.current(db)
    if user.role_name == access.ACCOUNTS and cyc.status != "locked":
        raise Forbidden("Accounts can only access reports for locked cycles")
    return cyc


@dashboard.get("")
def overview(db: Session = DB, user: User = Staff):
    out = dashboard_service.overview(db, user)
    db.commit()
    return out


@router.get("/pay-days")
def pay_days(cycle_id: int | None = None, db: Session = DB, user: User = HRorAccounts):
    cyc = _cycle_for_role(db, user, cycle_id)
    rows = report_service.pay_days_rows(db, cyc)
    db.commit()
    return {"cycle": {"id": cyc.id, "label": cyc.label, "status": cyc.status, "start_date": cyc.start_date,
                      "end_date": cyc.end_date}, "rows": rows, "totals": report_service.totals(rows)}


@router.get("/runs", response_model=list[ReportRunOut])
def runs(cycle_id: int | None = None, db: Session = DB, _=HRorAccounts):
    stmt = select(ReportRun).order_by(ReportRun.created_at.desc()).limit(100)
    if cycle_id:
        stmt = stmt.where(ReportRun.cycle_id == cycle_id)
    return list(db.scalars(stmt))


@router.get("/statement")
def statement(fmt: str = Query("pdf", pattern="^(pdf|xlsx)$"), employee_id: int | None = None,
              cycle_id: int | None = None, db: Session = DB, user: User = CurrentUser):
    emp = resolve_employee(db, user, employee_id)
    cyc = cycle_service.get(db, cycle_id) if cycle_id else cycle_service.current(db)
    if fmt == "pdf":
        content = pdf_service.statement_pdf(db, report_service.statement_data(db, emp, cyc), user)
        media = "application/pdf"
    else:
        content = report_service.statement_xlsx(db, emp, cyc, user)
        media = XLSX
    report_service.save_run(db, cyc, f"statement_{emp.code}", fmt, content, user)
    db.commit()
    return Response(content, media_type=media, headers={
        "Content-Disposition": f'attachment; filename="statement_{emp.code}_{cyc.start_date:%Y%m%d}.{fmt}"'})


@router.get("/{report}.{fmt}")
def download(report: str, fmt: str, cycle_id: int | None = None, db: Session = DB, user: User = HRorAccounts):
    cyc = _cycle_for_role(db, user, cycle_id)
    if fmt == "xlsx" and report in BUILDERS:
        content, media = BUILDERS[report](db, cyc, user), XLSX
    elif fmt == "pdf" and report == "pay-days":
        content, media = pdf_service.pay_days_pdf(db, cyc, report_service.pay_days_rows(db, cyc), user), \
            "application/pdf"
    else:
        raise NotFound("Unknown report")
    report_service.save_run(db, cyc, report.replace("-", "_"), fmt, content, user)
    db.commit()
    return Response(content, media_type=media, headers={
        "Content-Disposition": f'attachment; filename="{report}_{cyc.start_date:%Y%m%d}-{cyc.end_date:%Y%m%d}.{fmt}"'})


@router.post("/email-accounts")
def email_accounts(body: EmailReportIn, cycle_id: int | None = None, db: Session = DB, user: User = HROnly):
    cyc = cycle_service.get(db, cycle_id) if cycle_id else cycle_service.current(db)
    out = report_service.email_accounts(db, cyc, user, [str(e) for e in body.to] if body.to else None)
    db.commit()
    return out
