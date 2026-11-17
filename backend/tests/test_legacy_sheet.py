"""Legacy 'Payable Days Calculation' workbook parser and loader helpers."""
from datetime import date, datetime
from decimal import Decimal as D

import openpyxl

from app.importers.load_legacy import collect
from app.importers.payable_sheet import parse

DAYS = list(range(20, 31)) + list(range(1, 20))  # 20 Sep .. 19 Oct 2026


def _book(path, rows):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["Probation", "DOJ", "P. Completion Date", "Employee Name", *DAYS, "Leaves Eligible", "Leaves Taken",
               "Working days", "Leaves in Hand", "Leaves Counted", "Days Payable", "Leaves left "])
    for i, (doj, name, marks, tail, *remark) in enumerate(rows, start=2):
        ws.append(["Completed", doj, f"=B{i}+180" if doj else None, name, *marks, *tail,
                   f"=(AI{i}-AJ{i})+AL{i}", *remark])
    wb.save(path)


def _marks(sunday_letter="", holiday_letter="", absent_on=()):
    out = []
    for d in DAYS:
        day = date(2026, 9, d) if d >= 20 else date(2026, 10, d)
        if day.weekday() == 6:
            out.append(sunday_letter or None)
        elif day == date(2026, 10, 2):
            out.append(holiday_letter or None)
        elif day in absent_on:
            out.append("A")
        else:
            out.append("P")
    return out


def test_parse_skips_decorative_columns_and_evaluates_formulas(tmp_path):
    rows = [(None, f"Person {i}", _marks("SUNDAY"[i % 6], "GANDHI"[i % 6]), [2, 0, "=30-AJ%d" % (i + 2), 3, 0,
             "=30-AM%d" % (i + 2)]) for i in range(6)]
    rows.append((datetime(2026, 5, 15), "Asha  Rao ", _marks(absent_on=(date(2026, 9, 22),)),
                 [1, 1, "=30-AJ9", 0, 0, "=30-AM9"], "ok"))
    path = tmp_path / "oct.xlsx"
    _book(path, rows)
    sh = parse(path, date(2026, 10, 19))
    assert sh.days[0] == date(2026, 9, 20) and sh.days[-1] == date(2026, 10, 19)
    assert sh.off_days[date(2026, 10, 2)] == "H" and sh.off_days[date(2026, 9, 27)] == "WO"
    asha = sh.rows[-1]
    assert asha.name == "Asha Rao" and asha.doj == date(2026, 5, 15)
    assert asha.marks[date(2026, 9, 22)] == "A" and date(2026, 9, 27) not in asha.marks
    assert (asha.eligible, asha.taken, asha.payable, asha.remark) == (D(1), D(1), D(30), "ok")


def test_collect_detects_exits_and_skips_no_shows(tmp_path):
    early_stop = [m if i < 10 else None for i, m in enumerate(_marks())]
    rows = [(None, f"Filler {i}", _marks("SUNDAY"[i % 6], "GANDHI"[i % 6]), [2, 0, 30, 0, 0, 30]) for i in range(6)]
    rows += [(None, "Leaver", early_stop, [2, 0, 10, 0, 0, 10]),
             (datetime(2026, 10, 25), "Future Joiner", [None] * 30, [0.5, 0, 0, 0, 0, 0])]
    path = tmp_path / "oct.xlsx"
    _book(path, rows)
    people, notes = collect([(date(2026, 10, 19), parse(path, date(2026, 10, 19)))])
    by_name = {p.name: p for p in people}
    assert by_name["Leaver"].exit_date == date(2026, 9, 29)
    assert by_name["Future Joiner"].rows == {} and by_name["Future Joiner"].exit_date is None
    assert by_name["Filler 0"].exit_date is None and not notes
