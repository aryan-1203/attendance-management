"""Collection Dashboard attendance sync: go-live backfill + daily window."""
from datetime import date

from app.models import Attendance
from app.services import collection_attendance_sync as cas
from app.services import cycle_service
from app.utils import timeutil
from sqlalchemy import select


def _patch_collection(monkeypatch, records_by_range: dict[tuple[str, str], list]):
    monkeypatch.setattr(cas.settings, "collection_api_base_url", "https://collection.test")
    monkeypatch.setattr(cas.settings, "collection_api_key", "test-key")
    monkeypatch.setattr(cas.settings, "collection_sync_start_date", date(2026, 11, 19))

    def fake_fetch(start: date, end: date):
        key = (start.isoformat(), end.isoformat())
        if key in records_by_range:
            return records_by_range[key]
        # Return any records that fall inside the requested window.
        out = []
        for (s, e), rows in records_by_range.items():
            for r in rows:
                d = str(r["attendance_date"])[:10]
                if start.isoformat() <= d <= end.isoformat():
                    out.append(r)
        return out

    monkeypatch.setattr(cas, "_fetch_collection_records", fake_fetch)


def test_backfill_from_nov_19_fills_blank_marks(world, monkeypatch):
    db, hr, emp = world["db"], world["users"]["hr"], world["perm"]
    emp.email = "pat@prosparity.in"
    db.flush()
    timeutil.set_today(date(2026, 11, 25))
    cycle_service.ensure_range(db, date(2026, 10, 20), date(2026, 12, 19))

    _patch_collection(monkeypatch, {
        ("2026-11-19", "2026-11-25"): [
            {"email": "pat@prosparity.in", "attendance_date": "2026-11-19", "status": "ON_TIME"},
            {"email": "pat@prosparity.in", "attendance_date": "2026-11-20", "status": "LATE"},
            {"email": "pat@prosparity.in", "attendance_date": "2026-11-21", "status": "ON_TIME"},
            {"email": "ghost@x.com", "attendance_date": "2026-11-21", "status": "ON_TIME"},
        ],
    })

    summary = cas.backfill(db, user=hr)
    db.commit()

    assert summary["start_date"] == date(2026, 11, 19)
    assert summary["end_date"] == date(2026, 11, 25)
    assert summary["applied"] == 3
    assert summary["skipped_unmatched_email"] == 1

    rows = list(db.scalars(select(Attendance).where(Attendance.employee_id == emp.id)))
    by_date = {a.date: a for a in rows}
    assert set(by_date) == {date(2026, 11, 19), date(2026, 11, 20), date(2026, 11, 21)}
    assert by_date[date(2026, 11, 19)].status == "P" and by_date[date(2026, 11, 19)].is_late is False
    assert by_date[date(2026, 11, 20)].status == "P" and by_date[date(2026, 11, 20)].is_late is True
    assert by_date[date(2026, 11, 19)].source == "collection"

    # Idempotent — second backfill must not overwrite / re-apply.
    summary2 = cas.backfill(db, user=hr)
    assert summary2["applied"] == 0
    assert summary2["skipped_existing"] == 3


def test_sync_clamps_before_go_live_and_daily_window(world, monkeypatch):
    db, hr, emp = world["db"], world["users"]["hr"], world["perm"]
    emp.email = "pat@prosparity.in"
    db.flush()
    timeutil.set_today(date(2026, 11, 25))
    cycle_service.ensure_range(db, date(2026, 10, 20), date(2026, 12, 19))

    calls: list[tuple[date, date]] = []

    def fake_fetch(start: date, end: date):
        calls.append((start, end))
        return [{"email": "pat@prosparity.in", "attendance_date": start.isoformat(), "status": "ON_TIME"}]

    monkeypatch.setattr(cas.settings, "collection_api_base_url", "https://collection.test")
    monkeypatch.setattr(cas.settings, "collection_api_key", "test-key")
    monkeypatch.setattr(cas.settings, "collection_sync_start_date", date(2026, 11, 19))
    monkeypatch.setattr(cas, "_fetch_collection_records", fake_fetch)

    # Requesting before go-live is clamped to 19 Nov.
    cas.sync(db, start=date(2026, 11, 1), end=date(2026, 11, 20), user=hr)
    assert calls[-1] == (date(2026, 11, 19), date(2026, 11, 20))

    calls.clear()
    recent = cas.sync_recent(db, user=hr)
    assert recent is not None
    assert calls[-1] == (date(2026, 11, 24), date(2026, 11, 25))


def test_omitted_dates_catch_up_from_go_live(world, monkeypatch):
    db, hr, emp = world["db"], world["users"]["hr"], world["perm"]
    emp.email = "pat@prosparity.in"
    db.flush()
    timeutil.set_today(date(2026, 11, 25))
    cycle_service.ensure_range(db, date(2026, 10, 20), date(2026, 12, 19))

    calls: list[tuple[date, date]] = []

    def fake_fetch(start: date, end: date):
        calls.append((start, end))
        return []

    monkeypatch.setattr(cas.settings, "collection_api_base_url", "https://collection.test")
    monkeypatch.setattr(cas.settings, "collection_api_key", "test-key")
    monkeypatch.setattr(cas.settings, "collection_sync_start_date", date(2026, 11, 19))
    monkeypatch.setattr(cas, "_fetch_collection_records", fake_fetch)

    cas.sync(db, user=hr)
    assert calls == [(date(2026, 11, 19), date(2026, 11, 25))]
