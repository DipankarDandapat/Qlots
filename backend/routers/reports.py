from __future__ import annotations

from io import BytesIO

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from sqlalchemy.orm import Session

from database.db import db_session
from models.models import User
from services.auth import current_user
from services.finance import dashboard_data

router = APIRouter(tags=["reports"])


@router.post("/api/reports/pdf")
def report(user: User = Depends(current_user), db: Session = Depends(db_session)):
    summary = dashboard_data(db, user.id, user.name)
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
