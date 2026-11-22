"""Darsni sababli boshqa joyda o'tish qaydi (2026-11-12).

O'qituvchi darsni monitorli xonada emas, boshqa joyda (klinik baza, bemor yonida, boshqa xona…)
o'tsa, dars vaqtida telefondan "Boshqa joyda dars o'tyapman" tugmasini bosadi: sabab, izoh, shu
zahoti olingan rasm va joylashuv. Qayd TASDIQSIZ kuchga kiradi (foydalanuvchi qarori): bu dars
rektor hisobotida qizil bo'lmaydi, admin «Boshqa joyda darslar» hisobotida ko'radi.

Rasm `/media` da EMAS (ochiq xizmat qilinadi) — shu jadvalda, faqat egasi va admin ko'radi.
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy import Date, DateTime, Float, Index, Integer, LargeBinary, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, deferred, mapped_column

from app.core.db import Base


class OffsiteLesson(Base):
    __tablename__ = "core_offsitelesson"
    __table_args__ = (
        UniqueConstraint("owner_key", "lesson_id", name="uq_core_offsitelesson_owner_lesson"),
        Index("ix_core_offsitelesson_date", "lesson_date"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_key: Mapped[str] = mapped_column(String(128), index=True)
    #: `core_hemislesson.id` — qaysi dars (hisobot shu orqali bog'lanadi).
    lesson_id: Mapped[int] = mapped_column(Integer, index=True)
    lesson_date: Mapped[dt.date] = mapped_column(Date)
    para: Mapped[str] = mapped_column(String(16), default="", server_default="")
    start_time: Mapped[str] = mapped_column(String(8), default="", server_default="")
    end_time: Mapped[str] = mapped_column(String(8), default="", server_default="")
    subject_name: Mapped[str] = mapped_column(String(255), default="", server_default="")
    group_name: Mapped[str] = mapped_column(String(128), default="", server_default="")
    #: Jadvaldagi xona (HEMIS) — "qayerda bo'lishi kerak edi".
    scheduled_room: Mapped[str] = mapped_column(String(255), default="", server_default="")
    reason: Mapped[str] = mapped_column(String(16), default="boshqa", server_default="boshqa")
    note: Mapped[str] = mapped_column(String(500), default="", server_default="")
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lon: Mapped[float | None] = mapped_column(Float, nullable=True)
    accuracy_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    photo_type: Mapped[str] = mapped_column(String(64), default="", server_default="")
    photo_size: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    photo_data: Mapped[bytes | None] = deferred(mapped_column(LargeBinary, nullable=True))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
