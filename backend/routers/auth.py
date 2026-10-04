from __future__ import annotations

from pydantic import BaseModel, EmailStr, Field, field_validator
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from database.db import db_session
from models.models import User
from services.auth import current_user, hash_password, issue_token, verify_password
from services.finance import get_assumptions

router = APIRouter(prefix="/api/auth", tags=["auth"])


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


@router.post("/register", status_code=201)
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


@router.post("/login")
def login(body: LoginIn, db: Session = Depends(db_session)):
    user = db.scalar(select(User).where(User.email == body.email.lower().strip()))
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Email or password is incorrect")
    return {"access_token": issue_token(user), "token_type": "bearer", "user": {"id": user.id, "name": user.name, "email": user.email}}


@router.post("/refresh")
def refresh_token(user: User = Depends(current_user)):
    return {"access_token": issue_token(user), "token_type": "bearer"}
