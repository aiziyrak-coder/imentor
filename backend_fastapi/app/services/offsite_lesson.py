"""Darsni sababli boshqa joyda o'tish (2026-11-12).

Qoidalar (foydalanuvchi qarori):
* faqat DARS VAQTIDA — HEMIS jadvalidagi darsi boshlanishidan `EARLY` oldin to tugaguncha;
* sabab ro'yxatdan + izoh; rasm majburiy (telefon kamerasi), joylashuv bo'lsa yoziladi;
* TASDIQSIZ: qayd qilingan dars rektor hisobotida qizil bo'lmaydi (foizga kirmaydi), admin alohida ko'radi.
"""

from __future__ import annotations

import datetime as dt
from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.hemis_lesson import HemisLesson
from app.models.offsite_lesson import OffsiteLesson

REASONS = {
    "klinika": "Klinik baza / bemor yonida",
    "xona": "Boshqa xonada",
    "monitor": "Monitor ishlamayapti",
    "amaliyot": "Ekskursiya / amaliyot joyida",
    "boshqa": "Boshqa sabab",
}
#: Dars boshlanishidan qancha oldin bosish mumkin (o'qituvchi guruhni olib ketayotgan bo'ladi).
EARLY = dt.timedelta(minutes=10)
MAX_PHOTO_BYTES = 8 * 1024 * 1024
#: Izoh majburiy — rektor hisobotida rasm bilan birga ko'rinadi.
MIN_NOTE = 5


def _at(day: dt.date, hhmm: str, tz: dt.tzinfo) -> dt.datetime | None:
    try:
        h, m = (int(x) for x in (hhmm or "").strip()[:5].split(":"))
    except ValueError:
        return None
    return dt.datetime.combine(day, dt.time(h, m), tzinfo=tz)


def current_lessons(db: Session, owner_key: str, now: dt.datetime) -> list[HemisLesson]:
    """O'qituvchining shu daqiqadagi darslari (HEMIS), boshlanishiga `EARLY` qolganlari ham."""
    rows = db.execute(
        select(HemisLesson).where(HemisLesson.teacher_username == owner_key, HemisLesson.lesson_date == now.date())
        .order_by(HemisLesson.start_time)
    ).scalars().all()
    out = []
    for lesson in rows:
        start, end = _at(lesson.lesson_date, lesson.start_time, now.tzinfo), _at(lesson.lesson_date, lesson.end_time, now.tzinfo)
        if start and end and start - EARLY <= now <= end:
            out.append(lesson)
    return out


def next_lesson(db: Session, owner_key: str, now: dt.datetime) -> HemisLesson | None:
    """Bugungi keyingi dars (tugma qachon faollashishini ko'rsatish uchun)."""
    rows = db.execute(
        select(HemisLesson).where(HemisLesson.teacher_username == owner_key, HemisLesson.lesson_date == now.date())
        .order_by(HemisLesson.start_time)
    ).scalars().all()
    for lesson in rows:
        start = _at(lesson.lesson_date, lesson.start_time, now.tzinfo)
        if start and start - EARLY > now:
            return lesson
    return None


