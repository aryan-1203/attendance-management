"""Exhaustive unit tests for the pure leave & pay-day engine (no database)."""
from datetime import date, timedelta
from decimal import Decimal as D

import pytest

from app.engine import (Balances, CompOffLot, CycleInput, DayMark, EmployeeProfile, Policy, compute_cycle,
                        cycle_bounds, run_cycles)
from app.engine.calendar import cycle_label, next_cycle
from app.engine.ledger import LedgerRow, balances_from_rows
from app.engine.rounding import round_days

CS, CE = date(2026, 10, 20), date(2026, 11, 19)
SUNDAYS = [date(2026, 10, 25), date(2026, 11, 1), date(2026, 11, 8), date(2026, 11, 15)]


def perm(**kw):
    base = dict(date_of_joining=date(2024, 1, 1), employment_type="permanent")
    base.update(kw)
    return EmployeeProfile(**base)


def prob(**kw):
    base = dict(date_of_joining=date(2026, 6, 1), employment_type="probation")
    base.update(kw)
    return EmployeeProfile(**base)


def marks(**by_date):
    return {date.fromisoformat(k.replace("_", "-")[1:]): DayMark(v) for k, v in by_date.items()}


def m(*pairs):
    return {dt: DayMark(code) for dt, code in pairs}


def ledger_sum(res, bucket, entry_type=None):
    return sum((p.amount for p in res.postings if p.bucket == bucket and (entry_type is None or p.entry_type == entry_type)), D(0))


# ---------------------------------------------------------------------------------------------
# Calendar
# ---------------------------------------------------------------------------------------------
class TestCalendar:
    def test_cycle_bounds_default_20th(self):
        assert cycle_bounds(date(2026, 11, 3)) == (CS, CE)
        assert cycle_bounds(date(2026, 10, 20)) == (CS, CE)
        assert cycle_bounds(date(2026, 11, 19)) == (CS, CE)
        assert cycle_bounds(date(2026, 11, 20)) == (date(2026, 11, 20), date(2026, 12, 19))

    def test_cycle_days_and_sundays(self):
        assert (CE - CS).days + 1 == 31
        sundays = [CS + timedelta(days=i) for i in range(31) if (CS + timedelta(days=i)).weekday() == 6]
        assert sundays == SUNDAYS

    def test_year_wrap(self):
        assert cycle_bounds(date(2027, 1, 5)) == (date(2026, 12, 20), date(2027, 1, 19))
        assert next_cycle(date(2026, 12, 20)) == (date(2027, 1, 20), date(2027, 2, 19))

    def test_configurable_start_day(self):
        assert cycle_bounds(date(2026, 2, 14), 1) == (date(2026, 2, 1), date(2026, 2, 28))
        assert cycle_bounds(date(2026, 3, 10), 26) == (date(2026, 2, 26), date(2026, 3, 25))
        assert cycle_bounds(date(2026, 3, 10), 31) == (date(2026, 2, 28), date(2026, 3, 27))  # clamped to 28

    def test_label(self):
        assert cycle_label(CS, CE) == "20 Oct – 19 Nov 2026"
        assert cycle_label(date(2026, 12, 20), date(2027, 1, 19)) == "20 Dec 2026 – 19 Jan 2027"


class TestRounding:
    @pytest.mark.parametrize("value,mode,expected", [
        ("0.9193", "nearest_half", "1.00"), ("0.74", "nearest_half", "0.50"), ("0.75", "nearest_half", "1.00"),
        ("0.24", "nearest_half", "0.00"), ("1.25", "nearest_half", "1.50"), ("0.9193", "floor_half", "0.50"),
        ("0.10", "ceil_half", "0.50"), ("0.9193", "none", "0.92"), ("1.5", "nearest_half", "1.50"),
    ])
    def test_modes(self, value, mode, expected):
        assert round_days(D(value), mode) == D(expected)


