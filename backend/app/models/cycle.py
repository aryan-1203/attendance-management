from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TABLE_ARGS, TimestampMixin


class SalaryCycle(TimestampMixin, Base):
    __tablename__ = "salary_cycles"
    __table_args__ = (Index("ix_cycle_dates", "start_date", "end_date"), TABLE_ARGS)
    id: Mapped[int] = mapped_column(primary_key=True)
    start_date: Mapped[date] = mapped_column(Date, unique=True)
    end_date: Mapped[date] = mapped_column(Date)
    label: Mapped[str] = mapped_column(String(60))
    status: Mapped[str] = mapped_column(String(10), default="open")  # open | locked
    locked_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    locked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    unlock_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    report_due_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    locked_by = relationship("User", foreign_keys=[locked_by_id], lazy="joined")

    @property
    def locked_by_name(self) -> str | None:
        return self.locked_by.full_name if self.locked_by else None

    @property
    def days(self) -> int:
        return (self.end_date - self.start_date).days + 1
