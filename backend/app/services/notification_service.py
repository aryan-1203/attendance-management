from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models import Employee, Notification, Role, User


def notify(db: Session, user_ids: list[int], title: str, body: str = "", kind: str = "info",
           link: str | None = None) -> None:
    for uid in sorted(set(u for u in user_ids if u)):
        db.add(Notification(user_id=uid, title=title[:200], body=body[:1000], kind=kind, link=link))


def hr_user_ids(db: Session) -> list[int]:
    return list(db.scalars(select(User.id).join(Role).where(Role.name == "hr_admin", User.is_active.is_(True))))


def user_id_for_employee(db: Session, employee_id: int | None) -> int | None:
    if not employee_id:
        return None
    return db.scalar(select(User.id).where(User.employee_id == employee_id))


def approver_user_ids(db: Session, emp: Employee) -> list[int]:
    ids = hr_user_ids(db)
    mgr = user_id_for_employee(db, emp.manager_id)
    return ([mgr] if mgr else []) + ids


def mark_read(db: Session, user_id: int, ids: list[int] | None) -> int:
    stmt = update(Notification).where(Notification.user_id == user_id, Notification.is_read.is_(False))
    if ids:
        stmt = stmt.where(Notification.id.in_(ids))
    return db.execute(stmt.values(is_read=True)).rowcount or 0
