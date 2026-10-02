from __future__ import annotations

import hashlib
import hmac
import os
import secrets
from datetime import date, datetime, timedelta, timezone
from io import BytesIO
from math import ceil
from typing import Literal

import jwt
from fastapi import Depends, FastAPI, HTTPException, Query, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, EmailStr, Field, field_validator
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from sqlalchemy import Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

APP_ENV = os.getenv("APP_ENV", "development")
JWT_SECRET = os.getenv("JWT_SECRET", "qlots-local-development-key-change-before-release")
if APP_ENV == "production" and JWT_SECRET == "qlots-local-development-key-change-before-release":
    raise RuntimeError("Set a unique JWT_SECRET before starting Qlots in production")
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./qlots.db")
TOKEN_HOURS = int(os.getenv("TOKEN_HOURS", "168"))


def utcnow_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args, pool_pre_ping=True)

if DATABASE_URL.startswith("sqlite"):
    from sqlalchemy import event
    @event.listens_for(engine, "connect")
    def set_wal_mode(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA journal_mode=WAL")
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(100), default="")
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow_naive)


class Entry(Base):
    __tablename__ = "entries"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(16), index=True)  # asset, liability, income, expense
    category: Mapped[str] = mapped_column(String(40), index=True)
    name: Mapped[str] = mapped_column(String(120))
    institution: Mapped[str] = mapped_column(String(120), default="")
    amount: Mapped[float] = mapped_column(Float, default=0)  # current value, outstanding debt, or periodic flow
    principal: Mapped[float] = mapped_column(Float, default=0)
    annual_rate: Mapped[float] = mapped_column(Float, default=0)  # percentage, not decimal
    frequency: Mapped[str] = mapped_column(String(20), default="monthly")
    emi: Mapped[float] = mapped_column(Float, default=0)
    tenure_months: Mapped[int] = mapped_column(Integer, default=0)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    maturity_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    growth_rate: Mapped[float] = mapped_column(Float, default=0)
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow_naive)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow_naive, onupdate=utcnow_naive)


class Assumptions(Base):
    __tablename__ = "assumptions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    salary_growth: Mapped[float] = mapped_column(Float, default=8)
    equity_return: Mapped[float] = mapped_column(Float, default=10)
    property_growth: Mapped[float] = mapped_column(Float, default=6)
    inflation: Mapped[float] = mapped_column(Float, default=5)
    monthly_investment: Mapped[float] = mapped_column(Float, default=0)


class Snapshot(Base):
    __tablename__ = "snapshots"
    __table_args__ = (UniqueConstraint("user_id", "snapshot_date", name="uq_snapshot_user_date"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    snapshot_date: Mapped[date] = mapped_column(Date, default=date.today)
    net_worth: Mapped[float] = mapped_column(Float, default=0)


Base.metadata.create_all(bind=engine)
app = FastAPI(title="Qlots API", version="0.1.0", description="Local-first personal finance MVP. Projections are estimates, not guarantees.")
cors_setting = os.getenv("CORS_ORIGINS", "*")
if APP_ENV == "production" and (not cors_setting.strip() or "*" in cors_setting):
    raise RuntimeError("Set explicit CORS_ORIGINS before starting Qlots in production")
origins = [x.strip() for x in cors_setting.split(",") if x.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=False, allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"], allow_headers=["Authorization", "Content-Type"])
security = HTTPBearer(auto_error=False)


def db_session():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 310_000)
    return f"pbkdf2_sha256${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algorithm, salt_hex, digest_hex = stored.split("$", 2)
        if algorithm != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), 310_000)
        return hmac.compare_digest(digest.hex(), digest_hex)
    except (ValueError, TypeError):
        return False


def issue_token(user: User) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode({"sub": str(user.id), "email": user.email, "iat": now, "exp": now + timedelta(hours=TOKEN_HOURS)}, JWT_SECRET, algorithm="HS256")


