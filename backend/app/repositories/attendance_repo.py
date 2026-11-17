from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Attendance, Holiday


def for_range(db: Session, start: date, end: date, employee_ids: list[int] | None = None) -> list[Attendance]:
    stmt = select(Attendance).where(Attendance.date >= start, Attendance.date <= end)
    if employee_ids is not None:
        stmt = stmt.where(Attendance.employee_id.in_(employee_ids or [-1]))
    return list(db.scalars(stmt))


def get(db: Session, employee_id: int, on: date) -> Attendance | None:
    return db.scalar(select(Attendance).where(Attendance.employee_id == employee_id, Attendance.date == on))


def public_holidays(db: Session, start: date, end: date) -> dict[date, str]:
    rows = db.scalars(select(Holiday).where(Holiday.date >= start, Holiday.date <= end, Holiday.kind == "public"))
    return {h.date: h.name for h in rows}
