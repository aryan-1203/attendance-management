"""Password hashing, password policy and JWT helpers."""
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import settings
from app.core.errors import Unauthorized, ValidationFailed

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

PASSWORD_POLICY = (
    "At least 8 characters, with an uppercase letter, a lowercase letter, a digit and a symbol."
)


def validate_password_policy(password: str) -> None:
    checks = [
        len(password) >= 8,
        re.search(r"[A-Z]", password),
        re.search(r"[a-z]", password),
        re.search(r"\d", password),
        re.search(r"[^A-Za-z0-9]", password),
    ]
    if not all(checks):
        raise ValidationFailed(f"Password does not meet policy: {PASSWORD_POLICY}", code="weak_password")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    try:
        return pwd_context.verify(password, hashed)
    except ValueError:
        return False


def _encode(sub: str, kind: str, delta: timedelta, extra: dict[str, Any] | None = None) -> str:
    now = datetime.now(timezone.utc)
    payload = {"sub": sub, "type": kind, "iat": int(now.timestamp()), "exp": int((now + delta).timestamp())}
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def create_access_token(user_id: int, role: str, token_version: int = 0) -> str:
    return _encode(str(user_id), "access", timedelta(minutes=settings.access_token_minutes),
                   {"role": role, "tv": token_version})


def create_refresh_token(user_id: int, token_version: int = 0) -> str:
    return _encode(str(user_id), "refresh", timedelta(days=settings.refresh_token_days), {"tv": token_version})


def decode_token(token: str, expected_type: str) -> dict[str, Any]:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError as exc:
        raise Unauthorized("Session expired or invalid. Please sign in again.", code="invalid_token") from exc
    if payload.get("type") != expected_type:
        raise Unauthorized("Invalid token type.", code="invalid_token")
    return payload


def new_reset_token() -> str:
    return secrets.token_urlsafe(32)