def current_user(creds: HTTPAuthorizationCredentials | None = Depends(security), db: Session = Depends(db_session)) -> User:
    if not creds:
        raise HTTPException(status_code=401, detail="Sign in to continue")
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=["HS256"])
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise HTTPException(status_code=401, detail="Session expired. Please sign in again")
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="Account not found")
    return user


class RegisterIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    email: EmailStr
    password: str = Field(min_length=10, max_length=128)

    @field_validator("name")
    @classmethod
    def trim_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Name cannot be blank")
        return value


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class EntryIn(BaseModel):
    kind: Literal["asset", "liability", "income", "expense"]
    category: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=120)
    institution: str = Field(default="", max_length=120)
    amount: float = Field(default=0, ge=0, le=1e14)
    principal: float = Field(default=0, ge=0, le=1e14)
    annual_rate: float = Field(default=0, ge=0, le=100)
    frequency: Literal["daily", "weekly", "monthly", "quarterly", "half_yearly", "yearly"] = "monthly"
    emi: float = Field(default=0, ge=0, le=1e12)
    tenure_months: int = Field(default=0, ge=0, le=600)
    start_date: date | None = None
    maturity_date: date | None = None
    growth_rate: float = Field(default=0, ge=-100, le=100)
    notes: str = Field(default="", max_length=1000)


class AssumptionIn(BaseModel):
    salary_growth: float = Field(default=8, ge=-50, le=100)
    equity_return: float = Field(default=10, ge=-50, le=100)
    property_growth: float = Field(default=6, ge=-50, le=100)
    inflation: float = Field(default=5, ge=-50, le=100)
    monthly_investment: float = Field(default=0, ge=0, le=1e12)


class UpdateProfileIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    password: str | None = Field(default=None, min_length=10, max_length=128)

    @field_validator("name")
    @classmethod
    def trim_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Name cannot be blank")
        return value


class QuestionIn(BaseModel):
    question: str = Field(min_length=1, max_length=1000)


def get_assumptions(db: Session, user_id: int) -> Assumptions:
    row = db.scalar(select(Assumptions).where(Assumptions.user_id == user_id))
    if row is None:
        row = Assumptions(user_id=user_id)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def annualized(amount: float, frequency: str) -> float:
    return amount * {"daily": 365, "weekly": 52, "monthly": 12, "quarterly": 4, "half_yearly": 2, "yearly": 1}.get(frequency, 12)


def rd_value(entry: Entry, on_date: date | None = None) -> float:
    """Recurring deposit: sum of monthly instalments compounded to valuation date."""
    instalment = entry.principal or entry.amount
    if instalment <= 0 or not entry.start_date or entry.annual_rate <= 0:
        return entry.amount
    valuation_date = on_date or date.today()
    end_date = min(valuation_date, entry.maturity_date) if entry.maturity_date else valuation_date
    months = max(0, (end_date.year - entry.start_date.year) * 12 + end_date.month - entry.start_date.month)
    r = entry.annual_rate / 1200  # monthly rate
    if r == 0:
        return instalment * months
    return instalment * ((1 + r) ** months - 1) / r * (1 + r)


def fd_value(entry: Entry, on_date: date | None = None) -> float:
    principal = entry.principal or entry.amount
    if principal <= 0 or not entry.start_date or entry.annual_rate <= 0:
        return entry.amount
    valuation_date = on_date or date.today()
    rate = entry.annual_rate / 100
    periods = {"daily": 365, "monthly": 12, "quarterly": 4, "half_yearly": 2, "yearly": 1}.get(entry.frequency, 4)
    end_date = min(valuation_date, entry.maturity_date) if entry.maturity_date else valuation_date
    elapsed_days = max(0, (end_date - entry.start_date).days)
    years = elapsed_days / 365.2425
    return principal * (1 + rate / periods) ** (periods * years)


