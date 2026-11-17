"""Seed realistic demo data.

    python -m app.seed            # seed if empty
    python -m app.seed --reset    # drop everything and re-seed

25 employees across 6 departments, ~4 months (4 salary cycles) of attendance, probation & permanent staff,
new joiners, one mid-cycle exit, leave recorded by HR, holidays, comp-offs. HR-only login in this version.
"""
from __future__ import annotations

import argparse
import random
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import inspect, select

from app.core.database import Base, SessionLocal, engine
from app.core.security import hash_password
from app.engine.calendar import cycle_bounds, daterange
from app.models import Attendance, Department, Designation, Employee, Holiday, LeaveRequest, Role, User
from app.services import cycle_service, leave_service, policy_service, recalc_service, report_service
from app.utils.timeutil import today

HR_EMAIL = "shraddha@prosparity.in"
HR_PASSWORD = "Shraddha@2627"
ROLES = [("hr_admin", "HR Administrator"), ("manager", "Team manager"), ("employee", "Employee self-service"),
         ("accounts", "Accounts (read-only reports)")]
DEPTS = [("Engineering", "ENG"), ("Sales", "SAL"), ("Operations", "OPS"), ("Finance", "FIN"),
         ("Human Resources", "HR"), ("Design", "DES")]
DESIGNATIONS = ["Engineering Manager", "Senior Engineer", "Software Engineer", "QA Engineer", "Sales Manager",
                "Account Executive", "Operations Lead", "Operations Associate", "Finance Manager", "Accountant",
                "HR Manager", "HR Executive", "Product Designer", "Intern"]

# code, name, dept, designation, type, doj, dob, extras
PEOPLE = [
    ("AE001", "Shraddha Rajeshirke", "Human Resources", "HR Manager", "permanent", "2021-04-05", "1988-11-21", {}),
    ("AE002", "Arjun Mehta", "Engineering", "Engineering Manager", "permanent", "2020-07-13", "1986-02-14", {}),
    ("AE003", "Kavya Iyer", "Engineering", "Senior Engineer", "permanent", "2022-01-10", "1993-06-02", {}),
    ("AE004", "Rohan Gupta", "Engineering", "Software Engineer", "permanent", "2023-03-06", "1997-11-19", {}),
    ("AE005", "Sneha Kulkarni", "Engineering", "QA Engineer", "permanent", "2022-08-22", "1995-01-30", {}),
    ("AE006", "Vikram Singh", "Sales", "Sales Manager", "permanent", "2019-11-18", "1984-09-08", {}),
    ("AE007", "Ananya Das", "Sales", "Account Executive", "permanent", "2023-06-12", "1998-03-25", {}),
    ("AE008", "Mohammed Faisal", "Sales", "Account Executive", "permanent", "2021-09-01", "1994-11-20", {}),
    ("AE009", "Lakshmi Narayan", "Operations", "Operations Lead", "permanent", "2018-02-19", "1983-07-17", {}),
    ("AE010", "Deepak Yadav", "Operations", "Operations Associate", "permanent", "2024-01-08", "1999-12-05", {}),
    ("AE011", "Meera Pillai", "Finance", "Finance Manager", "permanent", "2020-10-05", "1987-05-11", {}),
    ("AE012", "Sanjay Bhat", "Finance", "Accountant", "permanent", "2022-05-16", "1992-08-29", {}),
    ("AE013", "Ishita Chawla", "Design", "Product Designer", "permanent", "2023-09-04", "1996-04-14", {}),
    ("AE014", "Nikhil Joshi", "Engineering", "Software Engineer", "permanent", "2024-11-11",
     "1998-10-03", {}),
    ("AE015", "Pooja Reddy", "Engineering", "Software Engineer", "permanent", "2026-03-02", "1999-07-21",
     {"confirmation_date": "2026-09-02"}),  # confirmed mid-history -> probation release
    ("AE016", "Aditya Rao", "Sales", "Account Executive", "probation", "2026-05-25", "2000-01-12", {}),
    ("AE017", "Fatima Sheikh", "Operations", "Operations Associate", "probation", "2026-06-15", "1999-11-22", {}),
    ("AE018", "Karthik Subramanian", "Engineering", "Software Engineer", "probation", "2026-07-06",
     "1998-02-27", {}),
    ("AE019", "Riya Kapoor", "Design", "Product Designer", "probation", "2026-08-03", "1997-12-09", {}),
    ("AE020", "Harsh Vardhan", "Finance", "Accountant", "probation", "2026-09-07", "1996-06-30", {}),
    ("AE021", "Neha Agarwal", "Human Resources", "HR Executive", "probation", "2026-10-26", "2000-05-18", {}),
    ("AE022", "Siddharth Menon", "Engineering", "QA Engineer", "probation", "2026-11-01", "1998-09-14", {}),
    ("AE023", "Tanvi Desai", "Engineering", "Intern", "intern", "2026-08-17", "2003-03-03", {}),
    ("AE024", "Manish Tiwari", "Operations", "Operations Associate", "permanent", "2021-12-06", "1990-04-25",
     {"exit_date": "2026-11-10", "exit_reason": "Resigned – relocating"}),
    ("AE025", "Divya Krishnan", "Sales", "Account Executive", "permanent", "2025-02-03", "1997-11-18", {}),
]
MANAGERS = {"Engineering": "AE002", "Sales": "AE006", "Operations": "AE009", "Finance": "AE011",
            "Human Resources": "AE001", "Design": "AE002"}

