from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.errors import Conflict, NotFound, ValidationFailed
from app.engine.types import DayMark
from app.models import Employee, LeaveLedger, LeaveRequest
from app.models.base import utcnow
from app.repositories import attendance_repo, employee_repo
from app.services import (access, attendance_service, audit_service, cycle_service, notification_service,
                          policy_service, recalc_service)
from app.utils.timeutil import today

D0 = Decimal("0")


def _request_marks(emp: Employee, start: date, end: date, half_day: bool, leave_type: str,
                   holidays: dict[date, str]) -> dict[date, DayMark]:
    code = "HD" if half_day else ("CO" if leave_type == "comp_off" else "L")
    return {d: DayMark(code) for d in attendance_service.working_days(emp, start, end, holidays)}


def preview(db: Session, emp: Employee, start: date, end: date, half_day: bool = False,
            leave_type: str = "paid") -> dict[str, Any]:
    """What-if: run the engine for each affected cycle with and without the requested leave."""
    if end < start:
        raise ValidationFailed("End date must be on or after start date")
    if half_day and start != end:
        raise ValidationFailed("Half-day leave must be a single day")
    if start < emp.date_of_joining or (emp.exit_date and end > emp.exit_date):
        raise ValidationFailed("Leave dates must fall within employment")
    if (end - start).days > 92:
        raise ValidationFailed("A single leave request cannot exceed 93 days")
    hol = attendance_repo.public_holidays(db, start, end)
    marks = _request_marks(emp, start, end, half_day, leave_type, hol)
    days = Decimal("0.5") if half_day and marks else Decimal(len(marks))
    cycles = cycle_service.ensure_range(db, start, end)
    base_open = with_open = None
    lop_base = lop_with = paid_base = paid_with = co_base = co_with = D0
    for cyc in cycles:
        ctx = recalc_service.build_context(db, cyc, [emp.id])
        extra = {d: m for d, m in marks.items() if cyc.start_date <= d <= cyc.end_date}
        r0 = recalc_service.compute(db, emp, cyc, ctx, opening=base_open)
        r1 = recalc_service.compute(db, emp, cyc, ctx, extra_marks=extra, opening=with_open)
        base_open, with_open = r0.closing, r1.closing
        lop_base += r0.summary.lop_days
        lop_with += r1.summary.lop_days
        paid_base += r0.summary.paid_leave_used
        paid_with += r1.summary.paid_leave_used
        co_base += r0.summary.comp_off_used
        co_with += r1.summary.comp_off_used
    lop = max(D0, lop_with - lop_base)
    comp = max(D0, co_with - co_base)
    paid = max(D0, min(days - lop - comp, paid_with - paid_base))
    bal = recalc_service.balances_now(db, emp.id)
    parts = []
    if paid:
        parts.append(f"{_fmt(paid)} day{'s' if paid != 1 else ''} paid")
    if comp:
        parts.append(f"{_fmt(comp)} comp-off")
    if lop:
        parts.append(f"{_fmt(lop)} day{'s' if lop != 1 else ''} LOP")
    return {"days": days, "working_dates": sorted(marks), "paid_days": paid, "comp_off_days": comp, "lop_days": lop,
            "balance": bal, "message": ", ".join(parts) if parts else "No working days in this range",
            "has_lop": lop > 0}


def _fmt(v: Decimal) -> str:
    return f"{v.normalize():f}" if v == v.to_integral() else f"{v:.1f}"


def get(db: Session, req_id: int) -> LeaveRequest:
    req = db.get(LeaveRequest, req_id)
    if not req:
        raise NotFound("Leave request not found")
    return req