def entry_value(entry: Entry, on_date: date | None = None) -> float:
    if entry.kind == "asset" and entry.category == "fixed_deposit":
        return fd_value(entry, on_date)
    if entry.kind == "asset" and entry.category == "recurring_deposit":
        return rd_value(entry, on_date)
    return float(entry.amount or 0)


def monthly_flow(entries: list[Entry], kind: str) -> float:
    return sum(annualized(e.amount, e.frequency) / 12 for e in entries if e.kind == kind)


def loan_balance_after(balance: float, annual_rate: float, emi: float, months: int) -> float:
    if balance <= 0:
        return 0.0
    monthly_rate = max(annual_rate, 0) / 1200
    remaining = balance
    for _ in range(max(0, months)):
        interest = remaining * monthly_rate
        payment = emi if emi > 0 else interest
        remaining = max(0.0, remaining + interest - payment)
    return remaining


def collect_finances(db: Session, user_id: int) -> tuple[list[Entry], list[Entry], list[Entry], list[Entry]]:
    rows = list(db.scalars(select(Entry).where(Entry.user_id == user_id)))
    return tuple([e for e in rows if e.kind == k] for k in ("asset", "liability", "income", "expense"))  # type: ignore[return-value]


def project(assets: list[Entry], liabilities: list[Entry], income: list[Entry], expenses: list[Entry], assumptions: Assumptions, years: int, scenario: str = "base") -> dict:
    scenario = scenario.lower()
    return_factor = {"conservative": 0.65, "base": 1.0, "optimistic": 1.25}.get(scenario, 1.0)
    property_rate = assumptions.property_growth / 100 * return_factor
    equity_rate = assumptions.equity_return / 100 * return_factor
    years = max(1, min(years, 10))
    monthly_income = monthly_flow(income, "income")
    monthly_expenses = monthly_flow(expenses, "expense")
    monthly_emi = sum(x.emi for x in liabilities if x.emi > 0)
    investment = assumptions.monthly_investment
    liquid_cash = sum(entry_value(a) for a in assets if a.category in ("cash", "bank_balance", "savings"))
    projected_by_year = []
    for target_year in range(1, years + 1):
        months = target_year * 12
        asset_total = 0.0
        for asset in assets:
            current = entry_value(asset)
            if asset.category in ("property", "real_estate"):
                annual_rate = property_rate
            elif asset.category in ("cash", "bank_balance", "savings"):
                annual_rate = 0
            elif asset.category == "fixed_deposit" and asset.annual_rate > 0:
                annual_rate = asset.annual_rate / 100
            elif asset.growth_rate != 0:
                annual_rate = asset.growth_rate / 100
            elif asset.annual_rate > 0:
                annual_rate = asset.annual_rate / 100 * return_factor
            else:
                annual_rate = equity_rate
            asset_total += current * (1 + annual_rate) ** target_year
        investment_fv = investment * (((1 + equity_rate / 12) ** months - 1) / (equity_rate / 12)) if equity_rate else investment * months
        cumulative_cash_flow = 0.0
        for year_step in range(target_year):
            income_growth = (1 + assumptions.salary_growth / 100) ** year_step
            expense_growth = (1 + assumptions.inflation / 100) ** year_step
            monthly_net = monthly_income * income_growth - monthly_expenses * expense_growth - monthly_emi - investment
            cumulative_cash_flow += 12 * monthly_net
        projected_cash = liquid_cash + cumulative_cash_flow
        overdraft = max(0.0, -projected_cash)
        cash_delta = max(0.0, projected_cash) - liquid_cash
        asset_total += investment_fv + cash_delta
        debt_total = sum(
            loan_balance_after(
                x.amount, x.annual_rate, x.emi,
                min(months, x.tenure_months) if x.tenure_months > 0 else months
            ) for x in liabilities
        ) + overdraft
        projected_by_year.append({"year": target_year, "assets": round(asset_total, 2), "liabilities": round(debt_total, 2), "net_worth": round(asset_total - debt_total, 2)})
    return {"scenario": scenario if scenario in ("conservative", "base", "optimistic") else "base", "assumptions": {"salary_growth": assumptions.salary_growth, "equity_return": assumptions.equity_return, "property_growth": assumptions.property_growth, "inflation": assumptions.inflation, "monthly_investment": investment}, "monthly_income": round(monthly_income, 2), "monthly_expenses": round(monthly_expenses, 2), "monthly_emi": round(monthly_emi, 2), "projections": projected_by_year}


