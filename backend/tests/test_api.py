import os
import sys
from datetime import date
from pathlib import Path
from uuid import uuid4

os.environ["DATABASE_URL"] = "sqlite:///./test_qlots.db"
os.environ["APP_ENV"] = "test"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient
from main import Assumptions, Entry, app, fd_value, loan_balance_after, project

client = TestClient(app)


def register(name="Tester"):
    email = f"{uuid4().hex}@example.com"
    response = client.post("/api/auth/register", json={"name": name, "email": email, "password": "safe-test-password-123"})
    assert response.status_code == 201, response.text
    token = response.json()["access_token"]
    return email, {"Authorization": f"Bearer {token}"}


def test_health_and_authentication_boundary():
    assert client.get("/health").json()["status"] == "ok"
    assert client.get("/api/dashboard").status_code == 401
    email, headers = register()
    assert client.get("/api/me", headers=headers).json()["email"] == email
    assert client.post("/api/auth/login", json={"email": email, "password": "wrong-password"}).status_code == 401


def test_crud_dashboard_projection_and_pdf():
    _, headers = register()
    entries = [
        {"kind": "asset", "category": "cash", "name": "Savings", "amount": 200000},
        {"kind": "asset", "category": "fixed_deposit", "name": "Bank FD", "principal": 500000, "amount": 500000, "annual_rate": 6.4, "frequency": "quarterly", "start_date": "2025-11-20", "maturity_date": "2027-11-20"},
        {"kind": "asset", "category": "stocks", "name": "Portfolio", "amount": 800000},
        {"kind": "liability", "category": "home_loan", "name": "Home loan", "amount": 3000000, "annual_rate": 8, "emi": 25000},
        {"kind": "income", "category": "salary", "name": "Salary", "amount": 150000, "frequency": "monthly"},
        {"kind": "expense", "category": "living", "name": "Household", "amount": 90000, "frequency": "monthly"},
    ]
    for entry in entries:
        assert client.post("/api/entries", json=entry, headers=headers).status_code == 201
    dashboard = client.get("/api/dashboard", headers=headers)
    assert dashboard.status_code == 200, dashboard.text
    data = dashboard.json()
    assert data["totals"]["liabilities"] == 3000000
    assert data["totals"]["assets"] > 1500000
    assert data["totals"]["net_worth"] == data["totals"]["assets"] - 3000000
    assert data["projections"]["five_year"]["net_worth"] > 0
    assert data["monthly"]["surplus"] == 35000
    assert client.get("/api/history", headers=headers).json()
    pdf = client.post("/api/reports/pdf", headers=headers)
    assert pdf.status_code == 200
    assert pdf.headers["content-type"] == "application/pdf"
    assert pdf.content.startswith(b"%PDF")
    record_id = client.get("/api/entries?kind=asset", headers=headers).json()[0]["id"]
    assert client.delete(f"/api/entries/{record_id}", headers=headers).status_code == 204


def test_user_data_isolation_and_calculation_edges():
    _, headers_a = register("A")
    _, headers_b = register("B")
    client.post("/api/entries", json={"kind": "asset", "category": "cash", "name": "Private", "amount": 12345}, headers=headers_a)
    assert client.get("/api/entries", headers=headers_b).json() == []
    assert loan_balance_after(100000, 0, 10000, 12) == 0
    assert loan_balance_after(100000, 0, 0, 12) == 100000


def test_projection_records_persistent_cash_deficit():
    income = [Entry(kind="income", category="salary", name="Salary", amount=50, frequency="monthly")]
    expenses = [Entry(kind="expense", category="living", name="Living", amount=100, frequency="monthly")]
    assumptions = Assumptions(salary_growth=0, equity_return=0, property_growth=0, inflation=0, monthly_investment=0)
    result = project([], [], income, expenses, assumptions, 1)
    assert result["projections"][0]["assets"] == 0
    assert result["projections"][0]["liabilities"] == 600
    assert result["projections"][0]["net_worth"] == -600


def test_fixed_deposit_partial_period_accrual():
    fd = Entry(kind="asset", category="fixed_deposit", name="Example FD", amount=100000, principal=100000, annual_rate=6.4, frequency="quarterly", start_date=date(2025, 11, 20), maturity_date=date(2027, 11, 20))
    value = fd_value(fd, date(2026, 10, 1))
    assert 105600 <= value <= 105700
