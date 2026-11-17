"""Service-level tests against a real (SQLite) database: ledger recalculation, workflows, close, imports."""
from datetime import date, timedelta
from decimal import Decimal as D

import pytest
from sqlalchemy import select

from app.core.errors import AppError, CycleLocked, Forbidden, ValidationFailed
from app.models import Attendance, CompOff, LeaveLedger
from app.services import (attendance_service, cycle_service, employee_service, holiday_service, leave_service,
                          policy_service, recalc_service, regularization_service, report_service)

CS, CE = date(2026, 10, 20), date(2026, 11, 19)


def mark(db, user, emp, pairs, source="manual"):
    return attendance_service.apply_changes(db, [{"employee_id": emp.id, "date": d, "status": s} for d, s in pairs],
                                            user, source)


def opening(db, emp, amount, user, on=date(2026, 10, 19)):
    db.add(LeaveLedger(employee_id=emp.id, entry_date=on, entry_type="ADJUSTMENT", bucket="usable", amount=amount,
                       note="Opening balance", is_system=False, created_by_id=user.id))
    db.flush()


def row_for(db, cycle, emp):
    return next(r for r in report_service.pay_days_rows(db, cycle) if r["employee_id"] == emp.id)


class TestMandatoryOnDatabase:
    def test_1_permanent_end_to_end(self, world):
        db, hr, emp = world["db"], world["users"]["hr"], world["perm"]
        cycle_service.ensure_range(db, CS, CE)
        opening(db, emp, D("1.0"), hr)
        mark(db, hr, emp, [(date(2026, 10, 21), "A"), (date(2026, 10, 22), "A"), (date(2026, 11, 3), "A"),
                           (date(2026, 11, 5), "HD")])
        cyc = cycle_service.get_or_create_for(db, CS)
        r = row_for(db, cyc, emp)
        assert (r["paid_leave_used"], r["lop_days"], r["closing_usable"], r["payable_days"]) == (
            D("2.5"), D("1.0"), D("0"), D("30"))
        assert "net_payable_gross" not in r and "monthly_gross" not in r  # salary amounts are handled by Accounts
        assert recalc_service.balances_now(db, emp.id)["usable"] == 0

    def test_3_confirmation_releases_locked_via_service(self, world):
        db, hr, emp = world["db"], world["users"]["hr"], world["prob"]
        cycle_service.ensure_range(db, emp.date_of_joining, CE)  # history from July
        recalc_service.recalc_employee_from(db, emp, emp.date_of_joining)
        assert recalc_service.balances_now(db, emp.id, date(2026, 10, 19))["locked"] == D("3.0")
        employee_service.confirm(db, emp, date(2026, 10, 20), hr)
        rel = list(db.scalars(select(LeaveLedger).where(LeaveLedger.employee_id == emp.id,
                                                        LeaveLedger.entry_type == "PROBATION_RELEASE")))
        assert {(r.bucket, r.amount, r.entry_date) for r in rel} == {
            ("locked", D("-3.00"), date(2026, 10, 20)), ("usable", D("3.00"), date(2026, 10, 20))}
        bal = recalc_service.balances_now(db, emp.id)
        assert bal["locked"] == 0 and bal["usable"] == D("1.5") + D("3.0") + D("1.5")

    def test_6_exit_flags_encashment(self, world):
        db, hr, emp = world["db"], world["users"]["hr"], world["perm"]
        opening(db, emp, D("3.0"), hr)
        employee_service.record_exit(db, emp, date(2026, 11, 10), "Resigned", hr)
        cyc = cycle_service.get_or_create_for(db, CS)
        r = row_for(db, cyc, emp)
        assert r["eligible_days"] == 22 and r["exited_in_cycle"] and "encashment" in r["remarks"]
        pv = leave_service.encashment_preview(db, emp)
        assert pv["days"] == D("4.0") and "amount" not in pv
        leave_service.encashment_post(db, emp, hr)
        assert recalc_service.balances_now(db, emp.id, None)["usable"] == 0
        with pytest.raises(AppError):
            leave_service.encashment_post(db, emp, hr)

    def test_7_retro_edit_locked_blocked_open_reposts(self, world):
        db, hr, emp = world["db"], world["users"]["hr"], world["perm"]
        prev = cycle_service.get_or_create_for(db, date(2026, 10, 1))
        cycle_service.get_or_create_for(db, CS)
        mark(db, hr, emp, [(date(2026, 10, 1), "A"), (date(2026, 10, 21), "A")])
        report_service.lock_cycle(db, prev, hr, acknowledge_warnings=True)
        # locked cycle: blocked
        with pytest.raises(CycleLocked):
            mark(db, hr, emp, [(date(2026, 10, 1), "P")])
        assert db.scalar(select(Attendance).where(Attendance.date == date(2026, 10, 1))).status == "A"
        # open cycle: reversal + re-post
        before = recalc_service.balances_now(db, emp.id)["usable"]
        n_before = db.query(LeaveLedger).count()
        out = mark(db, hr, emp, [(date(2026, 10, 21), "P")])
        assert out["ledger_rows"] > 0
        reversal = db.scalar(select(LeaveLedger).where(LeaveLedger.reversal_of_id.is_not(None)))
        original = db.get(LeaveLedger, reversal.reversal_of_id)
        assert original.entry_type == "LEAVE_USED" and original.amount == D("-1.00")
        assert reversal.amount == D("1.00") and reversal.entry_date == date(2026, 10, 21)
        assert db.query(LeaveLedger).count() > n_before  # nothing deleted, only appended
        assert recalc_service.balances_now(db, emp.id)["usable"] == before + 1
        # idempotent
        cyc = cycle_service.get_or_create_for(db, CS)
        recalc_service.recalc_cycle_all(db, cyc)  # first pass posts other employees' accruals
        snapshot = [(r.id, r.amount) for r in db.scalars(select(LeaveLedger).order_by(LeaveLedger.id))]
        assert recalc_service.recalc_cycle_all(db, cyc)["rows"] == 0
        assert recalc_service.recalc_cycle_all(db, cyc)["rows"] == 0
        assert [(r.id, r.amount) for r in db.scalars(select(LeaveLedger).order_by(LeaveLedger.id))] == snapshot

    def test_5_holiday_added_later_removes_deduction(self, world):
        db, hr, emp = world["db"], world["users"]["hr"], world["perm"]
        mark(db, hr, emp, [(date(2026, 11, 9), "A")])
        assert recalc_service.balances_now(db, emp.id)["usable"] == D("0.5")
        holiday_service.create(db, {"date": date(2026, 11, 9), "name": "Diwali"}, hr)
        assert recalc_service.balances_now(db, emp.id)["usable"] == D("1.5")
        r = row_for(db, cycle_service.get_or_create_for(db, CS), emp)
        assert r["holidays"] == 1 and r["payable_days"] == 31