# ---------------------------------------------------------------------------------------------
# Mandatory worked tests (section 2.7)
# ---------------------------------------------------------------------------------------------
class TestMandatoryWorkedExamples:
    def test_1_permanent_partial_lop(self):
        att = m((date(2026, 10, 21), "A"), (date(2026, 10, 22), "A"), (date(2026, 11, 3), "A"),
                (date(2026, 11, 5), "HD"))
        res = compute_cycle(CycleInput(CS, CE, perm(), opening=Balances(usable=D("1.0")), attendance=att))
        s = res.summary
        assert s.cycle_days == 30 and s.eligible_days == 30
        assert s.opening_usable == D("1.0") and s.accrued == D("1.5")
        assert s.paid_leave_used == D("2.5")
        assert s.lop_days == D("1.0")
        assert s.closing_usable == D("0")
        assert s.payable_days == D("29")
        assert s.weekly_offs == 4
        assert ledger_sum(res, "lop") == D("1.0")

    def test_2_probation_cumulative_off(self):
        pol = Policy(probation_usable_cumulative=False)
        att = m((date(2026, 10, 27), "A"), (date(2026, 10, 28), "A"))
        res = compute_cycle(CycleInput(CS, CE, prob(), policy=pol, attendance=att))
        s = res.summary
        assert s.accrued_usable == D("0.5") and s.accrued_locked == D("1.0")
        assert s.paid_leave_used == D("0.5")
        assert s.lop_days == D("1.5")
        assert s.payable_days == D("28.5")
        assert s.closing_locked == D("1.0")  # untouched
        assert ledger_sum(res, "locked") == D("1.0")

    def test_3_probation_confirmed_releases_locked(self):
        emp = prob(date_of_joining=date(2026, 7, 20), confirmation_date=date(2026, 11, 1))
        cycles = [(date(2026, 7, 20), date(2026, 8, 19)), (date(2026, 8, 20), date(2026, 9, 19)),
                  (date(2026, 9, 20), date(2026, 10, 19))]
        results = run_cycles([CycleInput(a, b, emp) for a, b in cycles])
        assert results[-1].closing.locked == D("3.0")
        assert results[-1].closing.usable == D("1.5")
        # 4th cycle contains the confirmation date
        res = compute_cycle(CycleInput(CS, CE, emp, opening=results[-1].closing))
        release = [p for p in res.postings if p.entry_type == "PROBATION_RELEASE"]
        assert {(p.bucket, p.amount, p.entry_date) for p in release} == {
            ("locked", D("-4.00"), date(2026, 11, 1)), ("usable", D("4.00"), date(2026, 11, 1))}
        # 3.0 carried in + 1.0 locked from this cycle's accrual (made before confirmation)
        assert res.summary.released == D("4.0")
        assert res.summary.closing_locked == D("0")
        assert res.summary.closing_usable == D("1.5") + D("0.5") + D("4.0")

    def test_3b_release_exactly_three_when_confirmed_at_cycle_start(self):
        emp = prob(date_of_joining=date(2026, 7, 20), confirmation_date=date(2026, 10, 20))
        cycles = [(date(2026, 7, 20), date(2026, 8, 19)), (date(2026, 8, 20), date(2026, 9, 19)),
                  (date(2026, 9, 20), date(2026, 10, 19)), (CS, CE)]
        results = run_cycles([CycleInput(a, b, emp) for a, b in cycles])
        rel = [p for p in results[-1].postings if p.entry_type == "PROBATION_RELEASE" and p.bucket == "usable"]
        assert rel == [rel[0]] and rel[0].amount == D("3.00") and rel[0].entry_date == date(2026, 10, 20)
        assert results[-1].summary.accrued_usable == D("1.5")  # permanent from cycle start
        assert results[-1].closing.usable == D("1.5") + D("3.0") + D("1.5")

    def test_4_new_joiner_prorata(self):
        emp = prob(date_of_joining=date(2026, 11, 1))
        res = compute_cycle(CycleInput(CS, CE, emp))
        s = res.summary
        assert s.eligible_days == 19
        assert s.accrued == D("1.0")  # 1.5*19/30 = 0.95 -> 1.0
        assert s.payable_days == D("19")
        assert s.joined_in_cycle
        assert res.days[0].status == "NJ" and res.days[11].status == "NJ" and res.days[12].status == "WO"

    def test_4b_new_joiner_permanent_accrual_all_usable(self):
        res = compute_cycle(CycleInput(CS, CE, perm(date_of_joining=date(2026, 11, 1))))
        assert res.summary.accrued_usable == D("1.0") and res.summary.accrued_locked == 0

    def test_5_holiday_inside_cycle_paid(self):
        hol = {date(2026, 11, 9): "Diwali"}
        att = m((date(2026, 11, 9), "H"))
        res = compute_cycle(CycleInput(CS, CE, perm(), attendance=att, holidays=hol))
        assert res.summary.holidays == 1
        assert res.summary.lop_days == 0 and res.summary.paid_leave_used == 0
        assert res.summary.eligible_days == 30 and res.summary.payable_days == 30

    def test_5b_holiday_auto_filled_without_mark(self):
        res = compute_cycle(CycleInput(CS, CE, perm(), holidays={date(2026, 11, 9): "Diwali"}))
        assert [d.status for d in res.days if d.date == date(2026, 11, 9)] == ["H"]
        assert res.summary.eligible_days == 30 and res.summary.payable_days == 30 and res.summary.unmarked_days == 26

    def test_6_exit_mid_cycle(self):
        emp = perm(exit_date=date(2026, 11, 10))
        res = compute_cycle(CycleInput(CS, CE, emp, opening=Balances(usable=D("4.0"))))
        assert res.summary.eligible_days == 22
        assert res.summary.exited_in_cycle
        assert res.summary.payable_days == 22
        assert res.days[-1].status == "EX"
        assert any("encashment" in r for r in res.remarks)
        assert res.summary.accrued == D("1.0")  # 1.5*22/30 = 1.1 -> 1.0
        assert res.summary.closing_usable == D("5.0")

    def test_7_retro_edit_engine_is_deterministic(self):
        """The service-level part (locked cycle blocked, reversal+re-post) lives in test_services.py.
        Here: changing A->P changes the postings exactly as expected."""
        before = m((date(2026, 10, 21), "A"))
        r1 = compute_cycle(CycleInput(CS, CE, perm(), attendance=before))
        r2 = compute_cycle(CycleInput(CS, CE, perm(), attendance=m((date(2026, 10, 21), "P"))))
        assert r1.summary.paid_leave_used == 1 and r2.summary.paid_leave_used == 0
        assert r2.summary.closing_usable == D("1.5")


