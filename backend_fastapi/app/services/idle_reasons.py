"""Nega dars iMentor'da qayd etilmagan — har o'qituvchi uchun ANIQ sabab (2026-10-21).

Shikoyat: "Avval xonasini tekshirish kerak" ro'yxatida hammaga bitta umumiy gap
("Dars vaqtida iMentor umuman ochilmagan") yozilardi. Tekshiruvda sabablar
butunlay boshqa-boshqa chiqdi:

* HEMIS bog'lagan hisobga (Xodim ID) hech qachon kirilmagan — o'qituvchi
  boshqa, eski hisobdan ishlaydi yoki umuman ishlamaydi (30 kunda darsi bor
  520 hisobdan 188 tasi);
* o'sha kuni iMentor'ga kirgan, lekin dars vaqtida emas;
* dars vaqtida kirgan, lekin qisqa (26 daqiqa) — "umuman ochilmagan" emas;
* HEMIS'da shu vaqtga yana bir darsi qo'yilgan — ikki xonada bir vaqtda
  bo'lib bo'lmaydi;
* xona monitorida 14 kunda 44 darsdan 2 tasi o'tilgan — jihoz shubhali.

Har sabab DALIL bilan qaytariladi (sana, vaqt, daqiqa, xona); qaror shu
yerda, matn ham shu yerda — sahifa faqat ko'rsatadi.
"""

from __future__ import annotations

import datetime as dt
from collections import defaultdict

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.analytics import UserActivityEvent
from app.models.hemis_lesson import HemisLesson
from app.models.user import User
from app.services import lesson_report_service as lr
from app.services import monitor_schedule_service as ms

#: Xona holati necha kunlik tarixga qarab baholanadi.
ROOM_DAYS = 14
#: Shu ulushdan kam dars o'tilgan monitor — "shubhali" (kamida ROOM_MIN_LESSONS darsda).
ROOM_LOW_SHARE = 0.15
ROOM_MIN_LESSONS = 8

#: Sabab kodlari — ustuvorlik tartibida (birinchisi asosiy sabab bo'ladi).
ORDER = ("parallel", "short", "twin_account", "never_used", "absent_day", "outside_lesson", "room")
#: O'qituvchi tomonida emas — avval xona, HEMIS jadvali yoki hisoblar tekshiriladi.
SYSTEM_SIDE = frozenset({"parallel", "twin_account", "room"})
LABEL = {
    "parallel": "HEMIS'da bir vaqtda ikki dars",
    "short": "Dars vaqtida qisqa ishlagan",
    "twin_account": "Boshqa hisobdan foydalanadi",
    "never_used": "Hisobiga hech qachon kirmagan",
    "absent_day": "O'sha kuni iMentor'ga kirmagan",
    "outside_lesson": "Kirgan, lekin dars vaqtida emas",
    "room": "Xona monitori shubhali",
    "unknown": "Dalil topilmadi",
}


def _hm(value: dt.datetime) -> str:
    return value.astimezone(ms.TASHKENT).strftime("%H:%M")


def _day(value: dt.date) -> str:
    return value.strftime("%d.%m")


def mask_login(login: str) -> str:
    """Telefon raqami ko'rinmasin: `998939838000` -> `+998 93 ••• •• 00`."""
    if len(login) == 12 and login.isdigit() and login.startswith("998"):
        return f"+998 {login[3:5]} ••• •• {login[-2:]}"
    return login


def _accounts(db: Session, logins: set[str]) -> dict[str, dict]:
    """Hisob holati: kirganmi, oxirgi faolligi qachon."""
    out = {u: {"last_login": None, "last_activity": None, "first": "", "last": ""} for u in logins}
    for username, last_login, first, last in db.execute(
        select(User.username, User.last_login, User.first_name, User.last_name).where(User.username.in_(logins))
    ).all():
        out[username].update(last_login=last_login, first=first or "", last=last or "")
    for owner, last_ev in db.execute(
        select(UserActivityEvent.owner_key, func.max(UserActivityEvent.occurred_at))
        .where(UserActivityEvent.owner_key.in_(logins)).group_by(UserActivityEvent.owner_key)
    ).all():
        out[owner]["last_activity"] = last_ev
    return out


def _twin(db: Session, login: str, account: dict) -> tuple[str, dt.datetime] | None:
    """Shu odamning BOSHQA, ishlatilgan hisobi (familiya + ismning boshi bir xil)."""
    last = account["last"].strip().lower()
    first = account["first"].strip().lower()[:3]
    if not last or not first:
        return None
    rows = db.execute(
        select(User.username).where(
            User.username != login,
            User.is_active.is_(True),
            ~User.username.like("ot\\_%"),
            func.lower(func.trim(User.last_name)) == last,
            func.lower(func.left(func.trim(User.first_name), 3)) == first,
        )
    ).scalars().all()
    best: tuple[str, dt.datetime] | None = None
    for other in rows:
        seen = db.execute(
            select(func.max(UserActivityEvent.occurred_at)).where(UserActivityEvent.owner_key == other)
        ).scalar()
        if seen and (best is None or seen > best[1]):
            best = (other, seen)
    return best


