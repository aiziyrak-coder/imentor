"""Monitorli xonalar — admin paneldan tahrirlanadigan inventar (2026-11-16).

Ilgari ro'yxat `app/data/interactive_boards.json` faylida edi va faqat dasturchi o'zgartira olardi;
monitor ID ketma-ket raqam bo'lgani uchun xona qo'shish keyingi hamma ID'ni siljitardi. Endi:
  * har xonaning `monitor_id` si ANIQ saqlanadi va hech qachon o'zgarmaydi;
  * `hemis_codes` — admin tanlagan HEMIS auditoriya kodlari (bo'sh bo'lsa nom bo'yicha topiladi);
  * `active_from` / `active_to` — monitor qachondan qachongacha turgan. Yangi qo'yilgan monitor
    o'tgan darslarni «monitorli, o'tilmagan» qilib qo'ymasin; olib tashlangani esa o'tgan hisobotni buzmasin.
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class MonitorDepartment(Base):
    __tablename__ = "core_monitordepartment"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    row: Mapped[int] = mapped_column(Integer, default=0)
    name: Mapped[str] = mapped_column(String(255))
    aliases: Mapped[list] = mapped_column(JSONB, default=list)
    # Kafedra so'rovi bilan guruhni xonaga biriktirish (JSON'dagi `group_rooms`, o'zgarmagan).
    group_rooms: Mapped[list] = mapped_column(JSONB, default=list)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class MonitorRoom(Base):
    __tablename__ = "core_monitorroom"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    monitor_id: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    department_id: Mapped[int] = mapped_column(ForeignKey("core_monitordepartment.id", ondelete="CASCADE"), index=True)
    room_full: Mapped[str] = mapped_column(String(255))
    hemis_codes: Mapped[list] = mapped_column(JSONB, default=list)
    sort: Mapped[int] = mapped_column(Integer, default=0)
    active_from: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    active_to: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    note: Mapped[str] = mapped_column(String(255), default="", server_default="")
    updated_by: Mapped[str] = mapped_column(String(128), default="", server_default="")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class MonitorRoomLog(Base):
    """Monitorli xonalardagi har o'zgarish — kim, qachon, qaysi xonada nima qildi (2026-11-16).

    Sahifadagi «Tarix» shu jadvaldan; har yozuvni qaytarish mumkin.
    """

    __tablename__ = "core_monitorroomlog"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    by: Mapped[str] = mapped_column(String(128), default="")
    # on | off | relink | dedupe | undo
    action: Mapped[str] = mapped_column(String(16))
    monitor_id: Mapped[str] = mapped_column(String(16), default="")
    hemis_code: Mapped[str] = mapped_column(String(32), default="")
    room: Mapped[str] = mapped_column(String(255), default="")
    detail: Mapped[str] = mapped_column(String(255), default="")
    undone: Mapped[bool] = mapped_column(Boolean, default=False)
