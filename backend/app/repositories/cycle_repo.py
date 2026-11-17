from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import SalaryCycle


def containing(db: Session, on: date) -> SalaryCycle | None:
    return db.scalar(select(SalaryCycle).where(SalaryCycle.start_date <= on, SalaryCycle.end_date >= on))


def overlapping(db: Session, start: date, end: date) -> list[SalaryCycle]:
    return list(db.scalars(select(SalaryCycle).where(SalaryCycle.start_date <= end, SalaryCycle.end_date >= start)
                           .order_by(SalaryCycle.start_date)))


def from_date(db: Session, start: date, until: date | None = None) -> list[SalaryCycle]:
    stmt = select(SalaryCycle).where(SalaryCycle.end_date >= start)
    if until:
        stmt = stmt.where(SalaryCycle.start_date <= until)
    return list(db.scalars(stmt.order_by(SalaryCycle.start_date)))


def all_cycles(db: Session) -> list[SalaryCycle]:
    return list(db.scalars(select(SalaryCycle).order_by(SalaryCycle.start_date)))