def _day_activity(db: Session, logins: set[str], days: set[dt.date]) -> dict[tuple[str, dt.date], list[dt.datetime]]:
    """O'qituvchining shu kunlardagi faollik paytlari."""
    if not logins or not days:
        return {}
    lo = dt.datetime.combine(min(days), dt.time(0, 0), tzinfo=ms.TASHKENT)
    hi = dt.datetime.combine(max(days) + dt.timedelta(days=1), dt.time(0, 0), tzinfo=ms.TASHKENT)
    out: dict[tuple[str, dt.date], list[dt.datetime]] = defaultdict(list)
    for owner, when in db.execute(
        select(UserActivityEvent.owner_key, UserActivityEvent.occurred_at).where(
            UserActivityEvent.owner_key.in_(logins),
            UserActivityEvent.occurred_at >= lo,
            UserActivityEvent.occurred_at < hi,
        )
    ).all():
        if when.tzinfo is None:
            when = when.replace(tzinfo=dt.timezone.utc)
        out[(owner, when.astimezone(ms.TASHKENT).date())].append(when)
    for moments in out.values():
        moments.sort()
    return out


def _parallel(db: Session, lesson) -> HemisLesson | None:
    """HEMIS'da shu o'qituvchiga AYNI VAQTDA boshqa xonada qo'yilgan dars."""
    start, end = lr._scheduled(lesson)
    for other in db.execute(
        select(HemisLesson).where(
            HemisLesson.teacher_username == lesson.teacher_username,
            HemisLesson.lesson_date == lesson.lesson_date,
            HemisLesson.hemis_status != "missing_from_hemis",
            HemisLesson.id != lesson.id,
        )
    ).scalars():
        if (other.auditorium_name or "") == (lesson.auditorium_name or ""):
            continue  # o'sha xona — guruhlar birlashgan dars, ziddiyat emas
        o_start, o_end = lr._scheduled(other)
        if o_start < end and start < o_end:
            return other
    return None


def _room_history(db: Session, monitor_ids: set[str], end_day: dt.date,
                  period_rooms: dict | None = None, period_days: int = 1) -> dict[str, tuple[int, int]]:
    """Monitor: (oxirgi 14 kundagi darslar, shundan iMentor bilan o'tilgani).

    Hisobot davri 14 kundan uzun bo'lsa — uning o'z xona statistikasi (qo'shimcha
    o'lchovsiz); qisqa bo'lsa — 30 daqiqa saqlanadigan 14 kunlik o'lchov.
    """
    if not monitor_ids:
        return {}
    if period_rooms is not None and period_days >= ROOM_DAYS:
        source = {k: (v["lessons"], v["used"]) for k, v in period_rooms.items()}
    else:
        source = {k: (v["lessons"], v["used"]) for k, v in lr.room_usage(db, end_day, back_days=ROOM_DAYS).items()}
    return {k: v for k, v in source.items() if k in monitor_ids}