def apply(db: Session, emp: Employee, data: dict[str, Any], user) -> LeaveRequest:
    start, end = data["start_date"], data["end_date"]
    half = bool(data.get("is_half_day"))
    ltype = data.get("leave_type", "paid")
    if ltype not in ("paid", "comp_off"):
        raise ValidationFailed("Leave type must be paid or comp_off")
    if not (data.get("reason") or "").strip():
        raise ValidationFailed("Please give a reason")
    for cyc in cycle_service.ensure_range(db, start, end):
        if cyc.status == "locked":
            cycle_service.assert_open_for(db, cyc.start_date)
    overlap = db.scalar(select(LeaveRequest).where(
        LeaveRequest.employee_id == emp.id, LeaveRequest.status.in_(("pending", "approved")),
        LeaveRequest.start_date <= end, LeaveRequest.end_date >= start))
    if overlap:
        raise Conflict(f"Overlaps with an existing {overlap.status} request ({overlap.start_date} – {overlap.end_date})",
                       code="overlap")
    pv = preview(db, emp, start, end, half, ltype)
    if pv["days"] == 0:
        raise ValidationFailed("The selected range has no working days")
    req = LeaveRequest(employee_id=emp.id, start_date=start, end_date=end, is_half_day=half, leave_type=ltype,
                       reason=data["reason"].strip(), attachment_path=data.get("attachment_path"), days=pv["days"],
                       paid_days_estimate=pv["paid_days"], lop_days_estimate=pv["lop_days"], status="pending",
                       requested_by_id=getattr(user, "id", None))
    db.add(req)
    db.flush()
    audit_service.log(db, user, "leave.apply", "leave_request", req.id,
                      f"{emp.code} applied for {pv['days']} day(s) {start}–{end}", None,
                      {"start": start, "end": end, "days": pv["days"], "type": ltype})
    notification_service.notify(db, notification_service.approver_user_ids(db, emp),
                                f"Leave request from {emp.full_name}",
                                f"{start:%d %b} – {end:%d %b}: {pv['message']}", "approval", "/leave?tab=approvals")
    # HR applying on behalf: auto-approve when requested
    if data.get("auto_approve") and user.role_name == access.HR:
        decide(db, req, "approve", user, "Recorded by HR")
    return req


def decide(db: Session, req: LeaveRequest, action: str, user, note: str | None = None) -> LeaveRequest:
    emp = db.get(Employee, req.employee_id)
    if req.status != "pending":
        raise ValidationFailed(f"Request is already {req.status}")
    access.ensure_approve(user, emp)
    if action == "approve":
        hol = attendance_repo.public_holidays(db, req.start_date, req.end_date)
        marks = _request_marks(emp, req.start_date, req.end_date, req.is_half_day, req.leave_type, hol)
        changes = [{"employee_id": emp.id, "date": d, "status": m.status, "note": f"Leave #{req.id}"}
                   for d, m in sorted(marks.items())]
        attendance_service.apply_changes(db, changes, user, source="leave")
        req.status = "approved"
    elif action == "reject":
        req.status = "rejected"
    else:
        raise ValidationFailed("Action must be approve or reject")
    req.approver_id = user.id
    req.decided_at = utcnow()
    req.decision_note = note
    db.flush()
    audit_service.log(db, user, f"leave.{action}", "leave_request", req.id,
                      f"{action.capitalize()}d leave of {emp.code} ({req.start_date}–{req.end_date})",
                      {"status": "pending"}, {"status": req.status, "note": note})
    uid = notification_service.user_id_for_employee(db, emp.id)
    notification_service.notify(db, [uid] if uid else [], f"Leave {req.status}",
                                f"{req.start_date:%d %b} – {req.end_date:%d %b}" + (f": {note}" if note else ""),
                                "success" if req.status == "approved" else "warning", "/me/leave")
    return req


