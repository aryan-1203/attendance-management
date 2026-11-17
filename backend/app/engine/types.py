from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

D0 = Decimal("0")

PRESENT_CODES = frozenset({"P", "WFH", "OD"})
NON_WORKING_CODES = frozenset({"WO", "H"})
ALL_CODES = frozenset({"P", "A", "HD", "L", "WO", "H", "CO", "WFH", "OD", "NJ", "EX"})


@dataclass(frozen=True)
class Policy:
    accrual_per_cycle: Decimal = Decimal("1.5")
    probation_usable_per_cycle: Decimal = Decimal("0.5")
    probation_usable_cumulative: bool = True
    accrual_timing: str = "start"  # start | end | daily
    prorata_rounding: str = "nearest_half"  # nearest_half | floor_half | ceil_half | none
    sandwich_rule: bool = False
    late_mark_enabled: bool = False
    late_marks_per_half_day: int = 3
    negative_balance_allowed: bool = False
    negative_balance_limit: Decimal = Decimal("0")
    comp_off_enabled: bool = True
    comp_off_expiry_days: int = 60
    comp_off_auto_apply: bool = False  # use comp-off for A/HD/L after usable balance is exhausted
    unmarked_policy: str = "present"  # present | absent


@dataclass(frozen=True)
class EmployeeProfile:
    date_of_joining: date
    employment_type: str = "permanent"  # probation | permanent | contract | intern
    confirmation_date: date | None = None
    exit_date: date | None = None
    weekly_off: frozenset[int] = frozenset({6})  # 0=Mon .. 6=Sun

    def on_probation(self, on: date) -> bool:
        if self.confirmation_date is not None:
            return on < self.confirmation_date
        return self.employment_type == "probation"


@dataclass
class CompOffLot:
    earned_date: date
    remaining: Decimal
    expires_on: date
    original: Decimal = D0

    def __post_init__(self) -> None:
        if self.original == D0:
            self.original = self.remaining


@dataclass
class Balances:
    usable: Decimal = D0
    locked: Decimal = D0
    comp_off_lots: list[CompOffLot] = field(default_factory=list)

    @property
    def comp_off(self) -> Decimal:
        return sum((lot.remaining for lot in self.comp_off_lots), D0)


@dataclass(frozen=True)
class DayMark:
    status: str
    is_late: bool = False


@dataclass(frozen=True)
class Posting:
    entry_date: date
    entry_type: str
    bucket: str  # usable | locked | comp_off | lop
    amount: Decimal
    note: str = ""
    reference: str = ""

    def key(self) -> tuple:
        return (self.entry_date, self.entry_type, self.bucket, self.amount, self.note, self.reference)


@dataclass
class CycleInput:
    cycle_start: date
    cycle_end: date
    employee: EmployeeProfile
    policy: Policy = field(default_factory=Policy)
    opening: Balances = field(default_factory=Balances)
    attendance: dict[date, DayMark] = field(default_factory=dict)  # may include neighbour dates (sandwich)
    holidays: dict[date, str] = field(default_factory=dict)
    as_of: date | None = None  # unmarked days after this date are "pending" (never deducted)


@dataclass
class DayResult:
    date: date
    status: str  # resolved code
    marked: bool
    present: Decimal = D0
    paid_leave: Decimal = D0
    comp_off_used: Decimal = D0
    lop: Decimal = D0
    comp_off_earned: Decimal = D0
    note: str = ""


@dataclass
class CycleSummary:
    cycle_days: int = 0
    eligible_days: int = 0
    weekly_offs: int = 0
    holidays: int = 0
    present_days: int = 0
    half_days: int = 0
    absent_days: int = 0
    leave_days: int = 0
    unmarked_days: int = 0
    pending_days: int = 0
    late_marks: int = 0
    paid_leave_used: Decimal = D0
    comp_off_used: Decimal = D0
    comp_off_earned: Decimal = D0
    comp_off_expired: Decimal = D0
    lop_days: Decimal = D0
    payable_days: Decimal = D0
    opening_usable: Decimal = D0
    opening_locked: Decimal = D0
    opening_comp_off: Decimal = D0
    accrued: Decimal = D0
    accrued_usable: Decimal = D0
    accrued_locked: Decimal = D0
    released: Decimal = D0
    closing_usable: Decimal = D0
    closing_locked: Decimal = D0
    closing_comp_off: Decimal = D0
    on_probation_at_end: bool = False
    exited_in_cycle: bool = False
    joined_in_cycle: bool = False


@dataclass
class CycleResult:
    postings: list[Posting]
    days: list[DayResult]
    summary: CycleSummary
    closing: Balances
    warnings: list[str] = field(default_factory=list)
    remarks: list[str] = field(default_factory=list)
