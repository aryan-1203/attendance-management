from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TABLE_ARGS, utcnow


class CycleSnapshot(Base):
    """Frozen per-employee results written when a cycle is locked (reports for locked cycles read these)."""

    __tablename__ = "cycle_snapshots"
    __table_args__ = (UniqueConstraint("cycle_id", "employee_id", name="uq_snapshot_cycle_emp"), TABLE_ARGS)
    id: Mapped[int] = mapped_column(primary_key=True)
    cycle_id: Mapped[int] = mapped_column(ForeignKey("salary_cycles.id", ondelete="CASCADE"))
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"))
    data: Mapped[Any] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