def cancel(db: Session, req: LeaveRequest, user) -> LeaveRequest:
    emp = db.get(Employee, req.employee_id)
    if user.employee_id != emp.id and not access.can_approve_for(user, emp):
        raise access.Forbidden("You cannot cancel this request")
    if req.status not in ("pending", "approved"):
        raise ValidationFailed(f"Request is already {req.status}")
    if req.status == "approved":
        for cyc in cycle_service.ensure_range(db, req.start_date, req.end_date):
            if cyc.status == "locked":
                cycle_service.assert_open_for(db, cyc.start_date)
        attendance_service.clear_range_by_source(db, emp.id, req.start_date, req.end_date, "leave", f"Leave #{req.id}")
        recalc_service.recalc_employee_from(db, emp, req.start_date, user)
    old = req.status
    req.status = "cancelled"
    audit_service.log(db, user, "leave.cancel", "leave_request", req.id, f"Cancelled leave of {emp.code}",
                      {"status": old}, {"status": "cancelled"})
    db.flush()
    return req


def list_requests(db: Session, user, status: str | None = None, scope: str = "all", employee_id: int | None = None):
    stmt = select(LeaveRequest).join(Employee, Employee.id == LeaveRequest.employee_id)
    if status:
        stmt = stmt.where(LeaveRequest.status == status)
    if employee_id:
        stmt = stmt.where(LeaveRequest.employee_id == employee_id)
    role = user.role_name
    if scope == "approvals":  # what this user can actually decide: never their own requests
        stmt = stmt.where(LeaveRequest.employee_id != (user.employee_id or -1))
    if scope == "mine" or role == access.EMPLOYEE:
        stmt = stmt.where(LeaveRequest.employee_id == (user.employee_id or -1))
    elif role == access.MANAGER:
        stmt = stmt.where(or_(Employee.manager_id == (user.employee_id or -1),
                              LeaveRequest.employee_id == (user.employee_id or -1)))
    return stmt.order_by(LeaveRequest.created_at.desc())


# ---------------------------------------------------------------- manual ledger operations
def adjust(db: Session, emp: Employee, bucket: str, amount: Decimal, reason: str, user,
           entry_date: date | None = None, entry_type: str = "ADJUSTMENT") -> LeaveLedger:
    if bucket not in ("usable", "locked", "comp_off"):
        raise ValidationFailed("Bucket must be usable, locked or comp_off")
    if amount == 0:
        raise ValidationFailed("Amount cannot be zero")
    if abs(amount) > 365:
        raise ValidationFailed("Amount is too large")
    if not reason or len(reason.strip()) < 5:
        raise ValidationFailed("A reason (at least 5 characters) is required")
    on = entry_date or today()
    cycle_service.assert_open_for(db, on)
    bal = recalc_service.balances_now(db, emp.id, as_of=None)
    if amount < 0 and bal[bucket] + amount < 0 and not policy_service.get(db, "negative_balance_allowed"):
        raise ValidationFailed(f"This would make the {bucket.replace('_', '-')} balance negative "
                               f"(current {bal[bucket]})", code="negative_balance")
    ref = ""
    if bucket == "comp_off" and amount > 0:
        expiry = int(policy_service.get(db, "comp_off_expiry_days"))
        ref = f"expires:{(on + timedelta(days=expiry)).isoformat()}"
    row = LeaveLedger(employee_id=emp.id, entry_date=on, entry_type=entry_type, bucket=bucket,
                      amount=amount, cycle_id=None, reference=ref, note=reason.strip()[:500], is_system=False,
                      created_by_id=user.id)
    db.add(row)
    db.flush()
    audit_service.log(db, user, "ledger.adjust", "leave_ledger", row.id,
                      f"{entry_type} {amount:+} {bucket} for {emp.code}: {reason}", {"balance": bal[bucket]},
                      {"balance": bal[bucket] + amount})
    recalc_service.recalc_employee_from(db, emp, on, user)
    return row


def leave_year_bounds(db: Session, year: int) -> tuple[date, date]:
    m = int(policy_service.get(db, "leave_year_start_month") or 1)
    start = date(year, m, 1)
    end = date(year + 1, m, 1) - timedelta(days=1) if m > 1 else date(year, 12, 31)
    return start, end


