from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database.db import db_session
from models.models import User
from services.auth import current_user
from services.finance import collect_finances, get_assumptions, project

router = APIRouter(tags=["projections"])


class AssumptionIn(BaseModel):
    salary_growth: float = Field(default=8, ge=-50, le=100)
    equity_return: float = Field(default=10, ge=-50, le=100)
    property_growth: float = Field(default=6, ge=-50, le=100)
    inflation: float = Field(default=5, ge=-50, le=100)
    monthly_investment: float = Field(default=0, ge=0, le=1e12)


@router.get("/api/assumptions")
def read_assumptions(user: User = Depends(current_user), db: Session = Depends(db_session)):
    a = get_assumptions(db, user.id)
    return {"salary_growth": a.salary_growth, "equity_return": a.equity_return, "property_growth": a.property_growth, "inflation": a.inflation, "monthly_investment": a.monthly_investment}


@router.put("/api/assumptions")
def update_assumptions(body: AssumptionIn, user: User = Depends(current_user), db: Session = Depends(db_session)):
    row = get_assumptions(db, user.id)
    for key, value in body.model_dump().items():
        setattr(row, key, value)
    db.commit()
    return body.model_dump()


@router.post("/api/projection/calculate")
def calculate_projection(scenario: Literal["conservative", "base", "optimistic"] = "base", user: User = Depends(current_user), db: Session = Depends(db_session)):
    assets, liabilities, income, expenses = collect_finances(db, user.id)
    return project(assets, liabilities, income, expenses, get_assumptions(db, user.id), 5, scenario)
