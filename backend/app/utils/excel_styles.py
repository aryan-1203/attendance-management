"""Single source of truth for every .xlsx ProsParity generates.

Rules (mandatory):
* Font Abadi, size 9 for EVERY cell (titles, headers, data, totals). Bold allowed for headers/totals/titles.
* Header row: bold, light fill, freeze panes below header, auto-filter, fitted column widths.
* Days use 0.0, money uses #,##0.00 prefixed with the configured currency symbol.
* Title block on top: company, report name, cycle dates, generated on/by.
* Totals row uses real SUM formulas.
"""
from __future__ import annotations

import io
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.worksheet import Worksheet

FONT_NAME = "Abadi"
FONT_SIZE = 9
HEADER_FILL = PatternFill("solid", fgColor="E8EEF7")
TOTAL_FILL = PatternFill("solid", fgColor="F3F5F9")
TITLE_COLOR = "1F2A44"
THIN = Side(style="thin", color="C9D2E3")
HEADER_BORDER = Border(bottom=THIN, top=THIN)
TOTAL_BORDER = Border(top=Side(style="thin", color="8A97B1"))

DAYS_FORMAT = "0.0"
INT_FORMAT = "0"
DATE_FORMAT = "dd-mmm-yyyy"


def font(bold: bool = False, color: str | None = None, italic: bool = False) -> Font:
    return Font(name=FONT_NAME, size=FONT_SIZE, bold=bold, italic=italic, color=color)


def money_format(symbol: str = "₹") -> str:
    symbol = (symbol or "").replace('"', "")
    return f'"{symbol}"#,##0.00' if symbol else "#,##0.00"


@dataclass
class Col:
    key: str
    header: str
    kind: str = "text"  # text | days | money | int | date | code
    total: bool = False
    width: float | None = None


@dataclass
class TitleBlock:
    company: str
    report: str
    period: str | None = None
    generated_by: str | None = None
    generated_on: datetime | None = None

    def lines(self) -> list[tuple[str, bool]]:
        out = [(self.company, True), (self.report, True)]
        if self.period:
            out.append((f"Cycle: {self.period}", False))
        gen = f"Generated on {(self.generated_on or datetime.now()):%d %b %Y %H:%M}"
        if self.generated_by:
            gen += f" by {self.generated_by}"
        out.append((gen, False))
        return out


def new_workbook() -> Workbook:
    wb = Workbook()
    _set_default_font(wb)
    return wb


def _set_default_font(wb: Workbook) -> None:
    # make the workbook's Normal style Abadi 9 so even cells added later default to it
    for style in wb._named_styles:  # noqa: SLF001 - openpyxl exposes no public API for this
        if style.name == "Normal":
            style.font = font()


def _coerce(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)  # Excel stores IEEE doubles; values are already exact to 2dp
    return value


def write_title(ws: Worksheet, title: TitleBlock, ncols: int) -> int:
    """Writes the title block; returns the next free row (one blank row after the block)."""
    r = 1
    for i, (text, bold) in enumerate(title.lines()):
        c = ws.cell(row=r, column=1, value=text)
        c.font = font(bold=bold, color=TITLE_COLOR if i < 2 else "5B6478")
        r += 1
    return r + 1


