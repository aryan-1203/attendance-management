from datetime import date, datetime
from zoneinfo import ZoneInfo

from app.core.config import settings


def business_now() -> datetime:
    return datetime.now(ZoneInfo(settings.business_timezone))


_override: date | None = None


def set_today(value: date | None) -> None:
    """Test hook: pin the business date."""
    global _override
    _override = value


def today() -> date:
    return _override or business_now().date()