# ---------------------------------------------------------------------------------------------
# Accrual & probation details
# ---------------------------------------------------------------------------------------------
class TestAccrual:
    def test_full_cycle_permanent(self):
        res = compute_cycle(CycleInput(CS, CE, perm()))
        assert [(p.entry_type, p.bucket, p.amount, p.entry_date) for p in res.postings] == [
            ("ACCRUAL", "usable", D("1.50"), CS)]

    def test_probation_split_postings(self):
        res = compute_cycle(CycleInput(CS, CE, prob()))
        assert [(p.entry_type, p.bucket, p.amount) for p in res.postings] == [
            ("ACCRUAL", "usable", D("0.50")), ("PROBATION_LOCK", "locked", D("1.00"))]

    def test_accrual_at_end_not_usable_in_cycle(self):
        pol = Policy(accrual_timing="end")
        res = compute_cycle(CycleInput(CS, CE, perm(), policy=pol, attendance=m((date(2026, 10, 21), "A"))))
        assert res.summary.lop_days == 1 and res.summary.closing_usable == D("1.5")
        assert res.postings[-1].entry_date == CE

    def test_daily_accrual(self):
        pol = Policy(accrual_timing="daily")
        # absent on day 1: only 1.5/31 of the full accrual so far -> mostly LOP
        res = compute_cycle(CycleInput(CS, CE, perm(), policy=pol, attendance=m((CS, "A"))))
        assert res.summary.paid_leave_used == D("0.04")  # 1.5/31 = 0.0483 floored to 0.01 grid
        assert res.summary.lop_days == D("0.96")
        assert res.summary.closing_usable == D("1.46")
        assert res.summary.accrued == D("1.50")
        assert res.summary.cycle_days == 30

    def test_prorata_rounding_modes(self):
        emp = perm(date_of_joining=date(2026, 11, 1))
        assert compute_cycle(CycleInput(CS, CE, emp, policy=Policy(prorata_rounding="floor_half"))).summary.accrued == D("0.5")
        assert compute_cycle(CycleInput(CS, CE, emp, policy=Policy(prorata_rounding="none"))).summary.accrued == D("0.95")

    def test_probation_cumulative_on_accumulates_usable(self):
        emp = prob(date_of_joining=date(2026, 8, 20))
        cycles = [(date(2026, 8, 20), date(2026, 9, 19)), (date(2026, 9, 20), date(2026, 10, 19))]
        prev = run_cycles([CycleInput(a, b, emp) for a, b in cycles])[-1].closing
        assert prev.usable == D("1.0") and prev.locked == D("2.0")
        att = m((date(2026, 10, 21), "A"), (date(2026, 10, 22), "A"))
        res = compute_cycle(CycleInput(CS, CE, emp, opening=prev, attendance=att))
        assert res.summary.paid_leave_used == D("1.5") and res.summary.lop_days == D("0.5")
        assert res.summary.closing_locked == D("3.0")

    def test_probation_cumulative_off_caps_per_cycle_even_with_balance(self):
        pol = Policy(probation_usable_cumulative=False)
        res = compute_cycle(CycleInput(CS, CE, prob(), policy=pol, opening=Balances(usable=D("1.0"), locked=D("2.0")),
                                       attendance=m((date(2026, 10, 21), "A"))))
        assert res.summary.paid_leave_used == D("0.5") and res.summary.lop_days == D("0.5")
        assert res.summary.closing_usable == D("1.0")

    def test_locked_never_used_before_confirmation(self):
        att = {CS + timedelta(days=i): DayMark("A") for i in range(1, 6) if (CS + timedelta(days=i)).weekday() != 6}
        res = compute_cycle(CycleInput(CS, CE, prob(), opening=Balances(locked=D("5.0")), attendance=att))
        assert res.summary.closing_locked == D("6.0")
        assert res.summary.paid_leave_used == D("0.5")

    def test_absence_after_confirmation_uses_released_balance(self):
        emp = prob(confirmation_date=date(2026, 11, 2))
        att = m((date(2026, 10, 21), "A"), (date(2026, 11, 3), "A"), (date(2026, 11, 4), "A"))
        res = compute_cycle(CycleInput(CS, CE, emp, opening=Balances(usable=D("0"), locked=D("3.0")), attendance=att))
        # 21 Oct (probation): 0.5 paid + 0.5 LOP. Release 4.0 on 2 Nov. 3,4 Nov paid.
        assert res.summary.lop_days == D("0.5")
        assert res.summary.paid_leave_used == D("2.5")
        assert res.summary.closing_usable == D("2.0") and res.summary.closing_locked == 0

    def test_confirmation_in_past_releases_at_cycle_start(self):
        emp = prob(confirmation_date=date(2026, 9, 1))  # confirmed already, but locked left over
        res = compute_cycle(CycleInput(CS, CE, emp, opening=Balances(locked=D("2.0"))))
        rel = [p for p in res.postings if p.entry_type == "PROBATION_RELEASE"]
        assert rel and rel[0].entry_date == CS
        assert res.summary.accrued_locked == 0 and res.summary.closing_usable == D("3.5")

    def test_not_employed_in_cycle(self):
        res = compute_cycle(CycleInput(CS, CE, perm(date_of_joining=date(2026, 12, 1))))
        assert res.postings == [] and res.summary.eligible_days == 0 and res.summary.payable_days == 0
        assert all(d.status == "NJ" for d in res.days)

    def test_joined_and_exited_same_cycle(self):
        emp = perm(date_of_joining=date(2026, 10, 25), exit_date=date(2026, 11, 5))
        res = compute_cycle(CycleInput(CS, CE, emp))
        assert res.summary.eligible_days == 12 and res.summary.accrued == D("0.5")  # 1.5*12/30 = 0.6 -> 0.5


