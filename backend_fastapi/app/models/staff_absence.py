"""Xodimning ishda bo'lmagan kunlari: kasallik varaqasi, ta'til, xizmat safari (2026-10-28).

O'qituvchi bolnichniyga chiqsa, HEMIS buni ko'rsatmaydi va rektor hisobotida u "iMentor'dan
foydalanmadi" bo'lib qolardi. Endi o'qituvchi sanani va varaqa rasmini o'zi yuboradi, admin
tasdiqlaydi; tasdiqlangan kunlardagi o'tilmagan darslar foizga kirmaydi va ayblanmaydi.

Hujjat (tibbiy ma'lumot) `/media` da EMAS — u ochiq xizmat qilinadi. Fayl shu jadvalda
saqlanadi va faqat egasi va admin ko'radi; ro'yxatlarda yuklanmaydi (`deferred`).
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy import Date, DateTime, Index, Integer, LargeBinary, String, func
from sqlalchemy.orm import Mapped, deferred, mapped_column

from app.core.db import Base

PENDING = "pending"
APPROVED = "approved"
REJECTED = "rejected"


class StaffAbsence(Base):
    __tablename__ = "core_staffabsence"
    __table_args__ = (
        Index("ix_core_staffabsence_owner_dates", "owner_key", "start_date", "end_date"),
        Index("ix_core_staffabsence_status", "status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_key: Mapped[str] = mapped_column(String(128))
    kind: Mapped[str] = mapped_column(String(16), default="kasallik")
    start_date: Mapped[dt.date] = mapped_column(Date)
    end_date: Mapped[dt.date] = mapped_column(Date)
    note: Mapped[str] = mapped_column(String(500), default="", server_default="")
    status: Mapped[str] = mapped_column(String(16), default=PENDING, server_default=PENDING)
    doc_name: Mapped[str] = mapped_column(String(255), default="", server_default="")
    doc_type: Mapped[str] = mapped_column(String(64), default="", server_default="")
    doc_size: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    doc_data: Mapped[bytes | None] = deferred(mapped_column(LargeBinary, nullable=True))
    decided_by: Mapped[str] = mapped_column(String(128), default="", server_default="")
    decided_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decision_note: Mapped[str] = mapped_column(String(255), default="", server_default="")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
