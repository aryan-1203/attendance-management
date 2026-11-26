"""Pull Collection Dashboard attendance and fill blank HR marks (email match)."""
from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import AppError, CycleLocked, ValidationFailed
from app.models import Employee
from app.repositories import attendance_repo
from app.services import attendance_service, cycle_service
from app.utils.timeutil import today

log = logging.getLogger("prosparity.collection_sync")

SOURCE = "collection"
# Collection integration API rejects ranges longer than this.
MAX_CHUNK_DAYS = 62


def configured() -> bool:
    return bool(settings.collection_api_base_url.strip() and settings.collection_api_key.strip())


def sync_floor() -> date:
    """Earliest date Collection marks may be written into HR."""
    return settings.collection_sync_start_date


def _fetch_collection_records(start: date, end: date) -> list[dict[str, Any]]:
    base = settings.collection_api_base_url.rstrip("/")
    url = f"{base}/api/v1/integration/attendance"
    try:
        with httpx.Client(timeout=60.0) as client:
            res = client.get(
                url,
                params={"start_date": start.isoformat(), "end_date": end.isoformat()},
                headers={"X-API-Key": settings.collection_api_key},
            )
    except httpx.HTTPError as exc:
        raise AppError(
            f"Could not reach Collection Dashboard: {exc}",
            code="collection_unreachable",
            status_code=502,
        ) from exc

    if res.status_code == 401:
        raise AppError("Collection API key was rejected", code="collection_unauthorized", status_code=502)
    if res.status_code == 503:
        raise AppError(
            "Collection HR integration API key is not configured",
            code="collection_misconfigured",
            status_code=502,
        )
    if res.status_code >= 400:
        detail = res.text[:500]
        raise AppError(
            f"Collection API error ({res.status_code}): {detail}",
            code="collection_error",
            status_code=502,
        )

    body = res.json()
    records = body.get("records") if isinstance(body, dict) else None
    if not isinstance(records, list):
        raise AppError("Unexpected Collection API response", code="collection_error", status_code=502)
    return records


def _email_employee_map(db: Session) -> dict[str, Employee]:
    rows = list(db.scalars(select(Employee).where(Employee.deleted_at.is_(None), Employee.email.isnot(None))))
    out: dict[str, Employee] = {}
    for emp in rows:
        email = (emp.email or "").strip().lower()
        if email and email not in out:
            out[email] = emp
    return out


def _cycle_open_cache(db: Session, dates: set[date]) -> dict[date, bool]:
    """True if the salary cycle for that date is open (writable)."""
    cache: dict[date, bool] = {}
    for on in sorted(dates):
        if on in cache:
            continue
        try:
            cycle_service.assert_open_for(db, on)
            cache[on] = True
        except CycleLocked:
            cache[on] = False
    return cache


def _empty_summary(start: date, end: date) -> dict[str, Any]:
    return {
        "fetched": 0,
        "matched": 0,
        "applied": 0,
        "skipped_existing": 0,
        "skipped_unmatched_email": 0,
        "skipped_locked": 0,
        "skipped_other": 0,
        "start_date": start,
        "end_date": end,
    }


def _merge_summaries(parts: list[dict[str, Any]], start: date, end: date) -> dict[str, Any]:
    out = _empty_summary(start, end)
    for part in parts:
        for key in (
            "fetched",
            "matched",
            "applied",
            "skipped_existing",
            "skipped_unmatched_email",
            "skipped_locked",
            "skipped_other",
        ):
            out[key] += int(part.get(key) or 0)
    return out


def sync(db: Session, start: date | None = None, end: date | None = None, user=None) -> dict[str, Any]:
    """
    Fetch Collection marks for [start, end] and insert Present only where HR has no mark.
    Never overwrites existing attendance rows.

    When both dates are omitted, catch up from collection_sync_start_date through today
    (chunked). Otherwise defaults each missing bound to today, then clamps start to the
    Collection go-live floor.
    """
    if not configured():
        raise AppError(
            "Collection sync is not configured. Set COLLECTION_API_BASE_URL and COLLECTION_API_KEY.",
            code="collection_not_configured",
            status_code=400,
        )

    t = today()
    floor = sync_floor()
    if start is None and end is None:
        start, end = floor, t
    else:
        start = start or t
        end = end or t

    if start < floor:
        start = floor
    if end < start:
        raise ValidationFailed("end_date must be on or after start_date")
    if end > t:
        end = t
    if start > t:
        return _empty_summary(start, end)

    # Long catch-ups (e.g. go-live → today months later) are split for the Collection API.
    if (end - start).days > MAX_CHUNK_DAYS:
        return sync_range(db, start, end, user=user)

    return _sync_chunk(db, start, end, user=user)


