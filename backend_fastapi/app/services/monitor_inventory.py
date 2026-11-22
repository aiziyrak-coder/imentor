"""Monitorli xonalar inventari — bazadan (2026-11-16), admin panelda tahrirlanadi.

`monitor_schedule_service.monitors()` va `inventory()` shu yerdan o'qiydi. Jadval bo'sh yoki baza
yetib bo'lmasa — eski `interactive_boards.json` (dastur ishlashdan to'xtamasin).

Jarayon keshi 60 soniya; admin o'zgartirsa shu jarayonda darhol tozalanadi, qolgan ishchi jarayonlar
bir daqiqa ichida yangisini oladi.
"""

from __future__ import annotations

import datetime as dt
import logging
import re
import threading
import time
from typing import Any

from sqlalchemy import select

logger = logging.getLogger(__name__)

CACHE_SECONDS = 60
_lock = threading.Lock()
_cache: dict[str, Any] = {"at": 0.0, "value": None}


def _clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").replace("\n", " ")).strip()


def clear() -> None:
    with _lock:
        _cache["at"] = 0.0
        _cache["value"] = None


def load(force: bool = False) -> dict | None:
    """{departments: [{id,row,name,aliases,group_rooms,rooms:[{...}]}]} yoki None (bazada yo'q)."""
    now = time.monotonic()
    with _lock:
        if not force and _cache["value"] is not None and now - _cache["at"] < CACHE_SECONDS:
            return _cache["value"]
    try:
        from app.core.db import SessionLocal
        from app.models.monitor_room import MonitorDepartment, MonitorRoom

        with SessionLocal() as db:
            deps = db.execute(select(MonitorDepartment).order_by(MonitorDepartment.row, MonitorDepartment.id)).scalars().all()
            rooms = db.execute(select(MonitorRoom).order_by(MonitorRoom.sort, MonitorRoom.id)).scalars().all()
            if not deps:
                value = None
            else:
                by_dep: dict[int, list[dict]] = {}
                for r in rooms:
                    by_dep.setdefault(r.department_id, []).append({
                        "id": r.id, "monitor_id": r.monitor_id, "room_full": _clean(r.room_full),
                        "hemis_codes": [str(c) for c in (r.hemis_codes or [])],
                        "active_from": r.active_from, "active_to": r.active_to, "note": r.note or "",
                    })
                value = {"departments": [{
                    "id": d.id, "row": d.row, "name": _clean(d.name),
                    "aliases": [_clean(a) for a in (d.aliases or []) if _clean(a)],
                    "group_rooms": d.group_rooms or [],
                    "rooms": by_dep.get(d.id, []),
                } for d in deps]}
    except Exception:  # noqa: BLE001 — jadval hali yo'q (migratsiyadan oldin) yoki baza yetib bo'lmadi
        logger.debug("monitor inventari bazadan o'qilmadi", exc_info=True)
        value = None
    with _lock:
        _cache["value"] = value
        _cache["at"] = time.monotonic()
    return value


def active_on(room: dict, day: dt.date | None) -> bool:
    """Monitor shu kuni xonada bo'lganmi (sana berilmasa — bugun)."""
    day = day or dt.datetime.now(dt.timezone(dt.timedelta(hours=5))).date()  # Toshkent kuni (konteyner UTC)
    start, end = room.get("active_from"), room.get("active_to")
    return (start is None or start <= day) and (end is None or day <= end)
