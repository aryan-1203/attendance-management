from datetime import date

from sqlalchemy import Select, or_, select
from sqlalchemy.orm import Session

from app.models import Employee


def base_query(include_deleted: bool = False) -> Select:
    stmt = select(Employee)
    if not include_deleted:
        stmt = stmt.where(Employee.deleted_at.is_(None))
    return stmt


def filtered(search: str | None = None, department_id: int | None = None, employment_type: str | None = None,
             status: str | None = None, manager_employee_id: int | None = None,
             active_between: tuple[date, date] | None = None) -> Select:
    stmt = base_query()
    if search:
        like = f"%{search.strip()}%"
        stmt = stmt.where(or_(Employee.full_name.ilike(like), Employee.code.ilike(like), Employee.email.ilike(like)))
    if department_id:
        stmt = stmt.where(Employee.department_id == department_id)
    if employment_type:
        stmt = stmt.where(Employee.employment_type == employment_type)
    if status:
        stmt = stmt.where(Employee.status == status)
    if manager_employee_id:
        stmt = stmt.where(Employee.manager_id == manager_employee_id)
    if active_between:
        start, end = active_between
        stmt = stmt.where(Employee.date_of_joining <= end,
                          or_(Employee.exit_date.is_(None), Employee.exit_date >= start))
    return stmt


def employed_between(db: Session, start: date, end: date) -> list[Employee]:
    return list(db.scalars(filtered(active_between=(start, end)).order_by(Employee.code)))


def by_code(db: Session, code: str) -> Employee | None:
    return db.scalar(base_query().where(Employee.code == code))


def team_ids(db: Session, manager_employee_id: int) -> list[int]:
    return list(db.scalars(select(Employee.id).where(Employee.manager_id == manager_employee_id,
                                                     Employee.deleted_at.is_(None))))
