"""Policy settings: typed defaults, persistence in `policy_settings`, conversion to engine Policy."""
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ValidationFailed
from app.engine.types import Policy
from app.models import PolicySetting
from app.services import audit_service

# key, default, type, category, label, description, choices
DEFAULTS: list[tuple[str, Any, str, str, str, str, list | None]] = [
    # Company
    ("company_name", "ProsParity", "str", "company", "Company name", "Shown on reports and statements", None),
    ("company_address", "Bengaluru, India", "str", "company", "Company address", "", None),
    ("company_logo_url", "/logo.svg", "str", "company", "Logo URL", "Shown in Settings; PDF reports use the bundled ProsParity logo", None),
    ("business_timezone", "Asia/Kolkata", "str", "company", "Business timezone", "", None),
    # Cycle
    ("cycle_start_day", 20, "int", "cycle", "Salary cycle start day",
     "Cycle runs from this day of a month to the day before it in the next month (1-28)", None),
    ("report_due_days", 2, "int", "cycle", "Report due (days after cycle end)", "Pay-days report deadline", None),
    ("unmarked_policy", "present", "choice", "cycle", "Unmarked working days",
     "How to treat working days with no mark when calculating", ["present", "absent"]),
    # Leave
    ("accrual_per_cycle", "1.5", "decimal", "leave", "Leave accrual per cycle", "Days credited every cycle", None),
    ("accrual_timing", "start", "choice", "leave", "Accrual timing", "When the accrual is credited",
     ["start", "end", "daily"]),
    ("prorata_rounding", "nearest_half", "choice", "leave", "Pro-rata rounding",
     "Rounding for joiner/leaver pro-rata accrual", ["nearest_half", "floor_half", "ceil_half", "none"]),
    ("probation_months", 6, "int", "leave", "Default probation (months)", "Probation length from DOJ", None),
    ("probation_usable_per_cycle", "0.5", "decimal", "leave", "Usable per cycle during probation",
     "Remainder of the accrual is locked until confirmation", None),
    ("probation_usable_cumulative", True, "bool", "leave", "Probation usable balance accumulates",
     "If off, at most the per-cycle usable amount can be used each cycle", None),
    ("leave_year_start_month", 1, "int", "leave", "Leave year start month", "1 = January", None),
    ("carry_forward_cap", None, "decimal", "leave", "Carry-forward cap (days)", "Empty = no cap", None),
    ("negative_balance_allowed", False, "bool", "leave", "Allow negative leave balance", "", None),
    ("negative_balance_limit", "0", "decimal", "leave", "Max negative balance (days)", "", None),
    ("sandwich_rule", False, "bool", "leave", "Sandwich rule",
     "Weekly-off/holiday between two leave days counts as leave", None),
    ("late_mark_enabled", False, "bool", "leave", "Late-mark rule", "Every N lates deduct a half-day", None),
    ("late_marks_per_half_day", 3, "int", "leave", "Late marks per half-day", "", None),
    ("comp_off_enabled", True, "bool", "leave", "Comp-off for working on weekly-off/holiday", "", None),
    ("comp_off_expiry_days", 60, "int", "leave", "Comp-off expiry (days)", "", None),
    ("comp_off_auto_apply", False, "bool", "leave", "Auto-use comp-off when leave balance runs out",
     "Otherwise comp-off is only used when the employee chooses it (CO)", None),
    # Email
    ("accounts_email", "accounts@example.com", "str", "email", "Accounts email", "Recipient for pay-days reports", None),
    ("smtp_host", "", "str", "email", "SMTP host", "Leave empty to log emails instead of sending (dev mode)", None),
    ("smtp_port", 587, "int", "email", "SMTP port", "", None),
    ("smtp_username", "", "str", "email", "SMTP username", "", None),
    ("smtp_password", "", "secret", "email", "SMTP password", "", None),
    ("smtp_from", "prosparity@example.com", "str", "email", "From address", "", None),
    ("smtp_use_tls", True, "bool", "email", "Use STARTTLS", "", None),
]
DEFAULT_MAP = {k: v for k, v, *_ in DEFAULTS}
META = {k: dict(type=t, category=c, label=lbl, description=desc, choices=ch) for k, _, t, c, lbl, desc, ch in DEFAULTS}


def seed_defaults(db: Session) -> None:
    existing = set(db.scalars(select(PolicySetting.key)))
    for key, default, vtype, cat, label, desc, choices in DEFAULTS:
        if key not in existing:
            db.add(PolicySetting(key=key, value=default, value_type=vtype, category=cat, label=label,
                                 description=desc, choices=choices))
    db.flush()


