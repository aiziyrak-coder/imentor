"""Nazoratdagi fanlar — admin qarori: fan KLINIKmi (2026-11-16).

Rektor hisoboti faqat klinik fanlarning amaliy mashg'ulotlarini nazorat qiladi. Fan klinikmi degan
savolga avtomatik qoida javob beradi (`clinical_subjects.auto_verdict`); admin «Monitorli xonalar»
sahifasidagi «Nazoratdagi fanlar» ro'yxatida uni har bir fan uchun o'zgartira oladi. Bu jadvalda
faqat admin O'ZGARTIRGAN fanlar turadi — qolganlari avtomatik qoidada.
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy import Boolean, DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class SubjectScope(Base):
    __tablename__ = "core_subjectscope"

    # `clinical_subjects.norm_subject` — harf/apostrof farqisiz fan nomi.
    subject_key: Mapped[str] = mapped_column(String(300), primary_key=True)
    subject_name: Mapped[str] = mapped_column(String(300), default="")
    clinical: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_by: Mapped[str] = mapped_column(String(150), default="")
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(),
                                                    onupdate=func.now())
