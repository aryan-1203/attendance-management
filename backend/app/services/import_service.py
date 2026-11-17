"""Attendance Excel/CSV import: upload → mapping → validation preview → commit → (rollback).

Wide layout:  one row per employee, one column per date   (Emp Code | Name | 20-Oct-2026 | 21-Oct-2026 | ...)
Long layout:  one row per employee-day                    (Emp Code | Date | Status | Note)
"""
from __future__ import annotations

import re
import uuid
from collections import Counter
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import pandas as pd
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import NotFound, ValidationFailed
from app.models import Attendance, ColumnMappingTemplate, Employee, ImportBatch, ImportRow, SalaryCycle
from app.models.base import utcnow
from app.repositories import attendance_repo, cycle_repo
from app.services import attendance_service, audit_service, cycle_service, recalc_service
from app.utils import excel_styles as xs
from app.utils.timeutil import today

ALLOWED_EXT = {".xlsx", ".xls", ".csv"}
MAX_BYTES = 15 * 1024 * 1024

STATUS_ALIASES = {
    "P": "P", "PRESENT": "P", "1": "P", "1.0": "P", "X": "P", "✓": "P", "PR": "P",
    "A": "A", "ABSENT": "A", "AB": "A", "0": "A", "0.0": "A",
    "HD": "HD", "H/D": "HD", "HALF DAY": "HD", "HALFDAY": "HD", "HALF-DAY": "HD", "0.5": "HD", "½": "HD", "½P": "HD",
    "P/2": "HD", "1/2": "HD", "HF": "HD",
    "L": "L", "LEAVE": "L", "PL": "L", "CL": "L", "SL": "L", "EL": "L", "AL": "L",
    "WO": "WO", "W/O": "WO", "WOFF": "WO", "WEEKLY OFF": "WO", "OFF": "WO", "SUN": "WO", "SUNDAY": "WO",
    "H": "H", "HOL": "H", "HOLIDAY": "H", "PH": "H", "PUBLIC HOLIDAY": "H",
    "CO": "CO", "C/O": "CO", "COMP OFF": "CO", "COMPOFF": "CO", "COFF": "CO",
    "WFH": "WFH", "WORK FROM HOME": "WFH", "REMOTE": "WFH",
    "OD": "OD", "ON DUTY": "OD", "TOUR": "OD",
}
CODE_HEADERS = ("emp code", "employee code", "emp_code", "employee_code", "code", "emp id", "employee id", "empid",
                "emp no", "employee no", "id", "staff id")
NAME_HEADERS = ("name", "employee name", "emp name", "full name", "employee")
DATE_HEADERS = ("date", "attendance date", "day")
STATUS_HEADERS = ("status", "code", "attendance", "mark", "attendance status")
NOTE_HEADERS = ("note", "notes", "remark", "remarks", "comment")


# ------------------------------------------------------------------------------------------ reading
def _read_raw(path: Path, sheet: str | None) -> tuple[pd.DataFrame, list[str]]:
    ext = path.suffix.lower()
    if ext == ".csv":
        df = pd.read_csv(path, header=None, dtype=object, keep_default_na=False)
        return df, ["CSV"]
    engine = "xlrd" if ext == ".xls" else "openpyxl"
    xl = pd.ExcelFile(path, engine=engine)
    sheets = list(xl.sheet_names)
    df = xl.parse(sheet or sheets[0], header=None, dtype=object)
    return df.where(pd.notna(df), None), sheets