def _coerce(key: str, value: Any) -> Any:
    meta = META.get(key)
    if meta is None:
        raise ValidationFailed(f"Unknown setting '{key}'")
    t = meta["type"]
    if value is None:
        if key == "carry_forward_cap":
            return None
        raise ValidationFailed(f"{meta['label']} is required")
    try:
        if t == "bool":
            if isinstance(value, str):
                return value.lower() in ("1", "true", "yes", "on")
            return bool(value)
        if t == "int":
            v = int(value)
            if key == "cycle_start_day" and not 1 <= v <= 28:
                raise ValidationFailed("Cycle start day must be between 1 and 28")
            if key == "leave_year_start_month" and not 1 <= v <= 12:
                raise ValidationFailed("Leave year start month must be 1-12")
            if v < 0:
                raise ValidationFailed(f"{meta['label']} cannot be negative")
            return v
        if t == "decimal":
            if value == "":
                if key == "carry_forward_cap":
                    return None
                raise ValidationFailed(f"{meta['label']} is required")
            dv = Decimal(str(value))
            if dv < 0:
                raise ValidationFailed(f"{meta['label']} cannot be negative")
            return str(dv)
        if t == "choice":
            if value not in meta["choices"]:
                raise ValidationFailed(f"{meta['label']} must be one of {', '.join(meta['choices'])}")
            return value
        return str(value)
    except (ValueError, ArithmeticError) as exc:
        raise ValidationFailed(f"Invalid value for {meta['label']}") from exc


def get_all(db: Session) -> dict[str, Any]:
    values = dict(DEFAULT_MAP)
    for row in db.scalars(select(PolicySetting)):
        values[row.key] = row.value
    return values


def get(db: Session, key: str) -> Any:
    row = db.scalar(select(PolicySetting).where(PolicySetting.key == key))
    return row.value if row else DEFAULT_MAP.get(key)


def list_settings(db: Session, include_secrets: bool = False) -> list[dict]:
    values = get_all(db)
    out = []
    for key, _default, vtype, cat, label, desc, choices in DEFAULTS:
        v = values.get(key)
        if vtype == "secret" and not include_secrets:
            v = "••••••••" if v else ""
        out.append(dict(key=key, value=v, type=vtype, category=cat, label=label, description=desc, choices=choices))
    return out


def update_many(db: Session, changes: dict[str, Any], user) -> dict[str, Any]:
    old = get_all(db)
    applied: dict[str, Any] = {}
    for key, raw in changes.items():
        if META.get(key, {}).get("type") == "secret" and raw == "••••••••":
            continue
        value = _coerce(key, raw)
        row = db.scalar(select(PolicySetting).where(PolicySetting.key == key))
        if row is None:
            m = META[key]
            row = PolicySetting(key=key, value_type=m["type"], category=m["category"], label=m["label"],
                                description=m["description"], choices=m["choices"])
            db.add(row)
        if row.value != value:
            row.value = value
            row.updated_by_id = getattr(user, "id", None)
            applied[key] = value
    if applied:
        audit_service.log(db, user, "settings.update", "policy_settings", "",
                          f"Updated {', '.join(applied)}",
                          {k: ("***" if META[k]["type"] == "secret" else old.get(k)) for k in applied},
                          {k: ("***" if META[k]["type"] == "secret" else v) for k, v in applied.items()})
    db.flush()
    return applied


CALC_KEYS = {"accrual_per_cycle", "accrual_timing", "prorata_rounding", "probation_usable_per_cycle",
             "probation_usable_cumulative", "sandwich_rule", "late_mark_enabled",
             "late_marks_per_half_day", "negative_balance_allowed", "negative_balance_limit", "comp_off_enabled",
             "comp_off_expiry_days", "comp_off_auto_apply", "unmarked_policy"}


def to_engine_policy(values: dict[str, Any]) -> Policy:
    return Policy(
        accrual_per_cycle=Decimal(str(values["accrual_per_cycle"])),
        probation_usable_per_cycle=Decimal(str(values["probation_usable_per_cycle"])),
        probation_usable_cumulative=bool(values["probation_usable_cumulative"]),
        accrual_timing=values["accrual_timing"],
        prorata_rounding=values["prorata_rounding"],
        sandwich_rule=bool(values["sandwich_rule"]),
        late_mark_enabled=bool(values["late_mark_enabled"]),
        late_marks_per_half_day=int(values["late_marks_per_half_day"]),
        negative_balance_allowed=bool(values["negative_balance_allowed"]),
        negative_balance_limit=Decimal(str(values["negative_balance_limit"])),
        comp_off_enabled=bool(values["comp_off_enabled"]),
        comp_off_expiry_days=int(values["comp_off_expiry_days"]),
        comp_off_auto_apply=bool(values["comp_off_auto_apply"]),
        unmarked_policy=values["unmarked_policy"],
    )


def engine_policy(db: Session) -> Policy:
    return to_engine_policy(get_all(db))
