"""APScheduler background jobs (single process). Jobs are idempotent and recorded in job_runs."""
import logging
from datetime import timedelta

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import select

from app.core.config import settings
from app.core.database import SessionLocal
from app.models import Employee, JobRun
from app.services import (
    collection_attendance_sync,
    cycle_service,
    leave_service,
    notification_service,
    policy_service,
    recalc_service,
)
from app.utils.timeutil import today

log = logging.getLogger("prosparity.scheduler")
_scheduler: BackgroundScheduler | None = None


def _once(db, job: str, key: str) -> bool:
    if db.scalar(select(JobRun).where(JobRun.job == job, JobRun.run_key == key, JobRun.status == "ok")):
        return False
    return True


def nightly() -> None:
    """Create the current cycle, recalc open cycles (posts accruals & comp-off expiries), alert HR."""
    db = SessionLocal()
    try:
        t = today()
        cycle_service.ensure_through_today(db)
        cur = cycle_service.current(db)
        recalc_service.recalc_open_from(db, cur.start_date - timedelta(days=1))
        key = t.isoformat()
        if _once(db, "probation_alerts", key):
            due = list(db.scalars(select(Employee).where(
                Employee.employment_type == "probation", Employee.confirmation_date.is_(None),
                Employee.deleted_at.is_(None), Employee.probation_end_date == t + timedelta(days=15))))
            for e in due:
                notification_service.notify(db, notification_service.hr_user_ids(db), "Probation confirmation due",
                                            f"{e.full_name} ({e.code}) completes probation on "
                                            f"{e.probation_end_date:%d %b %Y}", "warning", f"/employees/{e.id}")
            db.add(JobRun(job="probation_alerts", run_key=key, status="ok", detail=f"{len(due)} alerts", for_date=t))
        db.add(JobRun(job="nightly", run_key=key, status="ok", for_date=t))
        db.commit()
    except Exception as exc:  # pragma: no cover
        db.rollback()
        log.exception("nightly job failed")
        db.add(JobRun(job="nightly", run_key=today().isoformat(), status="error", detail=str(exc)[:2000]))
        db.commit()
    finally:
        db.close()


def year_end() -> None:
    """On the first day of a new leave year, prepare the carry-forward preview and notify HR (HR posts it)."""
    db = SessionLocal()
    try:
        t = today()
        m = int(policy_service.get(db, "leave_year_start_month") or 1)
        if t.month != m or t.day != 1:
            return
        year = t.year - 1 if m == 1 else (t.year - 1 if t.month >= m else t.year - 2)
        key = str(year)
        if not _once(db, "carry_forward_preview", key):
            return
        pv = leave_service.carry_forward_preview(db, year)
        lapse = sum(r["lapse"] for r in pv["rows"])
        notification_service.notify(db, notification_service.hr_user_ids(db), f"Year-end carry-forward {year} ready",
                                    f"{len(pv['rows'])} employees; {lapse} day(s) would lapse. Review and post.",
                                    "action", "/leave?tab=carry-forward")
        db.add(JobRun(job="carry_forward_preview", run_key=key, status="ok", for_date=t))
        db.commit()
    finally:
        db.close()


def collection_attendance() -> None:
    """Pull Collection Dashboard marks for yesterday+today and fill blank HR cells."""
    if not collection_attendance_sync.configured():
        return
    db = SessionLocal()
    try:
        t = today()
        key = t.isoformat()
        # Allow re-runs within the day for late Collection marks: use a soft key suffix by hour
        # but only record one "ok" summary per calendar day for JobRun listing.
        summary = collection_attendance_sync.sync_recent(db)
        if summary is None:
            return
        db.add(JobRun(
            job="collection_attendance",
            run_key=key,
            status="ok",
            detail=(
                f"applied={summary['applied']} fetched={summary['fetched']} "
                f"unmatched={summary['skipped_unmatched_email']} existing={summary['skipped_existing']}"
            )[:2000],
            for_date=t,
        ))
        db.commit()
    except Exception as exc:  # pragma: no cover
        db.rollback()
        log.exception("collection attendance sync failed")
        try:
            db.add(JobRun(
                job="collection_attendance",
                run_key=today().isoformat(),
                status="error",
                detail=str(exc)[:2000],
                for_date=today(),
            ))
            db.commit()
        except Exception:  # pragma: no cover
            db.rollback()
    finally:
        db.close()


def start() -> None:
    global _scheduler
    if _scheduler or not settings.enable_scheduler or settings.environment == "test":
        return
    _scheduler = BackgroundScheduler(timezone=settings.business_timezone)
    _scheduler.add_job(nightly, CronTrigger(hour=0, minute=30), id="nightly", replace_existing=True,
                       misfire_grace_time=3600, coalesce=True)
    _scheduler.add_job(year_end, CronTrigger(hour=1, minute=0), id="year_end", replace_existing=True,
                       misfire_grace_time=3600, coalesce=True)
    _scheduler.add_job(
        collection_attendance,
        CronTrigger(hour=11, minute=0),
        id="collection_attendance",
        replace_existing=True,
        misfire_grace_time=3600,
        coalesce=True,
    )
    _scheduler.start()
    log.info("Scheduler started")


def shutdown() -> None:
    global _scheduler
    if _scheduler:
        _scheduler.shutdown(wait=False)
        _scheduler = None