HOLIDAYS = [
    ("2026-01-26", "Republic Day", "public"), ("2026-03-04", "Holi", "public"),
    ("2026-04-03", "Good Friday", "optional"), ("2026-05-01", "Labour Day", "public"),
    ("2026-08-15", "Independence Day", "public"), ("2026-08-28", "Raksha Bandhan", "restricted"),
    ("2026-09-14", "Ganesh Chaturthi", "public"), ("2026-10-02", "Gandhi Jayanti", "public"),
    ("2026-10-20", "Dussehra", "public"), ("2026-11-09", "Diwali (Govardhan Puja)", "public"),
    ("2026-12-25", "Christmas", "public"), ("2027-01-01", "New Year's Day", "optional"),
    ("2027-01-26", "Republic Day", "public"), ("2027-03-22", "Holi", "public"),
]


def reset() -> None:
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)


def ensure_schema() -> None:
    if not inspect(engine).has_table("users"):
        Base.metadata.create_all(engine)


def seed(force: bool = False) -> None:
    ensure_schema()
    db = SessionLocal()
    try:
        if db.scalar(select(User).limit(1)) and not force:
            print("Database already seeded – use --reset to start over.")
            return
        rng = random.Random(20261117)
        policy_service.seed_defaults(db)
        roles = {}
        for name, desc in ROLES:
            r = Role(name=name, description=desc)
            db.add(r)
            roles[name] = r
        depts = {}
        for name, code in DEPTS:
            d = Department(name=name, code=code)
            db.add(d)
            depts[name] = d
        desigs = {}
        for name in DESIGNATIONS:
            x = Designation(name=name)
            db.add(x)
            desigs[name] = x
        db.flush()
        for d, name, kind in HOLIDAYS:
            db.add(Holiday(date=date.fromisoformat(d), name=name, kind=kind))

        emps: dict[str, Employee] = {}
        for code, name, dept, desig, etype, doj, dob, extra in PEOPLE:
            doj_d = date.fromisoformat(doj)
            e = Employee(code=code, full_name=name, department_id=depts[dept].id, designation_id=desigs[desig].id,
                         date_of_joining=doj_d, employment_type=etype,
                         date_of_birth=date.fromisoformat(dob), weekly_off="6",
                         email=f"{name.split()[0].lower()}.{name.split()[-1].lower()}@prosparity.demo",
                         phone=f"+91 98{rng.randint(10000000, 99999999)}", status="active",
                         probation_end_date=(doj_d + timedelta(days=183)) if etype in ("probation",) or
                         extra.get("confirmation_date") else None)
            for k, v in extra.items():
                setattr(e, k, date.fromisoformat(v) if k.endswith("_date") else v)
            if e.exit_date:
                e.status = "exited"
            db.add(e)
            emps[code] = e
        db.flush()
        for code, _, dept, *_rest in PEOPLE:
            mgr = MANAGERS[dept]
            if mgr != code:
                emps[code].manager_id = emps[mgr].id
        emps["AE001"].manager_id = None
        emps["AE009"].manager_id = emps["AE001"].id
        db.flush()

        pw = hash_password(HR_PASSWORD)

        def user(email, role, emp_code=None, name=None):
            e = emps.get(emp_code) if emp_code else None
            u = User(email=email, full_name=name or (e.full_name if e else email), role_id=roles[role].id,
                     employee_id=e.id if e else None, password_hash=pw)
            db.add(u)
            return u

        # This version is HR-only: HR marks attendance and records leave for everyone.
        hr = user(HR_EMAIL, "hr_admin", "AE001")  # Shraddha Rajeshirke
        # Logins for managers / employees / accounts are disabled in this version (roles still exist in the
        # backend). Re-enable these lines when self-service and approvals are rolled out:
        # user("manager@prosparity.demo", "manager", "AE002")
        # user("employee@prosparity.demo", "employee", "AE004")
        # user("accounts@prosparity.demo", "accounts", None, "Accounts Team")
        # for code in ("AE006", "AE009", "AE011"):
        #     user(emps[code].email, "manager", code)
        # for code, e in emps.items():
        #     if code not in ("AE001", "AE002", "AE004", "AE006", "AE009", "AE011"):
        #         user(e.email, "employee", code)
        db.flush()

        # ---------------- attendance: 4 cycles ending with the current one
        t = today()
        cur_start, _ = cycle_bounds(t, int(policy_service.get(db, "cycle_start_day")))
        first_start = cur_start
        for _ in range(3):
            first_start = cycle_bounds(first_start - timedelta(days=1))[0]
        cycles = cycle_service.ensure_range(db, first_start, t)
        hol = {date.fromisoformat(d): n for d, n, k in HOLIDAYS if k == "public"}
        from app.models import LeaveLedger
        for e in emps.values():  # carried-in opening balances for staff who joined before the demo history
            if e.date_of_joining < first_start and e.employment_type != "probation":
                db.add(LeaveLedger(employee_id=e.id, entry_date=first_start - timedelta(days=1),
                                   entry_type="ADJUSTMENT", bucket="usable",
                                   amount=Decimal(rng.choice(["0.5", "1.0", "2.0", "3.5", "4.0", "6.0"])),
                                   note="Opening balance migrated from previous system", is_system=False,
                                   created_by_id=hr.id))
        heavy_absentee = emps["AE010"]  # frequent Monday/Friday absences
        rows = []
        for e in emps.values():
            for d in daterange(first_start, t):
                if d < e.date_of_joining or (e.exit_date and d > e.exit_date):
                    continue
                if d == t and rng.random() < 0.35:
                    continue  # some of today still unmarked
                off = d in hol or d.weekday() in e.weekly_off_days
                if off:
                    if d.weekday() == 6 and rng.random() < 0.012:
                        rows.append(Attendance(employee_id=e.id, date=d, status="P", source="manual",
                                               note="Weekend release support", updated_by_id=hr.id))
                    continue
                r = rng.random()
                if e is heavy_absentee and d.weekday() in (0, 4) and rng.random() < 0.3:
                    status = "A"
                elif r < 0.035:
                    status = "A"
                elif r < 0.055:
                    status = "HD"
                elif r < 0.11:
                    status = "WFH"
                elif r < 0.125:
                    status = "OD"
                else:
                    status = "P"
                rows.append(Attendance(employee_id=e.id, date=d, status=status, source="import" if d < cur_start
                                       else "manual", is_late=status == "P" and rng.random() < 0.06,
                                       updated_by_id=hr.id))
        db.add_all(rows)
        db.flush()

        # ---------------- leave requests (approved in past, pending upcoming)
        def working_after(start: date, n: int) -> date:
            d = start
            while d.weekday() == 6 or d in hol:
                d += timedelta(days=1)
            end = d
            count = 1
            while count < n:
                end += timedelta(days=1)
                if end.weekday() != 6 and end not in hol:
                    count += 1
            return end

        leave_plan = [("AE003", first_start + timedelta(days=9), 2), ("AE005", first_start + timedelta(days=37), 3),
                      ("AE007", first_start + timedelta(days=50), 1), ("AE012", first_start + timedelta(days=66), 2),
                      ("AE013", first_start + timedelta(days=80), 4), ("AE008", cur_start + timedelta(days=3), 1),
                      ("AE025", cur_start + timedelta(days=8), 2), ("AE017", cur_start + timedelta(days=5), 1)]
        for code, start, n in leave_plan:
            e = emps[code]
            while start.weekday() == 6 or start in hol:
                start += timedelta(days=1)
            end = working_after(start, n)
            if end > t:
                continue
            for d in daterange(start, end):  # clear generated marks so leave owns those days
                a = db.scalar(select(Attendance).where(Attendance.employee_id == e.id, Attendance.date == d))
                if a:
                    db.delete(a)
            db.flush()
            req = leave_service.apply(db, e, {"start_date": start, "end_date": end, "reason": rng.choice(
                ["Family function", "Medical appointment", "Personal work", "Travelling home", "Festival"])}, hr)
            leave_service.decide(db, req, "approve", hr, "Approved")
        # upcoming leave already recorded by HR (HR-only version: no employee requests to approve)
        for code, offset, n, reason in [("AE004", 3, 2, "Sister's wedding"), ("AE014", 6, 1, "Dental surgery"),
                                        ("AE019", 10, 3, "Visiting family in Kochi"),
                                        ("AE016", 4, 2, "Exam preparation")]:
            start = t + timedelta(days=offset)
            while start.weekday() == 6 or start in hol:
                start += timedelta(days=1)
            req = leave_service.apply(db, emps[code], {"start_date": start, "end_date": working_after(start, n),
                                                       "reason": reason}, hr)
            leave_service.decide(db, req, "approve", hr, "Recorded by HR")
        # Employee-raised attendance corrections are not used in the HR-only version:
        # # pending regularization in the current cycle
        # e = emps["AE007"]
        # a_day = db.scalar(select(Attendance).where(Attendance.employee_id == e.id, Attendance.status == "A",
        #                                            Attendance.date >= cur_start).limit(1))
        # if a_day is None:
        #     d = cur_start + timedelta(days=2)
        #     while d.weekday() == 6 or d in hol:
        #         d += timedelta(days=1)
        #     a_day = db.scalar(select(Attendance).where(Attendance.employee_id == e.id, Attendance.date == d))
        #     if a_day:
        #         a_day.status = "A"
        #     db.flush()
        # if a_day:
        #     regularization_service.create(db, e, a_day.date, "OD", "I was at the Infosys client site for a demo", hr)

        db.flush()
        recalc_service.recalc_open_from(db, first_start, hr)
        # lock the older cycles (all but the previous and current), as HR would have done
        for cyc in cycles[:-2]:
            report_service.lock_cycle(db, cyc, hr, acknowledge_warnings=True)
        db.commit()
        print(f"Seeded {len(emps)} employees, {len(rows)} attendance marks, {len(cycles)} cycles.")
        print(f"HR login: {HR_EMAIL} / {HR_PASSWORD} (Shraddha Rajeshirke)")
    finally:
        db.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--reset", action="store_true")
    args = ap.parse_args()
    if args.reset:
        reset()
    seed(force=args.reset)
