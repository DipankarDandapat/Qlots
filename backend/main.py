from __future__ import annotations

import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from database.db import engine, run_migrations, Base
from models.models import *  # noqa: F401,F403 — registers all ORM models with Base

logging.basicConfig(level=logging.INFO)

APP_ENV = os.getenv("APP_ENV", "development")
JWT_SECRET = os.getenv("JWT_SECRET", "qlots-local-development-key-change-before-release")
if APP_ENV == "production" and JWT_SECRET == "qlots-local-development-key-change-before-release":
    raise RuntimeError("Set a unique JWT_SECRET before starting Qlots in production")

try:
    Base.metadata.create_all(bind=engine)
    run_migrations()
except Exception:
    logging.exception("Database initialization failed; /health will report db error")

app = FastAPI(
    title="Qlots API",
    version="0.1.0",
    description="Local-first personal finance MVP. Projections are estimates, not guarantees.",
)

cors_setting = os.getenv("CORS_ORIGINS", "*")
if APP_ENV == "production" and (not cors_setting.strip() or "*" in cors_setting):
    raise RuntimeError("Set explicit CORS_ORIGINS before starting Qlots in production")
origins = [x.strip() for x in cors_setting.split(",") if x.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

from routers import auth, entries, dashboard, projections, advisor, reports, me  # noqa: E402

app.include_router(auth.router)
app.include_router(entries.router)
app.include_router(dashboard.router)
app.include_router(projections.router)
app.include_router(advisor.router)
app.include_router(reports.router)
app.include_router(me.router)


@app.get("/health")
def health():
    from database.db import SessionLocal
    db = SessionLocal()
    try:
        db.execute(select(1))
        db_ok = True
    except Exception:
        db_ok = False
    finally:
        db.close()
    return {"status": "ok" if db_ok else "degraded", "service": "qlots-api", "environment": APP_ENV, "db": "ok" if db_ok else "error"}
