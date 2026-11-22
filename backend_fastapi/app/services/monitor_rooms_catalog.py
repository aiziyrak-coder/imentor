"""«Monitorli xonalar» — HEMIS'dagi HAMMA faol xonalar, monitor bor-yo'qligi qo'lda belgilanadi (2026-11-16).

Foydalanuvchi: "bu joyda hamma xonalar bo'lsin — HEMIS'dagi barcha aktiv xonalar, barcha binolardagi,
monitor bor yo'qligini biz qo'lda belgilab chiqaylik"; keyin: "uzun ro'yxat emas, tushunarli; konfliktlar
ko'p bo'ladi — har tomonlama o'ylashimiz kerak".

Qoidalar (ziddiyat chiqmasligi uchun):
  * bitta FAOL HEMIS xonasi — ko'pi bilan BITTA faol monitor. Yoqishda xonada monitor bo'lsa — yangi
    yozuv yaratilmaydi; boshqa monitorni shu xonaga ko'chirishda ham shu tekshiriladi;
  * HEMIS bitta xonani bir necha yozuvda saqlaydi (faqat bittasi faol) — nofaol yozuvdagi darslar va
    nofaol kodga bog'langan eski monitorlar FAOL yozuvga keltiriladi (`canonical_codes`);
  * o'chirish — o'chirish emas: `active_to` qo'yiladi, o'tgan hisobot buzilmaydi; qayta yoqilsa o'sha
    MON ID qaytadi;
  * o'zgarishlar sahifada «Tahrirlash» rejimida yig'iladi va BIR tasdiq bilan saqlanadi (`apply_changes`),
    har biri tarixga yoziladi (`core_monitorroomlog`) va qaytarilishi mumkin (`undo`);
  * qolgan ziddiyatlar «Muammolar»da: bitta xonada bir necha monitor, HEMIS'da faol xonasi yo'q monitor,
    bir necha xonaga bog'langan monitor — har biri uchun tuzatish tugmasi.
"""

from __future__ import annotations

import datetime as dt
import logging
import re
from collections import Counter, defaultdict

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.hemis_lesson import HemisLesson
from app.models.monitor_room import MonitorDepartment, MonitorRoom, MonitorRoomLog
from app.services import hemis_schedule as hs
from app.services import monitor_inventory
from app.services import monitor_rooms_admin as admin

logger = logging.getLogger(__name__)

UNASSIGNED = "Kafedraga biriktirilmagan"
HISTORY_LIMIT = 80


# ------------------------------------------------------------------ yordamchilar
def _key(room: dict) -> tuple | None:
    letter, number = hs._room_key(room.get("name") or "")
    if not number:
        return None
    return (room.get("building_key") or hs._norm(room.get("building") or ""), letter, number)


def canonical_codes(rooms: list[dict]) -> dict[str, str]:
    """HEMIS kodi -> shu xonaning FAOL yozuvi kodi (faol kod o'ziga)."""
    active_by_key: dict[tuple, str] = {}
    for r in rooms:
        k = _key(r)
        if r.get("active", True) and k and k not in active_by_key:
            active_by_key[k] = r["code"]
    out: dict[str, str] = {}
    for r in rooms:
        if r.get("active", True):
            out[r["code"]] = r["code"]
        else:
            k = _key(r)
            if k and k in active_by_key:
                out[r["code"]] = active_by_key[k]
    return out


def room_label(name: str) -> str:
    """Plitkadagi nom — HEMIS nomi o'zi (bo'sh joylarsiz). HEMIS nomlari tartibsiz ("106-xona",
    "3 q/1", "E - 2 qavat 2 xona"), shuning uchun raqamga qisqartirilmaydi: aks holda bir xil
    ko'rinadigan plitkalar chiqardi."""
    return " ".join((name or "").split())


_FLOOR_WORD = re.compile(r"(?<!\d)(\d{1,2})\s*-?\s*(?:qavat|etaj|этаж|q\s*/|q\b)", re.I)
_THREE_DIGITS = re.compile(r"(?<![\d/])(\d{3})(?![\d/])")


def room_floor(name: str) -> str:
    """Qavat: nomida "qavat/etaj/q" bo'lsa — o'sha; aks holda uch xonali raqamning birinchi raqami
    (106-xona → 1-qavat). Aniqlab bo'lmasa bo'sh."""
    text = name or ""
    m = _FLOOR_WORD.search(text)
    if m:
        return f"{int(m.group(1))}-qavat"
    m = _THREE_DIGITS.search(text)
    if m:
        return f"{int(m.group(1)) // 100}-qavat"
    return ""


def _codes(m: MonitorRoom, rooms_h: list[dict]) -> list[str]:
    """Monitorning HEMIS kodlari: admin tanlagani, bo'lmasa nom bo'yicha topilgani."""
    return [str(c) for c in (m.hemis_codes or []) if str(c)] or admin.match_codes(m.room_full, rooms_h)