def explain(db: Session, rows: list[dict], lessons: list, used: dict, end_day: dt.date,
            period_rooms: dict | None = None, period_days: int = 1) -> None:
    """`rows` (iMentor'da qaydi yo'q o'qituvchilar) ga `reason`, `reason_label`
    va `reasons` (dalilli gaplar) qo'shadi. Ro'yxat o'zgarmaydi — faqat izoh."""
    if not rows:
        return
    logins = {r["teacher_key"] for r in rows if r.get("teacher_key")}
    mine = [x for x in lessons
            if x.teacher_username in logins and x.monitor_id and x.monitor_id != "boshqa-xona"
            and x.id not in used]
    measures = lr.measure_map(db, mine)
    accounts = _accounts(db, logins)
    activity = _day_activity(db, logins, {x.lesson_date for x in mine})
    rooms = _room_history(db, {x.monitor_id for x in mine}, end_day, period_rooms, period_days)
    by_teacher: dict[str, list] = defaultdict(list)
    for x in mine:
        by_teacher[x.teacher_username].append(x)

    for r in rows:
        login = r.get("teacher_key") or ""
        found: dict[str, list[str]] = defaultdict(list)
        per_day: dict[dt.date, list[str]] = defaultdict(list)
        room_unproven = False
        account = accounts.get(login) or {}
        never = not account.get("last_login") and not account.get("last_activity")
        if never and login:
            twin = _twin(db, login, account)
            if twin:
                found["twin_account"].append(
                    f"HEMIS bog'lagan hisobga ({login}) hech qachon kirilmagan; o'qituvchi boshqa hisobdan "
                    f"ishlaydi ({mask_login(twin[0])}, oxirgi faolligi {_day(twin[1].astimezone(ms.TASHKENT).date())}). "
                    "Hisoblarni birlashtirish kerak."
                )
            else:
                found["never_used"].append(
                    f"iMentor hisobi ({login}) bir marta ham ochilmagan — o'qituvchi tizimdan foydalanmaydi."
                )
        for lesson in sorted(by_teacher.get(login, []), key=lambda x: (x.lesson_date, x.start_time)):
            start, end = lr._scheduled(lesson)
            when = f"{_day(lesson.lesson_date)} {start.strftime('%H:%M')}–{end.strftime('%H:%M')}"
            twin_lesson = _parallel(db, lesson)
            if twin_lesson is not None:
                found["parallel"].append(
                    f"{when}: HEMIS'da shu vaqtga yana bir darsi qo'yilgan — {twin_lesson.auditorium_name} "
                    f"({twin_lesson.lesson_type or 'dars'}, {twin_lesson.group_name}). Bir vaqtda ikki xonada "
                    "bo'lib bo'lmaydi — HEMIS jadvalini to'g'rilash kerak."
                )
            m = measures.get(lesson.id) or {}
            minutes = round((m.get("seconds") or 0) / 60)
            if minutes > 0:
                found["short"].append(
                    f"{when} ({lesson.auditorium_name}): dars vaqtida {minutes} daqiqa ishlagan — "
                    f"o'tilgan hisoblanishi uchun kamida {lr.MIN_LESSON_MINUTES} daqiqa kerak."
                )
            elif not never:
                # Bir kunning darslari bitta gapga yig'iladi (pastda).
                per_day[lesson.lesson_date].append(
                    f"{start.strftime('%H:%M')}–{end.strftime('%H:%M')} ({lesson.auditorium_name})")
            # Xonada kimdir bir marta bo'lsa ham iMentor bilan dars o'tgan — monitor
            # ishlaydi. Hech kim o'tmagan bo'lsa — ishlashi isbotlanmagan: avval xona.
            total, taught = rooms.get(lesson.monitor_id, (0, 0))
            if not taught:
                room_unproven = True
                text = (f"{lesson.auditorium_name}: {ROOM_DAYS} kunda {total} darsdan birortasi ham iMentor bilan "
                        "o'tilmagan — monitor ishlashini joyida tekshirish kerak.")
                if total and text not in found["room"]:
                    found["room"].append(text)
            else:
                rare = total >= ROOM_MIN_LESSONS and taught / total < ROOM_LOW_SHARE
                text = (f"{lesson.auditorium_name} monitori ishlaydi: {ROOM_DAYS} kunda {total} darsdan {taught} tasi "
                        "iMentor bilan o'tilgan" + (" (bu xonada kam ishlatiladi)." if rare else "."))
                if text not in found.get("room_ok", []):
                    found["room_ok"].append(text)

        for day, slots in sorted(per_day.items()):
            moments = activity.get((login, day)) or []
            listed = ", ".join(slots)
            if not moments:
                seen = account.get("last_activity")
                tail = f" (oxirgi faolligi {_day(seen.astimezone(ms.TASHKENT).date())})" if seen else ""
                found["absent_day"].append(f"{_day(day)} kuni iMentor'ga umuman kirmagan{tail}; darsi: {listed}.")
            else:
                found["outside_lesson"].append(
                    f"{_day(day)} kuni iMentor'da {_hm(moments[0])}–{_hm(moments[-1])} da ishlagan, darsi esa "
                    f"{listed} — dars vaqtida ochilmagan."
                )

        # Dalil topilmasa — taxminiy sabab yozilmaydi.
        primary = next((code for code in ORDER if found.get(code)), "unknown")
        lines: list[str] = []
        for code in ORDER:
            lines.extend(found.get(code, [])[:2])
        lines.extend(found.get("room_ok", [])[:1])
        r["reason"] = primary
        r["reason_label"] = LABEL[primary]
        r["reasons"] = lines[:4]
        # O'qituvchi aybi isbotlanmagan: HEMIS jadvali yoki ikki hisob muammosi, yoki
        # xona monitori 14 kunda ishlagani isbotlanmagan (bunda avval xona tekshiriladi).
        # Hisobini hech qachon ochmagan o'qituvchiga xona bahona bo'lmaydi.
        r["system_side"] = primary in SYSTEM_SIDE or (primary != "never_used" and room_unproven)