def write_table(ws: Worksheet, columns: list[Col], rows: list[dict[str, Any]], *, title: TitleBlock | None = None,
                currency_symbol: str = "₹", start_row: int | None = None, totals: bool = True,
                freeze_cols: int = 0, total_label: str = "Total") -> dict[str, int]:
    r = start_row or (write_title(ws, title, len(columns)) if title else 1)
    header_row = r
    mfmt = money_format(currency_symbol)
    for ci, col in enumerate(columns, start=1):
        c = ws.cell(row=header_row, column=ci, value=col.header)
        c.font = font(bold=True)
        c.fill = HEADER_FILL
        c.border = HEADER_BORDER
        c.alignment = Alignment(horizontal="center" if col.kind == "code" else
                                ("right" if col.kind in ("days", "money", "int") else "left"),
                                vertical="center", wrap_text=True)
    first = header_row + 1
    for ri, row in enumerate(rows):
        rr = first + ri
        for ci, col in enumerate(columns, start=1):
            value = row.get(col.key)
            c = ws.cell(row=rr, column=ci, value=_coerce(value))
            c.font = font()
            if col.kind == "days":
                c.number_format = DAYS_FORMAT
            elif col.kind == "money":
                c.number_format = mfmt
            elif col.kind == "int":
                c.number_format = INT_FORMAT
            elif col.kind == "date" and isinstance(value, (date, datetime)):
                c.number_format = DATE_FORMAT
            elif col.kind == "code":
                c.alignment = Alignment(horizontal="center")
    last = first + len(rows) - 1
    total_row = None
    if totals and any(c.total for c in columns):
        total_row = last + 1 if rows else first
        lc = ws.cell(row=total_row, column=1, value=total_label)
        lc.font = font(bold=True)
        for ci, col in enumerate(columns, start=1):
            cell = ws.cell(row=total_row, column=ci)
            cell.fill = TOTAL_FILL
            cell.border = TOTAL_BORDER
            if col.total:
                letter = get_column_letter(ci)
                cell.value = f"=SUM({letter}{first}:{letter}{max(last, first)})" if rows else 0
                cell.number_format = mfmt if col.kind == "money" else DAYS_FORMAT if col.kind == "days" else INT_FORMAT
            cell.font = font(bold=True)
    ws.freeze_panes = ws.cell(row=header_row + 1, column=freeze_cols + 1)
    ws.auto_filter.ref = f"A{header_row}:{get_column_letter(len(columns))}{max(last, header_row)}"
    fit_columns(ws, columns, header_row)
    return {"header_row": header_row, "first": first, "last": last, "total_row": total_row or 0}


def fit_columns(ws: Worksheet, columns: list[Col], header_row: int) -> None:
    for ci, col in enumerate(columns, start=1):
        letter = get_column_letter(ci)
        if col.width:
            ws.column_dimensions[letter].width = col.width
            continue
        longest = len(str(col.header))
        for (cell,) in ws.iter_rows(min_row=header_row + 1, min_col=ci, max_col=ci):
            v = cell.value
            if v is None or (isinstance(v, str) and v.startswith("=")):
                continue
            s = f"{v:,.2f}" if isinstance(v, float) else (v.strftime("%d-%b-%Y") if isinstance(v, (date, datetime))
                                                          else str(v))
            longest = max(longest, len(s))
        ws.column_dimensions[letter].width = min(48, max(5 if col.kind == "code" else 8, longest * 1.05 + 2))


def write_key_values(ws: Worksheet, pairs: list[tuple[str, Any, str]], start_row: int, currency_symbol: str = "₹"
                     ) -> int:
    """Two-column label/value block. kind in text|days|money|int|date. Returns next free row."""
    r = start_row
    for label, value, kind in pairs:
        a = ws.cell(row=r, column=1, value=label)
        a.font = font(bold=True)
        b = ws.cell(row=r, column=2, value=_coerce(value))
        b.font = font()
        if kind == "days":
            b.number_format = DAYS_FORMAT
        elif kind == "money":
            b.number_format = money_format(currency_symbol)
        elif kind == "date":
            b.number_format = DATE_FORMAT
        r += 1
    return r + 1


def section_heading(ws: Worksheet, row: int, text: str) -> None:
    c = ws.cell(row=row, column=1, value=text)
    c.font = font(bold=True, color=TITLE_COLOR)


def enforce_fonts(wb: Workbook) -> None:
    """Safety net: guarantee Abadi 9 on every non-empty cell while preserving bold/italic/colour."""
    for ws in wb.worksheets:
        for row in ws.iter_rows():
            for c in row:
                if c.value is None:
                    continue
                f = c.font
                if f is None or f.name != FONT_NAME or f.sz != FONT_SIZE:
                    c.font = Font(name=FONT_NAME, size=FONT_SIZE, bold=bool(f and f.b), italic=bool(f and f.i),
                                  color=f.color if f else None)


def to_bytes(wb: Workbook) -> bytes:
    enforce_fonts(wb)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
