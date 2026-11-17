from decimal import ROUND_CEILING, ROUND_DOWN, ROUND_FLOOR, ROUND_HALF_UP, Decimal

D0 = Decimal("0")
CENT = Decimal("0.01")
ONE = Decimal("1")


def d(value) -> Decimal:
    """Coerce to Decimal without ever passing through float."""
    if isinstance(value, Decimal):
        return value
    if isinstance(value, float):  # guard: stringify to avoid binary artefacts
        return Decimal(repr(value))
    return Decimal(str(value))


def q2(value: Decimal) -> Decimal:
    return d(value).quantize(CENT, rounding=ROUND_HALF_UP)


def floor2(value: Decimal) -> Decimal:
    return d(value).quantize(CENT, rounding=ROUND_DOWN)


def round_days(value: Decimal, mode: str) -> Decimal:
    """Round a day count according to policy mode.

    nearest_half: 0.92 -> 1.0, 0.74 -> 0.5, 0.75 -> 1.0 (half-up)
    floor_half / ceil_half: towards -inf / +inf on a 0.5 grid
    none: two-decimal precision
    """
    value = d(value)
    if mode == "none":
        return q2(value)
    rounding = {"nearest_half": ROUND_HALF_UP, "floor_half": ROUND_FLOOR, "ceil_half": ROUND_CEILING}[mode]
    return q2((value * 2).quantize(ONE, rounding=rounding) / 2)
