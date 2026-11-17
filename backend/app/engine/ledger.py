"""Derive balances from ledger postings (the ledger is the single source of truth)."""
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

from app.engine.rounding import D0
from app.engine.types import Balances, CompOffLot


@dataclass(frozen=True)
class LedgerRow:
    entry_date: date
    entry_type: str
    bucket: str
    amount: Decimal
    reference: str = ""
    seq: int = 0  # tie-breaker (database id)


def balances_from_rows(rows: Iterable[LedgerRow], comp_off_expiry_days: int = 60) -> Balances:
    """Replay ACTIVE rows (reversed pairs already removed, or both present - they cancel) in order.

    Comp-off lots are rebuilt FIFO: positive comp_off rows create lots (expiry taken from
    `expires:YYYY-MM-DD` reference when present); negative rows consume the referenced lot
    (`lot:YYYY-MM-DD`) or the earliest-expiring lot.
    """
    usable = locked = D0
    lots: list[CompOffLot] = []
    for r in sorted(rows, key=lambda x: (x.entry_date, x.seq)):
        if r.bucket == "usable":
            usable += r.amount
        elif r.bucket == "locked":
            locked += r.amount
        elif r.bucket == "comp_off":
            if r.amount > 0:
                expires = None
                if r.reference.startswith("expires:"):
                    expires = date.fromisoformat(r.reference.split(":", 1)[1])
                lots.append(CompOffLot(r.entry_date, r.amount,
                                       expires or r.entry_date + timedelta(days=comp_off_expiry_days)))
                lots.sort(key=lambda lot: (lot.expires_on, lot.earned_date))
            else:
                need = -r.amount
                target = None
                if r.reference.startswith("lot:"):
                    target = date.fromisoformat(r.reference.split(":", 1)[1])
                ordered = sorted(lots, key=lambda lot: (lot.earned_date != target, lot.expires_on))
                for lot in ordered:
                    if need <= 0:
                        break
                    take = min(lot.remaining, need)
                    lot.remaining -= take
                    need -= take
                lots = [lot for lot in lots if lot.remaining > 0]
    return Balances(usable, locked, lots)
