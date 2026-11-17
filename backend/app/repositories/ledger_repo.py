from datetime import date
from decimal import Decimal

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session, aliased

from app.engine.ledger import LedgerRow
from app.models import LeaveLedger


def _reversed_ids_subq():
    return select(LeaveLedger.reversal_of_id).where(LeaveLedger.reversal_of_id.is_not(None))


def active_rows(db: Session, employee_id: int, up_to: date | None = None, exclude_cycle_id: int | None = None,
                ) -> list[LeaveLedger]:
    """Rows that are neither reversed nor reversals (their net effect equals the full ledger sum)."""
    stmt = select(LeaveLedger).where(LeaveLedger.employee_id == employee_id,
                                     LeaveLedger.reversal_of_id.is_(None),
                                     LeaveLedger.id.not_in(_reversed_ids_subq()))
    if up_to is not None:
        stmt = stmt.where(LeaveLedger.entry_date <= up_to)
    if exclude_cycle_id is not None:
        stmt = stmt.where(~and_(LeaveLedger.cycle_id == exclude_cycle_id, LeaveLedger.is_system.is_(True)))
    return list(db.scalars(stmt.order_by(LeaveLedger.entry_date, LeaveLedger.id)))


def active_system_rows_for_cycle(db: Session, employee_id: int, cycle_id: int) -> list[LeaveLedger]:
    stmt = select(LeaveLedger).where(LeaveLedger.employee_id == employee_id, LeaveLedger.cycle_id == cycle_id,
                                     LeaveLedger.is_system.is_(True), LeaveLedger.reversal_of_id.is_(None),
                                     LeaveLedger.id.not_in(_reversed_ids_subq()))
    return list(db.scalars(stmt.order_by(LeaveLedger.id)))


def to_engine_rows(rows: list[LeaveLedger]) -> list[LedgerRow]:
    return [LedgerRow(r.entry_date, r.entry_type, r.bucket, Decimal(r.amount), r.reference or "", r.id) for r in rows]


def bucket_totals(db: Session, employee_ids: list[int] | None = None, up_to: date | None = None
                  ) -> dict[int, dict[str, Decimal]]:
    """Fast balance totals per employee/bucket via SUM (reversals cancel automatically)."""
    stmt = select(LeaveLedger.employee_id, LeaveLedger.bucket, func.sum(LeaveLedger.amount)).group_by(
        LeaveLedger.employee_id, LeaveLedger.bucket)
    if employee_ids is not None:
        stmt = stmt.where(LeaveLedger.employee_id.in_(employee_ids or [-1]))
    if up_to is not None:
        stmt = stmt.where(LeaveLedger.entry_date <= up_to)
    out: dict[int, dict[str, Decimal]] = {}
    for emp_id, bucket, total in db.execute(stmt):
        out.setdefault(emp_id, {})[bucket] = Decimal(total or 0)
    return out


def reversal_alias():
    return aliased(LeaveLedger)
