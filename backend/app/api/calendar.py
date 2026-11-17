import io
from datetime import date

from fastapi import APIRouter, File, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import DB, CurrentUser, HROnly
from app.core.errors import Conflict, CycleLocked, NotFound, ValidationFailed
from app.models import Holiday, SalaryCycle, User
from app.schemas.common import CycleOut, HolidayIn, HolidayOut, HolidayUpdate
from app.schemas.ops import BulkResultOut, LockIn, UnlockIn
from app.services import cycle_service, holiday_service, recalc_service, report_service

holidays = APIRouter(prefix="/holidays", tags=["holidays"])
cycles = APIRouter(prefix="/cycles", tags=["cycles"])


@holidays.get("", response_model=list[HolidayOut])
def list_holidays(year: int | None = None, db: Session = DB, _=CurrentUser):
    return holiday_service.list_holidays(db, year)


@holidays.post("", response_model=HolidayOut, status_code=201)
def create_holiday(body: HolidayIn, db: Session = DB, user: User = HROnly):
    h = holiday_service.create(db, body.model_dump(), user)
    db.commit()
    return h


@holidays.patch("/{holiday_id}", response_model=HolidayOut)
def update_holiday(holiday_id: int, body: HolidayUpdate, db: Session = DB, user: User = HROnly):
    h = db.get(Holiday, holiday_id)
    if not h:
        raise NotFound("Holiday not found")
    h = holiday_service.update(db, h, body.model_dump(exclude_unset=True), user)
    db.commit()
    return h


@holidays.delete("/{holiday_id}", status_code=204)
def delete_holiday(holiday_id: int, db: Session = DB, user: User = HROnly):
    holiday_service.delete(db, holiday_id, user)
    db.commit()


@holidays.post("/import", response_model=BulkResultOut)
async def import_holidays(file: UploadFile = File(...), dry_run: bool = True, db: Session = DB, user: User = HROnly):
    import pandas as pd

    from app.services.import_service import parse_date_header
    content = await file.read()
    try:
        df = (pd.read_csv(io.BytesIO(content), dtype=object, keep_default_na=False)
              if (file.filename or "").lower().endswith(".csv") else pd.read_excel(io.BytesIO(content), dtype=object))
    except Exception as exc:  # noqa: BLE001
        raise ValidationFailed(f"Could not read file: {exc}") from exc
    cols = {str(c).strip().lower(): c for c in df.columns}
    dc, nc = cols.get("date"), cols.get("name") or cols.get("holiday")
    kc = cols.get("type") or cols.get("kind")
    if dc is None or nc is None:
        raise ValidationFailed("File needs Date and Name columns")
    created, errors, earliest = 0, [], None
    for i, row in enumerate(df.to_dict("records"), start=2):
        d = parse_date_header(row[dc])
        name = str(row[nc] or "").strip()
        kind = str(row[kc]).strip().lower() if kc and row.get(kc) not in (None, "") else "public"
        try:
            if not d or not name:
                raise ValidationFailed("Date and name are required")
            with db.begin_nested():
                holiday_service.create(db, {"date": d, "name": name, "kind": kind}, user, recalc=False)
            created += 1
            earliest = d if earliest is None else min(earliest, d)
        except (ValidationFailed, Conflict, CycleLocked) as exc:
            errors.append({"row": i, "code": name, "message": exc.message})
    if dry_run:
        db.rollback()
    else:
        if earliest:
            recalc_service.recalc_open_from(db, earliest, user)
        db.commit()
    return {"dry_run": dry_run, "total": created + len(errors), "created": created, "updated": 0, "errors": errors}


@cycles.get("", response_model=list[CycleOut])
def list_cycles(db: Session = DB, _=CurrentUser):
    out = cycle_service.list_cycles(db)
    db.commit()
    return list(reversed(out))


@cycles.get("/current", response_model=CycleOut)
def current(db: Session = DB, _=CurrentUser):
    c = cycle_service.current(db)
    db.commit()
    return c


@cycles.get("/for-date", response_model=CycleOut)
def for_date(on: date, db: Session = DB, _=CurrentUser):
    c = cycle_service.get_or_create_for(db, on)
    db.commit()
    return c


@cycles.get("/{cycle_id}", response_model=CycleOut)
def get_cycle(cycle_id: int, db: Session = DB, _=CurrentUser):
    return cycle_service.get(db, cycle_id)


@cycles.get("/{cycle_id}/close-checks")
def close_checks(cycle_id: int, db: Session = DB, _=HROnly):
    return report_service.close_checks(db, cycle_service.get(db, cycle_id))


@cycles.post("/{cycle_id}/lock")
def lock(cycle_id: int, body: LockIn, db: Session = DB, user: User = HROnly):
    out = report_service.lock_cycle(db, cycle_service.get(db, cycle_id), user, body.acknowledge_warnings)
    db.commit()
    return out


@cycles.post("/{cycle_id}/unlock", response_model=CycleOut)
def unlock(cycle_id: int, body: UnlockIn, db: Session = DB, user: User = HROnly):
    c = report_service.unlock_cycle(db, cycle_service.get(db, cycle_id), user, body.reason)
    db.commit()
    return c


@cycles.post("/{cycle_id}/recalculate")
def recalculate(cycle_id: int, db: Session = DB, user: User = HROnly):
    cyc: SalaryCycle = cycle_service.get(db, cycle_id)
    out = recalc_service.recalc_open_from(db, cyc.start_date, user)
    db.commit()
    return {"cycles": out}


