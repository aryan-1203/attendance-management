"""PDF statements/reports via reportlab. (Excel files use Abadi 9; PDFs use an embedded Unicode sans.)"""
from __future__ import annotations

import io
from datetime import datetime
from decimal import Decimal
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from sqlalchemy.orm import Session

from app.services import policy_service

_FONT = "Helvetica"
_FONT_BOLD = "Helvetica-Bold"
_CANDIDATES = [  # (regular, bold) — the first pair that contains the ₹ glyph wins
    ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    ("/System/Library/Fonts/Geneva.ttf", "/System/Library/Fonts/Geneva.ttf"),  # macOS (single weight)
    ("/System/Library/Fonts/Supplemental/Arial.ttf", "/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
    ("/Library/Fonts/Arial.ttf", "/Library/Fonts/Arial Bold.ttf"),
    ("C:/Windows/Fonts/arial.ttf", "C:/Windows/Fonts/arialbd.ttf"),
    ("/System/Library/Fonts/Supplemental/Arial Unicode.ttf", "/System/Library/Fonts/Supplemental/Arial Unicode.ttf"),
]
RUPEE = 0x20B9


def _has_rupee(font: TTFont) -> bool:
    try:
        return RUPEE in font.face.charToGlyph
    except Exception:  # pragma: no cover
        return False


for regular, bold in _CANDIDATES:
    if not (Path(regular).exists() and Path(bold).exists()):
        continue
    try:
        reg = TTFont("PP-Sans", regular)
        if not _has_rupee(reg):
            continue
        pdfmetrics.registerFont(reg)
        pdfmetrics.registerFont(TTFont("PP-Sans-Bold", bold))
        _FONT, _FONT_BOLD = "PP-Sans", "PP-Sans-Bold"
        break
    except Exception:  # pragma: no cover - font loading is best effort
        continue

INK = colors.HexColor("#1F2A44")
MUTED = colors.HexColor("#5B6478")
LINE = colors.HexColor("#D5DCE8")
HEAD = colors.HexColor("#E8EEF7")


def _days(v) -> str:
    return f"{Decimal(v):.1f}"


def _styles():
    return {
        "title": ParagraphStyle("t", fontName=_FONT_BOLD, fontSize=14, textColor=INK, leading=18),
        "sub": ParagraphStyle("s", fontName=_FONT, fontSize=9, textColor=MUTED, leading=12),
        "h": ParagraphStyle("h", fontName=_FONT_BOLD, fontSize=10, textColor=INK, leading=14, spaceBefore=8),
        "cell": ParagraphStyle("c", fontName=_FONT, fontSize=7.5, leading=9),
    }


def _table(data, col_widths=None, header=True, font_size=8):
    t = Table(data, colWidths=col_widths, repeatRows=1 if header else 0, hAlign="LEFT")
    style = [("FONTNAME", (0, 0), (-1, -1), _FONT), ("FONTSIZE", (0, 0), (-1, -1), font_size),
             ("TEXTCOLOR", (0, 0), (-1, -1), INK), ("LINEBELOW", (0, 0), (-1, -1), 0.25, LINE),
             ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("TOPPADDING", (0, 0), (-1, -1), 3),
             ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]
    if header:
        style += [("BACKGROUND", (0, 0), (-1, 0), HEAD), ("FONTNAME", (0, 0), (-1, 0), _FONT_BOLD)]
    t.setStyle(TableStyle(style))
    return t


LOGO_PATH = Path(__file__).resolve().parent.parent / "assets" / "logo.png"


def _header(db: Session, title: str, period: str, user) -> list:
    st = _styles()
    company = policy_service.get(db, "company_name")
    text = [Paragraph(company, st["sub"]), Paragraph(title, st["title"]),
            Paragraph(f"Cycle: {period} · Generated {datetime.now():%d %b %Y %H:%M}"
                      + (f" by {user.full_name}" if user else ""), st["sub"])]
    if LOGO_PATH.exists():  # brand mark to the left of the title block
        head = Table([[Image(str(LOGO_PATH), width=13 * mm, height=13 * mm), text]], colWidths=[17 * mm, None])
        head.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
        return [head, Spacer(1, 6 * mm)]
    return text + [Spacer(1, 6 * mm)]


def pay_days_pdf(db: Session, cycle, rows: list[dict], user) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=landscape(A4), leftMargin=10 * mm, rightMargin=10 * mm, topMargin=10 * mm,
                            bottomMargin=10 * mm, title=f"Pay-Days {cycle.label}")
    head = ["Code", "Name", "Department", "Eligible", "Sundays/WO", "Holidays", "Present", "Half-days", "Paid leave",
            "Comp-off", "LOP", "Payable", "Opening", "Accrued", "Closing", "Locked"]
    data = [head]
    for r in rows:
        data.append([r["code"], r["full_name"][:26], (r["department"] or "")[:16], _days(r["eligible_days"]),
                     _days(r["weekly_offs"]), _days(r["holidays"]), _days(r["present_days"]), _days(r["half_days"]),
                     _days(r["paid_leave_used"]), _days(r["comp_off_used"]), _days(r["lop_days"]),
                     _days(r["payable_days"]), _days(r["opening_usable"]), _days(r["accrued"]),
                     _days(r["closing_usable"]), _days(r["closing_locked"])])
    tot = lambda k: sum((r[k] for r in rows), Decimal(0))  # noqa: E731
    data.append(["Total", f"{len(rows)} employees", "", _days(tot("eligible_days")), "", "", "", "",
                 _days(tot("paid_leave_used")), _days(tot("comp_off_used")), _days(tot("lop_days")),
                 _days(tot("payable_days")), "", "", "", ""])
    t = _table(data, font_size=7)
    t.setStyle(TableStyle([("FONTNAME", (0, -1), (-1, -1), _FONT_BOLD), ("ALIGN", (3, 0), (-1, -1), "RIGHT")]))
    doc.build(_header(db, "Salary Pay-Days Report", cycle.label, user) + [t])
    return buf.getvalue()


