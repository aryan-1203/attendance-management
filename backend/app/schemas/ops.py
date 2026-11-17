from datetime import date, datetime
from datetime import date as Date
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, EmailStr, Field

from app.schemas.common import ORM, Balances, CycleOut, Dec, EmployeeBrief


# ------------------------------------------------------------------ auth / users
class LoginIn(BaseModel):
    email: EmailStr
    password: str


class TokenOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str
    expires_in: int


class RefreshIn(BaseModel):
    refresh_token: str


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str


class ForgotIn(BaseModel):
    email: EmailStr


class ResetIn(BaseModel):
    token: str
    new_password: str


class UserOut(ORM):
    id: int
    email: str
    full_name: str
    role_name: str
    employee_id: int | None
    is_active: bool
    last_login_at: datetime | None


class MeOut(UserOut):
    employee: EmployeeBrief | None = None
    session_minutes: int


class UserIn(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=1)
    role: str
    employee_id: int | None = None
    password: str


class UserUpdate(BaseModel):
    full_name: str | None = None
    role: str | None = None
    employee_id: int | None = None
    is_active: bool | None = None
    password: str | None = None


# ------------------------------------------------------------------ attendance
class Cell(BaseModel):
    s: str | None
    auto: bool
    src: str | None
    late: bool
    note: str | None


class GridDay(BaseModel):
    date: Date
    weekday: int
    is_holiday: bool
    holiday_name: str | None
    is_today: bool
    is_future: bool


class GridRow(BaseModel):
    id: int
    code: str
    full_name: str
    photo_url: str | None
    department: str | None
    department_id: int | None
    employment_type: str
    status: str
    date_of_joining: date
    exit_date: date | None
    cells: list[Cell]


class GridOut(BaseModel):
    cycle: CycleOut
    days: list[GridDay]
    employees: list[GridRow]


class MarkIn(BaseModel):
    employee_id: int
    date: Date
    status: str | None = None
    note: str | None = None
    is_late: bool | None = None


class BulkMarkIn(BaseModel):
    changes: list[MarkIn] = Field(min_length=1, max_length=20000)


class MarkOut(BaseModel):
    employee_id: int
    date: Date
    status: str | None
    note: str | None = None
    is_late: bool = False


class BulkMarkOut(BaseModel):
    applied: list[MarkOut]
    previous: list[MarkOut]
    ledger_rows: int
    count: int | None = None


class MarkAllIn(BaseModel):
    date: Date
    employee_ids: list[int] | None = None


class DayDetail(BaseModel):
    date: Date
    status: str
    paid_leave: Dec
    lop: Dec
    comp_off_used: Dec
    comp_off_earned: Dec
    note: str


class CycleSummaryOut(BaseModel):
    employee_id: int
    cycle_id: int
    balance: Balances
    cycle_days: int
    eligible_days: int
    present_days: int
    half_days: int
    absent_days: int
    leave_days: int
    weekly_offs: int
    holidays: int
    unmarked_days: int
    pending_days: int
    paid_leave_used: Dec
    comp_off_used: Dec
    lop_days: Dec
    payable_days: Dec
    projected_payable_days: Dec
    opening_usable: Dec
    accrued: Dec
    closing_usable: Dec
    closing_locked: Dec
    remarks: list[str]
    warnings: list[str]
    on_probation: bool
    days: list[DayDetail]


# ------------------------------------------------------------------ leave
class LeavePreviewIn(BaseModel):
    employee_id: int | None = None
    start_date: date
    end_date: date
    is_half_day: bool = False
    leave_type: str = "paid"


class LeavePreviewOut(BaseModel):
    days: Dec
    working_dates: list[date]
    paid_days: Dec
    comp_off_days: Dec
    lop_days: Dec
    balance: Balances
    message: str
    has_lop: bool


class LeaveApplyIn(LeavePreviewIn):
    reason: str = Field(min_length=1, max_length=2000)
    attachment_path: str | None = None
    auto_approve: bool = False


class LeaveRequestOut(ORM):
    id: int
    employee_id: int
    employee: EmployeeBrief
    start_date: date
    end_date: date
    is_half_day: bool
    leave_type: str
    reason: str
    attachment_path: str | None
    days: Dec
    paid_days_estimate: Dec
    lop_days_estimate: Dec
    status: str
    approver_id: int | None
    decided_at: datetime | None
    decision_note: str | None
    created_at: datetime


class DecisionIn(BaseModel):
    action: str = Field(pattern="^(approve|reject)$")
    note: str | None = None


