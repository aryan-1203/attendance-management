from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TABLE_ARGS, TimestampMixin


class Department(Base):
    __tablename__ = "departments"
    __table_args__ = TABLE_ARGS
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    code: Mapped[str] = mapped_column(String(20), default="")


class Designation(Base):
    __tablename__ = "designations"
    __table_args__ = TABLE_ARGS
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)


EMPLOYMENT_TYPES = ("probation", "permanent", "contract", "intern")


class Employee(TimestampMixin, Base):
    __tablename__ = "employees"
    __table_args__ = (
        Index("ix_employees_status_dept", "status", "department_id"),
        TABLE_ARGS,
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(30), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(150), index=True)
    photo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id", ondelete="SET NULL"), nullable=True)
    designation_id: Mapped[int | None] = mapped_column(ForeignKey("designations.id", ondelete="SET NULL"), nullable=True)
    manager_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id", ondelete="SET NULL"), nullable=True, index=True)
    date_of_joining: Mapped[date] = mapped_column(Date)
    probation_end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    confirmation_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    exit_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    exit_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    employment_type: Mapped[str] = mapped_column(String(20), default="probation")
    weekly_off: Mapped[str] = mapped_column(String(20), default="6")  # comma list of weekdays, 0=Mon..6=Sun
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    date_of_birth: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | exited | inactive
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    department: Mapped[Department | None] = relationship(lazy="joined")
    designation: Mapped[Designation | None] = relationship(lazy="joined")
    manager: Mapped["Employee | None"] = relationship(remote_side="Employee.id", lazy="select")

    @property
    def weekly_off_days(self) -> list[int]:
        return [int(x) for x in self.weekly_off.split(",") if x.strip() != ""]


class Holiday(TimestampMixin, Base):
    __tablename__ = "holidays"
    __table_args__ = (UniqueConstraint("date", "name", name="uq_holiday_date_name"), TABLE_ARGS)
    id: Mapped[int] = mapped_column(primary_key=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    name: Mapped[str] = mapped_column(String(150))
    kind: Mapped[str] = mapped_column(String(20), default="public")  # public | optional | restricted
    description: Mapped[str] = mapped_column(String(255), default="")
