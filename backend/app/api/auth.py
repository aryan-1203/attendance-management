from fastapi import APIRouter
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import DB, CurrentUser, HROnly
from app.core.config import settings
from app.core.errors import Conflict, NotFound, ValidationFailed
from app.core.security import PASSWORD_POLICY, hash_password, validate_password_policy
from app.models import Role, User
from app.schemas.common import Message
from app.schemas.ops import (ChangePasswordIn, ForgotIn, LoginIn, MeOut, RefreshIn, ResetIn, TokenOut, UserIn,
                             UserOut, UserUpdate)
from app.services import audit_service, auth_service

router = APIRouter(prefix="/auth", tags=["auth"])
users = APIRouter(prefix="/users", tags=["users"])


@router.post("/login", response_model=TokenOut)
def login(body: LoginIn, db: Session = DB):
    return auth_service.login(db, body.email, body.password)


@router.post("/refresh", response_model=TokenOut)
def refresh(body: RefreshIn, db: Session = DB):
    return auth_service.refresh(db, body.refresh_token)


@router.get("/me", response_model=MeOut)
def me(user: User = CurrentUser):
    out = UserOut.model_validate(user).model_dump()
    emp = user.employee
    out["employee"] = {"id": emp.id, "code": emp.code, "full_name": emp.full_name, "photo_url": emp.photo_url} \
        if emp else None
    out["session_minutes"] = settings.access_token_minutes
    return out


@router.post("/change-password", response_model=Message)
def change_password(body: ChangePasswordIn, user: User = CurrentUser, db: Session = DB):
    auth_service.change_password(db, user, body.current_password, body.new_password)
    db.commit()
    return {"message": "Password changed. Please sign in again."}


@router.post("/forgot-password", response_model=Message)
def forgot(body: ForgotIn, db: Session = DB):
    token = auth_service.forgot_password(db, body.email)
    db.commit()
    data = {"dev_token": token} if (settings.is_dev and token) else None
    return {"message": "If that email is registered, a reset link has been sent.", "data": data}


@router.post("/reset-password", response_model=Message)
def reset(body: ResetIn, db: Session = DB):
    auth_service.reset_password(db, body.token, body.new_password)
    db.commit()
    return {"message": "Password updated. You can sign in now."}


@router.get("/password-policy", response_model=Message)
def policy():
    return {"message": PASSWORD_POLICY}


# ------------------------------------------------------------------ user admin (HR)
def _role(db: Session, name: str) -> Role:
    role = db.scalar(select(Role).where(Role.name == name))
    if not role:
        raise ValidationFailed(f"Unknown role '{name}'")
    return role


@users.get("", response_model=list[UserOut])
def list_users(db: Session = DB, _=HROnly):
    return list(db.scalars(select(User).order_by(User.full_name)))


@users.post("", response_model=UserOut, status_code=201)
def create_user(body: UserIn, db: Session = DB, actor: User = HROnly):
    if db.scalar(select(User).where(User.email == body.email.lower())):
        raise Conflict("A user with this email already exists")
    validate_password_policy(body.password)
    u = User(email=body.email.lower(), full_name=body.full_name, role_id=_role(db, body.role).id,
             employee_id=body.employee_id, password_hash=hash_password(body.password))
    db.add(u)
    db.flush()
    audit_service.log(db, actor, "user.create", "user", u.id, f"Created user {u.email} ({body.role})")
    db.commit()
    return u


@users.patch("/{user_id}", response_model=UserOut)
def update_user(user_id: int, body: UserUpdate, db: Session = DB, actor: User = HROnly):
    u = db.get(User, user_id)
    if not u:
        raise NotFound("User not found")
    old = {"role": u.role_name, "is_active": u.is_active, "employee_id": u.employee_id}
    data = body.model_dump(exclude_unset=True)
    demoting = data.get("role") not in (None, "hr_admin") or data.get("is_active") is False
    if demoting and u.role_name == "hr_admin":
        if u.id == actor.id:
            raise ValidationFailed("You can't remove your own HR admin access", code="self_demotion")
        others = db.scalar(select(func.count()).select_from(User).join(Role).where(
            Role.name == "hr_admin", User.is_active.is_(True), User.id != u.id)) or 0
        if others == 0:
            raise ValidationFailed("At least one active HR admin is required", code="last_hr_admin")
    if "role" in data:
        u.role_id = _role(db, data.pop("role")).id
    if data.get("password"):
        validate_password_policy(data["password"])
        u.password_hash = hash_password(data.pop("password"))
        u.token_version += 1
    data.pop("password", None)
    for k, v in data.items():
        setattr(u, k, v)
    if data.get("is_active") is False:
        u.token_version += 1
    db.flush()
    db.refresh(u)
    audit_service.log(db, actor, "user.update", "user", u.id, f"Updated user {u.email}", old,
                      {"role": u.role_name, "is_active": u.is_active, "employee_id": u.employee_id})
    db.commit()
    return u
