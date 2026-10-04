from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from database.db import db_session
from models.models import Entry, Assumptions, Snapshot, User
from services.auth import current_user, hash_password
from sqlalchemy import select

router = APIRouter(tags=["me"])


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


@router.get("/api/me")
def me(user: User = Depends(current_user)):
    return {"id": user.id, "name": user.name, "email": user.email}


@router.put("/api/me")
def update_profile(body: UpdateProfileIn, user: User = Depends(current_user), db: Session = Depends(db_session)):
    user.name = body.name.strip()
    if body.password:
        user.password_hash = hash_password(body.password)
    db.commit()
    return {"id": user.id, "name": user.name, "email": user.email}


@router.delete("/api/account", status_code=204)
def delete_account(user: User = Depends(current_user), db: Session = Depends(db_session)):
    db.delete(user)
    db.commit()
    return Response(status_code=204)


@router.delete("/api/account/data", status_code=204)
def delete_all_data(user: User = Depends(current_user), db: Session = Depends(db_session)):
    for model in (Entry, Snapshot, Assumptions):
        for row in db.scalars(select(model).where(model.user_id == user.id)):
            db.delete(row)
    db.commit()
    return Response(status_code=204)
