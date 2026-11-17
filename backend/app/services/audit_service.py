import json
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from app.models import AuditLog


def _jsonable(value: Any) -> Any:
    if value is None:
        return None
    return json.loads(json.dumps(value, default=lambda o: str(o) if isinstance(o, (Decimal, date, datetime)) else repr(o)))


def log(db: Session, user, action: str, entity_type: str, entity_id: Any = "", summary: str = "",
        old: Any = None, new: Any = None) -> AuditLog:
    entry = AuditLog(user_id=getattr(user, "id", None), user_email=getattr(user, "email", "system"),
                     action=action, entity_type=entity_type, entity_id=str(entity_id or ""), summary=summary[:500],
                     old_value=_jsonable(old), new_value=_jsonable(new))
    db.add(entry)
    return entry