def _cell_str(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    if isinstance(v, (datetime, pd.Timestamp)):
        return v.strftime("%Y-%m-%d")
    return str(v).strip()


def _detect_header_row(df: pd.DataFrame) -> int:
    """First row (0-based) in the top 15 that contains an employee-code-like header."""
    for i in range(min(15, len(df))):
        vals = [_cell_str(v).lower() for v in df.iloc[i].tolist()]
        if any(v in CODE_HEADERS for v in vals):
            return i
    return 0


def parse_date_header(v: Any, cycle: SalaryCycle | None = None, default_year: int | None = None) -> date | None:
    if v is None or v == "":
        return None
    if isinstance(v, pd.Timestamp):
        return v.date()
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    s = _cell_str(v)
    if re.fullmatch(r"\d{1,2}", s) and cycle is not None:  # bare day number within the chosen cycle
        day = int(s)
        for d in (cycle.start_date + timedelta(days=i) for i in range(cycle.days)):
            if d.day == day:
                return d
        return None
    s_clean = re.sub(r"\s*\(.*\)$", "", s)  # "20-Oct (Tue)"
    s_clean = re.sub(r"^(mon|tue|wed|thu|fri|sat|sun)[a-z]*[,\s]+", "", s_clean, flags=re.I)
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%d-%b-%Y", "%d %b %Y", "%d-%b-%y", "%d/%m/%y", "%d.%m.%Y",
                "%d-%B-%Y", "%d %B %Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(s_clean, fmt).date()
        except ValueError:
            continue
    for fmt in ("%d-%b", "%d %b", "%b %d", "%d/%m"):
        try:
            d = datetime.strptime(s_clean, fmt).date()
        except ValueError:
            continue
        year = default_year or (cycle.end_date.year if cycle else today().year)
        d = d.replace(year=year)
        if cycle and d > cycle.end_date:
            d = d.replace(year=year - 1)
        return d
    if re.fullmatch(r"\d{5}(\.0)?", s):  # Excel serial
        return (datetime(1899, 12, 30) + timedelta(days=int(float(s)))).date()
    return None


def normalize_status(raw: Any, overrides: dict[str, str] | None = None) -> str | None:
    s = _cell_str(raw).upper()
    if not s:
        return ""
    if overrides:
        for k, v in overrides.items():
            if k.strip().upper() == s:
                return v
    return STATUS_ALIASES.get(s)


# ------------------------------------------------------------------------------------------ steps
def upload(db: Session, filename: str, content: bytes, user) -> dict[str, Any]:
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXT:
        raise ValidationFailed("Upload an .xlsx, .xls or .csv file", code="bad_file_type")
    if len(content) > MAX_BYTES:
        raise ValidationFailed("File is larger than 15 MB", code="file_too_large")
    folder = Path(settings.upload_dir)
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{uuid.uuid4().hex}{ext}"
    path.write_bytes(content)
    try:
        df, sheets = _read_raw(path, None)
    except Exception as exc:  # noqa: BLE001
        path.unlink(missing_ok=True)
        raise ValidationFailed(f"Could not read the file: {exc}", code="unreadable_file") from exc
    batch = ImportBatch(filename=filename[:255], file_path=str(path), status="uploaded", sheet_name=sheets[0],
                        created_by_id=user.id)
    db.add(batch)
    db.flush()
    audit_service.log(db, user, "import.upload", "import_batch", batch.id, f"Uploaded {filename}")
    return {"batch": batch, **inspect(db, batch, None)}


def inspect(db: Session, batch: ImportBatch, sheet: str | None, header_row: int | None = None,
            cycle_id: int | None = None) -> dict[str, Any]:
    df, sheets = _read_raw(Path(batch.file_path), sheet or batch.sheet_name)
    hr = header_row - 1 if header_row else _detect_header_row(df)
    headers = [_cell_str(v) for v in df.iloc[hr].tolist()] if len(df) else []
    raw_headers = df.iloc[hr].tolist() if len(df) else []
    sample = [[_cell_str(v) for v in df.iloc[i].tolist()] for i in range(hr + 1, min(len(df), hr + 9))]
    cycle = db.get(SalaryCycle, cycle_id) if cycle_id else None
    lower = [h.lower() for h in headers]

    def find(cands):
        for c in cands:
            if c in lower:
                return headers[lower.index(c)]
        return None

    code_col = find(CODE_HEADERS)
    date_cols = {}
    for h, raw in zip(headers, raw_headers):
        if h and h != code_col:
            d = parse_date_header(raw, cycle)
            if d:
                date_cols[h] = d.isoformat()
    layout = "wide" if len(date_cols) >= 3 else "long"
    mapping = {
        "layout": layout, "header_row": hr + 1, "employee_code_column": code_col, "name_column": find(NAME_HEADERS),
        "date_columns": date_cols if layout == "wide" else {},
        "date_column": None if layout == "wide" else find(DATE_HEADERS),
        "status_column": None if layout == "wide" else find(STATUS_HEADERS[:1] + STATUS_HEADERS[2:]) or
        (find(("code",)) if code_col and code_col.lower() != "code" else None),
        "note_column": None if layout == "wide" else find(NOTE_HEADERS),
        "status_map": {}, "cycle_id": cycle_id,
    }
    # suggest a saved template whose columns match
    suggested = None
    for t in db.scalars(select(ColumnMappingTemplate)):
        cols = {t.mapping.get("employee_code_column"), t.mapping.get("date_column"), t.mapping.get("status_column")}
        cols.discard(None)
        if cols and cols.issubset(set(headers)) and t.layout == layout:
            suggested = {"id": t.id, "name": t.name}
            break
    return {"sheets": sheets, "headers": headers, "sample_rows": sample, "detected_mapping": mapping,
            "suggested_template": suggested}


def _extract(db: Session, batch: ImportBatch, mapping: dict[str, Any]) -> list[dict[str, Any]]:
    df, _ = _read_raw(Path(batch.file_path), batch.sheet_name)
    hr = int(mapping.get("header_row") or 1) - 1
    if hr >= len(df):
        raise ValidationFailed("Header row is beyond the end of the sheet")
    headers = [_cell_str(v) for v in df.iloc[hr].tolist()]
    idx = {h: i for i, h in enumerate(headers) if h}
    code_col = mapping.get("employee_code_column")
    if not code_col or code_col not in idx:
        raise ValidationFailed("Choose the column that holds the employee code", code="mapping_incomplete")
    out = []
    overrides = mapping.get("status_map") or {}
    if mapping.get("layout") == "wide":
        date_cols = {h: date.fromisoformat(d) for h, d in (mapping.get("date_columns") or {}).items() if d and h in idx}
        if not date_cols:
            raise ValidationFailed("Map at least one date column", code="mapping_incomplete")
        for r in range(hr + 1, len(df)):
            row = df.iloc[r].tolist()
            code = _cell_str(row[idx[code_col]])
            if not code:
                continue
            for h, d in date_cols.items():
                raw = row[idx[h]]
                out.append({"row_number": r + 1, "column_ref": h, "employee_code": code, "date": d,
                            "raw_value": _cell_str(raw), "status": normalize_status(raw, overrides), "note": None})
    else:
        dc, sc = mapping.get("date_column"), mapping.get("status_column")
        if not dc or dc not in idx or not sc or sc not in idx:
            raise ValidationFailed("Choose the date and status columns", code="mapping_incomplete")
        nc = mapping.get("note_column")
        for r in range(hr + 1, len(df)):
            row = df.iloc[r].tolist()
            code = _cell_str(row[idx[code_col]])
            if not code and not _cell_str(row[idx[dc]]):
                continue
            d = parse_date_header(row[idx[dc]])
            out.append({"row_number": r + 1, "column_ref": dc, "employee_code": code, "date": d,
                        "raw_value": _cell_str(row[idx[sc]]), "status": normalize_status(row[idx[sc]], overrides),
                        "note": _cell_str(row[idx[nc]]) if nc and nc in idx else None,
                        "raw_date": _cell_str(row[idx[dc]])})
    return out


def validate(db: Session, batch: ImportBatch, mapping: dict[str, Any], user, sheet: str | None = None,
             save_template: str | None = None) -> dict[str, Any]:
    if batch.status not in ("uploaded", "validated"):
        raise ValidationFailed(f"Batch is already {batch.status}")
    if sheet:
        batch.sheet_name = sheet
    items = _extract(db, batch, mapping)
    db.execute(delete(ImportRow).where(ImportRow.batch_id == batch.id))
    emps = {e.code.strip().upper(): e for e in db.scalars(select(Employee).where(Employee.deleted_at.is_(None)))}
    dates = [i["date"] for i in items if i["date"]]
    lo, hi = (min(dates), max(dates)) if dates else (today(), today())
    hol = attendance_repo.public_holidays(db, lo, hi)
    cycles = cycle_repo.overlapping(db, lo, hi)
    existing = {(a.employee_id, a.date): a.status for a in attendance_repo.for_range(db, lo, hi)}
    seen: Counter = Counter()
    t = today()
    counts = Counter()
    rows: list[ImportRow] = []
    for it in items:
        issues: list[dict[str, str]] = []
        sev = "ok"
        emp = emps.get(it["employee_code"].strip().upper())
        status, d = it["status"], it["date"]

        def err(field, msg):
            issues.append({"field": field, "severity": "error", "message": msg})

        def warn(field, msg):
            issues.append({"field": field, "severity": "warning", "message": msg})

        if status == "":
            continue  # blank cell: nothing to import
        if not emp:
            err("employee_code", f"Unknown employee code '{it['employee_code']}'")
        if d is None:
            err("date", f"Invalid date '{it.get('raw_date', it['column_ref'])}'")
        if status is None:
            err("status", f"Invalid status '{it['raw_value']}'")
        elif status in ("NJ", "EX"):
            err("status", f"{status} is set automatically and cannot be imported")
        if emp and d:
            if d < emp.date_of_joining:
                err("date", f"Before date of joining ({emp.date_of_joining:%d %b %Y})")
            elif emp.exit_date and d > emp.exit_date:
                err("date", f"After exit date ({emp.exit_date:%d %b %Y})")
            key = (emp.id, d)
            seen[key] += 1
            if seen[key] > 1:
                err("date", "Duplicate: this employee/date appears more than once in the file")
            if status and status not in attendance_service.FUTURE_OK and d > t:
                err("date", "Future date")
            cyc = next((c for c in cycles if c.start_date <= d <= c.end_date), None)
            if cyc and cyc.status == "locked":
                err("date", f"Cycle {cyc.label} is locked")
            prev = existing.get(key)
            if prev and status and prev != status:
                warn("status", f"Overwrites existing '{prev}'")
            off = attendance_service.auto_code(emp, d, hol)
            if off in ("WO", "H") and status in ("A", "L", "CO"):
                warn("status", f"{status} on a {'holiday' if off == 'H' else 'weekly off'} will not be deducted")
        if any(i["severity"] == "error" for i in issues):
            sev = "error"
        elif issues:
            sev = "warning"
        counts[sev] += 1
        rows.append(ImportRow(batch_id=batch.id, row_number=it["row_number"], column_ref=it["column_ref"][:60],
                              employee_code=it["employee_code"][:60], employee_id=emp.id if emp else None, date=d,
                              status=status or "", raw_value=it["raw_value"][:100], severity=sev,
                              issues=issues or None))
    db.add_all(rows)
    batch.mapping = mapping
    batch.layout = mapping.get("layout", "wide")
    batch.total_rows = len(rows)
    batch.valid_rows = counts["ok"]
    batch.warning_rows = counts["warning"]
    batch.error_rows = counts["error"]
    batch.status = "validated"
    if save_template:
        tpl = db.scalar(select(ColumnMappingTemplate).where(ColumnMappingTemplate.name == save_template.strip()))
        stored = {k: v for k, v in mapping.items() if k not in ("cycle_id",)}
        if tpl:
            tpl.mapping, tpl.layout = stored, batch.layout
        else:
            db.add(ColumnMappingTemplate(name=save_template.strip()[:100], layout=batch.layout, mapping=stored,
                                         created_by_id=user.id))
    db.flush()
    return summary(db, batch)


def summary(db: Session, batch: ImportBatch) -> dict[str, Any]:
    rows = list(db.scalars(select(ImportRow).where(ImportRow.batch_id == batch.id)))
    emps = {r.employee_id for r in rows if r.employee_id}
    dates = [r.date for r in rows if r.date]
    by_status = Counter(r.status for r in rows if r.severity != "error")
    return {"batch": batch, "employees": len(emps), "date_from": min(dates) if dates else None,
            "date_to": max(dates) if dates else None, "by_status": dict(by_status),
            "issue_summary": dict(Counter(i["message"].split("'")[0].split("(")[0].strip()
                                          for r in rows for i in (r.issues or [])).most_common(10))}


def preview_grid(db: Session, batch: ImportBatch, limit_employees: int = 200) -> dict[str, Any]:
    """Employee x date grid of imported values with per-cell severity for the validation preview."""
    rows = list(db.scalars(select(ImportRow).where(ImportRow.batch_id == batch.id).order_by(ImportRow.row_number)))
    dates = sorted({r.date for r in rows if r.date})
    emp_order: list[str] = []
    cells: dict[str, dict[str, Any]] = {}
    for r in rows:
        if r.employee_code not in cells:
            emp_order.append(r.employee_code)
            cells[r.employee_code] = {}
        cells[r.employee_code][r.date.isoformat() if r.date else f"?{r.row_number}"] = {
            "v": r.status or r.raw_value, "sev": r.severity, "issues": r.issues or [], "row": r.row_number}
    names = {e.code.upper(): e.full_name for e in db.scalars(select(Employee))}
    return {"dates": dates[:62], "employees": [{"code": c, "name": names.get(c.upper()), "cells": cells[c]}
                                                for c in emp_order[:limit_employees]]}


def commit(db: Session, batch: ImportBatch, user) -> dict[str, Any]:
    if batch.status != "validated":
        raise ValidationFailed("Validate the file before importing")
    rows = list(db.scalars(select(ImportRow).where(ImportRow.batch_id == batch.id, ImportRow.severity != "error")))
    if not rows:
        raise ValidationFailed("There are no valid rows to import")
    for d in sorted({r.date for r in rows}):
        cycle_service.assert_open_for(db, d)
    earliest: dict[int, date] = {}
    existing = {(a.employee_id, a.date): a for a in attendance_repo.for_range(
        db, min(r.date for r in rows), max(r.date for r in rows), list({r.employee_id for r in rows}))}
    for r in rows:
        a = existing.get((r.employee_id, r.date))
        r.prev_existed = a is not None
        r.prev_status = a.status if a else None
        r.prev_source = a.source if a else None
        if a:
            a.status, a.source, a.import_batch_id, a.updated_by_id = r.status, "import", batch.id, user.id
        else:
            db.add(Attendance(employee_id=r.employee_id, date=r.date, status=r.status, source="import",
                              import_batch_id=batch.id, updated_by_id=user.id))
        r.applied = True
        earliest[r.employee_id] = min(r.date, earliest.get(r.employee_id, r.date))
    db.flush()
    affected = cycle_repo.overlapping(db, min(earliest.values()), max(r.date for r in rows))
    for emp_id, start in earliest.items():
        recalc_service.recalc_employee_from(db, db.get(Employee, emp_id), start, user)
    batch.status = "committed"
    batch.applied_rows = len(rows)
    batch.committed_at = utcnow()
    batch.affected_cycles = [c.id for c in affected]
    audit_service.log(db, user, "import.commit", "import_batch", batch.id,
                      f"Imported {len(rows)} attendance marks from {batch.filename}", None,
                      {"rows": len(rows), "employees": len(earliest), "cycles": [c.label for c in affected]})
    return {"applied": len(rows), "employees": len(earliest), "affected_cycles": [c.label for c in affected]}


def rollback(db: Session, batch: ImportBatch, user) -> dict[str, Any]:
    if batch.status != "committed":
        raise ValidationFailed("Only committed imports can be rolled back")
    rows = list(db.scalars(select(ImportRow).where(ImportRow.batch_id == batch.id, ImportRow.applied.is_(True))))
    for d in sorted({r.date for r in rows}):
        cycle_service.assert_open_for(db, d)
    earliest: dict[int, date] = {}
    skipped = 0
    for r in rows:
        a = attendance_repo.get(db, r.employee_id, r.date)
        if not a or a.import_batch_id != batch.id or a.source != "import":
            skipped += 1  # changed after import: keep the newer value
            continue
        if r.prev_existed:
            a.status, a.source, a.import_batch_id = r.prev_status, r.prev_source or "manual", None
        else:
            db.delete(a)
        earliest[r.employee_id] = min(r.date, earliest.get(r.employee_id, r.date))
    db.flush()
    for emp_id, start in earliest.items():
        recalc_service.recalc_employee_from(db, db.get(Employee, emp_id), start, user)
    batch.status = "rolled_back"
    batch.rolled_back_at = utcnow()
    audit_service.log(db, user, "import.rollback", "import_batch", batch.id,
                      f"Rolled back import {batch.filename} ({len(rows) - skipped} marks restored, {skipped} kept)")
    return {"restored": len(rows) - skipped, "kept_newer": skipped}


def get(db: Session, batch_id: int) -> ImportBatch:
    b = db.get(ImportBatch, batch_id)
    if not b:
        raise NotFound("Import not found")
    return b


# ------------------------------------------------------------------------------------------ files
def error_rows_xlsx(db: Session, batch: ImportBatch, user) -> bytes:
    rows = list(db.scalars(select(ImportRow).where(ImportRow.batch_id == batch.id, ImportRow.severity != "ok")
                           .order_by(ImportRow.row_number)))
    data = [{"row_number": r.row_number, "column_ref": r.column_ref, "employee_code": r.employee_code,
             "date": r.date, "raw_value": r.raw_value, "severity": r.severity.title(),
             "issues": "; ".join(i["message"] for i in (r.issues or []))} for r in rows]
    wb = xs.new_workbook()
    ws = wb.active
    ws.title = "Issues"
    from app.services import policy_service
    xs.write_table(ws, [xs.Col("row_number", "Row", "int"), xs.Col("column_ref", "Column"),
                        xs.Col("employee_code", "Emp Code"), xs.Col("date", "Date", "date"),
                        xs.Col("raw_value", "Value"), xs.Col("severity", "Severity"),
                        xs.Col("issues", "Issues", width=60)], data,
                   title=xs.TitleBlock(policy_service.get(db, "company_name"), f"Import issues — {batch.filename}",
                                       None, getattr(user, "full_name", None)), totals=False)
    return xs.to_bytes(wb)


def template_xlsx(db: Session, layout: str, cycle: SalaryCycle, user) -> bytes:
    from app.repositories import employee_repo
    from app.services import policy_service
    emps = employee_repo.employed_between(db, cycle.start_date, cycle.end_date)
    wb = xs.new_workbook()
    ws = wb.active
    title = xs.TitleBlock(policy_service.get(db, "company_name"), f"Attendance import template ({layout})",
                          cycle.label, getattr(user, "full_name", None))
    days = [cycle.start_date + timedelta(days=i) for i in range(cycle.days)]
    if layout == "long":
        ws.title = "Attendance"
        cols = [xs.Col("code", "Emp Code"), xs.Col("name", "Name"), xs.Col("date", "Date", "date"),
                xs.Col("status", "Status", "code"), xs.Col("note", "Note", width=30)]
        rows = [{"code": e.code, "name": e.full_name, "date": days[0], "status": "", "note": ""} for e in emps]
        xs.write_table(ws, cols, rows, title=title, totals=False)
    else:
        ws.title = "Attendance"
        cols = [xs.Col("code", "Emp Code"), xs.Col("name", "Name")] + [
            xs.Col(d.isoformat(), d.strftime("%d-%b-%Y"), "code", width=11) for d in days]
        rows = [{"code": e.code, "name": e.full_name} for e in emps]
        xs.write_table(ws, cols, rows, title=title, totals=False, freeze_cols=2)
    legend = wb.create_sheet("Status codes")
    xs.write_table(legend, [xs.Col("code", "Code", "code"), xs.Col("meaning", "Meaning", width=40),
                            xs.Col("aliases", "Also accepted", width=50)],
                   [{"code": c, "meaning": m, "aliases": ", ".join(sorted(k for k, v in STATUS_ALIASES.items()
                                                                          if v == c and k != c))}
                    for c, m in [("P", "Present"), ("A", "Absent"), ("HD", "Half-day"), ("L", "Approved leave"),
                                 ("WO", "Weekly off"), ("H", "Holiday"), ("CO", "Comp-off used"),
                                 ("WFH", "Work from home"), ("OD", "On duty")]],
                   title=xs.TitleBlock(policy_service.get(db, "company_name"), "Status codes"), totals=False)
    return xs.to_bytes(wb)
