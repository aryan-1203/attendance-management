"""Leave & pay-day engine (days only — salary amounts are handled by Accounts).

`compute_cycle` turns (policy, employee, opening balances, attendance marks, holidays) for ONE salary
cycle into a deterministic list of ledger postings plus a pay-days summary. It is pure: the same
input always yields the same output, which is what makes recalculation idempotent.

Rules implemented (see DECISIONS.md for the reasoning behind each default):
* Eligible window = cycle ∩ [date_of_joining, exit_date].
* Accrual: `accrual_per_cycle` credited at start/end of the eligible window (or daily pro-rata).
  Partial windows (joiners/leavers) are pro-rated by eligible/cycle days and rounded per policy.
* Probation: of each accrual, `probation_usable_per_cycle` (pro-rated) is usable, the rest locked.
  Locked balance is released to usable on the confirmation date (PROBATION_RELEASE).
* Deduction order for A / HD / L: usable → (comp-off if auto-apply) → LOP.
  For CO: comp-off → usable → LOP. Locked balance is never used.
* Sundays/weekly-offs and holidays are paid and never deducted (unless the sandwich rule applies).
* Working on a weekly-off/holiday (P/OD/HD) earns comp-off that expires after N days.
* Payable days = eligible days − LOP days.
"""
from __future__ import annotations

from dataclasses import replace
from datetime import date, timedelta
from decimal import Decimal

from app.engine.calendar import daterange
from app.engine.rounding import D0, floor2, q2, round_days
from app.engine.types import (NON_WORKING_CODES, PRESENT_CODES, Balances, CompOffLot, CycleInput, CycleResult,
                              CycleSummary, DayResult, Posting)

HALF = Decimal("0.5")
ONE = Decimal("1")
FULL_LEAVE_CODES = frozenset({"A", "L", "CO"})


class _State:
    def __init__(self, opening: Balances):
        self.usable = opening.usable
        self.locked = opening.locked
        self.lots = sorted((replace(lot) for lot in opening.comp_off_lots if lot.remaining > 0),
                           key=lambda lot: (lot.expires_on, lot.earned_date))
        self.postings: list[Posting] = []
        self.probation_used_this_cycle = D0

    @property
    def comp_off(self) -> Decimal:
        return sum((lot.remaining for lot in self.lots), D0)

    def post(self, on: date, entry_type: str, bucket: str, amount: Decimal, note: str = "", ref: str = "") -> None:
        amount = q2(amount)
        if amount == 0:
            return
        self.postings.append(Posting(on, entry_type, bucket, amount, note, ref))


def _is_non_working(day: date, inp: CycleInput) -> str | None:
    if day in inp.holidays:
        return "H"
    if day.weekday() in inp.employee.weekly_off:
        return "WO"
    return None


def _sandwiched_days(inp: CycleInput) -> set[date]:
    """Weekly-off/holiday runs bounded on both sides by full-day leave/absence."""
    result: set[date] = set()
    marks = inp.attendance

    def leave_on(day: date) -> bool:
        m = marks.get(day)
        return bool(m and m.status in FULL_LEAVE_CODES and _is_non_working(day, inp) is None)

    def off_on(day: date) -> bool:
        if _is_non_working(day, inp) is None:
            return False
        m = marks.get(day)
        return not (m and (m.status in PRESENT_CODES or m.status == "HD"))

    day = inp.cycle_start
    while day <= inp.cycle_end:
        if off_on(day):
            run_start = day
            while day <= inp.cycle_end + timedelta(days=14) and off_on(day):
                day += timedelta(days=1)
            run_end = day - timedelta(days=1)
            if leave_on(run_start - timedelta(days=1)) and leave_on(run_end + timedelta(days=1)):
                result.update(daterange(run_start, run_end))
        else:
            day += timedelta(days=1)
    return result


