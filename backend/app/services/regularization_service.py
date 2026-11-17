from datetime import date

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.errors import Conflict, NotFound, ValidationFailed
from app.models import Employee, RegularizationRequest
from app.models.base import utcnow
from app.repositories import attendance_repo
from app.services import access, attendance_service, audit_service, cycle_service, notification_service
from app.utils.timeutil import today


def create(db: Session, emp: Employee, on: date, requested_status: str, reason: str, user) -> RegularizationRequest:
    if requested_status not in attendance_service.SETTABLE:
        raise ValidationFailed("Invalid requested status")
    if on > today():
        raise ValidationFailed("You can only regularize past or current dates")
    if not reason or len(reason.strip()) < 5:
        raise ValidationFailed("Please explain the correction (at least 5 characters)")
    cycle_service.assert_open_for(db, on)
    if on < emp.date_of_joining or (emp.exit_date and on > emp.exit_date):
        raise ValidationFailed("Date is outside employment")
    if db.scalar(select(RegularizationRequest).where(RegularizationRequest.employee_id == emp.id,
                                                     RegularizationRequest.date == on,
                                                     RegularizationRequest.status == "pending")):
        raise Conflict("A pending correction already exists for this date")
    row = attendance_repo.get(db, emp.id, on)
    current = row.status if row else attendance_service.auto_code(emp, on, attendance_repo.public_holidays(db, on, on))
    if current == requested_status:
        raise ValidationFailed(f"The day is already marked {requested_status}")
    req = RegularizationRequest(employee_id=emp.id, date=on, current_status=current, requested_status=requested_status,
                                reason=reason.strip(), requested_by_id=user.id)
    db.add(req)
    db.flush()
    audit_service.log(db, user, "regularization.request", "regularization_request", req.id,
                      f"{emp.code} requested {current or '—'}→{requested_status} on {on}")
    notification_service.notify(db, notification_service.approver_user_ids(db, emp),
                                f"Attendance correction from {emp.full_name}",
                                f"{on:%d %b}: {current or 'unmarked'} → {requested_status}", "approval",
                                "/leave?tab=regularizations")
    return req


def get(db: Session, req_id: int) -> RegularizationRequest:
    req = db.get(RegularizationRequest, req_id)
    if not req:
        raise NotFound("Request not found")
    return req


def decide(db: Session, req: RegularizationRequest, action: str, user, note: str | None = None):
    if req.status != "pending":
        raise ValidationFailed(f"Request is already {req.status}")
    emp = db.get(Employee, req.employee_id)
    access.ensure_approve(user, emp)
    if action == "approve":
        attendance_service.apply_changes(db, [{"employee_id": emp.id, "date": req.date,
                                               "status": req.requested_status,
                                               "note": f"Regularization #{req.id}: {req.reason[:80]}"}],
                                         user, source="regularization")
        req.status = "approved"
    elif action == "reject":
        req.status = "rejected"
    else:
        raise ValidationFailed("Action must be approve or reject")
    req.approver_id = user.id
    req.decided_at = utcnow()
    req.decision_note = note
    db.flush()
    audit_service.log(db, user, f"regularization.{action}", "regularization_request", req.id,
                      f"{action.capitalize()}d correction for {emp.code} on {req.date}",
                      {"status": "pending", "attendance": req.current_status},
                      {"status": req.status, "attendance": req.requested_status if action == "approve" else None})
    uid = notification_service.user_id_for_employee(db, emp.id)
    notification_service.notify(db, [uid] if uid else [], f"Attendance correction {req.status}",
                                f"{req.date:%d %b}: {req.requested_status}", "success" if action == "approve"
                                else "warning", "/me/attendance")
    return req


def list_query(db: Session, user, status: str | None = None, scope: str = "all"):
    stmt = select(RegularizationRequest).join(Employee, Employee.id == RegularizationRequest.employee_id)
    if status:
        stmt = stmt.where(RegularizationRequest.status == status)
    if scope == "approvals":
        stmt = stmt.where(RegularizationRequest.employee_id != (user.employee_id or -1))
    if scope == "mine" or user.role_name == access.EMPLOYEE:
        stmt = stmt.where(RegularizationRequest.employee_id == (user.employee_id or -1))
    elif user.role_name == access.MANAGER:
        stmt = stmt.where(or_(Employee.manager_id == (user.employee_id or -1),
                              RegularizationRequest.employee_id == (user.employee_id or -1)))
    return stmt.order_by(RegularizationRequest.created_at.desc())