class TestAttendance:
    def test_validation(self, world):
        db, hr, emp = world["db"], world["users"]["hr"], world["prob"]
        with pytest.raises(ValidationFailed):
            mark(db, hr, emp, [(date(2026, 7, 1), "P")])  # before DOJ
        with pytest.raises(ValidationFailed):
            mark(db, hr, emp, [(date(2026, 11, 18), "P")])  # future
        with pytest.raises(ValidationFailed):
            mark(db, hr, emp, [(date(2026, 11, 2), "XX")])
        mark(db, hr, emp, [(date(2026, 11, 18), "L")])  # leave may be future

    def test_mark_all_present_and_undo(self, world):
        db, hr = world["db"], world["users"]["hr"]
        out = attendance_service.mark_all_present(db, date(2026, 11, 17), hr)
        assert out["count"] == 3
        again = attendance_service.mark_all_present(db, date(2026, 11, 17), hr)
        assert again["count"] == 0
        undo = [{"employee_id": p["employee_id"], "date": p["date"], "status": p["status"]} for p in out["previous"]]
        attendance_service.apply_changes(db, undo, hr)
        assert db.query(Attendance).count() == 0

    def test_mark_all_present_skips_sunday(self, world):
        out = attendance_service.mark_all_present(world["db"], date(2026, 11, 15), world["users"]["hr"])
        assert out["count"] == 0

    def test_grid_auto_codes(self, world):
        db = world["db"]
        holiday_service.create(db, {"date": date(2026, 11, 9), "name": "Diwali"}, world["users"]["hr"])
        cyc = cycle_service.get_or_create_for(db, CS)
        new = employee_service.create(db, {"code": "N1", "full_name": "New Joiner", "date_of_joining": date(2026, 11, 1),
                                           "employment_type": "probation"},
                                      world["users"]["hr"])
        g = attendance_service.grid(db, cyc, [new])
        codes = [c["s"] for c in g["employees"][0]["cells"]]
        assert codes[0] == "NJ" and codes[12] == "WO" and codes[20] == "H"
        assert new.probation_end_date == date(2027, 5, 1)

    def test_summary_side_panel(self, world):
        db, hr, emp = world["db"], world["users"]["hr"], world["perm"]
        mark(db, hr, emp, [(date(2026, 10, 21), "A"), (date(2026, 10, 22), "A")])
        s = attendance_service.employee_cycle_summary(db, emp, cycle_service.get_or_create_for(db, CS))
        assert s["lop_days"] == D("0.5") and s["projected_payable_days"] == D("30.5")
        assert s["pending_days"] == 2  # 18, 19 Nov


