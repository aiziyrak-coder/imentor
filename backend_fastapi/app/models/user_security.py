"""Hisob xavfsizligi sozlamalari (2026-11-17 auditi, G8 + D2).

* `tokens_valid_after` — shu vaqtdan OLDIN berilgan barcha tokenlar (access ham, refresh ham) bekor.
  Parol almashtirilganda, admin parolni tiklaganda, "barcha qurilmalardan chiqish" va admin
  "sessiyalarni yopish" bosganda qo'yiladi. Ilgari token 14 kungacha (refresh zanjiri bilan
  cheksiz) yashardi va uni hech qanday yo'l bilan to'xtatib bo'lmasdi.
* `password_only` — o'qituvchi o'zi yoqadi: hisobiga Xodim ID / JSHSHIR / pasport bilan PAROLSIZ
  kirib bo'lmaydi, faqat parol (yoki yuz) bilan. Xodim ID'lar ketma-ket va taxmin qilinadigan.

`auth_user` ga ustun qo'shilmaydi — `password_policy` dagi kabi alohida jadval. Qator yo'q =
odatiy holat (hech narsa bekor qilinmagan, parolsiz kirish ochiq).
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy import Boolean, DateTime, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class UserSecurity(Base):
    __tablename__ = "core_usersecurity"

    user_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tokens_valid_after: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    password_only: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