def compute_cycle(inp: CycleInput) -> CycleResult:
    pol, emp = inp.policy, inp.employee
    cs, ce = inp.cycle_start, inp.cycle_end
    if ce < cs:
        raise ValueError("cycle_end before cycle_start")
    cycle_days = (ce - cs).days + 1
    ws = max(cs, emp.date_of_joining)
    we = min(ce, emp.exit_date) if emp.exit_date else ce

    st = _State(inp.opening)
    summary = CycleSummary(cycle_days=cycle_days, opening_usable=st.usable, opening_locked=st.locked,
                           opening_comp_off=st.comp_off)
    warnings: list[str] = []
    remarks: list[str] = []
    days: list[DayResult] = []

    if ws > we:  # not employed at all during this cycle
        for day in daterange(cs, ce):
            code = "NJ" if day < emp.date_of_joining else "EX"
            days.append(DayResult(day, code, False))
        summary.closing_usable, summary.closing_locked, summary.closing_comp_off = st.usable, st.locked, st.comp_off
        return CycleResult([], days, summary, Balances(st.usable, st.locked, st.lots), warnings, remarks)

    eligible = (we - ws).days + 1
    summary.eligible_days = eligible
    summary.joined_in_cycle = cs <= emp.date_of_joining <= ce
    summary.exited_in_cycle = bool(emp.exit_date and cs <= emp.exit_date <= ce)

    # ---- accrual amounts -------------------------------------------------------------------
    full = pol.accrual_per_cycle
    if pol.accrual_timing == "daily":
        total = q2(full * eligible / cycle_days)
    elif eligible == cycle_days:
        total = full
    else:
        total = round_days(full * eligible / cycle_days, pol.prorata_rounding)

    accrual_day = we if pol.accrual_timing == "end" else ws
    probation_at_accrual = emp.on_probation(accrual_day)
    if probation_at_accrual and full > 0:
        if total == full:
            usable_part = pol.probation_usable_per_cycle
        elif pol.accrual_timing == "daily":
            usable_part = q2(total * pol.probation_usable_per_cycle / full)
        else:
            usable_part = round_days(total * pol.probation_usable_per_cycle / full, pol.prorata_rounding)
        usable_part = min(usable_part, total)
        locked_part = total - usable_part
    else:
        usable_part, locked_part = total, D0
    summary.accrued, summary.accrued_usable, summary.accrued_locked = total, usable_part, locked_part
    accrual_note = "Monthly accrual" if eligible == cycle_days else f"Pro-rata accrual ({eligible}/{cycle_days} days)"

    def credit_accrual(on: date) -> None:
        st.usable += usable_part
        st.locked += locked_part
        st.post(on, "ACCRUAL", "usable", usable_part, accrual_note)
        if locked_part:
            st.post(on, "PROBATION_LOCK", "locked", locked_part, "Probation: locked until confirmation")

    # daily accrual: make each day's share available progressively; ledger rows posted at window end
    accrued_u = accrued_l = D0
    day_index = 0

    sandwiched = _sandwiched_days(inp) if pol.sandwich_rule else set()
    late_count = 0

    def deduct(on: date, amount: Decimal, reason: str, prefer_comp_off: bool, dr: DayResult) -> None:
        remaining = amount
        if prefer_comp_off and pol.comp_off_enabled:
            remaining = _use_comp_off(st, on, remaining, reason, dr)
        if remaining > 0:
            available = st.usable + (pol.negative_balance_limit if pol.negative_balance_allowed else D0)
            if emp.on_probation(on) and not pol.probation_usable_cumulative:
                available = min(available, pol.probation_usable_per_cycle - st.probation_used_this_cycle)
            take = floor2(max(D0, min(remaining, available)))
            if take > 0:
                st.usable -= take
                if emp.on_probation(on):
                    st.probation_used_this_cycle += take
                st.post(on, "LEAVE_USED", "usable", -take, reason)
                dr.paid_leave += take
                remaining -= take
        if remaining > 0 and pol.comp_off_enabled and pol.comp_off_auto_apply and not prefer_comp_off:
            remaining = _use_comp_off(st, on, remaining, reason, dr)
        if remaining > 0:
            st.post(on, "LOP", "lop", remaining, reason)
            dr.lop += remaining

    for day in daterange(cs, ce):
        if day < ws:
            days.append(DayResult(day, "NJ", day in inp.attendance))
            continue
        if day > we:
            days.append(DayResult(day, "EX", day in inp.attendance))
            continue

        if day == ws and pol.accrual_timing == "start":
            credit_accrual(day)
        if pol.accrual_timing == "daily":
            day_index += 1
            to_date_u = floor2(usable_part * day_index / eligible)
            to_date_l = floor2(locked_part * day_index / eligible)
            st.usable += to_date_u - accrued_u
            st.locked += to_date_l - accrued_l
            accrued_u, accrued_l = to_date_u, to_date_l

        # probation release (on/after confirmation date)
        if not emp.on_probation(day) and st.locked > 0:
            amount = st.locked
            st.post(day, "PROBATION_RELEASE", "locked", -amount, "Probation release on confirmation")
            st.post(day, "PROBATION_RELEASE", "usable", amount, "Probation release on confirmation")
            st.usable += amount
            st.locked -= amount
            summary.released += q2(amount)

        # comp-off expiry: lots are usable up to and including expires_on
        for lot in st.lots:
            if lot.remaining > 0 and lot.expires_on < day:
                st.post(day, "COMP_OFF_EXPIRED", "comp_off", -lot.remaining,
                        f"Comp-off earned {lot.earned_date.isoformat()} expired",
                        f"lot:{lot.earned_date.isoformat()}")
                summary.comp_off_expired += lot.remaining
                lot.remaining = D0
        st.lots = [lot for lot in st.lots if lot.remaining > 0]

        mark = inp.attendance.get(day)
        off_code = _is_non_working(day, inp)
        status = mark.status if mark else off_code
        if status in ("NJ", "EX"):
            warnings.append(f"{day.isoformat()}: '{status}' inside employment window treated as unmarked")
            status = off_code
        dr = DayResult(day, status or "-", mark is not None)

        if status is None and inp.as_of is not None and day > inp.as_of:
            summary.pending_days += 1  # future day not yet marked
            dr.status = "-"
            dr.note = "Pending"
        elif status is None:  # unmarked working day
            summary.unmarked_days += 1
            if pol.unmarked_policy == "absent":
                dr.status = "A"
                summary.absent_days += 1
                deduct(day, ONE, "Absent (unmarked)", False, dr)
            else:
                dr.present = ONE
                dr.note = "Unmarked (treated as present)"
        elif status in PRESENT_CODES:
            dr.present = ONE
            summary.present_days += 1
            if off_code and status in ("P", "OD") and pol.comp_off_enabled:
                _earn_comp_off(st, day, ONE, pol, dr, off_code)
                summary.comp_off_earned += ONE
            if mark and mark.is_late and pol.late_mark_enabled:
                late_count += 1
                if pol.late_marks_per_half_day > 0 and late_count % pol.late_marks_per_half_day == 0:
                    deduct(day, HALF, f"{pol.late_marks_per_half_day} late marks", False, dr)
        elif status == "HD":
            dr.present = HALF
            summary.half_days += 1
            if off_code:
                if pol.comp_off_enabled:
                    _earn_comp_off(st, day, HALF, pol, dr, off_code)
                    summary.comp_off_earned += HALF
            else:
                deduct(day, HALF, "Half-day", False, dr)
        elif status in FULL_LEAVE_CODES:
            if off_code:
                # absence/leave marked on a weekly-off or holiday: paid off-day, not deducted
                dr.status = off_code
                if day in sandwiched:
                    deduct(day, ONE, f"Sandwich rule ({off_code})", False, dr)
                    dr.note = "Sandwiched"
                elif status != off_code:
                    warnings.append(f"{day.isoformat()}: '{status}' on {off_code} ignored (non-working day)")
                if off_code == "H":
                    summary.holidays += 1
                else:
                    summary.weekly_offs += 1
            else:
                if status == "A":
                    summary.absent_days += 1
                    deduct(day, ONE, "Absent", False, dr)
                elif status == "L":
                    summary.leave_days += 1
                    deduct(day, ONE, "Approved leave", False, dr)
                else:  # CO
                    summary.leave_days += 1
                    deduct(day, ONE, "Comp-off", True, dr)
        elif status in NON_WORKING_CODES:
            if status == "H":
                summary.holidays += 1
            else:
                summary.weekly_offs += 1
            if day in sandwiched:
                deduct(day, ONE, f"Sandwich rule ({status})", False, dr)
                dr.note = "Sandwiched"
        days.append(dr)

        if day == we and pol.accrual_timing == "end":
            credit_accrual(day)

    if pol.accrual_timing == "daily":
        # rows for the (already applied) daily accrual, then fix rounding drift
        st.post(we, "ACCRUAL", "usable", usable_part, accrual_note + " (daily)")
        if locked_part:
            st.post(we, "PROBATION_LOCK", "locked", locked_part, "Probation: locked until confirmation")

    summary.late_marks = late_count
    summary.paid_leave_used = sum((x.paid_leave for x in days), D0)
    summary.comp_off_used = sum((x.comp_off_used for x in days), D0)
    summary.lop_days = sum((x.lop for x in days), D0)
    summary.payable_days = Decimal(eligible) - summary.lop_days
    summary.closing_usable, summary.closing_locked, summary.closing_comp_off = q2(st.usable), q2(st.locked), st.comp_off
    summary.on_probation_at_end = emp.on_probation(we)


    if summary.exited_in_cycle:
        balance = summary.closing_usable + summary.closing_locked
        remarks.append(f"Exited {emp.exit_date.isoformat()}: {q2(balance)} leave balance pending encashment/settlement")
    if summary.joined_in_cycle and emp.date_of_joining > cs:
        remarks.append(f"Joined {emp.date_of_joining.isoformat()} (pro-rata {eligible}/{cycle_days} days)")
    if summary.released:
        remarks.append(f"Probation release {q2(summary.released)}")
    if summary.unmarked_days:
        remarks.append(f"{summary.unmarked_days} unmarked day(s)")

    return CycleResult(st.postings, days, summary, Balances(summary.closing_usable, summary.closing_locked,
                                                                  st.lots), warnings, remarks)


