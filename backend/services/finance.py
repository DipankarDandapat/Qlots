from __future__ import annotations

from datetime import date
from sqlalchemy import select
from sqlalchemy.orm import Session

from models.models import Assumptions, Entry, Snapshot


def annualized(amount: float, frequency: str) -> float:
    return amount * {"daily": 365, "weekly": 52, "monthly": 12, "quarterly": 4, "half_yearly": 2, "yearly": 1}.get(frequency, 12)


def rd_value(entry: Entry, on_date: date | None = None) -> float:
    instalment = entry.principal or entry.amount
    if instalment <= 0 or not entry.start_date or entry.annual_rate <= 0:
        return entry.amount
    valuation_date = on_date or date.today()
    end_date = min(valuation_date, entry.maturity_date) if entry.maturity_date else valuation_date
    months = max(0, (end_date.year - entry.start_date.year) * 12 + end_date.month - entry.start_date.month)
    r = entry.annual_rate / 1200
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


def entry_dict(entry: Entry) -> dict:
    return {
        "id": entry.id, "kind": entry.kind, "category": entry.category, "name": entry.name,
        "institution": entry.institution,
        "amount": round(entry_value(entry), 2) if entry.kind == "asset" else round(entry.amount, 2),
        "principal": entry.principal, "annual_rate": entry.annual_rate, "frequency": entry.frequency,
        "emi": entry.emi, "tenure_months": entry.tenure_months,
        "start_date": entry.start_date.isoformat() if entry.start_date else None,
        "maturity_date": entry.maturity_date.isoformat() if entry.maturity_date else None,
        "growth_rate": entry.growth_rate, "notes": entry.notes,
    }


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


def get_assumptions(db: Session, user_id: int) -> Assumptions:
    row = db.scalar(select(Assumptions).where(Assumptions.user_id == user_id))
    if row is None:
        row = Assumptions(user_id=user_id)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


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
        today_proj = date.today()
        for asset in assets:
            if asset.category in ("fixed_deposit", "recurring_deposit"):
                try:
                    future_date = date(today_proj.year + target_year, today_proj.month, today_proj.day)
                except ValueError:
                    future_date = date(today_proj.year + target_year, today_proj.month, 28)
                asset_total += entry_value(asset, future_date)
                continue
            current = entry_value(asset)
            if asset.category in ("property", "real_estate"):
                annual_rate = property_rate
            elif asset.category in ("cash", "bank_balance", "savings"):
                annual_rate = 0
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
            loan_balance_after(x.amount, x.annual_rate, x.emi, min(months, x.tenure_months) if x.tenure_months > 0 else months)
            for x in liabilities
        ) + overdraft
        projected_by_year.append({"year": target_year, "assets": round(asset_total, 2), "liabilities": round(debt_total, 2), "net_worth": round(asset_total - debt_total, 2)})
    return {
        "scenario": scenario if scenario in ("conservative", "base", "optimistic") else "base",
        "assumptions": {"salary_growth": assumptions.salary_growth, "equity_return": assumptions.equity_return, "property_growth": assumptions.property_growth, "inflation": assumptions.inflation, "monthly_investment": investment},
        "monthly_income": round(monthly_income, 2), "monthly_expenses": round(monthly_expenses, 2),
        "monthly_emi": round(monthly_emi, 2), "projections": projected_by_year,
    }


def health_score(assets: list[Entry], liabilities: list[Entry], income: list[Entry], expenses: list[Entry]) -> dict:
    monthly_income = monthly_flow(income, "income")
    monthly_expenses = monthly_flow(expenses, "expense")
    monthly_emi = sum(x.emi for x in liabilities)
    monthly_surplus = monthly_income - monthly_expenses - monthly_emi
    if not (assets or liabilities or income or expenses):
        return {"score": 0, "label": "Building", "metrics": {"savings_rate_pct": 0, "debt_to_income_pct": 0, "emergency_fund_months": 0, "monthly_surplus": 0}, "disclaimer": "Add your assets, income and expenses to get a financial health score."}
    savings_rate = (monthly_surplus / monthly_income * 100) if monthly_income else 0
    dti = (monthly_emi / monthly_income * 100) if monthly_income else 0
    liquid = sum(entry_value(a) for a in assets if a.category in ("cash", "bank_balance", "savings"))
    emergency_months = liquid / monthly_expenses if monthly_expenses else 0
    score = 0
    score += min(25, max(0, savings_rate) * 0.5)
    score += max(0, 25 - min(25, dti * 0.6)) if monthly_income > 0 else 0
    score += min(20, emergency_months * 5)
    non_cash = [a for a in assets if a.category not in ("cash", "bank_balance", "savings")]
    score += 15 if len({a.category for a in non_cash}) >= 3 else min(15, len({a.category for a in non_cash}) * 5)
    score += 15 if monthly_surplus > 0 else (7 if monthly_surplus == 0 and monthly_income > 0 else 0)
    score = round(min(100, max(0, score)))
    return {"score": score, "label": "Building" if score < 50 else "Steady" if score < 75 else "Strong", "metrics": {"savings_rate_pct": round(savings_rate, 1), "debt_to_income_pct": round(dti, 1), "emergency_fund_months": round(emergency_months, 1), "monthly_surplus": round(monthly_surplus, 2)}, "disclaimer": "An educational indicator based on the information entered—not professional financial advice."}


def dashboard_data(db: Session, user_id: int, user_name: str) -> dict:
    from models.models import Snapshot
    assets, liabilities, income, expenses = collect_finances(db, user_id)
    assumptions = get_assumptions(db, user_id)
    total_assets = sum(entry_value(a) for a in assets)
    total_liabilities = sum(l.amount for l in liabilities)
    monthly_income = monthly_flow(income, "income")
    monthly_expenses = monthly_flow(expenses, "expense")
    forecast = project(assets, liabilities, income, expenses, assumptions, 5)
    today = date.today()
    existing = db.scalar(select(Snapshot).where(Snapshot.user_id == user_id, Snapshot.snapshot_date == today))
    if existing:
        existing.net_worth = total_assets - total_liabilities
    else:
        db.add(Snapshot(user_id=user_id, snapshot_date=today, net_worth=total_assets - total_liabilities))
    db.commit()
    allocation: dict[str, float] = {}
    for a in assets:
        allocation[a.category] = allocation.get(a.category, 0) + entry_value(a)
    return {
        "currency": "INR", "as_of": today.isoformat(),
        "totals": {"assets": round(total_assets, 2), "liabilities": round(total_liabilities, 2), "net_worth": round(total_assets - total_liabilities, 2)},
        "monthly": {"income": round(monthly_income, 2), "expenses": round(monthly_expenses, 2), "emi": round(sum(l.emi for l in liabilities), 2), "surplus": round(monthly_income - monthly_expenses - sum(l.emi for l in liabilities), 2)},
        "asset_breakdown": [{"category": k, "value": round(v, 2)} for k, v in sorted(allocation.items(), key=lambda kv: -kv[1])],
        "assets": [entry_dict(a) for a in assets],
        "liabilities": [entry_dict(l) for l in liabilities],
        "projections": {"one_year": forecast["projections"][0], "five_year": forecast["projections"][4], "assumptions": forecast["assumptions"], "disclaimer": "Model-based projections; actual outcomes may differ and are not guaranteed."},
        "health": health_score(assets, liabilities, income, expenses),
    }
