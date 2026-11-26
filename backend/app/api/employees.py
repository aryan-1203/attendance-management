from datetime import timedelta
from decimal import Decimal

from fastapi import APIRouter, File, Query, UploadFile
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import DB, CurrentUser, HROnly, Staff
from app.core.errors import Conflict, ValidationFailed
from app.models import Department, Designation, Employee, User
from app.repositories import employee_repo
from app.repositories.base import paginate
from app.schemas.common import (DepartmentOut, EmployeeIn, EmployeeOut, EmployeeUpdate, LedgerEntryOut, Lookup,
                                NamedIn, PageOut, page_out)
from app.schemas.ops import BulkResultOut, CompOffOut, ConfirmIn, ExitIn
from app.services import access, attendance_service, audit_service, cycle_service, employee_service
from app.utils import excel_styles as xs
from app.utils.timeutil import today

router = APIRouter(prefix="/employees", tags=["employees"])
meta = APIRouter(tags=["meta"])

SORTABLE = {"code": Employee.code, "full_name": Employee.full_name, "date_of_joining": Employee.date_of_joining,
            "employment_type": Employee.employment_type,
            "status": Employee.status}


@router.get("", response_model=PageOut[EmployeeOut])
def list_employees(db: Session = DB, user: User = CurrentUser, search: str | None = None,
                   department_id: int | None = None, employment_type: str | None = None, status: str | None = None,
                   page: int = 1, page_size: int = Query(25, le=1000), sort: str | None = "code"):
    mgr = None
    if user.role_name == access.MANAGER:
        mgr = user.employee_id or -1
    elif user.role_name == access.EMPLOYEE:
        stmt = employee_repo.base_query().where(Employee.id == (user.employee_id or -1))
        return page_out(paginate(db, stmt, 1, 1), EmployeeOut)
    stmt = employee_repo.filtered(search, department_id, employment_type, status, mgr)
    return page_out(paginate(db, stmt, page, page_size, sort, SORTABLE, Employee.code), EmployeeOut)


@router.post("", response_model=EmployeeOut, status_code=201)
def create_employee(body: EmployeeIn, db: Session = DB, user: User = HROnly):
    emp = employee_service.create(db, body.model_dump(), user)
    db.commit()
    return emp


