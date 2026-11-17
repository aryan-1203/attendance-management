from datetime import date, datetime
from typing import Any

from sqlalchemy import JSON, Boolean, Date, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TABLE_ARGS, utcnow


class PolicySetting(Base):
    __tablename__ = "policy_settings"
    __table_args__ = TABLE_ARGS
    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(80), unique=True)
    value: Mapped[Any] = mapped_column(JSON)
    value_type: Mapped[str] = mapped_column(String(20))  # bool|int|decimal|str|choice|json|secret
    category: Mapped[str] = mapped_column(String(40))
    label: Mapped[str] = mapped_column(String(150))
    description: Mapped[str] = mapped_column(String(500), default="")
    choices: Mapped[Any] = mapped_column(JSON, nullable=True)
    updated_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class ImportBatch(Base):
    __tablename__ = "import_batches"
    __table_args__ = TABLE_ARGS
    id: Mapped[int] = mapped_column(primary_key=True)
    filename: Mapped[str] = mapped_column(String(255))
    file_path: Mapped[str] = mapped_column(String(500))
    kind: Mapped[str] = mapped_column(String(20), default="attendance")  # attendance | employees | holidays
    layout: Mapped[str] = mapped_column(String(10), default="wide")  # wide | long
    status: Mapped[str] = mapped_column(String(20), default="uploaded")  # uploaded|validated|committed|rolled_back
    mapping: Mapped[Any] = mapped_column(JSON, nullable=True)
    sheet_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    total_rows: Mapped[int] = mapped_column(Integer, default=0)
    valid_rows: Mapped[int] = mapped_column(Integer, default=0)
    warning_rows: Mapped[int] = mapped_column(Integer, default=0)
    error_rows: Mapped[int] = mapped_column(Integer, default=0)
    applied_rows: Mapped[int] = mapped_column(Integer, default=0)
    affected_cycles: Mapped[Any] = mapped_column(JSON, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    committed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    rolled_back_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class ImportRow(Base):
    __tablename__ = "import_rows"
    __table_args__ = (Index("ix_import_rows_batch", "batch_id", "row_number"), TABLE_ARGS)
    id: Mapped[int] = mapped_column(primary_key=True)
    batch_id: Mapped[int] = mapped_column(ForeignKey("import_batches.id", ondelete="CASCADE"))
    row_number: Mapped[int] = mapped_column(Integer)
    column_ref: Mapped[str] = mapped_column(String(60), default="")  # source column (wide layout)
    employee_code: Mapped[str] = mapped_column(String(60), default="")
    employee_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="")
    raw_value: Mapped[str] = mapped_column(String(100), default="")
    severity: Mapped[str] = mapped_column(String(10), default="ok")  # ok | warning | error
    issues: Mapped[Any] = mapped_column(JSON, nullable=True)
    applied: Mapped[bool] = mapped_column(Boolean, default=False)
    prev_status: Mapped[str | None] = mapped_column(String(5), nullable=True)
    prev_source: Mapped[str | None] = mapped_column(String(20), nullable=True)
    prev_existed: Mapped[bool] = mapped_column(Boolean, default=False)


class ColumnMappingTemplate(Base):
    __tablename__ = "column_mapping_templates"
    __table_args__ = TABLE_ARGS
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    layout: Mapped[str] = mapped_column(String(10))
    mapping: Mapped[Any] = mapped_column(JSON)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (Index("ix_notif_user_read", "user_id", "is_read"), TABLE_ARGS)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(String(1000), default="")
    kind: Mapped[str] = mapped_column(String(30), default="info")
    link: Mapped[str | None] = mapped_column(String(300), nullable=True)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class AuditLog(Base):
    __tablename__ = "audit_log"
    __table_args__ = (Index("ix_audit_entity", "entity_type", "entity_id"), Index("ix_audit_created", "created_at"),
                      TABLE_ARGS)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    user_email: Mapped[str] = mapped_column(String(255), default="system")
    action: Mapped[str] = mapped_column(String(60))
    entity_type: Mapped[str] = mapped_column(String(60))
    entity_id: Mapped[str] = mapped_column(String(60), default="")
    summary: Mapped[str] = mapped_column(String(500), default="")
    old_value: Mapped[Any] = mapped_column(JSON, nullable=True)
    new_value: Mapped[Any] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class ReportRun(Base):
    __tablename__ = "report_runs"
    __table_args__ = TABLE_ARGS
    id: Mapped[int] = mapped_column(primary_key=True)
    cycle_id: Mapped[int | None] = mapped_column(ForeignKey("salary_cycles.id", ondelete="SET NULL"), nullable=True)
    report_type: Mapped[str] = mapped_column(String(40))
    fmt: Mapped[str] = mapped_column(String(10))
    file_path: Mapped[str] = mapped_column(String(500))
    generated_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    emailed_to: Mapped[str | None] = mapped_column(String(500), nullable=True)
    emailed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class JobRun(Base):
    __tablename__ = "job_runs"
    __table_args__ = TABLE_ARGS
    id: Mapped[int] = mapped_column(primary_key=True)
    job: Mapped[str] = mapped_column(String(60))
    run_key: Mapped[str] = mapped_column(String(60))
    status: Mapped[str] = mapped_column(String(20))
    detail: Mapped[str] = mapped_column(Text, default="")
    for_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
