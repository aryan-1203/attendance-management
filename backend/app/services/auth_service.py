import hashlib
import logging
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import Unauthorized, ValidationFailed
from app.core.security import (create_access_token, create_refresh_token, decode_token, hash_password,
                               new_reset_token, validate_password_policy, verify_password)
from app.models import PasswordResetToken, User
from app.models.base import utcnow
from app.services import audit_service, email_service

log = logging.getLogger("prosparity.auth")
MAX_FAILED = 5
LOCK_MINUTES = 15


def _tokens(user: User) -> dict:
    return {"access_token": create_access_token(user.id, user.role_name, user.token_version),
            "refresh_token": create_refresh_token(user.id, user.token_version), "token_type": "bearer",
            "expires_in": settings.access_token_minutes * 60}


def login(db: Session, email: str, password: str) -> dict:
    user = db.scalar(select(User).where(User.email == email.strip().lower()))
    now = utcnow()
    if user and user.locked_until and user.locked_until > now:
        raise Unauthorized("Too many failed attempts. Try again in a few minutes.", code="account_locked")
    if not user or not user.is_active or not verify_password(password, user.password_hash):
        if user:
            user.failed_logins += 1
            if user.failed_logins >= MAX_FAILED:
                user.locked_until = now + timedelta(minutes=LOCK_MINUTES)
                user.failed_logins = 0
            db.commit()
        raise Unauthorized("Incorrect email or password.", code="invalid_credentials")
    user.failed_logins = 0
    user.locked_until = None
    user.last_login_at = now
    audit_service.log(db, user, "auth.login", "user", user.id, f"{user.email} signed in")
    db.commit()
    return _tokens(user)


def refresh(db: Session, refresh_token: str) -> dict:
    payload = decode_token(refresh_token, "refresh")
    user = db.get(User, int(payload["sub"]))
    if not user or not user.is_active or payload.get("tv") != user.token_version:
        raise Unauthorized("Session expired. Please sign in again.", code="invalid_token")
    return _tokens(user)


def change_password(db: Session, user: User, current: str, new: str) -> None:
    if not verify_password(current, user.password_hash):
        raise ValidationFailed("Current password is incorrect", code="wrong_password")
    validate_password_policy(new)
    user.password_hash = hash_password(new)
    user.token_version += 1
    audit_service.log(db, user, "auth.change_password", "user", user.id, "Password changed")


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def forgot_password(db: Session, email: str) -> str | None:
    """Always succeeds from the caller's view (no account enumeration). Returns token in dev for tests."""
    user = db.scalar(select(User).where(User.email == email.strip().lower()))
    if not user or not user.is_active:
        return None
    token = new_reset_token()
    db.add(PasswordResetToken(user_id=user.id, token_hash=_hash(token),
                              expires_at=utcnow() + timedelta(minutes=settings.password_reset_minutes)))
    link = f"{settings.frontend_url}/reset-password?token={token}"
    email_service.send(db, [user.email], "Reset your ProsParity password",
                       f"Hello {user.full_name},\n\nReset your password using this link (valid "
                       f"{settings.password_reset_minutes} minutes):\n{link}\n\nIf you did not ask for this, ignore it.")
    log.info("Password reset link for %s: %s", user.email, link)
    return token


def reset_password(db: Session, token: str, new: str) -> None:
    row = db.scalar(select(PasswordResetToken).where(PasswordResetToken.token_hash == _hash(token)))
    if not row or row.used_at or row.expires_at < utcnow():
        raise ValidationFailed("This reset link is invalid or has expired", code="invalid_reset_token")
    validate_password_policy(new)
    user = db.get(User, row.user_id)
    user.password_hash = hash_password(new)
    user.token_version += 1
    row.used_at = utcnow()
    audit_service.log(db, user, "auth.reset_password", "user", user.id, "Password reset via email link")
