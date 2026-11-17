from collections.abc import Iterator
from datetime import date, timedelta


def daterange(start: date, end: date) -> Iterator[date]:
    cur = start
    while cur <= end:
        yield cur
        cur += timedelta(days=1)


def _add_months(year: int, month: int, delta: int) -> tuple[int, int]:
    idx = year * 12 + (month - 1) + delta
    return idx // 12, idx % 12 + 1


def cycle_bounds(on: date, start_day: int = 20) -> tuple[date, date]:
    """Salary cycle containing `on`. start_day=20 -> 20th of month M to 19th of M+1.

    start_day is clamped to 1..28 so every month has the start day.
    """
    start_day = max(1, min(28, int(start_day)))
    if on.day >= start_day:
        start = date(on.year, on.month, start_day)
    else:
        y, m = _add_months(on.year, on.month, -1)
        start = date(y, m, start_day)
    ny, nm = _add_months(start.year, start.month, 1)
    end = date(ny, nm, start_day) - timedelta(days=1)
    return start, end


def next_cycle(start: date, start_day: int = 20) -> tuple[date, date]:
    _, end = cycle_bounds(start, start_day)
    return cycle_bounds(end + timedelta(days=1), start_day)


def cycle_label(start: date, end: date) -> str:
    if start.year == end.year:
        return f"{start.day} {start:%b} – {end.day} {end:%b} {end.year}"
    return f"{start.day} {start:%b} {start.year} – {end.day} {end:%b} {end.year}"
