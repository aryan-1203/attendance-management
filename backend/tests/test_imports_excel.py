"""Excel import wizard + mandatory Excel formatting checks (Abadi 9 on every non-empty cell)."""
import io
from datetime import date, datetime
from decimal import Decimal as D

import pytest
from openpyxl import Workbook, load_workbook
from sqlalchemy import select

from app.core.errors import CycleLocked
from app.models import Attendance
from app.services import (attendance_service, cycle_service, holiday_service, import_service, pdf_service,
                          report_service)
from app.utils import excel_styles as xs

CS = date(2026, 10, 20)


def wide_file(rows, headers=None):
    wb = Workbook()
    ws = wb.active
    ws.append(["Monthly attendance – Oct/Nov"])  # junk title row: header detection must skip it
    ws.append(headers or ["Emp Code", "Name", datetime(2026, 11, 2), datetime(2026, 11, 3), "04-Nov-2026",
                          "2026-11-05"])
    for r in rows:
        ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def long_file(rows):
    wb = Workbook()
    ws = wb.active
    ws.append(["Employee Code", "Date", "Status", "Remarks"])
    for r in rows:
        ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


class TestImport:
    def test_wide_detect_validate_commit_rollback(self, world):
        db, hr, emp = world["db"], world["users"]["hr"], world["perm"]
        attendance_service.apply_changes(db, [{"employee_id": emp.id, "date": date(2026, 11, 2), "status": "A"}], hr)
        content = wide_file([
            ["E1", "Pat", "P", "Absent", "half day", "WFH"],
            ["E2", "Pia", "P", "XX", "", "1"],
            ["ZZ9", "Ghost", "P", "P", "P", "P"],
        ])
        out = import_service.upload(db, "nov.xlsx", content, hr)
        m = out["detected_mapping"]
        assert m["layout"] == "wide" and m["header_row"] == 2 and m["employee_code_column"] == "Emp Code"
        assert sorted(m["date_columns"].values()) == ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"]
        batch = out["batch"]
        summ = import_service.validate(db, batch, m, hr, save_template="Monthly wide")
        assert batch.error_rows == 5  # XX + 4 ghost
        assert batch.warning_rows == 1  # overwrite existing A on 2 Nov
        assert summ["by_status"] == {"P": 3, "A": 1, "HD": 1, "WFH": 1}  # blank cell skipped, "1" -> P
        commit = import_service.commit(db, batch, hr)
        assert commit["applied"] == 6
        marks = {(a.employee_id, a.date): a.status for a in db.scalars(select(Attendance))}
        assert marks[(emp.id, date(2026, 11, 2))] == "P" and marks[(emp.id, date(2026, 11, 4))] == "HD"
        # error report & template
        assert load_workbook(io.BytesIO(import_service.error_rows_xlsx(db, batch, hr)))["Issues"].max_row >= 7
        # rollback restores the original A and removes the new marks
        import_service.rollback(db, batch, hr)
        marks = {(a.employee_id, a.date): a.status for a in db.scalars(select(Attendance))}
        assert marks == {(emp.id, date(2026, 11, 2)): "A"}

    def test_long_layout_errors(self, world):
        db, hr = world["db"], world["users"]["hr"]
        content = long_file([["E1", "02-11-2026", "P", ""], ["E1", "02-11-2026", "A", "dup"],
                             ["E2", "2026-07-01", "P", ""], ["E1", "not a date", "P", ""],
                             ["E1", "2026-11-25", "P", "future"], ["E1", "2026-11-08", "A", "sunday"]])
        out = import_service.upload(db, "long.xlsx", content, hr)
        m = out["detected_mapping"]
        assert m["layout"] == "long" and m["date_column"] == "Date" and m["status_column"] == "Status"
        import_service.validate(db, out["batch"], m, hr)
        rows = import_service.preview_grid(db, out["batch"])
        issues = [i["message"] for e in rows["employees"] for c in e["cells"].values() for i in c["issues"]]
        assert any("Duplicate" in i for i in issues)
        assert any("Before date of joining" in i for i in issues)
        assert any("Invalid date" in i for i in issues)
        assert any("Future date" in i for i in issues)
        assert any("will not be deducted" in i for i in issues)

    def test_locked_cycle_rejected(self, world):
        db, hr = world["db"], world["users"]["hr"]
        prev = cycle_service.get_or_create_for(db, date(2026, 10, 1))
        cycle_service.get_or_create_for(db, CS)
        report_service.lock_cycle(db, prev, hr, acknowledge_warnings=True)
        out = import_service.upload(db, "l.csv", b"Emp Code,Date,Status\nE1,2026-10-01,P\n", hr)
        import_service.validate(db, out["batch"], out["detected_mapping"], hr)
        assert out["batch"].error_rows == 1
        with pytest.raises(Exception):
            import_service.commit(db, out["batch"], hr)

    def test_day_number_headers_with_cycle(self, world):
        db, hr = world["db"], world["users"]["hr"]
        cyc = cycle_service.get_or_create_for(db, CS)
        content = wide_file([["E1", "P", "P", "P"]], ["Emp Code", "20", "21", "2"])
        out = import_service.upload(db, "d.xlsx", content, hr)
        insp = import_service.inspect(db, out["batch"], None, None, cyc.id)
        assert sorted(insp["detected_mapping"]["date_columns"].values()) == ["2026-10-20", "2026-10-21", "2026-11-02"]

    def test_status_aliases(self):
        assert [import_service.normalize_status(x) for x in ("present", "CL", "w/o", "½", "comp off", "xyz", "")] \
            == ["P", "L", "WO", "HD", "CO", None, ""]
        assert import_service.normalize_status("MIS", {"mis": "A"}) == "A"

    def test_rollback_blocked_when_locked(self, world):
        db, hr = world["db"], world["users"]["hr"]
        prev = cycle_service.get_or_create_for(db, date(2026, 10, 1))
        cycle_service.get_or_create_for(db, CS)
        out = import_service.upload(db, "l.csv", b"Emp Code,Date,Status\nE1,2026-10-01,P\n", hr)
        import_service.validate(db, out["batch"], out["detected_mapping"], hr)
        import_service.commit(db, out["batch"], hr)
        report_service.lock_cycle(db, prev, hr, acknowledge_warnings=True)
        with pytest.raises(CycleLocked):
            import_service.rollback(db, out["batch"], hr)


