from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import DateTime, Numeric
from sqlalchemy.orm import Mapped, mapped_column

MONEY = Numeric(12, 2)
DAYS = Numeric(5, 2)
TABLE_ARGS = {"mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_unicode_ci", "mysql_engine": "InnoDB"}


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)


ZERO = Decimal("0")