@router.get("/export.xlsx")
def export_employees(db: Session = DB, user: User = HROnly):
    emps = list(db.scalars(employee_repo.base_query().order_by(Employee.code)))
    bal = employee_service.all_balances(db, [e.id for e in emps])
    from app.services import policy_service
    rows = [{"code": e.code, "full_name": e.full_name, "department": e.department.name if e.department else "",
             "designation": e.designation.name if e.designation else "", "doj": e.date_of_joining,
             "type": e.employment_type, "confirmation": e.confirmation_date, "exit": e.exit_date,
             "email": e.email or "", "phone": e.phone or "", "status": e.status,
             "usable": bal.get(e.id, {}).get("usable", Decimal(0)), "locked": bal.get(e.id, {}).get("locked", Decimal(0))}
            for e in emps]
    wb = xs.new_workbook()
    ws = wb.active
    ws.title = "Employees"
    xs.write_table(ws, [xs.Col("code", "Emp Code"), xs.Col("full_name", "Name"), xs.Col("department", "Department"),
                        xs.Col("designation", "Designation"), xs.Col("doj", "DOJ", "date"),
                        xs.Col("type", "Employment Type"), xs.Col("confirmation", "Confirmation Date", "date"),
                        xs.Col("exit", "Exit Date", "date"),
                        xs.Col("email", "Email"), xs.Col("phone", "Phone"), xs.Col("status", "Status"),
                        xs.Col("usable", "Usable Balance", "days", True), xs.Col("locked", "Locked", "days", True)],
                   rows, title=xs.TitleBlock(policy_service.get(db, "company_name"), "Employee Master", None,
                                             user.full_name), freeze_cols=2)
    return Response(xs.to_bytes(wb), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": 'attachment; filename="employees.xlsx"'})


IMPORT_FIELDS = {"emp code": "code", "employee code": "code", "code": "code", "name": "full_name",
                 "full name": "full_name", "employee name": "full_name", "department": "department",
                 "designation": "designation", "manager code": "manager_code", "doj": "date_of_joining",
                 "date of joining": "date_of_joining", "probation end date": "probation_end_date",
                 "confirmation date": "confirmation_date", "exit date": "exit_date",
                 "employment type": "employment_type", "type": "employment_type", "email": "email", "phone": "phone", "date of birth": "date_of_birth",
                 "dob": "date_of_birth", "weekly off": "weekly_off"}


@router.post("/import", response_model=BulkResultOut)
async def import_employees(file: UploadFile = File(...), dry_run: bool = True, db: Session = DB, user: User = HROnly):
    import io

    import pandas as pd

    from app.services.import_service import parse_date_header
    content = await file.read()
    try:
        if (file.filename or "").lower().endswith(".csv"):
            df = pd.read_csv(io.BytesIO(content), dtype=object, keep_default_na=False)
        else:
            raw = pd.read_excel(io.BytesIO(content), header=None, dtype=object)
            hr = next((i for i in range(min(15, len(raw))) if any(
                str(v).strip().lower() in ("emp code", "employee code", "code") for v in raw.iloc[i].tolist())), 0)
            df = pd.read_excel(io.BytesIO(content), header=hr, dtype=object)
    except Exception as exc:  # noqa: BLE001
        raise ValidationFailed(f"Could not read file: {exc}") from exc
    df.columns = [IMPORT_FIELDS.get(str(c).strip().lower(), str(c).strip().lower()) for c in df.columns]
    if "code" not in df.columns or "full_name" not in df.columns or "date_of_joining" not in df.columns:
        raise ValidationFailed("File needs Emp Code, Name and DOJ columns")
    errors, created, updated = [], 0, 0
    pending_managers = []
    for i, row in enumerate(df.to_dict("records"), start=2):
        def val(k):
            v = row.get(k)
            if v is None or (isinstance(v, float) and v != v) or str(v).strip() == "":
                return None
            return v
        code = str(val("code") or "").strip()
        if not code:
            continue
        try:
            data = {"code": code, "full_name": str(val("full_name") or "").strip()}
            for f in ("date_of_joining", "probation_end_date", "confirmation_date", "exit_date", "date_of_birth"):
                v = val(f)
                if v is not None:
                    d = parse_date_header(v)
                    if d is None:
                        raise ValidationFailed(f"Invalid {f.replace('_', ' ')} '{v}'")
                    data[f] = d
            if "date_of_joining" not in data:
                raise ValidationFailed("DOJ is required")
            et = val("employment_type")
            if et:
                data["employment_type"] = str(et).strip().lower()
            for f in ("email", "phone", "weekly_off"):
                if val(f) is not None:
                    data[f] = str(val(f)).strip()
            if not dry_run:
                data["department_id"] = employee_service.get_or_create_department(db, val("department"))
                data["designation_id"] = employee_service.get_or_create_designation(db, val("designation"))
            existing = employee_repo.by_code(db, code)
            with db.begin_nested():
                if existing:
                    data.pop("code")
                    if not dry_run:
                        employee_service.update(db, existing, data, user)
                    updated += 1
                else:
                    if not data["full_name"]:
                        raise ValidationFailed("Name is required")
                    if not dry_run:
                        employee_service.create(db, data, user)
                    created += 1
            if val("manager_code"):
                pending_managers.append((code, str(val("manager_code")).strip()))
        except (ValidationFailed, Conflict) as exc:
            errors.append({"row": i, "code": code, "message": exc.message})
    if not dry_run:
        for code, mcode in pending_managers:
            e, m = employee_repo.by_code(db, code), employee_repo.by_code(db, mcode)
            if e and m and e.id != m.id:
                e.manager_id = m.id
        audit_service.log(db, user, "employee.import", "employee", "", f"Imported employees: {created} new, "
                          f"{updated} updated, {len(errors)} errors")
        db.commit()
    else:
        db.rollback()
    return {"dry_run": dry_run, "total": created + updated + len(errors), "created": created, "updated": updated,
            "errors": errors}


@router.get("/{emp_id}", response_model=EmployeeOut)
def get_employee(emp_id: int, db: Session = DB, user: User = CurrentUser):
    emp = employee_service.get(db, emp_id)
    access.ensure_view(user, emp)
    return emp


@router.patch("/{emp_id}", response_model=EmployeeOut)
def update_employee(emp_id: int, body: EmployeeUpdate, db: Session = DB, user: User = HROnly):
    emp = employee_service.update(db, employee_service.get(db, emp_id), body.model_dump(exclude_unset=True), user)
    db.commit()
    return emp


@router.delete("/{emp_id}", status_code=204)
def delete_employee(emp_id: int, db: Session = DB, user: User = HROnly):
    employee_service.soft_delete(db, employee_service.get(db, emp_id), user)
    db.commit()


@router.post("/{emp_id}/confirm", response_model=EmployeeOut)
def confirm(emp_id: int, body: ConfirmIn, db: Session = DB, user: User = HROnly):
    emp = employee_service.confirm(db, employee_service.get(db, emp_id), body.confirmation_date, user)
    db.commit()
    return emp


@router.post("/{emp_id}/exit", response_model=EmployeeOut)
def record_exit(emp_id: int, body: ExitIn, db: Session = DB, user: User = HROnly):
    emp = employee_service.record_exit(db, employee_service.get(db, emp_id), body.exit_date, body.reason, user)
    db.commit()
    return emp


@router.get("/{emp_id}/profile")
def profile(emp_id: int, db: Session = DB, user: User = CurrentUser):
    emp = employee_service.get(db, emp_id)
    access.ensure_view(user, emp)
    t = today()
    cyc = cycle_service.current(db)
    summary = attendance_service.employee_cycle_summary(db, emp, cyc)
    manager = employee_service.get(db, emp.manager_id) if emp.manager_id else None
    function_manager = employee_service.get(db, emp.function_manager_id) if emp.function_manager_id else None
    db.commit()  # cycle creation
    return {
        "employee": EmployeeOut.model_validate(emp).model_dump(),
        "manager": {"id": manager.id, "code": manager.code, "full_name": manager.full_name} if manager else None,
        "function_manager": (
            {"id": function_manager.id, "code": function_manager.code, "full_name": function_manager.full_name}
            if function_manager else None
        ),
        "balances": employee_service.balances(db, emp.id),
        "current_cycle": {"id": cyc.id, "label": cyc.label},
        "summary": summary,
        "heatmap": employee_service.heatmap(db, emp, t - timedelta(days=364), t),
    }


@router.get("/{emp_id}/ledger", response_model=list[LedgerEntryOut])
def ledger(emp_id: int, db: Session = DB, user: User = CurrentUser, limit: int = Query(500, le=5000)):
    emp = employee_service.get(db, emp_id)
    access.ensure_view(user, emp)
    return employee_service.ledger(db, emp.id, limit)


@router.get("/{emp_id}/comp-offs", response_model=list[CompOffOut])
def comp_offs(emp_id: int, db: Session = DB, user: User = CurrentUser):
    from app.models import CompOff
    emp = employee_service.get(db, emp_id)
    access.ensure_view(user, emp)
    return list(db.scalars(select(CompOff).where(CompOff.employee_id == emp.id).order_by(CompOff.earned_date.desc())))


# ------------------------------------------------------------------ departments / designations
@meta.get("/departments", response_model=list[DepartmentOut], tags=["meta"])
def departments(db: Session = DB, _=CurrentUser):
    return list(db.scalars(select(Department).order_by(Department.name)))


@meta.post("/departments", response_model=DepartmentOut, status_code=201, tags=["meta"])
def create_department(body: NamedIn, db: Session = DB, user: User = HROnly):
    if db.scalar(select(Department).where(Department.name == body.name)):
        raise Conflict("Department exists")
    d = Department(name=body.name, code=body.code or body.name[:3].upper())
    db.add(d)
    db.flush()
    audit_service.log(db, user, "department.create", "department", d.id, f"Created department {d.name}")
    db.commit()
    return d


@meta.get("/designations", response_model=list[Lookup], tags=["meta"])
def designations(db: Session = DB, _=CurrentUser):
    return list(db.scalars(select(Designation).order_by(Designation.name)))


@meta.post("/designations", response_model=Lookup, status_code=201, tags=["meta"])
def create_designation(body: NamedIn, db: Session = DB, user: User = HROnly):
    if db.scalar(select(Designation).where(Designation.name == body.name)):
        raise Conflict("Designation exists")
    d = Designation(name=body.name)
    db.add(d)
    db.flush()
    audit_service.log(db, user, "designation.create", "designation", d.id, f"Created designation {d.name}")
    db.commit()
    return d


@meta.get("/meta/status-codes", tags=["meta"])
def status_codes():
    return [{"code": c, "label": lbl, "settable": c not in ("NJ", "EX")} for c, lbl in [
        ("P", "Present"), ("A", "Absent"), ("HD", "Half-day"), ("L", "Approved leave"), ("WO", "Weekly off"),
        ("H", "Holiday"), ("CO", "Comp-off used"), ("WFH", "Work from home"), ("OD", "On duty"),
        ("NJ", "Not joined yet"), ("EX", "Exited")]]


@meta.get("/meta/managers", response_model=list[dict], tags=["meta"])
def managers(db: Session = DB, _=Staff):
    # Any active employee can be selected as reporting / function manager.
    rows = db.execute(
        select(Employee.id, Employee.code, Employee.full_name)
        .where(Employee.deleted_at.is_(None), Employee.status == "active")
        .order_by(Employee.full_name)
    ).all()
    return [{"id": r.id, "code": r.code, "full_name": r.full_name} for r in rows]