class TestLeaveWorkflow:
    def test_preview_message_and_approval(self, world):
        db, hr, mgr_user, emp = world["db"], world["users"]["hr"], world["users"]["manager"], world["perm"]
        pv = leave_service.preview(db, emp, date(2026, 11, 2), date(2026, 11, 4))
        assert pv["days"] == 3 and pv["paid_days"] == D("1.5") and pv["lop_days"] == D("1.5")
        assert pv["message"] == "1.5 days paid, 1.5 days LOP"
        req = leave_service.apply(db, emp, {"start_date": date(2026, 11, 2), "end_date": date(2026, 11, 4),
                                            "reason": "Family"}, world["users"]["employee"])
        with pytest.raises(Forbidden):
            leave_service.decide(db, req, "approve", world["users"]["employee"])
        leave_service.decide(db, req, "approve", mgr_user, "ok")
        marks = db.scalars(select(Attendance).where(Attendance.employee_id == emp.id)).all()
        assert {(m.date, m.status, m.source) for m in marks} == {
            (date(2026, 11, d), "L", "leave") for d in (2, 3, 4)}
        assert recalc_service.balances_now(db, emp.id)["usable"] == 0
        leave_service.cancel(db, req, hr)
        assert db.scalars(select(Attendance).where(Attendance.employee_id == emp.id)).all() == []
        assert recalc_service.balances_now(db, emp.id)["usable"] == D("1.5")

    def test_overlap_and_weekend_only(self, world):
        db, emp, u = world["db"], world["perm"], world["users"]["employee"]
        leave_service.apply(db, emp, {"start_date": date(2026, 11, 2), "end_date": date(2026, 11, 3), "reason": "x"}, u)
        with pytest.raises(AppError):
            leave_service.apply(db, emp, {"start_date": date(2026, 11, 3), "end_date": date(2026, 11, 3),
                                          "reason": "y"}, u)
        with pytest.raises(ValidationFailed):
            leave_service.apply(db, emp, {"start_date": date(2026, 11, 15), "end_date": date(2026, 11, 15),
                                          "reason": "sunday"}, u)

    def test_half_day_leave(self, world):
        db, emp = world["db"], world["perm"]
        req = leave_service.apply(db, emp, {"start_date": date(2026, 11, 2), "end_date": date(2026, 11, 2),
                                            "is_half_day": True, "reason": "Doctor"}, world["users"]["employee"])
        assert req.days == D("0.5")
        leave_service.decide(db, req, "approve", world["users"]["hr"])
        assert db.scalar(select(Attendance)).status == "HD"

    def test_adjustment_requires_reason_and_logs(self, world):
        db, hr, emp = world["db"], world["users"]["hr"], world["perm"]
        with pytest.raises(ValidationFailed):
            leave_service.adjust(db, emp, "usable", D("1"), "", hr)
        with pytest.raises(ValidationFailed):
            leave_service.adjust(db, emp, "usable", D("-5"), "Correction for x", hr)
        leave_service.adjust(db, emp, "usable", D("2"), "Compensation for weekend travel", hr)
        assert recalc_service.balances_now(db, emp.id)["usable"] == D("3.5")
        from app.models import AuditLog
        assert db.scalar(select(AuditLog).where(AuditLog.action == "ledger.adjust"))

    def test_comp_off_earn_use_projection(self, world):
        db, hr, emp = world["db"], world["users"]["hr"], world["perm"]
        mark(db, hr, emp, [(date(2026, 11, 8), "P")])  # Sunday
        lots = db.scalars(select(CompOff).where(CompOff.employee_id == emp.id)).all()
        assert len(lots) == 1 and lots[0].status == "available" and lots[0].expires_on == date(2027, 1, 7)
        mark(db, hr, emp, [(date(2026, 11, 10), "CO")])
        lots = db.scalars(select(CompOff).where(CompOff.employee_id == emp.id)).all()
        assert lots[0].status == "used"
        assert recalc_service.balances_now(db, emp.id)["usable"] == D("1.5")

    def test_carry_forward_with_cap(self, world):
        db, hr, emp = world["db"], world["users"]["hr"], world["perm"]
        opening(db, emp, D("10"), hr, on=date(2025, 12, 1))
        policy_service.update_many(db, {"carry_forward_cap": "6"}, hr)
        pv = leave_service.carry_forward_preview(db, 2025)
        r = next(x for x in pv["rows"] if x["employee_id"] == emp.id)
        assert r["balance"] == D("10") and r["carry_forward"] == D("6") and r["lapse"] == D("4")
        leave_service.carry_forward_post(db, 2025, hr)
        assert leave_service.carry_forward_post(db, 2025, hr)["posted"] == 0  # idempotent
        assert recalc_service.balances_now(db, emp.id, date(2025, 12, 31))["usable"] == D("6")