# ---------------------------------------------------------------------------------------------
# Deductions
# ---------------------------------------------------------------------------------------------
class TestDeductions:
    def test_half_day_with_balance(self):
        res = compute_cycle(CycleInput(CS, CE, perm(), attendance=m((date(2026, 10, 21), "HD"))))
        assert res.summary.paid_leave_used == D("0.5") and res.summary.half_days == 1 and res.summary.lop_days == 0

    def test_half_day_without_balance_is_half_lop(self):
        res = compute_cycle(CycleInput(CS, CE, perm(), policy=Policy(accrual_timing="end"),
                                       attendance=m((date(2026, 10, 21), "HD"))))
        assert res.summary.lop_days == D("0.5") and res.summary.payable_days == D("29.5")

    def test_approved_leave_without_balance_becomes_lop(self):
        att = m((date(2026, 10, 21), "L"), (date(2026, 10, 22), "L"))
        res = compute_cycle(CycleInput(CS, CE, perm(), attendance=att))
        assert res.summary.paid_leave_used == D("1.5") and res.summary.lop_days == D("0.5")
        assert res.summary.leave_days == 2

    def test_absent_on_sunday_ignored(self):
        res = compute_cycle(CycleInput(CS, CE, perm(), attendance=m((SUNDAYS[0], "A"))))
        assert res.summary.paid_leave_used == 0 and res.summary.lop_days == 0 and res.warnings

    def test_leave_spanning_weekend_only_counts_working_days(self):
        att = {date(2026, 10, 23) + timedelta(days=i): DayMark("L") for i in range(4)}  # Fri..Mon
        res = compute_cycle(CycleInput(CS, CE, perm(), opening=Balances(usable=D("5")), attendance=att))
        assert res.summary.paid_leave_used == D("3")  # Fri, Sat, Mon (Sunday free)

    def test_negative_balance_allowed(self):
        pol = Policy(negative_balance_allowed=True, negative_balance_limit=D("2"))
        att = m((date(2026, 10, 21), "A"), (date(2026, 10, 22), "A"), (date(2026, 10, 23), "A"),
                (date(2026, 10, 24), "A"))
        res = compute_cycle(CycleInput(CS, CE, perm(), policy=pol, attendance=att))
        assert res.summary.paid_leave_used == D("3.5") and res.summary.lop_days == D("0.5")
        assert res.summary.closing_usable == D("-2.0")

    def test_unmarked_policy_absent(self):
        res = compute_cycle(CycleInput(CS, CE, perm(), policy=Policy(unmarked_policy="absent")))
        assert res.summary.unmarked_days == 27  # 31 - 4 Sundays
        assert res.summary.lop_days == D("25.5")

    def test_wfh_and_od_count_as_present(self):
        res = compute_cycle(CycleInput(CS, CE, perm(), attendance=m((date(2026, 10, 21), "WFH"), (date(2026, 10, 22), "OD"))))
        assert res.summary.present_days == 2 and res.summary.lop_days == 0

    def test_sandwich_rule_off_by_default(self):
        att = m((date(2026, 10, 24), "A"), (date(2026, 10, 26), "A"))  # Sat, (Sun), Mon
        res = compute_cycle(CycleInput(CS, CE, perm(), opening=Balances(usable=D("5")), attendance=att))
        assert res.summary.paid_leave_used == D("2")

    def test_sandwich_rule_on(self):
        att = m((date(2026, 10, 24), "A"), (date(2026, 10, 26), "L"))
        res = compute_cycle(CycleInput(CS, CE, perm(), policy=Policy(sandwich_rule=True),
                                       opening=Balances(usable=D("5")), attendance=att))
        assert res.summary.paid_leave_used == D("3")
        assert [d.note for d in res.days if d.date == date(2026, 10, 25)] == ["Sandwiched"]

    def test_sandwich_with_holiday_and_sunday_run(self):
        hol = {date(2026, 11, 9): "Holiday"}  # Sun 8 + Mon 9 between Sat 7 and Tue 10
        att = m((date(2026, 11, 7), "A"), (date(2026, 11, 10), "A"))
        res = compute_cycle(CycleInput(CS, CE, perm(), policy=Policy(sandwich_rule=True), holidays=hol,
                                       opening=Balances(usable=D("10")), attendance=att))
        assert res.summary.paid_leave_used == D("4")

    def test_sandwich_needs_both_sides(self):
        att = m((date(2026, 10, 24), "A"), (date(2026, 10, 26), "P"))
        res = compute_cycle(CycleInput(CS, CE, perm(), policy=Policy(sandwich_rule=True), attendance=att))
        assert res.summary.paid_leave_used == 1

    def test_late_marks(self):
        pol = Policy(late_mark_enabled=True, late_marks_per_half_day=3)
        att = {date(2026, 10, 21) + timedelta(days=i): DayMark("P", is_late=True) for i in range(4)}
        res = compute_cycle(CycleInput(CS, CE, perm(), policy=pol, attendance=att))
        assert res.summary.late_marks == 4 and res.summary.paid_leave_used == D("0.5")

    def test_late_marks_off_by_default(self):
        att = {date(2026, 10, 21) + timedelta(days=i): DayMark("P", is_late=True) for i in range(6)}
        assert compute_cycle(CycleInput(CS, CE, perm(), attendance=att)).summary.paid_leave_used == 0


