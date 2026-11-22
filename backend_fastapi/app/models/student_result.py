"""Talabalar natijalari arxivi (2026-10-23, rektor talabi).

"Qaysi talaba qaysi mavzudan qaysi sanada necha baho olgan — doimiy saqlansin,
bilimi o'syaptimi, pasayaptimi — fan bo'yicha yig'ilib borsin."

Har bir YAKUNLANGAN test natijasi bu yerga bir marta, o'sha paytdagi holati bilan
yoziladi (guruh, fan, kafedra, para, o'qituvchi). Jadval jonli test sessiyasiga
FK bilan bog'lanmagan: sessiya yoki urinish o'chirilsa ham natija qoladi. Hech
qanday kod bu jadvaldan o'chirmaydi.
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy import Boolean, Date, DateTime, Integer, SmallInteger, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class StudentResult(Base):
    __tablename__ = "core_studentresult"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    #: Manba urinish (core_studenttestattempt.id) — takror yozilmasligi uchun, FK emas.
    attempt_id: Mapped[int] = mapped_column(Integer, unique=True, index=True)
    session_id: Mapped[int] = mapped_column(Integer, default=0)
    student_id: Mapped[str] = mapped_column(String(64), index=True)
    student_name: Mapped[str] = mapped_column(String(255), default="", server_default="")
    group_name: Mapped[str] = mapped_column(String(128), default="", server_default="", index=True)
    faculty_name: Mapped[str] = mapped_column(String(255), default="", server_default="")
    course: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    lesson_date: Mapped[dt.date] = mapped_column(Date, index=True)
    submitted_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    para: Mapped[str] = mapped_column(String(16), default="", server_default="")
    subject_code: Mapped[str] = mapped_column(String(200), default="", server_default="")
    subject_name: Mapped[str] = mapped_column(String(255), default="", server_default="")
    #: Rasmiy kafedra (dars jadvalidan) — kafedra bo'yicha saralash uchun.
    department: Mapped[str] = mapped_column(String(255), default="", server_default="")
    teacher_username: Mapped[str] = mapped_column(String(128), default="", server_default="")
    teacher_name: Mapped[str] = mapped_column(String(255), default="", server_default="")
    topic: Mapped[str] = mapped_column(Text, default="", server_default="")
    topic_code: Mapped[str] = mapped_column(String(64), default="", server_default="")
    score: Mapped[int] = mapped_column(Integer, default=0)
    total: Mapped[int] = mapped_column(Integer, default=0)
    percent: Mapped[int] = mapped_column(SmallInteger, default=0)
    grade: Mapped[int] = mapped_column(SmallInteger, default=2)
    duration_sec: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    #: O'qituvchilar nazoratida hisobga olinadigan dars (monitorli xona, sanaladigan tur,
    #: hisobotdan chiqarilmagan kafedra) ichida topshirilganmi.
    in_scope: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", index=True)
    archived_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