def statement_pdf(db: Session, data: dict, user) -> bytes:
    emp, cycle, s = data["employee"], data["cycle"], data["summary"]
    st = _styles()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=14 * mm, rightMargin=14 * mm, topMargin=12 * mm,
                            bottomMargin=12 * mm, title=f"Statement {emp.code} {cycle.label}")
    story = _header(db, f"Monthly Statement — {emp.full_name} ({emp.code})", cycle.label, user)
    info = [["Department", emp.department.name if emp.department else "—", "Date of joining", f"{emp.date_of_joining:%d %b %Y}"],
            ["Employment type", emp.employment_type.title(), "Cycle days", str(s["cycle_days"])],
            ["Eligible days", _days(s["eligible_days"]), "Payable days", _days(s["payable_days"])],
            ["Present", _days(s["present_days"]), "Half-days", _days(s["half_days"])],
            ["Paid leave used", _days(s["paid_leave_used"]), "Comp-off used", _days(s["comp_off_used"])],
            ["LOP days", _days(s["lop_days"]), "Opening balance", _days(s["opening_usable"])],
            ["Accrued", _days(s["accrued"]), "Closing usable", _days(s["closing_usable"])],
            ["Locked (probation)", _days(s["closing_locked"]), "Comp-off balance", _days(s["balance"]["comp_off"])]]
    t = _table(info, header=False, col_widths=[38 * mm, 50 * mm, 38 * mm, 50 * mm], font_size=9)
    t.setStyle(TableStyle([("FONTNAME", (0, 0), (0, -1), _FONT_BOLD), ("FONTNAME", (2, 0), (2, -1), _FONT_BOLD)]))
    story += [t, Paragraph("Day-wise attendance", st["h"])]
    days = s["days"]
    half = (len(days) + 1) // 2
    grid = [["Date", "Status", "Note", "Date", "Status", "Note"]]
    for i in range(half):
        a = days[i]
        b = days[i + half] if i + half < len(days) else None
        grid.append([f"{a['date']:%a %d %b}", a["status"], (a["note"] or "")[:22]] +
                    ([f"{b['date']:%a %d %b}", b["status"], (b["note"] or "")[:22]] if b else ["", "", ""]))
    story.append(_table(grid, col_widths=[24 * mm, 14 * mm, 50 * mm, 24 * mm, 14 * mm, 50 * mm], font_size=7.5))
    if data["ledger"]:
        story.append(Paragraph("Leave ledger", st["h"]))
        rows = [["Date", "Type", "Bucket", "Days", "Note"]] + [
            [f"{x.entry_date:%d %b %Y}", x.entry_type.replace("_", " ").title(), x.bucket, f"{Decimal(x.amount):+.2f}",
             Paragraph((x.note or "")[:90], st["cell"])] for x in data["ledger"]]
        story.append(_table(rows, col_widths=[24 * mm, 34 * mm, 18 * mm, 14 * mm, 86 * mm], font_size=7.5))
    doc.build(story)
    return buf.getvalue()