class AdjustIn(BaseModel):
    employee_id: int
    bucket: str = "usable"
    amount: Dec = Field(max_digits=5, decimal_places=2)
    reason: str = Field(min_length=5, max_length=500)
    entry_date: date | None = None


class RegularizationIn(BaseModel):
    employee_id: int | None = None
    date: Date
    requested_status: str
    reason: str = Field(min_length=5, max_length=2000)


class RegularizationOut(ORM):
    id: int
    employee_id: int
    employee: EmployeeBrief
    date: Date
    current_status: str | None
    requested_status: str
    reason: str
    status: str
    approver_id: int | None
    decided_at: datetime | None
    decision_note: str | None
    created_at: datetime


class CompOffOut(ORM):
    id: int
    employee_id: int
    earned_date: date
    days: Dec
    used_days: Dec
    expired_days: Dec
    expires_on: date
    status: str


class CarryForwardRow(BaseModel):
    employee_id: int
    code: str
    full_name: str
    balance: Dec
    carry_forward: Dec
    lapse: Dec
    locked: Dec
    already_posted: bool


class CarryForwardOut(BaseModel):
    year: int
    year_start: date
    year_end: date
    cap: Dec | None
    rows: list[CarryForwardRow]
    already_posted: bool


class EncashmentOut(BaseModel):
    employee_id: int
    usable: Dec
    locked: Dec
    comp_off: Dec
    days: Dec
    already_posted: bool
    exit_date: date | None


# ------------------------------------------------------------------ misc
class NotificationOut(ORM):
    id: int
    title: str
    body: str
    kind: str
    link: str | None
    is_read: bool
    created_at: datetime


class MarkReadIn(BaseModel):
    ids: list[int] | None = None


class AuditOut(ORM):
    id: int
    user_id: int | None
    user_email: str
    action: str
    entity_type: str
    entity_id: str
    summary: str
    old_value: Any
    new_value: Any
    created_at: datetime


class SettingOut(BaseModel):
    key: str
    value: Any
    type: str
    category: str
    label: str
    description: str
    choices: list[str] | None


class SettingsUpdateIn(BaseModel):
    values: dict[str, Any]


class UnlockIn(BaseModel):
    reason: str = Field(min_length=5, max_length=500)


class LockIn(BaseModel):
    acknowledge_warnings: bool = False


class ConfirmIn(BaseModel):
    confirmation_date: date


class ExitIn(BaseModel):
    exit_date: date
    reason: str | None = None


class EmailReportIn(BaseModel):
    to: list[EmailStr] | None = None


class ImportBatchOut(ORM):
    id: int
    filename: str
    kind: str
    layout: str
    status: str
    mapping: Any
    sheet_name: str | None
    total_rows: int
    valid_rows: int
    warning_rows: int
    error_rows: int
    applied_rows: int
    affected_cycles: Any
    created_at: datetime
    committed_at: datetime | None
    rolled_back_at: datetime | None


class InspectOut(BaseModel):
    batch: ImportBatchOut
    sheets: list[str]
    headers: list[str]
    sample_rows: list[list[str]]
    detected_mapping: dict[str, Any]
    suggested_template: dict[str, Any] | None


class InspectIn(BaseModel):
    sheet: str | None = None
    header_row: int | None = None
    cycle_id: int | None = None


class ValidateIn(BaseModel):
    mapping: dict[str, Any]
    sheet: str | None = None
    save_template: str | None = None


class ImportSummaryOut(BaseModel):
    batch: ImportBatchOut
    employees: int
    date_from: date | None
    date_to: date | None
    by_status: dict[str, int]
    issue_summary: dict[str, int]


class ImportRowOut(ORM):
    id: int
    row_number: int
    column_ref: str
    employee_code: str
    employee_id: int | None
    date: Date | None
    status: str
    raw_value: str
    severity: str
    issues: Any
    applied: bool


class TemplateOut(ORM):
    id: int
    name: str
    layout: str
    mapping: Any
    created_at: datetime


class TemplateIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    layout: str
    mapping: dict[str, Any]


class ReportRunOut(ORM):
    id: int
    cycle_id: int | None
    report_type: str
    fmt: str
    generated_by_id: int | None
    emailed_to: str | None
    emailed_at: datetime | None
    created_at: datetime


class BulkResultOut(BaseModel):
    dry_run: bool
    total: int
    created: int
    updated: int
    errors: list[dict[str, Any]]
