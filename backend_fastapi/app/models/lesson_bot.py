"""Dars nazorati Telegram boti (2026-11-15).

Bot dekanlar va mas'ullar guruhiga yozadi: dars boshlanganidan 10 va 15 daqiqa o'tib iMentor'ga
kirmagan o'qituvchilar ro'yxati (kirganlar ✅ bo'lib xabar o'zi yangilanadi), kun oxirida hisobot.

* `LessonBotPost` — yuborilgan har bir xabar: kun + turi + slot bo'yicha YAGONA (bir xabar ikki marta
  ketmaydi, server qayta ishga tushsa ham xabar tahrirlanishda davom etadi). `state` — xabardagi
  o'qituvchilar va ularning holati.
* `LessonBotSetting` — kalit/qiymat: guruh chat_id (bot o'zi aniqlaydi), getUpdates offseti.
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy import BigInteger, Date, DateTime, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class LessonBotPost(Base):
    __tablename__ = "core_lessonbotpost"
    __table_args__ = (UniqueConstraint("day", "kind", "slot", name="uq_lessonbotpost_day_kind_slot"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    day: Mapped[dt.date] = mapped_column(Date, index=True)
    #: "alert10", "alert15", "daily".
    kind: Mapped[str] = mapped_column(String(16))
    #: Para boshlanish vaqti "08:00" (kunlik hisobotda "").
    slot: Mapped[str] = mapped_column(String(8), default="", server_default="")
    chat_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    message_ids: Mapped[list] = mapped_column(JSONB, default=list)
    state: Mapped[dict] = mapped_column(JSONB, default=dict)
    text_hash: Mapped[str] = mapped_column(String(64), default="", server_default="")
    #: "sent", "empty" (hamma kirgan — xabar shart emas), "failed".
    status: Mapped[str] = mapped_column(String(16), default="sent", server_default="sent")
    error: Mapped[str] = mapped_column(Text, default="", server_default="")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(),
                                                    onupdate=func.now())


class LessonBotSetting(Base):
    __tablename__ = "core_lessonbotsetting"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="", server_default="")
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(),
                                                    onupdate=func.now())
