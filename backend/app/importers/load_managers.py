"""Load reporting + function managers from Monthly Master Data Excel into employees.

    DB_SSL=true DATABASE_URL=... python -m app.importers.load_managers \
        --file "/path/to/Monthly Master Data - Oct 2026 - Copy 1.xlsx"

Creates missing people who appear as Reporting Manager / Function Head (using their
Employee ID + DOJ from the Active sheet), then sets:
  * employees.manager_id          ← Reporting Manager
  * employees.function_manager_id ← Function Head
"""
from __future__ import annotations

import argparse
import re
import unicodedata
from collections import defaultdict
from datetime import date, datetime
from difflib import SequenceMatcher
from pathlib import Path

import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models import Employee, User
from app.services import employee_service

INVALID_NAMES = {"", "nan", "none", "0", "total", "-", "n/a", "na"}
ALIASES = {
    "hakam dhakar": "hakam singh dhakar",
    "ram dhanak": "ramgopal dhanak",
    "aayush shrivastava": "ayush srivastava",
    "ayush shrivastava": "ayush srivastava",
    "jitendra sharma": "jitendra kumar sharma",
    "ashok kumhar": "ashok kumar",
    "ashish panwar": "aashish panwar",
    "priyanshi chidar": "priyanshi chiddar",
    "puranmal saini": "puran mal saini",
}


def norm(s: object) -> str:
    if s is None:
        return ""
    text = unicodedata.normalize("NFKC", str(s))
    text = text.replace("\xa0", " ").replace("\u200b", "")
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    return re.sub(r"\s+", " ", text)


def clean_name(raw: object) -> str | None:
    if raw is None or (isinstance(raw, float) and raw != raw):
        return None
    s = str(raw).strip()
    if not s or norm(s) in INVALID_NAMES or s.lower() in INVALID_NAMES:
        return None
    if "/" in s:
        s = s.split("/", 1)[0].strip()
    return s or None


def parse_date(v) -> date | None:
    if v is None or (isinstance(v, float) and v != v):
        return None
    try:
        if pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(v, datetime):
        d = v.date()
        return None if pd.isna(d) else d
    if isinstance(v, date):
        return None if pd.isna(v) else v
    try:
        ts = pd.to_datetime(v)
        if pd.isna(ts):
            return None
        return ts.date()
    except Exception:
        return None


def code_str(v) -> str | None:
    if v is None or (isinstance(v, float) and v != v):
        return None
    s = str(v).strip().upper()
    if not s or s == "NAN":
        return None
    if s.endswith(".0") and s[:-2].isdigit():
        s = s[:-2]
    return s


class NameIndex:
    def __init__(self, emps: list[Employee]):
        self.by_code = {e.code.upper(): e for e in emps}
        self.by_name: dict[str, list[Employee]] = defaultdict(list)
        for e in emps:
            self.by_name[norm(e.full_name)].append(e)

    def refresh(self, emps: list[Employee]) -> None:
        self.__init__(emps)

    def resolve(self, raw: object) -> tuple[Employee | None, str]:
        name = clean_name(raw)
        if not name:
            return None, "blank"
        key = ALIASES.get(norm(name), norm(name))
        hits = self.by_name.get(key, [])
        if len(hits) == 1:
            return hits[0], "exact"
        if len(hits) > 1:
            # Prefer active
            active = [h for h in hits if h.status == "active"]
            pick = active[0] if active else hits[0]
            return pick, f"ambiguous:{len(hits)}"
        best_e, best_score = None, 0.0
        for n, lst in self.by_name.items():
            sc = SequenceMatcher(None, key, n).ratio()
            if sc > best_score:
                best_score, best_e = sc, lst[0]
        if best_e and best_score >= 0.92:
            return best_e, f"fuzzy:{best_score:.2f}"
        return None, f"missing:{name}"


def load_excel(path: Path) -> pd.DataFrame:
    active = pd.read_excel(path, sheet_name="Active")
    try:
        inactive = pd.read_excel(path, sheet_name="Inactive")
        df = pd.concat([active, inactive], ignore_index=True)
    except Exception:
        df = active
    # Prefer Active when the same Employee ID appears twice
    df["_sheet_rank"] = 0
    df.loc[df.index < len(active), "_sheet_rank"] = 0
    if len(df) > len(active):
        df.loc[df.index >= len(active), "_sheet_rank"] = 1
    return df


