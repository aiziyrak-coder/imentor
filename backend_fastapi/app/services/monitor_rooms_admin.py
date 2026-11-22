"""Admin panel «Monitorli xonalar» (2026-11-16): kafedralar × monitorli xonalar jadvali.

Admin xona qo'shadi (HEMIS xonalari ro'yxatidan tanlab), nomini o'zgartiradi, HEMIS xonasini
bog'laydi yoki monitorni olib tashlaydi. Har o'zgarishdan keyin HEMIS darslari qayta solishtiriladi
(o'tgan haftadan keyingi haftagacha, cron bilan bir xil oraliq) — rektor hisoboti shu darslardan.

Monitor ID hech qachon qayta ishlatilmaydi va o'zgarmaydi. Olib tashlash — o'chirish emas:
`active_to` qo'yiladi, o'tgan darslar hisoboti buzilmaydi.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import re
import threading
import time

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.hemis_lesson import HemisLesson
from app.models.monitor_room import MonitorDepartment, MonitorRoom
from app.services import hemis_schedule as hs
from app.services import monitor_inventory

logger = logging.getLogger(__name__)

HEMIS_ROOMS_KEY = "rx:hemisauditoriums:v2"
HEMIS_ROOMS_TTL = 6 * 3600


def _clean(value) -> str:
    return re.sub(r"\s+", " ", str(value or "").replace("\n", " ")).strip()


def _today() -> dt.date:
    from app.services.lesson_report_service import current_time

    return current_time().date()


# ------------------------------------------------------------------ HEMIS xonalari
def hemis_rooms(*, force: bool = False) -> list[dict]:
    """HEMIS auditoriyalari: [{code, name, building, building_key}] — Redis'da 6 soat (faqat o'qish)."""
    try:
        from app.services.ai_response_cache import _redis

        if not force:
            raw = _redis().get(HEMIS_ROOMS_KEY)
            if raw:
                return json.loads(raw)
    except Exception:  # noqa: BLE001
        pass
    from app.services import hemis_client

    out = []
    for a in hemis_client.auditoriums():
        building = _clean((a.get("building") or {}).get("name"))
        out.append({
            "code": str(a.get("code") or ""),
            "name": _clean(a.get("name")),
            "building": building,
            "building_key": hs.BUILDINGS.get(hs._norm(building), ""),
            "active": bool(a.get("active", True)),
            "type": _clean((a.get("auditoriumType") or {}).get("name")),
            "volume": int(a.get("volume") or 0),
        })
    out = [r for r in out if r["code"]]
    out.sort(key=lambda r: (r["building"], r["name"]))
    try:
        from app.services.ai_response_cache import _redis

        _redis().set(HEMIS_ROOMS_KEY, json.dumps(out, ensure_ascii=False), ex=HEMIS_ROOMS_TTL)
    except Exception:  # noqa: BLE001
        pass
    return out


def match_codes(room_full: str, rooms: list[dict]) -> list[str]:
    """Xona nomidan HEMIS kodlari (bino + xona raqami/harfi bo'yicha) — `room_map` qoidasi bilan bir xil.

    Faqat FAOL HEMIS yozuvlari (nofaol nusxalarni `room_map` o'zi qo'shadi); faoli bo'lmasa — nofaollari.
    """
    building = hs._inventory_building(room_full)
    letter, number = hs._room_key(room_full)
    if not building or not number:
        return []
    found = [r for r in rooms if r["building_key"] == building and hs._room_key(r["name"]) == (letter, number)]
    active = [r["code"] for r in found if r.get("active", True)]
    return active or [r["code"] for r in found]


# ------------------------------------------------------------------ ko'rinish
def snapshot(db: Session, *, with_hemis: bool = True) -> dict:
    today = _today()
    monday = today - dt.timedelta(days=today.weekday())
    rooms_h: list[dict] = []
    hemis_error = ""
    if with_hemis:
        try:
            rooms_h = hemis_rooms()
        except Exception as exc:  # noqa: BLE001 — HEMIS javob bermasa ham sahifa ochilsin
            logger.warning("HEMIS xonalari olinmadi: %s", exc)
            hemis_error = "HEMIS xonalar ro'yxatini bermadi — keyinroq qayta urinib ko'ring."
    by_code = {r["code"]: r for r in rooms_h}
    week = dict(db.execute(
        select(HemisLesson.monitor_id, func.count())
        .where(HemisLesson.lesson_date >= monday, HemisLesson.lesson_date < monday + dt.timedelta(days=7),
               HemisLesson.monitor_id != "")
        .group_by(HemisLesson.monitor_id)
    ).all())
    # Nazoratdagi darslar (klinik fan, amaliy mashg'ulot) — o'tgan va shu hafta (2026-11-16).
    scope: dict[str, dict] = {}
    try:
        from app.services.subject_scope_admin import room_scope

        scope = room_scope(db, monday - dt.timedelta(days=7), monday + dt.timedelta(days=6))
    except Exception:  # noqa: BLE001 — sahifa baribir ochilsin
        logger.warning("room scope failed", exc_info=True)
    from app.services.clinical_subjects import department_is_clinical

    deps = db.execute(select(MonitorDepartment).order_by(MonitorDepartment.row, MonitorDepartment.id)).scalars().all()
    rooms = db.execute(select(MonitorRoom).order_by(MonitorRoom.sort, MonitorRoom.id)).scalars().all()
    by_dep: dict[int, list[dict]] = {}
    for r in rooms:
        explicit = [str(c) for c in (r.hemis_codes or [])]
        codes = explicit or (match_codes(r.room_full, rooms_h) if rooms_h else [])
        active = monitor_inventory.active_on({"active_from": r.active_from, "active_to": r.active_to}, today)
        by_dep.setdefault(r.department_id, []).append({
            "id": r.id, "monitor_id": r.monitor_id, "room_full": r.room_full,
            "hemis_codes": codes, "hemis_explicit": bool(explicit),
            "hemis": [{"code": c, "name": by_code[c]["name"], "building": by_code[c]["building"]}
                      for c in codes if c in by_code and (by_code[c].get("active", True) or not any(
                          by_code.get(x, {}).get("active", True) for x in codes if x in by_code))],
            "active": active,
            "active_from": r.active_from.isoformat() if r.active_from else None,
            "active_to": r.active_to.isoformat() if r.active_to else None,
            "lessons_week": int(week.get(r.monitor_id, 0)),
            "scope_lessons": (scope.get(r.monitor_id) or {}).get("lessons", 0),
            "scope_teachers": (scope.get(r.monitor_id) or {}).get("teachers", 0),
            "scope_subjects": (scope.get(r.monitor_id) or {}).get("subjects", []),
            "note": r.note or "",
        })
    return {
        "departments": [{"id": d.id, "row": d.row, "name": d.name, "clinical": department_is_clinical(d.name),
                         "rooms": by_dep.get(d.id, [])} for d in deps],
        "scope_from": (monday - dt.timedelta(days=7)).isoformat(),
        "scope_to": (monday + dt.timedelta(days=6)).isoformat(),
        "hemis_rooms_count": len(rooms_h),
        "hemis_error": hemis_error,
        "sync": dict(_sync_state),
        "today": today.isoformat(),
    }


# ------------------------------------------------------------------ o'zgartirish
def _next_monitor_id(db: Session) -> str:
    nums = [int(m) for m in (re.sub(r"\D", "", x or "") for x in db.execute(select(MonitorRoom.monitor_id)).scalars()) if m]
    return f"MON-{(max(nums) if nums else 0) + 1:03d}"


def _changed(db: Session) -> None:
    db.commit()
    monitor_inventory.clear()
    schedule_resync()


def add_department(db: Session, name: str) -> MonitorDepartment:
    name = _clean(name)
    if len(name) < 3:
        raise ValueError("Kafedra nomini yozing.")
    exists = db.execute(select(MonitorDepartment).where(func.lower(MonitorDepartment.name) == name.lower())).scalar_one_or_none()
    if exists:
        raise ValueError("Bu kafedra jadvalda bor.")
    row = (db.execute(select(func.max(MonitorDepartment.row))).scalar() or 0) + 1
    dep = MonitorDepartment(row=row, name=name, aliases=[], group_rooms=[])
    db.add(dep)
    db.commit()
    monitor_inventory.clear()
    return dep


def rename_department(db: Session, dep_id: int, name: str) -> None:
    dep = db.get(MonitorDepartment, dep_id)
    if dep is None:
        raise LookupError("Kafedra topilmadi.")
    name = _clean(name)
    if len(name) < 3:
        raise ValueError("Kafedra nomini yozing.")
    if dep.name != name:
        # Eski nom HEMIS'dagi yozilishiga mos bo'lishi mumkin — taxallus sifatida qoladi.
        dep.aliases = list(dict.fromkeys([*(dep.aliases or []), dep.name]))
        dep.name = name
        dep.updated_at = dt.datetime.now(dt.timezone.utc)
        _changed(db)


def add_room(db: Session, dep_id: int, *, room_full: str = "", hemis_codes: list[str] | None = None, by: str = "") -> MonitorRoom:
    dep = db.get(MonitorDepartment, dep_id)
    if dep is None:
        raise LookupError("Kafedra topilmadi.")
    codes = [str(c) for c in (hemis_codes or []) if str(c)]
    if not room_full and codes:
        names = {r["code"]: r for r in hemis_rooms()}
        first = names.get(codes[0])
        room_full = f"{first['name']} ({first['building']})" if first else ""
    room_full = _clean(room_full)
    if not room_full:
        raise ValueError("Xonani tanlang yoki nomini yozing.")
    sort = (db.execute(select(func.max(MonitorRoom.sort)).where(MonitorRoom.department_id == dep_id)).scalar() or 0) + 1
    room = MonitorRoom(monitor_id=_next_monitor_id(db), department_id=dep_id, room_full=room_full[:255],
                       hemis_codes=codes, sort=sort, active_from=_today(), updated_by=by[:128])
    db.add(room)
    _changed(db)
    return room


def update_room(db: Session, room_id: int, *, room_full: str | None = None, hemis_codes: list[str] | None = None,
                note: str | None = None, by: str = "") -> MonitorRoom:
    room = db.get(MonitorRoom, room_id)
    if room is None:
        raise LookupError("Xona topilmadi.")
    if room_full is not None:
        text = _clean(room_full)
        if not text:
            raise ValueError("Xona nomi bo'sh bo'lmasin.")
        room.room_full = text[:255]
    if hemis_codes is not None:
        room.hemis_codes = [str(c) for c in hemis_codes if str(c)]
    if note is not None:
        room.note = _clean(note)[:255]
    room.updated_by = by[:128]
    room.updated_at = dt.datetime.now(dt.timezone.utc)
    _changed(db)
    return room


def remove_room(db: Session, room_id: int, *, by: str = "") -> MonitorRoom:
    """Monitor olib tashlandi: bugundan boshlab hisobga kirmaydi; o'tgan darslar o'zgarmaydi."""
    room = db.get(MonitorRoom, room_id)
    if room is None:
        raise LookupError("Xona topilmadi.")
    today = _today()
    room.active_to = today - dt.timedelta(days=1)
    if room.active_from and room.active_from > room.active_to:
        room.active_from = room.active_to  # bugun xato qo'shilgan — umuman hisoblanmaydi
        room.active_to = room.active_from - dt.timedelta(days=1)
    room.updated_by = by[:128]
    room.updated_at = dt.datetime.now(dt.timezone.utc)
    _changed(db)
    return room


def restore_room(db: Session, room_id: int, *, by: str = "") -> MonitorRoom:
    room = db.get(MonitorRoom, room_id)
    if room is None:
        raise LookupError("Xona topilmadi.")
    room.active_to = None
    if room.active_from is None or room.active_from > _today():
        room.active_from = _today()
    room.updated_by = by[:128]
    room.updated_at = dt.datetime.now(dt.timezone.utc)
    _changed(db)
    return room


# ------------------------------------------------------------------ HEMIS bilan qayta solishtirish
_sync_state: dict = {"running": False, "started": None, "finished": None, "result": None, "error": ""}
_sync_lock = threading.Lock()
_pending = {"at": 0.0}
RESYNC_DELAY = 20  # soniya: ketma-ket bir nechta o'zgarish bitta solishtirishga yig'iladi


def schedule_resync() -> None:
    """Oxirgi o'zgarishdan 20 soniya keyin HEMIS darslari qayta solishtiriladi (fon ipi)."""
    _pending["at"] = time.monotonic()

    def run() -> None:
        time.sleep(RESYNC_DELAY)
        if time.monotonic() - _pending["at"] < RESYNC_DELAY - 1:
            return  # yana o'zgarish bo'ldi — keyingi ip bajaradi
        resync_now()

    threading.Thread(target=run, name="monitor-rooms-resync", daemon=True).start()


def resync_now() -> dict:
    if not _sync_lock.acquire(blocking=False):
        return dict(_sync_state)
    try:
        _sync_state.update(running=True, started=dt.datetime.now(dt.timezone.utc).isoformat(), error="")
        from app.core.db import SessionLocal

        today = _today()
        monday = today - dt.timedelta(days=today.weekday())
        start, end = monday - dt.timedelta(weeks=1), monday + dt.timedelta(days=13)
        with SessionLocal() as db:
            stats = hs.sync_lessons(db, start=start, end=end)
            db.commit()
        try:
            from app.services import control_report_service

            control_report_service.clear_cache()
        except Exception:  # noqa: BLE001
            pass
        _sync_state.update(result={"monitorli": stats.get("monitorli"), "oraliq": f"{start}…{end}",
                                   "yangilandi": stats.get("yangilandi")})
    except Exception as exc:  # noqa: BLE001
        logger.warning("monitor xonalari: HEMIS bilan solishtirish o'tmadi", exc_info=True)
        _sync_state["error"] = str(exc)[:200]
    finally:
        _sync_state.update(running=False, finished=dt.datetime.now(dt.timezone.utc).isoformat())
        _sync_lock.release()
    return dict(_sync_state)
