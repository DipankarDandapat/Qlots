from __future__ import annotations

from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from database.db import db_session
from models.models import Entry, User
from services.auth import current_user
from services.finance import entry_dict

router = APIRouter(prefix="/api/entries", tags=["entries"])


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


@router.get("")
def list_entries(kind: Literal["asset", "liability", "income", "expense"] | None = Query(default=None), user: User = Depends(current_user), db: Session = Depends(db_session)):
    stmt = select(Entry).where(Entry.user_id == user.id)
    if kind:
        stmt = stmt.where(Entry.kind == kind)
    return [entry_dict(x) for x in db.scalars(stmt.order_by(Entry.created_at.desc()))]


@router.post("", status_code=201)
def create_entry(body: EntryIn, user: User = Depends(current_user), db: Session = Depends(db_session)):
    if body.kind == "asset" and body.category in ("fixed_deposit", "recurring_deposit") and body.principal <= 0:
        raise HTTPException(status_code=422, detail="Enter the original principal for this deposit")
    row = Entry(user_id=user.id, **body.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return entry_dict(row)


@router.put("/{entry_id}")
def update_entry(entry_id: int, body: EntryIn, user: User = Depends(current_user), db: Session = Depends(db_session)):
    row = db.scalar(select(Entry).where(Entry.id == entry_id, Entry.user_id == user.id))
    if not row:
        raise HTTPException(status_code=404, detail="Record not found")
    for key, value in body.model_dump().items():
        setattr(row, key, value)
    db.commit()
    db.refresh(row)
    return entry_dict(row)


@router.delete("/{entry_id}", status_code=204)
def delete_entry(entry_id: int, user: User = Depends(current_user), db: Session = Depends(db_session)):
    row = db.scalar(select(Entry).where(Entry.id == entry_id, Entry.user_id == user.id))
    if not row:
        raise HTTPException(status_code=404, detail="Record not found")
    db.delete(row)
    db.commit()
    return Response(status_code=204)
