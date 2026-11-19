from fastapi import APIRouter
from sqlalchemy.orm import Session

from app.api.deps import DB, CurrentUser, HROnly, Staff, resolve_employee
from app.models import Employee, User
from app.repositories import employee_repo
from app.schemas.ops import BulkMarkIn, BulkMarkOut, CycleSummaryOut, GridOut, MarkAllIn, MarkRangeIn
from app.services import access, attendance_service, cycle_service

router = APIRouter(prefix="/attendance", tags=["attendance"])


@router.get("/grid", response_model=GridOut)
def grid(cycle_id: int | None = None, department_id: int | None = None, employment_type: str | None = None,
         status: str | None = None, search: str | None = None, db: Session = DB, user: User = Staff):
    cyc = cycle_service.get(db, cycle_id) if cycle_id else cycle_service.current(db)
    mgr = user.employee_id if user.role_name == access.MANAGER else None
    stmt = employee_repo.filtered(search, department_id, employment_type, status, mgr,
                                  active_between=(cyc.start_date, cyc.end_date)).order_by(Employee.code)
    emps = list(db.scalars(stmt))
    out = attendance_service.grid(db, cyc, emps)
    db.commit()
    return out


@router.post("/bulk", response_model=BulkMarkOut)
def bulk(body: BulkMarkIn, db: Session = DB, user: User = HROnly):
    out = attendance_service.apply_changes(db, [c.model_dump() for c in body.changes], user)
    db.commit()
    return out


@router.post("/mark-all-present", response_model=BulkMarkOut)
def mark_all_present(body: MarkAllIn, db: Session = DB, user: User = HROnly):
    out = attendance_service.mark_all_present(db, body.date, user, body.employee_ids)
    db.commit()
    return out


@router.post("/mark-range", response_model=BulkMarkOut)
def mark_range(body: MarkRangeIn, db: Session = DB, user: User = HROnly):
    out = attendance_service.mark_range(
        db, body.start_date, body.end_date, body.status, user, body.employee_ids, body.only_unmarked)
    db.commit()
    return out


@router.get("/summary", response_model=CycleSummaryOut)
def summary(employee_id: int | None = None, cycle_id: int | None = None, db: Session = DB, user: User = CurrentUser):
    emp = resolve_employee(db, user, employee_id)
    cyc = cycle_service.get(db, cycle_id) if cycle_id else cycle_service.current(db)
    out = attendance_service.employee_cycle_summary(db, emp, cyc)
    db.commit()
    return out
