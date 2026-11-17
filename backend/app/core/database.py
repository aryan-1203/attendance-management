"""SQLAlchemy engine/session setup. Works with MySQL 8 (production) and SQLite (tests)."""
from collections.abc import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings


class Base(DeclarativeBase):
    pass


def connect_args_for(url: str) -> dict:
    """Driver connect args: SQLite threading, or TLS for hosted MySQL when DB_SSL=true."""
    if url.startswith("sqlite"):
        return {"check_same_thread": False}
    if settings.db_ssl:
        import ssl

        if settings.db_ssl_ca:
            ctx = ssl.create_default_context(cafile=settings.db_ssl_ca)
        else:
            import certifi

            ctx = ssl.create_default_context(cafile=certifi.where())
        return {"ssl": ctx}
    return {}


def make_engine(url: str, **overrides):
    kwargs: dict = {"echo": settings.sql_echo, "future": True, "connect_args": connect_args_for(url)}
    if url.startswith("sqlite"):
        if ":memory:" in url or url in ("sqlite://", "sqlite:///"):
            from sqlalchemy.pool import StaticPool

            kwargs["poolclass"] = StaticPool
    elif "poolclass" not in overrides:
        # recycle under 5 min: serverless databases drop idle connections
        kwargs.update(pool_pre_ping=True, pool_recycle=280, pool_size=settings.db_pool_size,
                      max_overflow=settings.db_max_overflow)
    kwargs.update(overrides)
    eng = create_engine(url, **kwargs)
    if url.startswith("sqlite"):

        @event.listens_for(eng, "connect")
        def _fk_on(dbapi_conn, _):  # pragma: no cover - trivial
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA foreign_keys=ON")
            cur.close()

    return eng


engine = make_engine(settings.database_url)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, class_=Session)


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