def assert_abadi_9(content: bytes, name: str) -> int:
    wb = load_workbook(io.BytesIO(content))
    checked = 0
    for ws in wb.worksheets:
        for row in ws.iter_rows():
            for c in row:
                if c.value is None or c.value == "":
                    continue
                assert c.font.name == "Abadi", f"{name}/{ws.title}!{c.coordinate} font {c.font.name}"
                assert c.font.sz == 9, f"{name}/{ws.title}!{c.coordinate} size {c.font.sz}"
                checked += 1
    return checked


class TestExcelFormatting:
    @pytest.fixture
    def data(self, world):
        db, hr = world["db"], world["users"]["hr"]
        holiday_service.create(db, {"date": date(2026, 11, 9), "name": "Diwali"}, hr)
        attendance_service.apply_changes(db, [
            {"employee_id": world["perm"].id, "date": date(2026, 10, 21), "status": "A"},
            {"employee_id": world["perm"].id, "date": date(2026, 10, 22), "status": "A"},
            {"employee_id": world["prob"].id, "date": date(2026, 10, 23), "status": "HD"}], hr)
        return world

    def test_every_generated_workbook_is_abadi_9(self, data):
        db, hr = data["db"], data["users"]["hr"]
        cyc = cycle_service.get_or_create_for(db, CS)
        batch = import_service.upload(db, "x.csv", b"Emp Code,Date,Status\nE1,2026-11-02,P\nZZ,2026-11-02,P\n", hr)
        import_service.validate(db, batch["batch"], batch["detected_mapping"], hr)
        from app.api.employees import export_employees
        files = {
            "pay_days": report_service.pay_days_xlsx(db, cyc, hr),
            "muster": report_service.muster_xlsx(db, cyc, hr),
            "leave_register": report_service.leave_register_xlsx(db, cyc, hr),
            "lop_summary": report_service.lop_summary_xlsx(db, cyc, hr),
            "statement": report_service.statement_xlsx(db, data["perm"], cyc, hr),
            "template_wide": import_service.template_xlsx(db, "wide", cyc, hr),
            "template_long": import_service.template_xlsx(db, "long", cyc, hr),
            "import_errors": import_service.error_rows_xlsx(db, batch["batch"], hr),
            "employees": export_employees(db, hr).body,
        }
        for name, content in files.items():
            assert assert_abadi_9(content, name) > 5, name

    def test_pay_days_layout_totals_and_formats(self, data):
        db, hr = data["db"], data["users"]["hr"]
        cyc = cycle_service.get_or_create_for(db, CS)
        ws = load_workbook(io.BytesIO(report_service.pay_days_xlsx(db, cyc, hr))).active
        assert ws["A1"].value and ws["A1"].font.b  # company
        assert ws["A2"].value == "Salary Pay-Days Report"
        assert ws["A3"].value == "Cycle: 20 Oct – 19 Nov 2026"
        assert ws["A4"].value.startswith("Generated on") and "Hana HR" in ws["A4"].value
        header_row = 6
        headers = [c.value for c in ws[header_row]]
        assert headers[:3] == ["Emp Code", "Name", "Department"] and "Payable Days" in headers
        assert not any(h and ("Gross" in h or "Amount" in h or "Rate" in h) for h in headers)  # no salary columns
        assert all(c.font.b for c in ws[header_row] if c.value)
        assert ws[header_row][0].fill.fgColor.rgb.endswith("E8EEF7")
        assert ws.freeze_panes == "C7"
        assert ws.auto_filter.ref.startswith(f"A{header_row}:")
        lop_col = headers.index("LOP Days") + 1
        pay_col = headers.index("Payable Days") + 1
        total_row = ws.max_row
        assert ws.cell(total_row, 1).value == "Total" and ws.cell(total_row, 1).font.b
        assert ws.cell(total_row, lop_col).value == f"=SUM(N7:N{total_row - 1})"
        assert ws.cell(7, lop_col).number_format == "0.0"
        assert ws.cell(7, pay_col).number_format == "0.0"
        assert ws.column_dimensions["B"].width > 10

    def test_muster_has_countif(self, data):
        db, hr = data["db"], data["users"]["hr"]
        ws = load_workbook(io.BytesIO(report_service.muster_xlsx(db, cycle_service.get_or_create_for(db, CS), hr))).active
        values = [c.value for c in ws[7] if isinstance(c.value, str) and c.value.startswith("=COUNTIF")]
        assert len(values) == 7

    def test_pdfs_render(self, data):
        db, hr = data["db"], data["users"]["hr"]
        cyc = cycle_service.get_or_create_for(db, CS)
        assert pdf_service.pay_days_pdf(db, cyc, report_service.pay_days_rows(db, cyc), hr)[:4] == b"%PDF"
        assert pdf_service.statement_pdf(db, report_service.statement_data(db, data["perm"], cyc), hr)[:4] == b"%PDF"

    def test_styles_helper_units(self):
        assert xs.money_format("₹") == '"₹"#,##0.00' and xs.money_format("") == "#,##0.00"
        wb = xs.new_workbook()
        wb.active["A1"] = "raw"  # written without helper -> enforced on save
        assert assert_abadi_9(xs.to_bytes(wb), "raw") == 1
        _ = D