def ensure_missing_managers(db: Session, df: pd.DataFrame, index: NameIndex, dry_run: bool) -> list[str]:
    """Create Active-sheet people who are referenced as RM/FH but missing from DB."""
    notes: list[str] = []
    needed: set[str] = set()
    for _, row in df.iterrows():
        for col in ("Reporting Manager", "Function Head"):
            name = clean_name(row.get(col))
            if not name:
                continue
            emp, why = index.resolve(name)
            if emp is None and why.startswith("missing"):
                needed.add(ALIASES.get(norm(name), norm(name)))

    created = 0
    for _, row in df.iterrows():
        code = code_str(row.get("Employee ID"))
        name = str(row.get("Name") or "").strip()
        if not code or not name or name.lower() == "nan":
            continue
        if index.by_code.get(code):
            continue
        key = ALIASES.get(norm(name), norm(name))
        # Create if this person is needed as a manager, or if their normalized name is in needed
        if key not in needed and norm(name) not in needed:
            # Also create if Excel name aliases into a needed key
            aliased = False
            for nk in needed:
                if ALIASES.get(norm(name), norm(name)) == nk or norm(name) == nk:
                    aliased = True
                    break
            if not aliased:
                continue
        doj = parse_date(row.get("DOJ")) or date(2024, 1, 1)
        dept = row.get("Department ")
        if dept is None or (isinstance(dept, float) and dept != dept):
            dept = row.get("Department")
        desig = row.get("Designation")
        status_raw = str(row.get("Status") or "active").strip().lower()
        status = "active" if status_raw.startswith("active") else "exited"
        notes.append(f"CREATE {code} {name} (DOJ {doj}, {desig})")
        created += 1
        if dry_run:
            continue
        actor = db.scalar(select(User).order_by(User.id))
        data = {
            "code": code,
            "full_name": name,
            "date_of_joining": doj,
            "employment_type": "permanent",
            "weekly_off": "6",
            "confirmation_date": doj,
            "probation_end_date": doj,
            "department_id": employee_service.get_or_create_department(db, None if dept is None else str(dept).strip()),
            "designation_id": employee_service.get_or_create_designation(db, None if desig is None else str(desig).strip()),
        }
        if status == "exited":
            lwd = parse_date(row.get("LWD"))
            if lwd:
                data["exit_date"] = lwd
        emp = employee_service.create(db, data, actor)
        # Link HR login if this is Shraddha
        if norm(name) == "shraddha rajeshirke":
            user = db.scalar(select(User).where(User.email.ilike("shraddha@%")))
            if user and not user.employee_id:
                user.employee_id = emp.id
                notes.append(f"  linked user {user.email} → {code}")

    if not dry_run and created:
        db.flush()
        emps = list(db.scalars(select(Employee).where(Employee.deleted_at.is_(None))))
        index.refresh(emps)
    notes.append(f"{'Would create' if dry_run else 'Created'} {created} missing manager employee(s)")
    return notes


def apply_managers(db: Session, df: pd.DataFrame, index: NameIndex, dry_run: bool) -> dict:
    updated_rm = updated_fh = 0
    unmatched_emp: list[tuple] = []
    missing_rm: list[tuple] = []
    missing_fh: list[tuple] = []
    seen_codes: set[str] = set()

    # Process Active first (already ordered); skip duplicate codes later
    for _, row in df.sort_values("_sheet_rank").iterrows():
        code = code_str(row.get("Employee ID"))
        name = str(row.get("Name") or "").strip()
        emp = index.by_code.get(code) if code else None
        if not emp and name and name.lower() != "nan":
            hits = index.by_name.get(norm(name), [])
            if len(hits) == 1:
                emp = hits[0]
        if not emp:
            unmatched_emp.append((code, name))
            continue
        if emp.code.upper() in seen_codes:
            continue
        seen_codes.add(emp.code.upper())

        rm, rwhy = index.resolve(row.get("Reporting Manager"))
        fh, fwhy = index.resolve(row.get("Function Head"))

        if rm and rm.id == emp.id:
            rm = None  # self-manager in sheet (e.g. Harendra)
            rwhy = "self"
        if fh and fh.id == emp.id:
            fh = None
            fwhy = "self"

        if clean_name(row.get("Reporting Manager")) and rm is None and not rwhy.startswith("blank"):
            missing_rm.append((emp.code, emp.full_name, row.get("Reporting Manager"), rwhy))
        if clean_name(row.get("Function Head")) and fh is None and not fwhy.startswith(("blank", "invalid")):
            missing_fh.append((emp.code, emp.full_name, row.get("Function Head"), fwhy))

        changed = False
        if rm and emp.manager_id != rm.id:
            if not dry_run:
                emp.manager_id = rm.id
            updated_rm += 1
            changed = True
        elif rm is None and clean_name(row.get("Reporting Manager")) is None and emp.manager_id is not None:
            # leave existing if sheet blank
            pass
        if fh and emp.function_manager_id != fh.id:
            if not dry_run:
                emp.function_manager_id = fh.id
            updated_fh += 1
            changed = True
        _ = changed

    return {
        "matched": len(seen_codes),
        "updated_reporting": updated_rm,
        "updated_function": updated_fh,
        "unmatched_employees": unmatched_emp,
        "missing_reporting": missing_rm,
        "missing_function": missing_fh,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--file", required=True, type=Path)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    if not args.file.exists():
        raise SystemExit(f"File not found: {args.file}")

    df = load_excel(args.file)
    db: Session = SessionLocal()
    try:
        emps = list(db.scalars(select(Employee).where(Employee.deleted_at.is_(None))))
        index = NameIndex(emps)
        create_notes = ensure_missing_managers(db, df, index, args.dry_run)
        # Refresh after creates
        if not args.dry_run:
            emps = list(db.scalars(select(Employee).where(Employee.deleted_at.is_(None))))
            index.refresh(emps)
        else:
            # For dry-run, still show what would resolve after hypothetical creates:
            # re-run resolve after printing create notes only.
            pass
        stats = apply_managers(db, df, index, args.dry_run)
        if not args.dry_run:
            db.commit()
        else:
            db.rollback()

        print("=== create ===")
        for n in create_notes:
            print(n)
        print("\n=== apply ===")
        print(f"matched employees: {stats['matched']}")
        print(f"reporting managers set: {stats['updated_reporting']}")
        print(f"function managers set: {stats['updated_function']}")
        print(f"unmatched excel rows: {len(stats['unmatched_employees'])}")
        for item in stats["unmatched_employees"][:40]:
            print("  unmatched", item)
        if stats["missing_reporting"]:
            print(f"\nreporting unresolved ({len(stats['missing_reporting'])}):")
            for item in stats["missing_reporting"][:30]:
                print(" ", item)
        if stats["missing_function"]:
            print(f"\nfunction unresolved ({len(stats['missing_function'])}):")
            for item in stats["missing_function"][:30]:
                print(" ", item)
        print("\ndry_run" if args.dry_run else "\ncommitted")
    finally:
        db.close()


if __name__ == "__main__":
    main()
