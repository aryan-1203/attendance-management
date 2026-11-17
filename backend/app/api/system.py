from datetime import date, datetime, time

from fastapi import APIRouter, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import DB, CurrentUser, HROnly
from app.models import AuditLog, Notification, User
from app.repositories.base import paginate
from app.schemas.common import PageOut, page_out
from app.schemas.ops import AuditOut, MarkReadIn, NotificationOut, SettingOut, SettingsUpdateIn
from app.services import notification_service, policy_service, recalc_service

notifications = APIRouter(prefix="/notifications", tags=["notifications"])
audit = APIRouter(prefix="/audit", tags=["audit"])
settings_router = APIRouter(prefix="/settings", tags=["settings"])


@notifications.get("", response_model=PageOut[NotificationOut])
def list_notifications(unread: bool = False, page: int = 1, page_size: int = Query(20, le=100), db: Session = DB,
                       user: User = CurrentUser):
    stmt = select(Notification).where(Notification.user_id == user.id)
    if unread:
        stmt = stmt.where(Notification.is_read.is_(False))
    return page_out(paginate(db, stmt.order_by(Notification.created_at.desc(), Notification.id.desc()), page,
                             page_size), NotificationOut)


@notifications.get("/unread-count")
def unread_count(db: Session = DB, user: User = CurrentUser):
    n = db.scalar(select(func.count()).select_from(Notification).where(Notification.user_id == user.id,
                                                                       Notification.is_read.is_(False)))
    return {"count": n or 0}


@notifications.post("/read")
def mark_read(body: MarkReadIn, db: Session = DB, user: User = CurrentUser):
    n = notification_service.mark_read(db, user.id, body.ids)
    db.commit()
    return {"updated": n}


@audit.get("", response_model=PageOut[AuditOut])
def list_audit(search: str | None = None, entity_type: str | None = None, action: str | None = None,
               user_email: str | None = None, date_from: date | None = None, date_to: date | None = None,
               page: int = 1, page_size: int = Query(50, le=500), sort: str | None = "-created_at",
               db: Session = DB, _=HROnly):
    stmt = select(AuditLog)
    if search:
        stmt = stmt.where(AuditLog.summary.ilike(f"%{search}%"))
    if entity_type:
        stmt = stmt.where(AuditLog.entity_type == entity_type)
    if action:
        stmt = stmt.where(AuditLog.action.ilike(f"{action}%"))
    if user_email:
        stmt = stmt.where(AuditLog.user_email.ilike(f"%{user_email}%"))
    if date_from:
        stmt = stmt.where(AuditLog.created_at >= datetime.combine(date_from, time.min))
    if date_to:
        stmt = stmt.where(AuditLog.created_at <= datetime.combine(date_to, time.max))
    sortable = {"created_at": AuditLog.created_at, "action": AuditLog.action, "user_email": AuditLog.user_email}
    return page_out(paginate(db, stmt, page, page_size, sort, sortable, AuditLog.created_at.desc()), AuditOut)


@audit.get("/facets")
def facets(db: Session = DB, _=HROnly):
    return {"entity_types": sorted(db.scalars(select(AuditLog.entity_type).distinct())),
            "actions": sorted(db.scalars(select(AuditLog.action).distinct()))}


@settings_router.get("", response_model=list[SettingOut])
def get_settings(db: Session = DB, user: User = CurrentUser):
    rows = policy_service.list_settings(db)
    if user.role_name != "hr_admin":
        rows = [r for r in rows if r["category"] in ("company", "cycle", "leave")]
    return rows


@settings_router.put("", response_model=list[SettingOut])
def update_settings(body: SettingsUpdateIn, db: Session = DB, user: User = HROnly):
    applied = policy_service.update_many(db, body.values, user)
    if set(applied) & policy_service.CALC_KEYS:
        from app.services import cycle_service
        first_open = next((c for c in cycle_service.list_cycles(db) if c.status == "open"), None)
        if first_open:
            recalc_service.recalc_open_from(db, first_open.start_date, user)
    db.commit()
    return policy_service.list_settings(db)


@settings_router.get("/public")
def public_settings(db: Session = DB):
    v = policy_service.get_all(db)
    return {k: v[k] for k in ("company_name", "company_logo_url", "cycle_start_day")}
