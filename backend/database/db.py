from __future__ import annotations

import logging
import os
from pathlib import Path

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

logger = logging.getLogger(__name__)

# Load .env if present (needed on cPanel where env vars are not injected)
_env_path = Path(__file__).parent.parent / ".env"
if _env_path.exists():
    for _line in _env_path.read_text().splitlines():
        if _line.strip() and not _line.startswith("#") and "=" in _line:
            _k, _v = _line.split("=", 1)
            os.environ.setdefault(_k.strip(), _v.strip())

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./qlots.db")

if DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}
elif DATABASE_URL.startswith("postgres"):
    connect_args = {"connect_timeout": 8}
elif DATABASE_URL.startswith("mysql"):
    connect_args = {"connect_timeout": 8}
else:
    connect_args = {}
engine = create_engine(
    DATABASE_URL,
    connect_args=connect_args,
    pool_pre_ping=True,
    pool_timeout=10,
)

if DATABASE_URL.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def set_sqlite_pragmas(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA journal_mode=DELETE")
        dbapi_conn.execute("PRAGMA synchronous=NORMAL")

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def db_session():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def run_migrations():
    is_mysql = DATABASE_URL.startswith("mysql")
    with engine.connect() as conn:
        for col, defn in [
            ("growth_rate", "FLOAT DEFAULT 0"),
            ("notes", 'TEXT DEFAULT ""' if not is_mysql else "TEXT"),
            ("tenure_months", "INTEGER DEFAULT 0"),
            ("updated_at", "DATETIME"),
        ]:
            try:
                if is_mysql:
                    # MySQL: check if column exists before adding
                    result = conn.execute(text(
                        f"SELECT COUNT(*) FROM information_schema.columns "
                        f"WHERE table_schema=DATABASE() AND table_name='entries' AND column_name='{col}'"
                    ))
                    if result.scalar() == 0:
                        conn.execute(text(f"ALTER TABLE entries ADD COLUMN {col} {defn}"))
                        conn.commit()
                        logger.info(f"Migration: added entries.{col}")
                else:
                    conn.execute(text(f"ALTER TABLE entries ADD COLUMN {col} {defn}"))
                    conn.commit()
                    logger.info(f"Migration: added entries.{col}")
            except Exception:
                pass
