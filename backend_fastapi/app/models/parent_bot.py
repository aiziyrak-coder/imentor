"""Ota-onalar Telegram boti (2026-10-22).

Ota-ona botga kiradi, farzandini fakultet → kurs → guruh → ro'yxatdan tanlaydi
va tug'ilgan sanasi bilan tasdiqlaydi. Shundan keyin farzandining har bir test
natijasi (kun, para, fan, mavzu, ball) o'zi keladi, kechqurun kunlik hisobot.

* `ParentBotChat` — bitta Telegram suhbati (ota-ona): til, holat, sozlamalar.
* `ParentBotLink` — suhbat ↔ talaba (bir ota-onada bir nechta farzand bo'lishi mumkin).
* `ParentBotNotice` — yuborilgan xabarlar jurnali: bir natija ikki marta ketmasin
  (bir nechta ishchi jarayon bir vaqtda yuborishga urinsa ham, unique kalit bitta qoldiradi).
* `ParentBotVerifyFail` — talaba bo'yicha kunlik noto'g'ri tasdiqlashlar (barcha suhbatlar
  yig'indisi): bir nechta Telegram hisob ochib sanani terib chiqib bo'lmasin (2026-10-23).
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy import BigInteger, Boolean, Date, DateTime, Integer, SmallInteger, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class ParentBotChat(Base):
    __tablename__ = "core_parentbotchat"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    chat_id: Mapped[int] = mapped_column(BigInteger, unique=True, index=True)
    tg_username: Mapped[str] = mapped_column(String(64), default="", server_default="")
    tg_name: Mapped[str] = mapped_column(String(255), default="", server_default="")
    language: Mapped[str] = mapped_column(String(4), default="", server_default="")
    #: Suhbat qayerda turibdi: "" (menyu), "verify" (tug'ilgan sana kutilmoqda).
    state: Mapped[str] = mapped_column(String(32), default="", server_default="")
    #: Tanlov jarayonidagi ro'yxatlar (tugmalarda faqat tartib raqami yuradi).
    state_data: Mapped[dict] = mapped_column(JSONB, default=dict)
    daily_summary: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    #: Foydalanuvchi botni bloklagan — xabar yuborilmaydi (/start bosganda qaytadi).
    is_blocked: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    failed_checks: Mapped[int] = mapped_column(SmallInteger, default=0, server_default="0")
    failed_day: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    last_update_id: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(),
                                                    onupdate=func.now())


class ParentBotLink(Base):
    __tablename__ = "core_parentbotlink"
    __table_args__ = (UniqueConstraint("chat_id", "student_id", name="uq_parentbotlink_chat_student"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    chat_id: Mapped[int] = mapped_column(BigInteger, index=True)
    student_id: Mapped[str] = mapped_column(String(64), index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ParentBotNotice(Base):
    __tablename__ = "core_parentbotnotice"
    __table_args__ = (UniqueConstraint("chat_id", "kind", "ref", name="uq_parentbotnotice_chat_kind_ref"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    chat_id: Mapped[int] = mapped_column(BigInteger, index=True)
    #: "test" — bitta test natijasi (ref = urinish id), "daily" — kunlik hisobot (ref = "sana:talaba").
    kind: Mapped[str] = mapped_column(String(16))
    ref: Mapped[str] = mapped_column(String(96))
    #: claimed → sent | failed | skipped
    status: Mapped[str] = mapped_column(String(16), default="claimed", server_default="claimed")
    tries: Mapped[int] = mapped_column(SmallInteger, default=1, server_default="1")
    error: Mapped[str] = mapped_column(Text, default="", server_default="")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    sent_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ParentBotVerifyFail(Base):
    __tablename__ = "core_parentbotverifyfail"
    __table_args__ = (UniqueConstraint("student_id", "day", name="uq_parentbotverifyfail_student_day"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[str] = mapped_column(String(64))
    day: Mapped[dt.date] = mapped_column(Date)
    fails: Mapped[int] = mapped_column(SmallInteger, default=0, server_default="0")
