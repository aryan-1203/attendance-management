from datetime import date, datetime
from datetime import date as Date
from decimal import Decimal
from typing import Annotated, Any, Generic, TypeVar

from pydantic import PlainSerializer

from pydantic import BaseModel, ConfigDict, Field

T = TypeVar("T")


def fmt_decimal(v: Decimal) -> str:
    """All days and money leave the API as fixed 2-decimal strings (never floats)."""
    return f"{Decimal(v):.2f}"


Dec = Annotated[Decimal, PlainSerializer(fmt_decimal, return_type=str, when_used="json")]


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class PageOut(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int
    pages: int


def page_out(page, schema) -> dict:
    return {"items": [schema.model_validate(i) for i in page.items], "total": page.total, "page": page.page,
            "page_size": page.page_size, "pages": page.pages}


class Message(BaseModel):
    message: str
    data: dict[str, Any] | None = None


class ErrorBody(BaseModel):
    code: str
    message: str
    details: Any = None


class ErrorOut(BaseModel):
    error: ErrorBody


class Lookup(ORM):
    id: int
    name: str


class DepartmentOut(ORM):
    id: int
    name: str
    code: str = ""


class NamedIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    code: str | None = None


class EmployeeBrief(ORM):
    id: int
    code: str
    full_name: str
    photo_url: str | None = None


class EmployeeOut(ORM):
    id: int
    code: str
    full_name: str
    photo_url: str | None
    department_id: int | None
    department: DepartmentOut | None
    designation_id: int | None
    designation: Lookup | None
    manager_id: int | None
    function_manager_id: int | None = None
    date_of_joining: date
    probation_end_date: date | None
    confirmation_date: date | None
    exit_date: date | None
    exit_reason: str | None
    employment_type: str
    weekly_off: str
    email: str | None
    phone: str | None
    date_of_birth: date | None
    status: str
    created_at: datetime


class EmployeeIn(BaseModel):
    code: str = Field(min_length=1, max_length=30)
    full_name: str = Field(min_length=1, max_length=150)
    photo_url: str | None = None
    department_id: int | None = None
    designation_id: int | None = None
    manager_id: int | None = None
    function_manager_id: int | None = None
    date_of_joining: date
    probation_end_date: date | None = None
    confirmation_date: date | None = None
    exit_date: date | None = None
    exit_reason: str | None = None
    employment_type: str = "probation"
    weekly_off: str = "6"
    email: str | None = None
    phone: str | None = None
    date_of_birth: date | None = None


class EmployeeUpdate(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=30)
    full_name: str | None = Field(default=None, min_length=1, max_length=150)
    photo_url: str | None = None
    department_id: int | None = None
    designation_id: int | None = None
    manager_id: int | None = None
    function_manager_id: int | None = None
    date_of_joining: date | None = None
    probation_end_date: date | None = None
    confirmation_date: date | None = None
    exit_date: date | None = None
    exit_reason: str | None = None
    employment_type: str | None = None
    weekly_off: str | None = None
    email: str | None = None
    phone: str | None = None
    date_of_birth: date | None = None
    status: str | None = None


class CycleOut(ORM):
    id: int
    start_date: date
    end_date: date
    label: str
    status: str
    locked_at: datetime | None
    locked_by_id: int | None
    locked_by_name: str | None = None
    unlock_reason: str | None
    report_due_date: date | None
    days: int


class HolidayOut(ORM):
    id: int
    date: Date
    name: str
    kind: str
    description: str


class HolidayIn(BaseModel):
    date: Date
    name: str = Field(min_length=1, max_length=150)
    kind: str = "public"
    description: str = ""


class HolidayUpdate(BaseModel):
    date: Date | None = None
    name: str | None = None
    kind: str | None = None
    description: str | None = None


class Balances(BaseModel):
    usable: Dec
    locked: Dec
    comp_off: Dec
    lop: Dec | None = None


class LedgerEntryOut(BaseModel):
    id: int
    entry_date: date
    entry_type: str
    bucket: str
    amount: Dec
    cycle_id: int | None
    reference: str
    note: str
    is_system: bool
    reversal_of_id: int | None
    is_reversed: bool
    created_at: datetime