# ---------------------------------------------------------------------------------------------
# Comp-off
# ---------------------------------------------------------------------------------------------
class TestCompOff:
    def test_earn_on_sunday(self):
        res = compute_cycle(CycleInput(CS, CE, perm(), attendance=m((SUNDAYS[0], "P"))))
        earned = [p for p in res.postings if p.entry_type == "COMP_OFF_EARNED"]
        assert earned[0].amount == 1 and earned[0].reference == f"expires:{(SUNDAYS[0] + timedelta(days=60)).isoformat()}"
        assert res.summary.closing_comp_off == 1

    def test_earn_half_on_holiday_half_day(self):
        res = compute_cycle(CycleInput(CS, CE, perm(), holidays={date(2026, 11, 9): "X"},
                                       attendance=m((date(2026, 11, 9), "HD"))))
        assert res.summary.comp_off_earned == D("0.5") and res.summary.paid_leave_used == 0

    def test_disabled(self):
        res = compute_cycle(CycleInput(CS, CE, perm(), policy=Policy(comp_off_enabled=False),
                                       attendance=m((SUNDAYS[0], "P"))))
        assert res.summary.comp_off_earned == 0

    def test_use_comp_off_before_usable(self):
        att = m((SUNDAYS[0], "P"), (date(2026, 10, 27), "CO"))
        res = compute_cycle(CycleInput(CS, CE, perm(), attendance=att))
        assert res.summary.comp_off_used == 1 and res.summary.paid_leave_used == 0
        assert res.summary.closing_usable == D("1.5") and res.summary.closing_comp_off == 0

    def test_comp_off_falls_back_to_usable_then_lop(self):
        res = compute_cycle(CycleInput(CS, CE, perm(), policy=Policy(accrual_timing="end"),
                                       attendance=m((date(2026, 10, 21), "CO"))))
        assert res.summary.comp_off_used == 0 and res.summary.lop_days == 1

    def test_expiry(self):
        lot = CompOffLot(date(2026, 8, 30), D("1"), date(2026, 10, 29))
        res = compute_cycle(CycleInput(CS, CE, perm(), opening=Balances(comp_off_lots=[lot])))
        exp = [p for p in res.postings if p.entry_type == "COMP_OFF_EXPIRED"]
        assert exp[0].entry_date == date(2026, 10, 30) and exp[0].amount == -1
        assert res.summary.closing_comp_off == 0

    def test_usable_on_expiry_day(self):
        lot = CompOffLot(date(2026, 8, 30), D("1"), date(2026, 10, 29))
        res = compute_cycle(CycleInput(CS, CE, perm(), opening=Balances(comp_off_lots=[lot]),
                                       attendance=m((date(2026, 10, 29), "CO"))))
        assert res.summary.comp_off_used == 1 and res.summary.comp_off_expired == 0

    def test_auto_apply_after_usable(self):
        lot = CompOffLot(date(2026, 10, 1), D("1"), date(2026, 11, 30))
        att = m((date(2026, 10, 21), "A"), (date(2026, 10, 22), "A"))
        res = compute_cycle(CycleInput(CS, CE, perm(), policy=Policy(comp_off_auto_apply=True),
                                       opening=Balances(comp_off_lots=[lot]), attendance=att))
        assert res.summary.paid_leave_used == D("1.5") and res.summary.comp_off_used == D("0.5")
        assert res.summary.lop_days == 0


