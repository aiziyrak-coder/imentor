"""Kasallik varaqasi, ta'til, xizmat safari — o'qituvchi yuboradi, admin tasdiqlaydi (2026-10-28).

Hisobotlarga ta'siri (`approved_days`): tasdiqlangan kunlardagi O'TILMAGAN darslar foizga kirmaydi
va o'qituvchi ayblanmaydi; rektor sahifasida ular kulrang "kasallik varaqasida" bo'lib ko'rinadi.
Shu kuni baribir iMentor bilan o'tilgan dars o'tilgan bo'lib qoladi.
"""

from __future__ import annotations

import datetime as dt
from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.staff_absence import APPROVED, PENDING, REJECTED, StaffAbsence

KIND_LABELS = {
    "kasallik": "Kasallik varaqasi",
    "tatil": "Ta’til (otpuska)",
    "dekret": "Dekret ta’tili",
    "malaka": "Malaka oshirish",
    "safar": "Xizmat safari",
    "boshqa": "Boshqa sabab",
}
#: Uzoq davom etadigan sabablar (2026-11-19): dekret oylab davom etadi — umumiy 120/60 kun chegarasi yetmaydi.
LONG_KINDS = {"dekret": 400}
STATUSES = (PENDING, APPROVED, REJECTED)

#: Hujjat hajmi — telefon rasmi 2–4 MB bo'ladi.
MAX_DOC_BYTES = 8 * 1024 * 1024
#: Bir davr uzunligi va qanchalik orqaga yozish mumkin: kasallik varaqasi chiqqandan keyin
#: olib kelinadi, lekin bir semestrdan eski kunlar hisobotni qayta yozib yubormasin.
MAX_SPAN_DAYS = 120
MAX_BACK_DAYS = 60
MAX_AHEAD_DAYS = 60
#: Bir o'qituvchida bir vaqtda kutilayotgan arizalar.
MAX_PENDING = 5


def doc_type(content: bytes) -> str | None:
    """Faylning haqiqiy turi (nomiga emas, baytlariga qarab) — rasm yoki PDF."""
    head = content[:16]
    if head[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if head[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    if head[:5] == b"%PDF-":
        return "application/pdf"
    if head[4:8] == b"ftyp" and head[8:12] in (b"heic", b"heix", b"mif1", b"heif"):
        return "image/heic"
    return None


def date_problem(start: dt.date, end: dt.date, today: dt.date, kind: str = "") -> str:
    """Sana xatosi matni yoki ''."""
    span = LONG_KINDS.get(kind, MAX_SPAN_DAYS)
    ahead = LONG_KINDS.get(kind, MAX_AHEAD_DAYS)
    if end < start:
        return "Tugash sanasi boshlanish sanasidan oldin bo'lmasin."
    if (end - start).days + 1 > span:
        return f"Bir arizada ko'pi bilan {span} kun."
    if start < today - dt.timedelta(days=MAX_BACK_DAYS):
        return f"{MAX_BACK_DAYS} kundan eski kunlar uchun ariza berilmaydi — admin bilan bog'laning."
    if end > today + dt.timedelta(days=ahead):
        return f"Ko'pi bilan {ahead} kun oldinga."
    return ""


def approved_days(db: Session, start: dt.date, end: dt.date) -> dict[str, dict[dt.date, str]]:
    """{owner_key: {kun: tur}} — davrga to'g'ri keladigan TASDIQLANGAN kunlar."""
    rows = db.execute(
        select(StaffAbsence.owner_key, StaffAbsence.kind, StaffAbsence.start_date, StaffAbsence.end_date)
        .where(StaffAbsence.status == APPROVED, StaffAbsence.start_date <= end, StaffAbsence.end_date >= start)
    ).all()
    out: dict[str, dict[dt.date, str]] = defaultdict(dict)
    for owner, kind, first, last in rows:
        if not owner or first is None or last is None:
            continue
        day = max(first, start)
        while day <= min(last, end):
            out[owner].setdefault(day, kind)
            day += dt.timedelta(days=1)
    return dict(out)


# ---------------------------------------------------------------- o'rinbosar (2026-11-19)
#: "O'rnimga kim dars o'tyapti": ariza id -> {"key", "name", "employee_id"}. Sxema o'zgarmasin deb (migratsiya
#: 18 GB dump bilan ketadi) `core_lessonbotsetting` dagi bitta JSON kalitda saqlanadi.
SUBSTITUTES_KEY = "absence_substitutes"


def load_substitutes(db: Session) -> dict[str, dict]:
    import json

    from app.models.lesson_bot import LessonBotSetting

    row = db.get(LessonBotSetting, SUBSTITUTES_KEY)
    raw = getattr(row, "value", "") if row is not None else ""
    try:
        data = json.loads(raw) if isinstance(raw, str) and raw else {}
    except ValueError:
        data = {}
    return data if isinstance(data, dict) else {}


def save_substitute(db: Session, absence_id: int, sub: dict | None) -> None:
    import json

    from sqlalchemy.dialects.postgresql import insert

    from app.models.lesson_bot import LessonBotSetting

    data = load_substitutes(db)
    if sub:
        data[str(absence_id)] = {"key": sub["key"], "name": sub.get("name", ""), "employee_id": sub.get("employee_id", "")}
    else:
        data.pop(str(absence_id), None)
    value = json.dumps(data, ensure_ascii=False)
    db.execute(insert(LessonBotSetting).values(key=SUBSTITUTES_KEY, value=value)
               .on_conflict_do_update(index_elements=["key"],
                                      set_={"value": value, "updated_at": dt.datetime.now(dt.timezone.utc)}))


def substitutions(db: Session, start: dt.date, end: dt.date) -> dict[str, dict[dt.date, dict]]:
    """{asl o'qituvchi: {kun: o'rinbosar}} — TASDIQLANGAN arizalar, o'rinbosar belgilangan kunlar."""
    subs = load_substitutes(db)
    if not subs:
        return {}
    rows = db.execute(
        select(StaffAbsence.id, StaffAbsence.owner_key, StaffAbsence.start_date, StaffAbsence.end_date)
        .where(StaffAbsence.status == APPROVED, StaffAbsence.start_date <= end, StaffAbsence.end_date >= start)
    ).all()
    out: dict[str, dict[dt.date, dict]] = defaultdict(dict)
    for pk, owner, first, last in rows:
        sub = subs.get(str(pk))
        if not owner or not sub or not sub.get("key") or sub["key"] == owner:
            continue
        day = max(first, start)
        while day <= min(last, end):
            out[owner].setdefault(day, sub)
            day += dt.timedelta(days=1)
    return dict(out)


def label(kind: str) -> str:
    return KIND_LABELS.get(kind, KIND_LABELS["boshqa"])


def as_dict(row: StaffAbsence, *, name: str = "", department: str = "", substitute: dict | None = None) -> dict:
    return {
        "id": row.id,
        "owner_key": row.owner_key,
        "name": name,
        "department": department,
        "kind": row.kind,
        "kind_label": label(row.kind),
        "start_date": row.start_date.isoformat(),
        "end_date": row.end_date.isoformat(),
        "days": (row.end_date - row.start_date).days + 1,
        "note": row.note or "",
        "status": row.status,
        "has_document": bool(row.doc_size),
        "doc_name": row.doc_name or "",
        "decided_by": row.decided_by or "",
        "decided_at": row.decided_at.isoformat() if row.decided_at else None,
        "decision_note": row.decision_note or "",
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "substitute": substitute or None,
    }