def carry_forward_preview(db: Session, year: int) -> dict[str, Any]:
    start, end = leave_year_bounds(db, year)
    cap_raw = policy_service.get(db, "carry_forward_cap")
    cap = Decimal(str(cap_raw)) if cap_raw not in (None, "") else None
    from app.repositories import ledger_repo
    emps = employee_repo.employed_between(db, end, end)
    totals = ledger_repo.bucket_totals(db, [e.id for e in emps], up_to=end)
    posted = set(db.scalars(select(LeaveLedger.employee_id).where(LeaveLedger.entry_type == "CARRY_FORWARD",
                                                                  LeaveLedger.reference == f"CF-{year}")))
    rows = []
    for e in emps:
        bal = totals.get(e.id, {}).get("usable", D0)
        carry = bal if cap is None else min(bal, cap)
        lapse = max(D0, bal - carry)
        rows.append({"employee_id": e.id, "code": e.code, "full_name": e.full_name, "balance": bal,
                     "carry_forward": carry, "lapse": lapse, "locked": totals.get(e.id, {}).get("locked", D0),
                     "already_posted": e.id in posted})
    return {"year": year, "year_start": start, "year_end": end, "cap": cap, "rows": rows,
            "already_posted": bool(posted) and len(posted) >= len(emps)}


def carry_forward_post(db: Session, year: int, user) -> dict[str, Any]:
    pv = carry_forward_preview(db, year)
    if pv["year_end"] >= today():
        raise ValidationFailed("The leave year has not ended yet")
    posted = 0
    for r in pv["rows"]:
        if r["already_posted"]:
            continue
        db.add(LeaveLedger(employee_id=r["employee_id"], entry_date=pv["year_end"], entry_type="CARRY_FORWARD",
                           bucket="usable", amount=-r["lapse"], reference=f"CF-{year}", is_system=False,
                           note=f"Carried forward {r['carry_forward']} day(s)"
                                + (f"; {r['lapse']} lapsed above cap" if r["lapse"] else ""),
                           created_by_id=getattr(user, "id", None)))
        posted += 1
    db.flush()
    audit_service.log(db, user, "leave.carry_forward", "leave_ledger", year, f"Year-end carry forward {year}: "
                      f"{posted} employee(s)", None, {"cap": pv["cap"], "posted": posted})
    if any(r["lapse"] for r in pv["rows"]):
        recalc_service.recalc_open_from(db, pv["year_end"], user)
    return {"posted": posted, "year": year}


def encashment_preview(db: Session, emp: Employee) -> dict[str, Any]:
    """Days to encash at exit (the usable balance). Accounts converts days to money."""
    bal = recalc_service.balances_now(db, emp.id, as_of=None)
    days = max(D0, bal["usable"])
    posted = db.scalar(select(LeaveLedger).where(LeaveLedger.employee_id == emp.id,
                                                 LeaveLedger.entry_type == "ENCASHMENT"))
    return {"employee_id": emp.id, "usable": bal["usable"], "locked": bal["locked"], "comp_off": bal["comp_off"],
            "days": days, "already_posted": posted is not None, "exit_date": emp.exit_date}


def encashment_post(db: Session, emp: Employee, user) -> dict[str, Any]:
    pv = encashment_preview(db, emp)
    if pv["already_posted"]:
        raise Conflict("Encashment already posted for this employee")
    if pv["days"] <= 0:
        raise ValidationFailed("No usable balance to encash")
    on = emp.exit_date or today()
    db.add(LeaveLedger(employee_id=emp.id, entry_date=on, entry_type="ENCASHMENT", bucket="usable",
                       amount=-pv["days"], reference="exit-encashment", is_system=False,
                       note=f"Encashed {pv['days']} day(s) at exit (amount computed by Accounts)", created_by_id=user.id))
    db.flush()
    audit_service.log(db, user, "leave.encash", "employee", emp.id, f"Encashed {pv['days']} day(s) for {emp.code}",
                      None, pv)
    return pv