# ---------------------------------------------------------------------------------------------
# Pay & determinism
# ---------------------------------------------------------------------------------------------
class TestDeterminism:
    def test_no_floats_anywhere(self):
        res = compute_cycle(CycleInput(CS, CE, perm(), attendance=m((date(2026, 10, 21), "HD"))))
        for p in res.postings:
            assert isinstance(p.amount, D)
        for v in vars(res.summary).values():
            assert not isinstance(v, float)

    def test_idempotent(self):
        inp = CycleInput(CS, CE, prob(confirmation_date=date(2026, 11, 2)), opening=Balances(D("1"), D("2")),
                         attendance=m((date(2026, 10, 21), "A"), (SUNDAYS[1], "P"), (date(2026, 11, 5), "HD")),
                         policy=Policy(sandwich_rule=True))
        a, b = compute_cycle(inp), compute_cycle(inp)
        assert [p.key() for p in a.postings] == [p.key() for p in b.postings]
        assert a.summary == b.summary

    def test_opening_not_mutated(self):
        lot = CompOffLot(date(2026, 10, 1), D("1"), date(2026, 11, 30))
        opening = Balances(D("1"), D("0"), [lot])
        compute_cycle(CycleInput(CS, CE, perm(), opening=opening, attendance=m((date(2026, 10, 21), "CO"))))
        assert lot.remaining == 1