def _active(m: MonitorRoom, today: dt.date) -> bool:
    return monitor_inventory.active_on({"active_from": m.active_from, "active_to": m.active_to}, today)


def _window() -> tuple[dt.date, dt.date]:
    today = admin._today()
    monday = today - dt.timedelta(days=today.weekday())
    return monday - dt.timedelta(days=7), monday + dt.timedelta(days=6)


def _log(db: Session, action: str, *, by: str, monitor_id: str = "", code: str = "", room: str = "", detail: str = "") -> None:
    db.add(MonitorRoomLog(action=action, by=(by or "")[:128], monitor_id=(monitor_id or "")[:16], hemis_code=(code or "")[:32],
                          room=(room or "")[:255], detail=(detail or "")[:255]))


def _usage(db: Session, canon: dict[str, str]) -> dict[str, dict]:
    """Har faol xona: o'tgan va shu haftadagi amaliy darslar, nazoratdagilari, fanlar, o'qituvchilar."""
    from app.services import lesson_report_service as lr

    start, end = _window()
    raw = [r for r in db.execute(
        select(HemisLesson).where(HemisLesson.lesson_date >= start, HemisLesson.lesson_date <= end)
    ).scalars() if r.hemis_status != "missing_from_hemis" and lr.counts_lesson_type(r.lesson_type)]
    out: dict[str, dict] = defaultdict(lambda: {"lessons": 0, "scope": 0, "departments": Counter(),
                                                "subjects": Counter(), "teachers": set()})
    for x in lr.merge_group_rows(raw):
        code = canon.get(str(x.auditorium_code or ""))
        if code:
            out[code]["lessons"] += 1
            out[code]["departments"][(x.department_name or "").strip()] += 1
    for x in lr._lessons(db, start, end, pending=True):
        code = canon.get(str(x.auditorium_code or ""))
        if code:
            o = out[code]
            o["scope"] += 1
            o["subjects"][x.subject_name] += 1
            o["teachers"].add(x.teacher_username or x.teacher_name)
    return out


def _monitor_info(m: MonitorRoom, dep_name: dict[int, str], lessons_total: dict[str, int]) -> dict:
    return {"id": m.id, "monitor_id": m.monitor_id, "room_full": m.room_full,
            "department": dep_name.get(m.department_id, ""),
            "active_from": m.active_from.isoformat() if m.active_from else None,
            "lessons_total": int(lessons_total.get(m.monitor_id, 0)), "note": m.note or ""}


# ------------------------------------------------------------------ ko'rinish
def catalog(db: Session) -> dict:
    """Hamma faol HEMIS xonalari + monitor holati + darslar + muammolar + tarix."""
    today = admin._today()
    rooms_h = admin.hemis_rooms()
    canon = canonical_codes(rooms_h)
    by_hcode = {r["code"]: r for r in rooms_h}
    dep_name = {d.id: d.name for d in db.execute(select(MonitorDepartment)).scalars()}
    lessons_total = dict(db.execute(
        select(HemisLesson.monitor_id, func.count()).where(HemisLesson.monitor_id != "").group_by(HemisLesson.monitor_id)
    ).all())
    monitors = [m for m in db.execute(select(MonitorRoom).order_by(MonitorRoom.id)).scalars() if _active(m, today)]
    by_code: dict[str, list[dict]] = defaultdict(list)
    unmatched, shared = [], []
    for m in monitors:
        actives = sorted({canon[c] for c in _codes(m, rooms_h) if c in canon})
        info = _monitor_info(m, dep_name, lessons_total)
        if not actives:
            unmatched.append(info)
        if len(actives) > 1:
            shared.append({**info, "rooms": [{"code": c, "name": by_hcode[c]["name"], "building": by_hcode[c]["building"]}
                                             for c in actives]})
        for c in actives:
            by_code[c].append(info)
    usage = _usage(db, canon)
    empty = {"lessons": 0, "scope": 0, "departments": Counter(), "subjects": Counter(), "teachers": set()}
    rows, duplicates = [], []
    for r in rooms_h:
        if not r.get("active", True):
            continue
        u = usage.get(r["code"]) or empty
        mons = by_code.get(r["code"]) or []
        rows.append({
            "code": r["code"], "name": r["name"], "label": room_label(r["name"]), "floor": room_floor(r["name"]),
            "building": r["building"], "building_key": r.get("building_key", ""),
            "type": r.get("type", ""), "volume": r.get("volume", 0),
            "monitor": mons[0] if mons else None,
            "conflict": len(mons) > 1,
            "lessons": u["lessons"], "scope_lessons": u["scope"], "scope_teachers": len(u["teachers"]),
            "subjects": [s for s, _ in u["subjects"].most_common(4)],
            "departments": [d for d, _ in u["departments"].most_common(3) if d],
        })
        if len(mons) > 1:
            duplicates.append({"code": r["code"], "name": r["name"], "building": r["building"], "monitors": mons})
    history = [{"id": h.id, "at": h.at.isoformat() if h.at else None, "by": h.by, "action": h.action,
                "monitor_id": h.monitor_id, "code": h.hemis_code, "room": h.room, "detail": h.detail, "undone": h.undone}
               for h in db.execute(select(MonitorRoomLog).order_by(MonitorRoomLog.id.desc()).limit(HISTORY_LIMIT)).scalars()]
    start, end = _window()
    return {
        "rooms": rows,
        "conflicts": {"duplicates": duplicates, "unmatched": unmatched, "shared": shared},
        "history": history,
        "window": {"from": start.isoformat(), "to": end.isoformat()},
        "sync": dict(admin._sync_state),
        "today": today.isoformat(),
    }


