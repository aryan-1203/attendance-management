"""Parser for the legacy "Payable Days Calculation - <Month> <Year>.xlsx" workbooks HR kept before ProsParity.

Layout (one sheet, one row per employee):
  A Probation (Completed/Ongoing/blank)  B DOJ  C Probation completion (=DOJ+180)  D Employee name
  E.. one column per day of the cycle (header = day of month), then
  Leaves Eligible | Leaves Taken | Working days | Leaves in Hand | Leaves Counted (LOP) | Days Payable | Leaves left
  and an optional free-text remark after the last column.

Day cells hold P / A / HD / WFH. Sunday and holiday columns are vertical merged cells spelling "SUNDAY" or the
festival name, so their contents are decoration, not marks: a column is a non-working day when it carries those
letters for many employees. Formulas are evaluated here (the workbook has no cached values for some cells).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import openpyxl

MARKS = {"P": "P", "A": "A", "HD": "HD", "WFH": "WFH"}
SUMMARY_HEADERS = ["eligible", "taken", "working", "in_hand", "counted", "payable", "left"]


@dataclass
class SheetRow:
    row: int
    name: str
    probation_label: str
    doj: date | None
    marks: dict[date, str]
    eligible: Decimal
    taken: Decimal
    working: Decimal
    in_hand: Decimal
    counted: Decimal
    payable: Decimal
    remark: str
    last_marked: date | None = None


@dataclass
class Sheet:
    path: Path
    days: list[date]
    off_days: dict[date, str]  # date -> "WO" | "H"
    holiday_names: dict[date, str]
    rows: list[SheetRow] = field(default_factory=list)


def _dec(v) -> Decimal:
    if v is None or v == "":
        return Decimal("0")
    return Decimal(str(v))


def _eval(ws, r: int, v, row_vals: dict[str, object]):
    """Evaluate the few simple formulas the sheet uses (=30-AJ5, =19-3, =B34+180, =(AI2-AJ2)+AL2)."""
    if not (isinstance(v, str) and v.startswith("=")):
        return v
    expr = v[1:]

    def ref(m):
        col = m.group(1)
        val = row_vals.get(col)
        if isinstance(val, str) and val.startswith("="):
            val = _eval(ws, r, val, row_vals)
        if isinstance(val, datetime):
            return f"D({val.toordinal()})"
        return repr(Decimal(str(val if val not in (None, "") else 0)))

    py = re.sub(r"\b([A-Z]{1,2})\d+\b", ref, expr)
    out = eval(py, {"__builtins__": {}}, {"Decimal": Decimal, "D": lambda o: Decimal(o)})  # noqa: S307 - local,
    return out


def _holiday_word(letters: list[str]) -> str:
    return "".join(letters)


def parse(path: str | Path, cycle_end: date) -> Sheet:
    wb = openpyxl.load_workbook(path, data_only=False)
    ws = wb.worksheets[0]
    header = [ws.cell(1, c).value for c in range(1, ws.max_column + 1)]
    first_day_col = 5
    try:
        elig_col = next(i for i, h in enumerate(header, 1) if isinstance(h, str) and h.startswith("Leaves Eligible"))
    except StopIteration as exc:
        raise ValueError(f"{path}: 'Leaves Eligible' column not found") from exc
    day_nums = [int(header[c - 1]) for c in range(first_day_col, elig_col)]
    # map day numbers onto dates walking backwards from the cycle end
    days: list[date] = []
    d = cycle_end
    for dn in reversed(day_nums):
        while d.day != dn:
            d -= timedelta(days=1)
        days.append(d)
        d -= timedelta(days=1)
    days.reverse()
    col_of = {days[i]: first_day_col + i for i in range(len(days))}

    # detect decorative (non-working) columns: letters other than marks in many rows
    off_days: dict[date, str] = {}
    names: dict[date, str] = {}
    for day, c in col_of.items():
        vals = [ws.cell(r, c).value for r in range(2, ws.max_row + 1)]
        letters = [str(v).strip() for v in vals if v not in (None, "") and str(v).strip() not in MARKS]
        if len(letters) >= 5:
            off_days[day] = "WO" if day.weekday() == 6 else "H"
            if day.weekday() != 6:
                names[day] = _holiday_word([str(v).strip() for v in vals if v not in (None, "")])
    # rows
    sheet = Sheet(Path(path), days, off_days, names)
    last_col = ws.max_column
    for r in range(2, ws.max_row + 1):
        name = ws.cell(r, 4).value
        if not name or not str(name).strip():
            continue
        row_vals = {openpyxl.utils.get_column_letter(c): ws.cell(r, c).value for c in range(1, last_col + 1)}
        doj_v = ws.cell(r, 2).value
        doj = doj_v.date() if isinstance(doj_v, datetime) else None
        marks: dict[date, str] = {}
        for day, c in col_of.items():
            if day in off_days:
                continue
            v = ws.cell(r, c).value
            if v in (None, ""):
                continue
            code = MARKS.get(str(v).strip().upper())
            if code is None:
                raise ValueError(f"{path}: unknown mark {v!r} at row {r} {day}")
            marks[day] = code
        vals = [_eval(ws, r, ws.cell(r, elig_col + i).value, row_vals) for i in range(7)]
        remark = ws.cell(r, elig_col + 7).value if last_col >= elig_col + 7 else None
        sr = SheetRow(r, " ".join(str(name).split()), str(ws.cell(r, 1).value or "").strip(), doj, marks,
                      *(_dec(v) for v in vals[:6]), str(remark).strip() if remark not in (None, "") else "")
        sr.last_marked = max(marks) if marks else None
        sheet.rows.append(sr)
    return sheet
