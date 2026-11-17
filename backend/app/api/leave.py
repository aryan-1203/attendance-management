from datetime import date

from fastapi import APIRouter, File, Query, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import DB, CurrentUser, HROnly, resolve_employee
from app.core.errors import ValidationFailed
from app.models import User
from app.repositories.base import paginate
from app.schemas.common import LedgerEntryOut, PageOut, page_out
from app.schemas.ops import (AdjustIn, CarryForwardOut, DecisionIn, EncashmentOut, LeaveApplyIn, LeavePreviewIn,
                             LeavePreviewOut, LeaveRequestOut, RegularizationIn, RegularizationOut)
from app.services import access, employee_service, leave_service, regularization_service

router = APIRouter(prefix="/leave", tags=["leave"])
reg = APIRouter(prefix="/regularizations", tags=["regularizations"])


def _target(db, user, employee_id):
    emp = resolve_employee(db, user, employee_id)
    if employee_id and employee_id != user.employee_id and user.role_name not in (access.HR, access.MANAGER):
        raise access.Forbidden("You can only apply for yourself")
    return emp


@router.post("/preview", response_model=LeavePreviewOut)
def preview(body: LeavePreviewIn, db: Session = DB, user: User = CurrentUser):
    emp = _target(db, user, body.employee_id)
    out = leave_service.preview(db, emp, body.start_date, body.end_date, body.is_half_day, body.leave_type)
    db.rollback()
    return out


@router.post("/requests", response_model=LeaveRequestOut, status_code=201)
def apply(body: LeaveApplyIn, db: Session = DB, user: User = CurrentUser):
    emp = _target(db, user, body.employee_id)
    if body.employee_id and body.employee_id != user.employee_id and user.role_name == access.MANAGER:
        access.ensure_approve(user, emp)
    req = leave_service.apply(db, emp, body.model_dump(), user)
    db.commit()
    return req


@router.post("/attachments")
async def upload_attachment(file: UploadFile = File(...), _: User = CurrentUser):
    import uuid
    from pathlib import Path

    from app.core.config import settings
    data = await file.read()
    if len(data) > 5 * 1024 * 1024:
        raise ValidationFailed("Attachment must be under 5 MB")
    ext = Path(file.filename or "").suffix.lower()
    if ext not in (".pdf", ".png", ".jpg", ".jpeg", ".webp"):
        raise ValidationFailed("Attach a PDF or image")
    folder = Path(settings.upload_dir) / "attachments"
    folder.mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex}{ext}"
    (folder / name).write_bytes(data)
    return {"path": f"attachments/{name}", "filename": file.filename}


@router.get("/attachments/{name}")
def get_attachment(name: str, db: Session = DB, user: User = CurrentUser):
    """Download a leave attachment: the requester, their manager or HR."""
    from pathlib import Path

    from fastapi.responses import FileResponse
    from sqlalchemy import select

    from app.core.config import settings
    from app.core.errors import NotFound
    from app.models import LeaveRequest
    rel = f"attachments/{Path(name).name}"
    req = db.scalar(select(LeaveRequest).where(LeaveRequest.attachment_path == rel))
    if not req:
        raise NotFound("Attachment not found")
    access.ensure_view(user, employee_service.get(db, req.employee_id))
    path = Path(settings.upload_dir) / rel
    if not path.is_file():
        raise NotFound("Attachment file is missing")
    return FileResponse(path, filename=f"leave-{req.id}{path.suffix}")


@router.get("/requests", response_model=PageOut[LeaveRequestOut])
def list_requests(status: str | None = None, scope: str = "all", employee_id: int | None = None, page: int = 1,
                  page_size: int = Query(25, le=200), db: Session = DB, user: User = CurrentUser):
    stmt = leave_service.list_requests(db, user, status, scope, employee_id)
    return page_out(paginate(db, stmt, page, page_size), LeaveRequestOut)


@router.post("/requests/{req_id}/decision", response_model=LeaveRequestOut)
def decide(req_id: int, body: DecisionIn, db: Session = DB, user: User = CurrentUser):
    req = leave_service.decide(db, leave_service.get(db, req_id), body.action, user, body.note)
    db.commit()
    return req


@router.post("/requests/{req_id}/cancel", response_model=LeaveRequestOut)
def cancel(req_id: int, db: Session = DB, user: User = CurrentUser):
    req = leave_service.cancel(db, leave_service.get(db, req_id), user)
    db.commit()
    return req


@router.post("/adjustments", response_model=LedgerEntryOut, status_code=201)
def adjust(body: AdjustIn, db: Session = DB, user: User = HROnly):
    emp = employee_service.get(db, body.employee_id)
    row = leave_service.adjust(db, emp, body.bucket, body.amount, body.reason, user, body.entry_date)
    db.commit()
    return {**{c: getattr(row, c) for c in ("id", "entry_date", "entry_type", "bucket", "amount", "cycle_id",
                                            "reference", "note", "is_system", "reversal_of_id", "created_at")},
            "is_reversed": False}


@router.get("/balances")
def balances(employee_id: int | None = None, db: Session = DB, user: User = CurrentUser):
    emp = resolve_employee(db, user, employee_id)
    return employee_service.balances(db, emp.id)


@router.get("/carry-forward", response_model=CarryForwardOut)
def cf_preview(year: int = Query(default_factory=lambda: date.today().year - 1), db: Session = DB, _=HROnly):
    return leave_service.carry_forward_preview(db, year)


@router.post("/carry-forward/{year}")
def cf_post(year: int, db: Session = DB, user: User = HROnly):
    out = leave_service.carry_forward_post(db, year, user)
    db.commit()
    return out


@router.get("/encashment/{emp_id}", response_model=EncashmentOut)
def encash_preview(emp_id: int, db: Session = DB, _=HROnly):
    return leave_service.encashment_preview(db, employee_service.get(db, emp_id))


@router.post("/encashment/{emp_id}", response_model=EncashmentOut)
def encash_post(emp_id: int, db: Session = DB, user: User = HROnly):
    out = leave_service.encashment_post(db, employee_service.get(db, emp_id), user)
    db.commit()
    out["already_posted"] = True
    return out


@reg.post("", response_model=RegularizationOut, status_code=201)
def create_reg(body: RegularizationIn, db: Session = DB, user: User = CurrentUser):
    emp = _target(db, user, body.employee_id)
    req = regularization_service.create(db, emp, body.date, body.requested_status, body.reason, user)
    db.commit()
    return req


@reg.get("", response_model=PageOut[RegularizationOut])
def list_reg(status: str | None = None, scope: str = "all", page: int = 1, page_size: int = Query(25, le=200),
             db: Session = DB, user: User = CurrentUser):
    return page_out(paginate(db, regularization_service.list_query(db, user, status, scope), page, page_size),
                    RegularizationOut)


@reg.post("/{req_id}/decision", response_model=RegularizationOut)
def decide_reg(req_id: int, body: DecisionIn, db: Session = DB, user: User = CurrentUser):
    req = regularization_service.decide(db, regularization_service.get(db, req_id), body.action, user, body.note)
    db.commit()
    return req
