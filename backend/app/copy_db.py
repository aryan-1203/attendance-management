"""Copy every row from one database to another (e.g. local SQLite dev.db -> hosted MySQL / TiDB).

    # 1. create the schema on the target first
    DATABASE_URL="<target url>" DB_SSL=true alembic upgrade head
    # 2. copy the data
    DATABASE_URL="<target url>" DB_SSL=true python -m app.copy_db --source sqlite:///./storage/dev.db

The target is DATABASE_URL (with the same DB_SSL settings the app uses). The target must be empty unless
--wipe is given, which deletes all rows in the target first. Primary keys are preserved.
"""
from __future__ import annotations

import argparse
import sys

from sqlalchemy import func, select, text

import app.models  # noqa: F401 - register models
from app.core.config import settings
from app.core.database import Base, make_engine

BATCH = 500


def _fk_checks(conn, on: bool) -> None:
    if conn.dialect.name == "mysql":
        conn.execute(text(f"SET FOREIGN_KEY_CHECKS={1 if on else 0}"))
    elif conn.dialect.name == "sqlite":
        conn.execute(text(f"PRAGMA foreign_keys={'ON' if on else 'OFF'}"))


def copy(source_url: str, wipe: bool) -> None:
    src = make_engine(source_url)
    dst = make_engine(settings.database_url)
    if src.url == dst.url:
        sys.exit("Source and target are the same database")
    tables = Base.metadata.sorted_tables
    with src.connect() as s, dst.connect() as d:
        _fk_checks(d, False)
        non_empty = [t.name for t in tables if d.scalar(select(func.count()).select_from(t))]
        if non_empty and not wipe:
            sys.exit(f"Target is not empty ({', '.join(non_empty)}). Re-run with --wipe to replace its data.")
        if wipe:
            for t in reversed(tables):
                d.execute(t.delete())
            d.commit()
        for t in tables:
            rows = [dict(r._mapping) for r in s.execute(select(t))]
            for i in range(0, len(rows), BATCH):
                d.execute(t.insert(), rows[i:i + BATCH])
            d.commit()
            print(f"  {t.name:<28} {len(rows):>7} rows")
        _fk_checks(d, True)
        d.commit()
    print(f"Done. Copied into {dst.url.render_as_string(hide_password=True)}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", required=True, help="SQLAlchemy URL to copy from, e.g. sqlite:///./storage/dev.db")
    ap.add_argument("--wipe", action="store_true", help="delete all rows in the target first")
    a = ap.parse_args()
    copy(a.source, a.wipe)


if __name__ == "__main__":
    main()