def sync_range(db: Session, start: date, end: date, user=None) -> dict[str, Any]:
    """Sync [start, end] in ≤62-day chunks and aggregate counts."""
    parts: list[dict[str, Any]] = []
    cursor = start
    while cursor <= end:
        chunk_end = min(cursor + timedelta(days=MAX_CHUNK_DAYS), end)
        parts.append(_sync_chunk(db, cursor, chunk_end, user=user))
        cursor = chunk_end + timedelta(days=1)
    return _merge_summaries(parts, start, end)


def _sync_chunk(db: Session, start: date, end: date, user=None) -> dict[str, Any]:
    records = _fetch_collection_records(start, end)
    by_email = _email_employee_map(db)
    t = today()

    candidate_dates = set()
    parsed: list[tuple[Employee, date, bool]] = []
    skipped_unmatched = 0
    skipped_other = 0

    for rec in records:
        email = str(rec.get("email") or "").strip().lower()
        raw_date = rec.get("attendance_date")
        status = str(rec.get("status") or "").upper()
        if not email or not raw_date:
            skipped_other += 1
            continue
        emp = by_email.get(email)
        if not emp:
            skipped_unmatched += 1
            continue
        try:
            on = date.fromisoformat(str(raw_date)[:10])
        except ValueError:
            skipped_other += 1
            continue
        if on < start or on > end:
            skipped_other += 1
            continue
        if on > t:
            skipped_other += 1
            continue
        if on < emp.date_of_joining or (emp.exit_date and on > emp.exit_date):
            skipped_other += 1
            continue
        is_late = status == "LATE"
        candidate_dates.add(on)
        parsed.append((emp, on, is_late))

    emp_ids = list({e.id for e, _, _ in parsed})
    existing = {
        (a.employee_id, a.date)
        for a in (attendance_repo.for_range(db, start, end, emp_ids) if emp_ids else [])
    }
    open_by_date = _cycle_open_cache(db, candidate_dates)

    changes: list[dict[str, Any]] = []
    seen_keys: set[tuple[int, date]] = set()
    skipped_existing = 0
    skipped_locked = 0
    matched = 0

    for emp, on, is_late in parsed:
        matched += 1
        key = (emp.id, on)
        if key in seen_keys:
            continue
        if key in existing:
            skipped_existing += 1
            continue
        if not open_by_date.get(on, False):
            skipped_locked += 1
            continue
        seen_keys.add(key)
        changes.append({
            "employee_id": emp.id,
            "date": on,
            "status": "P",
            "is_late": is_late,
            "note": "Synced from Collection Dashboard",
        })

    applied_count = 0
    if changes:
        # apply_changes is all-or-nothing; pre-filtered so should not hit locked/overwrite.
        result = attendance_service.apply_changes(db, changes, user, source=SOURCE)
        applied_count = len(result.get("applied") or [])

    summary = {
        "fetched": len(records),
        "matched": matched,
        "applied": applied_count,
        "skipped_existing": skipped_existing,
        "skipped_unmatched_email": skipped_unmatched,
        "skipped_locked": skipped_locked,
        "skipped_other": skipped_other,
        "start_date": start,
        "end_date": end,
    }
    log.info("collection attendance sync: %s", summary)
    return summary


def backfill(db: Session, user=None) -> dict[str, Any]:
    """One-shot / catch-up: Collection go-live date through today."""
    return sync(db, start=sync_floor(), end=today(), user=user)


def sync_recent(db: Session, user=None) -> dict[str, Any] | None:
    """Daily job: yesterday + today (clamped to go-live). No-op when not configured."""
    if not configured():
        return None
    t = today()
    return sync(db, start=t - timedelta(days=1), end=t, user=user)
