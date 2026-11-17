"""Generic pagination/sorting helpers used by all list endpoints."""
from dataclasses import dataclass
from typing import Any, Generic, TypeVar

from sqlalchemy import Select, asc, desc, func, select
from sqlalchemy.orm import Session

T = TypeVar("T")


@dataclass
class Page(Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int

    @property
    def pages(self) -> int:
        return max(1, -(-self.total // self.page_size)) if self.page_size else 1


def paginate(db: Session, stmt: Select, page: int = 1, page_size: int = 25, sort: str | None = None,
             sortable: dict[str, Any] | None = None, default_sort: Any = None, unique: bool = False) -> Page:
    page = max(1, page)
    page_size = max(1, min(page_size, 1000))
    if sort and sortable:
        direction = desc if sort.startswith("-") else asc
        col = sortable.get(sort.lstrip("-"))
        if col is not None:
            stmt = stmt.order_by(None).order_by(direction(col))
    elif default_sort is not None:
        stmt = stmt.order_by(default_sort)
    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0
    result = db.scalars(stmt.offset((page - 1) * page_size).limit(page_size))
    items = list(result.unique()) if unique else list(result)
    return Page(items, total, page, page_size)