def photo_type(content: bytes) -> str | None:
    head = content[:16]
    if head[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if head[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    if head[4:8] == b"ftyp" and head[8:12] in (b"heic", b"heix", b"mif1", b"heif"):
        return "image/heic"
    return None


def marked_lesson_ids(db: Session, start: dt.date, end: dt.date) -> dict[str, set[int]]:
    """{owner_key: {hemis lesson id}} — davrdagi boshqa joyda o'tilgan deb qayd etilgan darslar."""
    out: dict[str, set[int]] = defaultdict(set)
    for owner, lesson_id in db.execute(
        select(OffsiteLesson.owner_key, OffsiteLesson.lesson_id)
        .where(OffsiteLesson.lesson_date >= start, OffsiteLesson.lesson_date <= end)
    ).all():
        out[owner].add(lesson_id)
    return dict(out)


def covered_marks(db: Session, start: dt.date, end: dt.date, *, owner: str = "") -> dict[str, dict[int, str]]:
    """{o'qituvchi: {dars_id: sabab}} — qayd QAMRAGAN hamma dars qatorlari (2026-11-16).

    Bitta qayd bitta para emas, butun DARSni qamraydi:
      * shu darsning hamma guruh qatorlari (HEMIS har guruhga alohida qator beradi — ilgari qayd bitta
        qatorga yozilib, hisobot boshqa qatorni "vakil" qilib olsa, dars qizil bo'lib qolardi);
      * o'sha kuni shu guruh(lar)ga shu fandan KETMA-KET paralar (`lesson_blocks`, hisobotdagi qoida).
        O'qituvchi savoli: «3 juftlik dars — har juftlikda qayta rasm yuklaymanmi?» Yo'q: talabalarni
        shifoxonaga olib borgan o'qituvchi uch para ham o'sha yerda.
    """
    from app.services import lesson_report_service as lrs

    q = select(OffsiteLesson.owner_key, OffsiteLesson.lesson_id, OffsiteLesson.lesson_date, OffsiteLesson.reason).where(
        OffsiteLesson.lesson_date >= start, OffsiteLesson.lesson_date <= end)
    if owner:
        q = q.where(OffsiteLesson.owner_key == owner)
    marks = db.execute(q).all()
    out: dict[str, dict[int, str]] = defaultdict(dict)
    if not marks:
        return {}
    for o, lesson_id, _day, reason in marks:
        out[o][lesson_id] = label(reason)
    owners = {m[0] for m in marks}
    days = {m[2] for m in marks}
    rows = db.execute(select(HemisLesson).where(
        HemisLesson.teacher_username.in_(owners), HemisLesson.lesson_date.in_(days))).scalars().all()
    by_day: dict[tuple, list] = defaultdict(list)
    for r in rows:
        by_day[(r.teacher_username, r.lesson_date)].append(r)
    for (o, _day), day_rows in by_day.items():
        mine = out.get(o) or {}
        if not any(r.id in mine for r in day_rows):
            continue
        siblings: dict[tuple, list] = defaultdict(list)
        for r in day_rows:
            siblings[lrs.lesson_key(r)].append(r)
        for block in lrs.lesson_blocks(lrs.merge_group_rows(list(day_rows))):
            ids = [r.id for head in block for r in siblings[lrs.lesson_key(head)]]
            reason = next((mine[i] for i in ids if i in mine), "")
            if reason:
                for i in ids:
                    out[o].setdefault(i, reason)
    return dict(out)


def label(reason: str) -> str:
    return REASONS.get(reason, REASONS["boshqa"])


def lesson_dict(lesson: HemisLesson) -> dict:
    return {
        "lesson_id": lesson.id,
        "date": lesson.lesson_date.isoformat(),
        "para": lesson.para or "",
        "start_time": lesson.start_time or "",
        "end_time": lesson.end_time or "",
        "subject_name": lesson.subject_name or "",
        "group_name": lesson.group_name or "",
        "room": " ".join(x for x in (lesson.building_name or "", lesson.auditorium_name or "") if x).strip(),
    }


def as_dict(row: OffsiteLesson, *, name: str = "", department: str = "") -> dict:
    return {
        "id": row.id,
        "owner_key": row.owner_key,
        "name": name,
        "department": department,
        "lesson_id": row.lesson_id,
        "date": row.lesson_date.isoformat(),
        "para": row.para or "",
        "start_time": row.start_time or "",
        "end_time": row.end_time or "",
        "subject_name": row.subject_name or "",
        "group_name": row.group_name or "",
        "scheduled_room": row.scheduled_room or "",
        "reason": row.reason,
        "reason_label": label(row.reason),
        "note": row.note or "",
        "lat": row.lat,
        "lon": row.lon,
        "accuracy_m": row.accuracy_m,
        "has_photo": bool(row.photo_size),
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }
