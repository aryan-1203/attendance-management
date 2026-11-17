from collections.abc import Callable

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.errors import Forbidden, Unauthorized
from app.core.security import decode_token
from app.models import Employee, User
from app.services import access

bearer = HTTPBearer(auto_error=False)

DB = Depends(get_db)


def get_current_user(creds: HTTPAuthorizationCredentials | None = Depends(bearer), db: Session = DB) -> User:
    if not creds:
        raise Unauthorized("Please sign in.", code="not_authenticated")
    payload = decode_token(creds.credentials, "access")
    user = db.get(User, int(payload["sub"]))
    if not user or not user.is_active or payload.get("tv") != user.token_version:
        raise Unauthorized("Session expired. Please sign in again.", code="invalid_token")
    return user


def require_roles(*roles: str) -> Callable[..., User]:
    def dep(user: User = Depends(get_current_user)) -> User:
        if user.role_name not in roles:
            raise Forbidden("You do not have permission for this action")
        return user

    return dep


CurrentUser = Depends(get_current_user)
HROnly = Depends(require_roles(access.HR))
HRorManager = Depends(require_roles(access.HR, access.MANAGER))
HRorAccounts = Depends(require_roles(access.HR, access.ACCOUNTS))
Staff = Depends(require_roles(access.HR, access.MANAGER, access.ACCOUNTS))


def resolve_employee(db: Session, user: User, employee_id: int | None) -> Employee:
    """employee_id or the user's own employee record; enforces view access."""
    from app.services import employee_service
    if employee_id is None:
        if not user.employee_id:
            raise Forbidden("Your account is not linked to an employee record")
        employee_id = user.employee_id
    emp = employee_service.get(db, employee_id)
    access.ensure_view(user, emp)
    return emp