# ------------------------------------------------------------------ o'zgartirish
def _guess_department(db: Session, code: str, canon: dict[str, str]) -> int:
    """Xonada eng ko'p dars o'tadigan kafedra (monitor jadvalidagi qatori); topilmasa — «biriktirilmagan»."""
    from app.services.dean_access import official_of

    codes = [c for c, a in canon.items() if a == code] or [code]
    start, end = _window()
    top = db.execute(
        select(HemisLesson.department_name, func.count())
        .where(HemisLesson.auditorium_code.in_(codes), HemisLesson.lesson_date >= start - dt.timedelta(days=21),
               HemisLesson.lesson_date <= end)
        .group_by(HemisLesson.department_name).order_by(func.count().desc())
    ).all()
    deps = db.execute(select(MonitorDepartment)).scalars().all()
    for name, _n in top:
        want = official_of(name or "") or (name or "").strip()
        for d in deps:
            if want and want in {official_of(x) or x for x in [d.name, *(d.aliases or [])]}:
                return d.id
    found = next((d for d in deps if d.name == UNASSIGNED), None)
    if found is None:
        found = MonitorDepartment(row=(max([d.row for d in deps] or [0]) + 1), name=UNASSIGNED, aliases=[], group_rooms=[])
        db.add(found)
        db.flush()
    return found.id


def _room_monitors(db: Session, code: str, rooms_h: list[dict], canon: dict[str, str]) -> list[MonitorRoom]:
    today = admin._today()
    return [m for m in db.execute(select(MonitorRoom).order_by(MonitorRoom.id)).scalars()
            if _active(m, today) and any(canon.get(c) == code for c in _codes(m, rooms_h))]


def set_monitor(db: Session, code: str, on: bool, *, by: str = "", log: bool = True) -> dict:
    """HEMIS xonasida monitor bor / yo'q. Xonada monitor bo'lsa ikkinchisi YARATILMAYDI."""
    code = str(code or "").strip()
    rooms_h = admin.hemis_rooms()
    canon = canonical_codes(rooms_h)
    room_h = next((r for r in rooms_h if r["code"] == code), None)
    if room_h is None or not room_h.get("active", True):
        raise LookupError("HEMIS'da bunday faol xona yo'q.")
    label = f"{room_h['name']} ({room_h['building']})"
    current = _room_monitors(db, code, rooms_h, canon)
    if on:
        if current:
            return {"code": code, "monitor_id": current[0].monitor_id, "changed": False}
        # Avval shu xonada bo'lib, olib tashlangan monitor — o'sha ID bilan qaytadi.
        old = [m for m in db.execute(select(MonitorRoom).where(MonitorRoom.active_to.is_not(None))
                                     .order_by(MonitorRoom.id)).scalars()
               if {canon.get(c) for c in _codes(m, rooms_h)} == {code}]
        if old:
            if log:
                _log(db, "on", by=by, monitor_id=old[-1].monitor_id, code=code, room=label, detail="qayta yoqildi")
            room = admin.restore_room(db, old[-1].id, by=by)
            return {"code": code, "monitor_id": room.monitor_id, "changed": True, "restored": True}
        dep = _guess_department(db, code, canon)
        room = admin.add_room(db, dep, room_full=label, hemis_codes=[code], by=by)
        if log:
            _log(db, "on", by=by, monitor_id=room.monitor_id, code=code, room=label, detail="yangi monitor")
            db.commit()
        return {"code": code, "monitor_id": room.monitor_id, "changed": True}
    if not current:
        return {"code": code, "changed": False}
    for m in current:
        rest = [c for c in _codes(m, rooms_h) if canon.get(c) != code]
        if log:
            _log(db, "off", by=by, monitor_id=m.monitor_id, code=code, room=label,
                 detail="xona monitordan ajratildi" if rest else "monitor olib tashlandi")
        if rest:
            # Bitta monitor bir necha HEMIS xonasiga bog'langan — faqat shu xona ajratiladi.
            admin.update_room(db, m.id, hemis_codes=rest, by=by)
        else:
            admin.remove_room(db, m.id, by=by)
    return {"code": code, "changed": True, "monitor_id": current[0].monitor_id}