def _earn_comp_off(st: _State, on: date, amount: Decimal, pol, dr: DayResult, off_code: str) -> None:
    expires = on + timedelta(days=pol.comp_off_expiry_days)
    st.lots.append(CompOffLot(on, amount, expires))
    st.lots.sort(key=lambda lot: (lot.expires_on, lot.earned_date))
    st.post(on, "COMP_OFF_EARNED", "comp_off", amount, f"Worked on {'holiday' if off_code == 'H' else 'weekly off'}",
            f"expires:{expires.isoformat()}")
    dr.comp_off_earned += amount


def _use_comp_off(st: _State, on: date, needed: Decimal, reason: str, dr: DayResult) -> Decimal:
    for lot in st.lots:
        if needed <= 0:
            break
        if lot.remaining <= 0 or lot.expires_on < on:
            continue
        take = min(lot.remaining, needed)
        lot.remaining -= take
        needed -= take
        dr.comp_off_used += take
        st.post(on, "LEAVE_USED", "comp_off", -take, f"{reason} (comp-off)", f"lot:{lot.earned_date.isoformat()}")
    st.lots = [lot for lot in st.lots if lot.remaining > 0]
    return needed


def run_cycles(inputs: list[CycleInput]) -> list[CycleResult]:
    """Run consecutive cycles, chaining each cycle's closing balances into the next opening."""
    results: list[CycleResult] = []
    opening = inputs[0].opening if inputs else Balances()
    for inp in inputs:
        inp = replace(inp, opening=opening)
        res = compute_cycle(inp)
        results.append(res)
        opening = res.closing
    return results