class TestLedgerReplay:
    def test_balances_from_rows_matches_engine_closing(self):
        emp = prob(confirmation_date=date(2026, 11, 2))
        att = m((SUNDAYS[0], "P"), (date(2026, 10, 27), "CO"), (SUNDAYS[2], "OD"), (date(2026, 11, 4), "A"))
        res = compute_cycle(CycleInput(CS, CE, emp, opening=Balances(D("0"), D("2")), attendance=att))
        rows = [LedgerRow(date(2026, 10, 1), "ADJUSTMENT", "locked", D("2"))] + [
            LedgerRow(p.entry_date, p.entry_type, p.bucket, p.amount, p.reference, i + 1) for i, p in enumerate(res.postings)]
        bal = balances_from_rows(rows)
        assert bal.usable == res.closing.usable and bal.locked == res.closing.locked
        assert bal.comp_off == res.closing.comp_off == 1
        assert bal.comp_off_lots[0].earned_date == SUNDAYS[2]

    def test_reversal_pairs_cancel(self):
        rows = [LedgerRow(CS, "ACCRUAL", "usable", D("1.5"), seq=1), LedgerRow(CS, "ACCRUAL", "usable", D("-1.5"), seq=2),
                LedgerRow(CS, "ACCRUAL", "usable", D("1.5"), seq=3)]
        assert balances_from_rows(rows).usable == D("1.5")


class TestAsOf:
    def test_future_unmarked_days_are_pending_not_absent(self):
        res = compute_cycle(CycleInput(CS, CE, perm(), policy=Policy(unmarked_policy="absent"),
                                       as_of=date(2026, 10, 22)))
        # 20, 21, 22 Oct unmarked -> absent; the rest pending
        assert res.summary.unmarked_days == 3 and res.summary.lop_days == D("1.5")
        assert res.summary.pending_days == 27 - 3