def apply_changes(db: Session, changes: list[dict], *, by: str = "") -> dict:
    """«Tahrirlash» rejimida yig'ilgan o'zgarishlar — bitta tasdiq bilan."""
    results, errors = [], []
    for ch in changes:
        try:
            results.append(set_monitor(db, str(ch.get("code") or ""), bool(ch.get("on")), by=by))
        except (LookupError, ValueError) as exc:
            db.rollback()
            errors.append({"code": str(ch.get("code") or ""), "error": str(exc)})
    return {"applied": sum(1 for r in results if r.get("changed")), "results": results, "errors": errors}


def resolve_duplicate(db: Session, code: str, keep_id: int, *, by: str = "") -> dict:
    """Bitta xonadagi bir necha monitordan BITTASI qoladi; qolganlari shu xonadan ajratiladi."""
    rooms_h = admin.hemis_rooms()
    canon = canonical_codes(rooms_h)
    current = _room_monitors(db, code, rooms_h, canon)
    if keep_id not in {m.id for m in current}:
        raise LookupError("Qoldiriladigan monitor bu xonada topilmadi.")
    room_h = next((r for r in rooms_h if r["code"] == code), {"name": code, "building": ""})
    label = f"{room_h['name']} ({room_h['building']})"
    keep = next(m for m in current if m.id == keep_id)
    for m in current:
        if m.id == keep_id:
            continue
        rest = [c for c in _codes(m, rooms_h) if canon.get(c) != code]
        _log(db, "dedupe", by=by, monitor_id=m.monitor_id, code=code, room=label, detail=f"takror; {keep.monitor_id} qoldi")
        if rest:
            admin.update_room(db, m.id, hemis_codes=rest, by=by)
        else:
            admin.remove_room(db, m.id, by=by)
    return {"kept": keep.monitor_id}


def relink(db: Session, room_id: int, code: str, *, by: str = "") -> dict:
    """HEMIS'da faol xonasi yo'q monitorni faol xonaga bog'lash (MON ID saqlanadi)."""
    rooms_h = admin.hemis_rooms()
    canon = canonical_codes(rooms_h)
    room_h = next((r for r in rooms_h if r["code"] == str(code) and r.get("active", True)), None)
    if room_h is None:
        raise LookupError("HEMIS'da bunday faol xona yo'q.")
    m = db.get(MonitorRoom, room_id)
    if m is None:
        raise LookupError("Monitor topilmadi.")
    busy = [x for x in _room_monitors(db, room_h["code"], rooms_h, canon) if x.id != room_id]
    if busy:
        raise ValueError(f"Bu xonada allaqachon {busy[0].monitor_id} monitori bor.")
    label = f"{room_h['name']} ({room_h['building']})"
    _log(db, "relink", by=by, monitor_id=m.monitor_id, code=room_h["code"], room=label, detail=f"avval: {m.room_full}")
    admin.update_room(db, room_id, room_full=label, hemis_codes=[room_h["code"]], by=by)
    return {"monitor_id": m.monitor_id}


def retire(db: Session, room_id: int, *, by: str = "") -> dict:
    """Xonasi topilmagan monitorni olib tashlash (tarixga yoziladi)."""
    m = db.get(MonitorRoom, room_id)
    if m is None:
        raise LookupError("Monitor topilmadi.")
    _log(db, "retire", by=by, monitor_id=m.monitor_id, room=m.room_full, detail="xonasi topilmagan monitor olib tashlandi")
    admin.remove_room(db, room_id, by=by)
    return {"monitor_id": m.monitor_id}


def undo(db: Session, log_id: int, *, by: str = "") -> dict:
    """Tarixdagi «yoqildi / olib tashlandi / takror» o'zgarishini teskarisiga qaytarish."""
    h = db.get(MonitorRoomLog, log_id)
    if h is None:
        raise LookupError("Tarix yozuvi topilmadi.")
    if h.undone:
        raise ValueError("Bu o'zgarish allaqachon qaytarilgan.")
    if h.action not in ("on", "off") or not h.hemis_code:
        raise ValueError("Bu o'zgarishni avtomatik qaytarib bo'lmaydi.")
    want_on = h.action == "off"
    res = set_monitor(db, h.hemis_code, want_on, by=by, log=False)
    h.undone = True
    _log(db, "undo", by=by, monitor_id=res.get("monitor_id") or h.monitor_id, code=h.hemis_code, room=h.room,
         detail=f"qaytarildi: monitor {'qayta yoqildi' if want_on else 'olib tashlandi'}")
    db.commit()
    return res
