from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import Conflict, CycleLocked, NotFound, ValidationFailed
from app.models import Holiday
from app.repositories import cycle_repo
from app.services import audit_service, recalc_service

KINDS = ("public", "optional", "restricted")


def _check_cycle_open(db: Session, on: date) -> None:
    cyc = cycle_repo.containing(db, on)
    if cyc and cyc.status == "locked":
        raise CycleLocked(f"{on.isoformat()} falls in locked cycle {cyc.label}; unlock it first")


def list_holidays(db: Session, year: int | None = None) -> list[Holiday]:
    stmt = select(Holiday).order_by(Holiday.date)
    if year:
        stmt = stmt.where(Holiday.date >= date(year, 1, 1), Holiday.date <= date(year, 12, 31))
    return list(db.scalars(stmt))


def create(db: Session, data: dict, user, recalc: bool = True) -> Holiday:
    if data.get("kind", "public") not in KINDS:
        raise ValidationFailed("Holiday type must be public, optional or restricted")
    _check_cycle_open(db, data["date"])
    if db.scalar(select(Holiday).where(Holiday.date == data["date"], Holiday.name == data["name"])):
        raise Conflict("This holiday already exists")
    h = Holiday(**data)
    db.add(h)
    db.flush()
    audit_service.log(db, user, "holiday.create", "holiday", h.id, f"Added holiday {h.name} on {h.date}", None,
                      {"date": h.date, "name": h.name, "kind": h.kind})
    if recalc:
        recalc_service.recalc_open_from(db, h.date, user)
    return h


def update(db: Session, h: Holiday, data: dict, user) -> Holiday:
    old = {"date": h.date, "name": h.name, "kind": h.kind, "description": h.description}
    _check_cycle_open(db, h.date)
    if "date" in data:
        _check_cycle_open(db, data["date"])
    for k, v in data.items():
        setattr(h, k, v)
    db.flush()
    audit_service.log(db, user, "holiday.update", "holiday", h.id, f"Updated holiday {h.name}", old,
                      {"date": h.date, "name": h.name, "kind": h.kind, "description": h.description})
    recalc_service.recalc_open_from(db, min(old["date"], h.date), user)
    return h


def delete(db: Session, holiday_id: int, user) -> None:
    h = db.get(Holiday, holiday_id)
    if not h:
        raise NotFound("Holiday not found")
    _check_cycle_open(db, h.date)
    on = h.date
    audit_service.log(db, user, "holiday.delete", "holiday", h.id, f"Deleted holiday {h.name} on {h.date}",
                      {"date": h.date, "name": h.name, "kind": h.kind}, None)
    db.delete(h)
    db.flush()
    recalc_service.recalc_open_from(db, on, user)
