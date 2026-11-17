from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import DAYS, TABLE_ARGS, TimestampMixin, utcnow

STATUS_CODES = ("P", "A", "HD", "L", "WO", "H", "CO", "WFH", "OD", "NJ", "EX")


class Attendance(TimestampMixin, Base):
    __tablename__ = "attendance"
    __table_args__ = (
        UniqueConstraint("employee_id", "date", name="uq_attendance_emp_date"),
        Index("ix_attendance_date", "date"),
        TABLE_ARGS,
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"))
    date: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(5))
    source: Mapped[str] = mapped_column(String(20), default="manual")  # manual|import|leave|regularization|system
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_late: Mapped[bool] = mapped_column(Boolean, default=False)
    import_batch_id: Mapped[int | None] = mapped_column(ForeignKey("import_batches.id", ondelete="SET NULL"), nullable=True)
    updated_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)


class LeaveRequest(TimestampMixin, Base):
    __tablename__ = "leave_requests"
    __table_args__ = (Index("ix_leave_req_emp_dates", "employee_id", "start_date", "end_date"), TABLE_ARGS)
    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"))
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    is_half_day: Mapped[bool] = mapped_column(Boolean, default=False)
    leave_type: Mapped[str] = mapped_column(String(20), default="paid")  # paid | comp_off
    reason: Mapped[str] = mapped_column(Text)
    attachment_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    days: Mapped[Decimal] = mapped_column(DAYS, default=Decimal("0"))
    paid_days_estimate: Mapped[Decimal] = mapped_column(DAYS, default=Decimal("0"))
    lop_days_estimate: Mapped[Decimal] = mapped_column(DAYS, default=Decimal("0"))
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    requested_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    approver_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    decision_note: Mapped[str | None] = mapped_column(String(500), nullable=True)

    employee = relationship("Employee", lazy="joined")


class RegularizationRequest(TimestampMixin, Base):
    __tablename__ = "regularization_requests"
    __table_args__ = TABLE_ARGS
    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), index=True)
    date: Mapped[date] = mapped_column(Date)
    current_status: Mapped[str | None] = mapped_column(String(5), nullable=True)
    requested_status: Mapped[str] = mapped_column(String(5))
    reason: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    requested_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    approver_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    decision_note: Mapped[str | None] = mapped_column(String(500), nullable=True)

    employee = relationship("Employee", lazy="joined")


LEDGER_TYPES = ("ACCRUAL", "PROBATION_LOCK", "PROBATION_RELEASE", "LEAVE_USED", "LOP", "ADJUSTMENT",
                "CARRY_FORWARD", "COMP_OFF_EARNED", "COMP_OFF_EXPIRED", "ENCASHMENT")
BUCKETS = ("usable", "locked", "comp_off", "lop")


class LeaveLedger(Base):
    """Immutable. Never UPDATE or DELETE rows; corrections are reversal rows (reversal_of_id)."""

    __tablename__ = "leave_ledger"
    __table_args__ = (
        Index("ix_ledger_emp_date", "employee_id", "entry_date"),
        Index("ix_ledger_cycle_emp", "cycle_id", "employee_id"),
        TABLE_ARGS,
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"))
    entry_date: Mapped[date] = mapped_column(Date)
    entry_type: Mapped[str] = mapped_column(String(30))
    bucket: Mapped[str] = mapped_column(String(12))
    amount: Mapped[Decimal] = mapped_column(DAYS)
    cycle_id: Mapped[int | None] = mapped_column(ForeignKey("salary_cycles.id", ondelete="SET NULL"), nullable=True)
    reference: Mapped[str] = mapped_column(String(120), default="")
    note: Mapped[str] = mapped_column(String(500), default="")
    is_system: Mapped[bool] = mapped_column(Boolean, default=True)
    reversal_of_id: Mapped[int | None] = mapped_column(ForeignKey("leave_ledger.id"), nullable=True, index=True)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class CompOff(Base):
    """Projection of comp-off lots, rebuilt on every recalculation (ledger remains source of truth)."""

    __tablename__ = "comp_offs"
    __table_args__ = (Index("ix_compoff_emp", "employee_id", "earned_date"), TABLE_ARGS)
    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"))
    earned_date: Mapped[date] = mapped_column(Date)
    days: Mapped[Decimal] = mapped_column(DAYS)
    used_days: Mapped[Decimal] = mapped_column(DAYS, default=Decimal("0"))
    expired_days: Mapped[Decimal] = mapped_column(DAYS, default=Decimal("0"))
    expires_on: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(12), default="available")  # available|used|expired|partial
