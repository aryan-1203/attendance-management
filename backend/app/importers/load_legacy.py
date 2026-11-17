"""Load HR's legacy "Payable Days Calculation" workbooks as ProsParity's real starting data.

    python -m app.importers.load_legacy --reset \
        --sheet 2026-09-19="Payable Days Calculation - Sept 2026.xlsx" \
        --sheet 2026-10-19="Payable Days Calculation - Oct 2026.xlsx"

Each --sheet is <cycle end date>=<workbook>. Only DATA is taken from the sheets; every calculation uses
ProsParity's own leave rules (Settings → Leave policy), not the formulas in the sheets:
  * wipes the database (with --reset) and creates the HR login (Shraddha Rajeshirke) and default settings;
  * creates every employee found in the sheets (name, DOJ, exits); probation ends DOJ + `probation_months`
    (confirmed automatically if that date has passed, otherwise still on probation for HR to confirm);
  * imports every P / A / HD / WFH mark, and the festival columns as optional holidays (not days off);
  * posts the first sheet's "Leaves in Hand" as each employee's opening balance at go-live;
  * calculates every cycle from go-live to today with the engine and locks the sheet cycles (closed months).
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path

from sqlalchemy import select

from app.core.database import SessionLocal
from app.core.security import hash_password
from app.importers.payable_sheet import Sheet, SheetRow, parse
from app.models import Attendance, Employee, Holiday, LeaveLedger, Role, User
from app.seed import HR_EMAIL, HR_PASSWORD, ROLES, ensure_schema, reset
from app.services import audit_service, cycle_service, policy_service, recalc_service, report_service
from app.services.employee_service import add_months
from app.utils.timeutil import today

UNKNOWN_DOJ = date(2025, 1, 1)  # sheets leave DOJ blank for long-serving (confirmed) staff
HOLIDAY_NAMES = {"RAKSHA": "Raksha Bandhan", "GANESH": "Ganesh Chaturthi", "GANDHI": "Gandhi Jayanti",
                 "DIWALI": "Diwali", "HOLI": "Holi", "DUSSEHRA": "Dussehra", "INDEPENDENCE": "Independence Day",
                 "REPUBLIC": "Republic Day", "CHRISTMAS": "Christmas"}
HR_NAME = "Shraddha Rajeshirke"


@dataclass
class Person:
    name: str
    doj: date | None
    rows: dict[date, SheetRow] = field(default_factory=dict)  # cycle end -> row
    exit_date: date | None = None
    order: tuple = ()

    @property
    def doj_or_placeholder(self) -> date:
        return self.doj or UNKNOWN_DOJ


def _holiday_name(letters: str, day: date) -> str:
    up = letters.upper()
    for key, name in HOLIDAY_NAMES.items():
        if key in up:
            return name
    return f"Holiday {day:%d %b}"


def collect(sheets: list[tuple[date, Sheet]]) -> tuple[list[Person], list[str]]:
    people: dict[tuple[str, date | None], Person] = {}
    notes: list[str] = []
    last_end = sheets[-1][0]
    for idx, (cend, sh) in enumerate(sheets):
        for r in sh.rows:
            if r.doj and r.doj > cend:
                continue  # listed in advance; they belong to a later sheet
            key = (r.name.lower(), r.doj)
            p = people.get(key)
            if p is None:
                p = people[key] = Person(r.name, r.doj, order=(r.doj or date.min, idx, r.row))
            if cend in p.rows:
                raise ValueError(f"{r.name} appears twice in the sheet ending {cend}")
            p.rows[cend] = r
    # people listed in the last sheet ahead of their joining date (they join in the current cycle)
    for r in sheets[-1][1].rows:
        if r.doj and r.doj > last_end and (r.name.lower(), r.doj) not in people:
            people[(r.name.lower(), r.doj)] = Person(r.name, r.doj, order=(r.doj, len(sheets), r.row))
    # earlier-sheet future joiners who never appear later did not join
    for cend, sh in sheets[:-1]:
        for r in sh.rows:
            if r.doj and r.doj > cend and (r.name.lower(), r.doj) not in people:
                notes.append(f"Skipped {r.name} (DOJ {r.doj:%d %b %Y}): listed in {sh.path.name} as a future "
                             f"joiner but not in any later sheet")
    # exits: missing from a later sheet, or marks stop before the cycle's last days
    ends = [c for c, _ in sheets]
    for p in people.values():
        if not p.rows:
            continue
        last_cycle = max(p.rows)
        r = p.rows[last_cycle]
        if last_cycle != ends[-1]:
            p.exit_date = r.last_marked or last_cycle
        elif r.last_marked and r.last_marked < last_cycle - timedelta(days=2):
            p.exit_date = r.last_marked
    return sorted(people.values(), key=lambda p: p.order), notes


def load(sheet_args: list[tuple[date, Path]], do_reset: bool) -> None:
    if do_reset:
        reset()
    ensure_schema()
    sheets = [(cend, parse(path, cend)) for cend, path in sorted(sheet_args)]
    people, notes = collect(sheets)
    db = SessionLocal()
    try:
        if db.scalar(select(User).limit(1)) is not None:
            raise SystemExit("Database is not empty – run with --reset to replace it with the sheet data.")
        policy_service.seed_defaults(db)
        months = int(policy_service.get(db, "probation_months") or 6)
        roles = {}
        for name, desc in ROLES:
            roles[name] = Role(name=name, description=desc)
            db.add(roles[name])
        db.flush()
        hr = User(email=HR_EMAIL, full_name=HR_NAME, role_id=roles["hr_admin"].id, employee_id=None,
                  password_hash=hash_password(HR_PASSWORD))
        db.add(hr)
        db.flush()

        # ---- holidays (non-Sunday decorated columns)
        holidays: dict[date, str] = {}
        for _, sh in sheets:
            for d, letters in sh.holiday_names.items():
                holidays[d] = _holiday_name(letters, d)
        for d, name in sorted(holidays.items()):
            # no paid public holidays this year: festival columns in the sheets are optional holidays
            db.add(Holiday(date=d, name=name, kind="optional", description="Optional holiday (from the payable-days sheet)"))

        # ---- cycles
        cycles = cycle_service.ensure_range(db, sheets[0][0], today())
        by_end = {c.end_date: c for c in cycles}
        for cend, _ in sheets:
            if cend not in by_end:
                raise SystemExit(f"Sheet cycle end {cend} does not match a salary cycle (cycle start day setting)")
        go_live = cycles[0].start_date

        # ---- employees (probation per the app's policy: DOJ + probation_months)
        emps: dict[int, Employee] = {}
        t = today()
        for i, p in enumerate(people, 1):
            doj = p.doj_or_placeholder
            if p.doj is None:
                prob_end, conf, etype = None, None, "permanent"
            else:
                prob_end = add_months(p.doj, months)
                confirmed = prob_end <= t and (p.exit_date is None or prob_end <= p.exit_date)
                conf, etype = (prob_end, "permanent") if confirmed else (None, "probation")
            e = Employee(code=f"PP{i:03d}", full_name=p.name, date_of_joining=doj, probation_end_date=prob_end,
                         confirmation_date=conf, employment_type=etype, weekly_off="6", exit_date=p.exit_date,
                         status="exited" if p.exit_date else "active",
                         exit_reason="Left (per payable-days sheet)" if p.exit_date else None)
            db.add(e)
            db.flush()
            emps[id(p)] = e
        if any(p.doj is None for p in people):
            notes.append(f"{sum(p.doj is None for p in people)} employees have no DOJ in the sheets; set to "
                         f"{UNKNOWN_DOJ:%d %b %Y} as a placeholder (confirmed staff) – update in Employees.")

        # ---- attendance marks
        n_marks = 0
        for p in people:
            e = emps[id(p)]
            for r in p.rows.values():
                for d, code in r.marks.items():
                    if d < e.date_of_joining or (e.exit_date and d > e.exit_date):
                        notes.append(f"{p.name}: mark {code} on {d:%d %b} is outside employment – skipped")
                        continue
                    db.add(Attendance(employee_id=e.id, date=d, status=code, source="import", updated_by_id=hr.id))
                    n_marks += 1
        db.flush()

        # ---- opening balances at go-live: the first sheet's "Leaves in Hand" (a fact, not a rule)
        first_end, first_sheet = sheets[0]
        n_open = 0
        for p in people:
            r = p.rows.get(first_end)
            e = emps[id(p)]
            if r is None or not r.in_hand or e.date_of_joining > go_live:
                continue
            db.add(LeaveLedger(employee_id=e.id, entry_date=go_live - timedelta(days=1), entry_type="ADJUSTMENT",
                               bucket="usable", amount=r.in_hand, is_system=False, created_by_id=hr.id,
                               note=f"Opening balance – Leaves in Hand per {first_sheet.path.name}"))
            n_open += 1
        db.flush()

        # ---- calculate every cycle with ProsParity's rules, then close the sheet months
        recalc_service.recalc_open_from(db, go_live, hr)
        for cend, sh in sheets:
            report_service.lock_cycle(db, by_end[cend], hr, acknowledge_warnings=True)
        audit_service.log(db, hr, "import.legacy", "system", "",
                          f"Loaded {len(people)} employees, {n_marks} marks and {n_open} opening balances from "
                          f"{', '.join(sh.path.name for _, sh in sheets)}")
        db.commit()
        active = sum(1 for p in people if not emps[id(p)].exit_date)
        print(f"Loaded {len(people)} employees ({active} active, {len(people) - active} exited), {n_marks} marks, "
              f"{len(holidays)} holidays, {n_open} opening balances; calculated with ProsParity rules and locked "
              f"{', '.join(by_end[c].label for c, _ in sheets)}.")
        for n in notes:
            print(" -", n)
        print(f"HR login: {HR_EMAIL} / {HR_PASSWORD} ({HR_NAME})")
    finally:
        db.close()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sheet", action="append", required=True, metavar="CYCLE_END=PATH",
                    help="cycle end date (YYYY-MM-DD) and workbook path, e.g. 2026-10-19=oct.xlsx")
    ap.add_argument("--reset", action="store_true", help="drop all data first")
    args = ap.parse_args()
    parsed = []
    for s in args.sheet:
        end, _, path = s.partition("=")
        parsed.append((datetime.strptime(end, "%Y-%m-%d").date(), Path(path)))
    load(parsed, args.reset)


if __name__ == "__main__":
    main()