def health_score(assets: list[Entry], liabilities: list[Entry], income: list[Entry], expenses: list[Entry]) -> dict:
    monthly_income = monthly_flow(income, "income")
    monthly_expenses = monthly_flow(expenses, "expense")
    monthly_emi = sum(x.emi for x in liabilities)
    monthly_surplus = monthly_income - monthly_expenses - monthly_emi
    savings_rate = (monthly_surplus / monthly_income * 100) if monthly_income else 0
    dti = (monthly_emi / monthly_income * 100) if monthly_income else 0
    liquid = sum(entry_value(a) for a in assets if a.category in ("cash", "bank_balance", "savings"))
    emergency_months = liquid / monthly_expenses if monthly_expenses else 0
    score = 0
    score += min(25, max(0, savings_rate) * 0.5)
    score += 25 if monthly_income == 0 else max(0, 25 - min(25, dti * 0.6))
    score += min(20, emergency_months * 5)
    non_cash = [a for a in assets if a.category not in ("cash", "bank_balance", "savings")]
    score += 15 if len({a.category for a in non_cash}) >= 3 else min(15, len({a.category for a in non_cash}) * 5)
    score += 15 if monthly_surplus > 0 else (7 if monthly_surplus == 0 else 0)
    score = round(min(100, max(0, score)))
    return {"score": score, "label": "Building" if score < 50 else "Steady" if score < 75 else "Strong", "metrics": {"savings_rate_pct": round(savings_rate, 1), "debt_to_income_pct": round(dti, 1), "emergency_fund_months": round(emergency_months, 1), "monthly_surplus": round(monthly_surplus, 2)}, "disclaimer": "An educational indicator based on the information entered—not professional financial advice."}


def dashboard_data(db: Session, user: User) -> dict:
    assets, liabilities, income, expenses = collect_finances(db, user.id)
    assumptions = get_assumptions(db, user.id)
    total_assets = sum(entry_value(a) for a in assets)
    total_liabilities = sum(l.amount for l in liabilities)
    monthly_income = monthly_flow(income, "income")
    monthly_expenses = monthly_flow(expenses, "expense")
    forecast = project(assets, liabilities, income, expenses, assumptions, 5)
    today = date.today()
    existing = db.scalar(select(Snapshot).where(Snapshot.user_id == user.id, Snapshot.snapshot_date == today))
    if existing:
        existing.net_worth = total_assets - total_liabilities
    else:
        db.add(Snapshot(user_id=user.id, snapshot_date=today, net_worth=total_assets - total_liabilities))
    db.commit()
    allocation = {}
    for a in assets:
        allocation[a.category] = allocation.get(a.category, 0) + entry_value(a)
    return {"currency": "INR", "as_of": today.isoformat(), "totals": {"assets": round(total_assets, 2), "liabilities": round(total_liabilities, 2), "net_worth": round(total_assets - total_liabilities, 2)}, "monthly": {"income": round(monthly_income, 2), "expenses": round(monthly_expenses, 2), "emi": round(sum(l.emi for l in liabilities), 2), "surplus": round(monthly_income - monthly_expenses - sum(l.emi for l in liabilities), 2)}, "asset_breakdown": [{"category": k, "value": round(v, 2)} for k, v in sorted(allocation.items(), key=lambda kv: -kv[1])], "assets": [entry_dict(a) for a in assets], "liabilities": [entry_dict(l) for l in liabilities], "projections": {"one_year": forecast["projections"][0], "five_year": forecast["projections"][4], "assumptions": forecast["assumptions"], "disclaimer": "Model-based projections; actual outcomes may differ and are not guaranteed."}, "health": health_score(assets, liabilities, income, expenses)}