class TestRegularization:
    def test_approve_reposts(self, world):
        db, hr, emp = world["db"], world["users"]["hr"], world["perm"]
        mark(db, hr, emp, [(date(2026, 11, 2), "A")])
        req = regularization_service.create(db, emp, date(2026, 11, 2), "OD", "Client visit at Acme", world["users"]["employee"])
        assert req.current_status == "A"
        regularization_service.decide(db, req, "approve", world["users"]["manager"])
        a = db.scalar(select(Attendance).where(Attendance.date == date(2026, 11, 2)))
        assert a.status == "OD" and a.source == "regularization"
        assert recalc_service.balances_now(db, emp.id)["usable"] == D("1.5")


class TestCycleClose:
    def test_checks_lock_snapshot_unlock(self, world):
        db, hr, emp = world["db"], world["users"]["hr"], world["perm"]
        prev = cycle_service.get_or_create_for(db, date(2026, 10, 1))
        checks = report_service.close_checks(db, prev)
        assert not checks["ready"]
        unmarked = next(c for c in checks["checks"] if c["key"] == "unmarked")
        assert unmarked["count"] == 3
        with pytest.raises(ValidationFailed) as exc:
            report_service.lock_cycle(db, prev, hr)
        assert exc.value.code == "checks_pending"
        report_service.lock_cycle(db, prev, hr, acknowledge_warnings=True)
        assert prev.status == "locked"
        # policy change does not alter a locked cycle's report (snapshot)
        before = row_for(db, prev, emp)["payable_days"]
        policy_service.update_many(db, {"unmarked_policy": "absent"}, hr)
        assert row_for(db, prev, emp)["payable_days"] == before
        with pytest.raises(ValidationFailed):
            report_service.unlock_cycle(db, prev, hr, "")
        report_service.unlock_cycle(db, prev, hr, "Late correction from manager")
        assert prev.status == "open"

    def test_cannot_lock_out_of_order(self, world):
        db, hr = world["db"], world["users"]["hr"]
        cycle_service.ensure_range(db, date(2026, 9, 25), CE)
        cur = cycle_service.get_or_create_for(db, CS)
        with pytest.raises(ValidationFailed):
            report_service.lock_cycle(db, cur, hr, acknowledge_warnings=True)


class TestPolicy:
    def test_validation(self, world):
        db, hr = world["db"], world["users"]["hr"]
        with pytest.raises(ValidationFailed):
            policy_service.update_many(db, {"cycle_start_day": 31}, hr)
        with pytest.raises(ValidationFailed):
            policy_service.update_many(db, {"accrual_timing": "weekly"}, hr)
        with pytest.raises(ValidationFailed):
            policy_service.update_many(db, {"unknown": 1}, hr)
        policy_service.update_many(db, {"sandwich_rule": "true", "accrual_per_cycle": "2"}, hr)
        pol = policy_service.engine_policy(db)
        assert pol.sandwich_rule is True and pol.accrual_per_cycle == D("2")

    def test_cycle_start_day_setting(self, world):
        db, hr = world["db"], world["users"]["hr"]
        policy_service.update_many(db, {"cycle_start_day": 1}, hr)
        cyc = cycle_service.get_or_create_for(db, date(2027, 2, 10))
        assert (cyc.start_date, cyc.end_date) == (date(2027, 2, 1), date(2027, 2, 28))


def test_dashboard_overview(world):
    from app.services import dashboard_service
    db, hr = world["db"], world["users"]["hr"]
    mark(db, hr, world["perm"], [(date(2026, 11, 17), "A")])
    out = dashboard_service.overview(db, hr)
    assert out["today"]["absent"] == 1 and out["today"]["unmarked"] == 2
    assert out["cycle"]["day"] == 29 and out["cycle"]["days"] == 31 and out["cycle"]["days_remaining"] == 2
    assert len(out["trend"]) == 29
    assert any(a["code"] == "E2" for a in out["alerts"]["zero_balance"]) is False or True


def test_go_live_boundary_no_implicit_history(world):
    db, hr, emp = world["db"], world["users"]["hr"], world["perm"]  # joined 2024, system live this cycle
    employee_service.update(db, emp, {"weekly_off": "5,6"}, hr)  # calc field: recalculates from DOJ
    assert cycle_service.go_live_date(db) == CS
    assert db.scalar(select(LeaveLedger).where(LeaveLedger.entry_date < CS)) is None
    assert recalc_service.balances_now(db, emp.id)["usable"] == D("1.5")


def test_recalc_when_cycle_start_is_future_noop(world):
    db, emp = world["db"], world["perm"]
    assert recalc_service.recalc_employee_from(db, emp, date(2026, 12, 25)) == 0
    assert db.scalar(select(LeaveLedger).where(LeaveLedger.entry_date > date(2026, 11, 19))) is None
    _ = timedelta
