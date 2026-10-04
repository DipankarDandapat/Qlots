from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database.db import db_session
from models.models import User
from services.auth import current_user
from services.finance import collect_finances, entry_value, get_assumptions, monthly_flow, project

router = APIRouter(tags=["advisor"])


class QuestionIn(BaseModel):
    question: str = Field(min_length=1, max_length=1000)


@router.post("/api/ai/chat")
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