def entry_dict(entry: Entry) -> dict:
    result = {"id": entry.id, "kind": entry.kind, "category": entry.category, "name": entry.name, "institution": entry.institution, "amount": round(entry_value(entry), 2) if entry.kind == "asset" else round(entry.amount, 2), "principal": entry.principal, "annual_rate": entry.annual_rate, "frequency": entry.frequency, "emi": entry.emi, "tenure_months": entry.tenure_months, "start_date": entry.start_date.isoformat() if entry.start_date else None, "maturity_date": entry.maturity_date.isoformat() if entry.maturity_date else None, "growth_rate": entry.growth_rate, "notes": entry.notes}
    return result


@app.get("/health")
def health(db: Session = Depends(db_session)):
    try:
        db.execute(select(1))
        db_ok = True
    except Exception:
        db_ok = False
    return {"status": "ok" if db_ok else "degraded", "service": "qlots-api", "environment": APP_ENV, "db": "ok" if db_ok else "error"}


@app.post("/api/auth/register", status_code=201)
def register(body: RegisterIn, db: Session = Depends(db_session)):
    email = body.email.lower().strip()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    user = User(email=email, name=body.name.strip(), password_hash=hash_password(body.password))
    db.add(user)
    db.commit()
    db.refresh(user)
    get_assumptions(db, user.id)
    return {"access_token": issue_token(user), "token_type": "bearer", "user": {"id": user.id, "name": user.name, "email": user.email}}


@app.post("/api/auth/login")
def login(body: LoginIn, db: Session = Depends(db_session)):
    user = db.scalar(select(User).where(User.email == body.email.lower().strip()))
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Email or password is incorrect")
    return {"access_token": issue_token(user), "token_type": "bearer", "user": {"id": user.id, "name": user.name, "email": user.email}}


@app.post("/api/auth/refresh")
def refresh_token(user: User = Depends(current_user)):
    return {"access_token": issue_token(user), "token_type": "bearer"}


@app.put("/api/me")
def update_profile(body: UpdateProfileIn, user: User = Depends(current_user), db: Session = Depends(db_session)):
    user.name = body.name.strip()
    if body.password:
        user.password_hash = hash_password(body.password)
    db.commit()
    return {"id": user.id, "name": user.name, "email": user.email}


@app.delete("/api/account", status_code=204)
def delete_account(user: User = Depends(current_user), db: Session = Depends(db_session)):
    db.delete(user)
    db.commit()
    return Response(status_code=204)


@app.get("/api/me")
def me(user: User = Depends(current_user)):
    return {"id": user.id, "name": user.name, "email": user.email}


@app.get("/api/dashboard")
def dashboard(user: User = Depends(current_user), db: Session = Depends(db_session)):
    return dashboard_data(db, user)


@app.get("/api/entries")
def list_entries(kind: Literal["asset", "liability", "income", "expense"] | None = Query(default=None), user: User = Depends(current_user), db: Session = Depends(db_session)):
    stmt = select(Entry).where(Entry.user_id == user.id)
    if kind:
        stmt = stmt.where(Entry.kind == kind)
    return [entry_dict(x) for x in db.scalars(stmt.order_by(Entry.created_at.desc()))]


@app.post("/api/entries", status_code=201)
def create_entry(body: EntryIn, user: User = Depends(current_user), db: Session = Depends(db_session)):
    if body.kind == "asset" and body.category == "fixed_deposit" and body.principal <= 0:
        raise HTTPException(status_code=422, detail="Enter the original principal for a fixed deposit")
    row = Entry(user_id=user.id, **body.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return entry_dict(row)


@app.put("/api/entries/{entry_id}")
def update_entry(entry_id: int, body: EntryIn, user: User = Depends(current_user), db: Session = Depends(db_session)):
    row = db.scalar(select(Entry).where(Entry.id == entry_id, Entry.user_id == user.id))
    if not row:
        raise HTTPException(status_code=404, detail="Record not found")
    for key, value in body.model_dump().items():
        setattr(row, key, value)
    db.commit()
    db.refresh(row)
    return entry_dict(row)


@app.delete("/api/entries/{entry_id}", status_code=204)
def delete_entry(entry_id: int, user: User = Depends(current_user), db: Session = Depends(db_session)):
    row = db.scalar(select(Entry).where(Entry.id == entry_id, Entry.user_id == user.id))
    if not row:
        raise HTTPException(status_code=404, detail="Record not found")
    db.delete(row)
    db.commit()
    return Response(status_code=204)


@app.get("/api/assumptions")
def read_assumptions(user: User = Depends(current_user), db: Session = Depends(db_session)):
    a = get_assumptions(db, user.id)
    return {"salary_growth": a.salary_growth, "equity_return": a.equity_return, "property_growth": a.property_growth, "inflation": a.inflation, "monthly_investment": a.monthly_investment}


@app.put("/api/assumptions")
def update_assumptions(body: AssumptionIn, user: User = Depends(current_user), db: Session = Depends(db_session)):
    row = get_assumptions(db, user.id)
    for key, value in body.model_dump().items():
        setattr(row, key, value)
    db.commit()
    return body.model_dump()


@app.post("/api/projection/calculate")
def calculate_projection(scenario: Literal["conservative", "base", "optimistic"] = "base", user: User = Depends(current_user), db: Session = Depends(db_session)):
    assets, liabilities, income, expenses = collect_finances(db, user.id)
    return project(assets, liabilities, income, expenses, get_assumptions(db, user.id), 5, scenario)


@app.get("/api/history")
def history(user: User = Depends(current_user), db: Session = Depends(db_session)):
    rows = list(db.scalars(select(Snapshot).where(Snapshot.user_id == user.id).order_by(Snapshot.snapshot_date.asc()).limit(365)))
    return [{"date": s.snapshot_date.isoformat(), "net_worth": round(s.net_worth, 2)} for s in rows]


@app.post("/api/ai/chat")
def advisor(body: QuestionIn, user: User = Depends(current_user), db: Session = Depends(db_session)):
    assets, liabilities, income, expenses = collect_finances(db, user.id)
    a = get_assumptions(db, user.id)
    total_assets = sum(entry_value(x) for x in assets)
    debt = sum(x.amount for x in liabilities)
    monthly_income = monthly_flow(income, "income")
    monthly_expenses = monthly_flow(expenses, "expense")
    emi = sum(x.emi for x in liabilities)
    surplus = monthly_income - monthly_expenses - emi
    question = body.question.lower()
    if any(k in question for k in ("net worth", "wealth", "financial position")):
        answer = f"Based on the records you entered, assets total ₹{total_assets:,.0f} and liabilities total ₹{debt:,.0f}, for an estimated net worth of ₹{total_assets-debt:,.0f}. This uses your manually entered values as of {date.today().isoformat()}."
    elif any(k in question for k in ("save", "surplus", "cash flow", "income", "expense")):
        answer = f"Your entered monthly income is ₹{monthly_income:,.0f}, expenses are ₹{monthly_expenses:,.0f}, and loan EMIs are ₹{emi:,.0f}. The arithmetic monthly surplus is ₹{surplus:,.0f}. Missing or irregular items are not included."
    elif any(k in question for k in ("project", "five year", "5 year", "future")):
        forecast = project(assets, liabilities, income, expenses, a, 5)
        answer = f"Under the current base assumptions (equity return {a.equity_return:g}%, property growth {a.property_growth:g}%, monthly investment ₹{a.monthly_investment:,.0f}), estimated net worth in five years is ₹{forecast['projections'][-1]['net_worth']:,.0f}. This is an assumption-based projection, not a prediction or guarantee."
    elif any(k in question for k in ("fd", "fixed deposit", "interest")):
        fds = [x for x in assets if x.category == "fixed_deposit"]
        value = sum(entry_value(x) for x in fds)
        principal = sum(x.principal or x.amount for x in fds)
        answer = f"You have {len(fds)} fixed deposit record(s): estimated current value ₹{value:,.0f} against entered principal ₹{principal:,.0f}; estimated accrued difference ₹{value-principal:,.0f}. Bank-specific payout, tax and premature-withdrawal rules may differ."
    else:
        answer = f"I can summarize the data you entered: ₹{total_assets:,.0f} in assets, ₹{debt:,.0f} in liabilities, and estimated monthly surplus ₹{surplus:,.0f}. Try asking about net worth, cash flow, FD interest or your five-year projection."
    return {"answer": answer, "mode": "calculation-backed MVP helper (not an LLM)", "disclaimer": "For informational and planning purposes only—not investment, tax, legal or other professional advice. Projections are not guaranteed."}


@app.post("/api/reports/pdf")
def report(user: User = Depends(current_user), db: Session = Depends(db_session)):
    summary = dashboard_data(db, user)
    packet = BytesIO()
    pdf = canvas.Canvas(packet, pagesize=A4)
    width, height = A4
    y = height - 56

    def line(text: str, size: int = 11, gap: int = 20, bold: bool = False):
        nonlocal y
        pdf.setFont("Helvetica-Bold" if bold else "Helvetica", size)
        pdf.drawString(48, y, text[:115])
        y -= gap
        if y < 60:
            pdf.showPage()
            y = height - 56

    line("Qlots | Personal Financial Snapshot", 18, 32, True)
    line(f"Prepared for {user.name} | {summary['as_of']}", 10, 28)
    line("FINANCIAL SUMMARY", 13, 23, True)
    line(f"Current net worth: INR {summary['totals']['net_worth']:,.0f}")
    line(f"Assets: INR {summary['totals']['assets']:,.0f}    Liabilities: INR {summary['totals']['liabilities']:,.0f}")
    line(f"1-year projected net worth: INR {summary['projections']['one_year']['net_worth']:,.0f}")
    line(f"5-year projected net worth: INR {summary['projections']['five_year']['net_worth']:,.0f}")
    line("ASSETS", 13, 23, True)
    for item in summary["assets"]:
        line(f"{item['name']} ({item['category']}): INR {item['amount']:,.0f}")
    line("LIABILITIES", 13, 23, True)
    for item in summary["liabilities"]:
        line(f"{item['name']} ({item['category']}): INR {item['amount']:,.0f}; EMI INR {item['emi']:,.0f}/month")
    line("CASH FLOW & HEALTH", 13, 23, True)
    line(f"Monthly income INR {summary['monthly']['income']:,.0f}; expenses INR {summary['monthly']['expenses']:,.0f}; EMI INR {summary['monthly']['emi']:,.0f}")
    line(f"Financial health indicator: {summary['health']['score']}/100 ({summary['health']['label']})")
    line("Projection assumptions: " + ", ".join(f"{k}={v}" for k, v in summary["projections"]["assumptions"].items()), 9, 28)
    line("Model-based projections depend on entered data and assumptions; actual results may differ.", 9, 18)
    line("For informational and planning purposes only—not professional financial advice.", 9, 18)
    pdf.save()
    packet.seek(0)
    return Response(content=packet.getvalue(), media_type="application/pdf", headers={"Content-Disposition": 'attachment; filename="qlots-financial-report.pdf"'})


@app.delete("/api/account/data", status_code=204)
def delete_all_data(user: User = Depends(current_user), db: Session = Depends(db_session)):
    for model in (Entry, Snapshot, Assumptions):
        for row in db.scalars(select(model).where(model.user_id == user.id)):
            db.delete(row)
    db.commit()
    return Response(status_code=204)
