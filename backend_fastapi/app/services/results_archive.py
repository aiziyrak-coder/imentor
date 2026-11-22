"""Talabalar natijalarini arxivga yozish (2026-10-23).

Yakunlangan (o'qituvchi tahlil qilgan yoki muddati o'tgan) jonli test sessiyasidagi
har bir urinish `core_studentresult` ga bir marta yoziladi: talaba (o'sha paytdagi
guruhi bilan), sana, para, fan, kafedra, o'qituvchi, mavzu, ball va baho. Shu bilan
birga u o'qituvchilar nazoratida hisobga olinadigan darsda (monitorli xona,
sanaladigan dars turi, hisobotdan chiqarilmagan kafedra) bo'lganmi — `in_scope`.

Ish takrorlansa ham xavfsiz (`attempt_id` unique). Fon oqimi har 5 daqiqada yangi
natijalarni oladi; eskilari `scripts/archive_student_results.py` bilan ko'chiriladi.
"""

from __future__ import annotations

import datetime as dt
import logging
import os
import random
import threading
import time
from collections import defaultdict

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models.student_contingent import StudentContingent
from app.models.student_result import StudentResult
from app.models.user import User
from app.services import lesson_report_service as lr
from app.services import parent_bot_data as pbd
from app.services.dean_access import official_of
from app.services.student_report_service import grade_of

log = logging.getLogger("app.results_archive")

LOCK_KEY = 7_210_823
INTERVAL_SECONDS = 300
BATCH = 4000
INSERT_CHUNK = 1000


_ATTEMPT_COLUMNS = """
        SELECT a.id, a.session_id, a.student_id, a.first_name, a.last_name, a.subject_code, a.topic, a.topic_code,
               a.score, a.total, a.duration_sec, a.submitted_at, a.submitted_date, a.started_at, s.owner_key,
               COALESCE(s.payload->>'excludeFromResults', '') AS excluded
        FROM core_studenttestattempt a
        JOIN core_livetestsession s ON s.id = a.session_id
"""


def pending(db: Session, limit: int = BATCH) -> list:
    """Arxivga hali yozilmagan, yakunlangan sessiyadagi urinishlar (eskisi birinchi).

    Yakunlangan = o'qituvchi yopgan YOKI 24 soatdan oshgan (talaba uchun u allaqachon yopiq).
    Ilgari faqat `is_closed`: yopilmay qolgan 316 eski sessiyadagi natijalar (2026-10-23)
    arxivga hech qachon tushmasdi.
    """
    return db.execute(text(_ATTEMPT_COLUMNS + """
        WHERE (s.is_closed OR s.created_at < now() - interval '24 hours')
          AND a.student_id <> '' AND a.total > 0
          AND NOT EXISTS (SELECT 1 FROM core_studentresult r WHERE r.attempt_id = a.id)
        ORDER BY a.submitted_at
        LIMIT :limit
    """), {"limit": limit}).all()


def _lesson(row, day: dt.date) -> pbd.Lesson:
    lesson = pbd.Lesson(para=row.para or "", start=row.start_time or "", end=row.end_time or "",
                        subject=row.subject_name or "", kind=row.lesson_type or "",
                        teacher=row.teacher_username or "", day=day)
    lesson.department = official_of(row.department_name or "") or (row.department_name or "")  # type: ignore[attr-defined]
    lesson.monitored = bool(getattr(row, "monitor_id", None))  # type: ignore[attr-defined]
    return lesson


def counted_lessons(db: Session, day: dt.date) -> dict[tuple[str, str], list[pbd.Lesson]]:
    """(o'qituvchi, guruh) → o'sha kuni o'qituvchilar nazoratida sanaladigan darslar."""
    out: dict[tuple[str, str], list[pbd.Lesson]] = defaultdict(list)
    for row in lr._lessons(db, day, day, pending=True):
        teacher = (row.teacher_username or "").strip()
        for group in lr.lesson_groups(row):
            out[(teacher, group)].append(_lesson(row, day))
    return out


#: Test boshlangan payt darsdan shuncha uzoq bo'lsa — o'sha kunning yagona darsiga ham bog'lanmaydi.
LONE_LESSON_SLACK = dt.timedelta(hours=3)


def _reference_time(a) -> dt.datetime:
    """Test qaysi darsda bo'lgani — talaba uni OCHGAN payt bo'yicha (2026-10-23).

    Topshirilgan vaqt yaramaydi: o'qituvchi tahlilni ertasi kuni bossa, yechilmay qolgan
    qoralamalar o'sha payt topshiriladi va natija boshqa kun va boshqa darsga tushardi.
    Brauzer soati noto'g'ri bo'lishi mumkin — boshlanish 6 soatdan uzoq bo'lsa olinmaydi.
    """
    sub_at, started = a.submitted_at, getattr(a, "started_at", None)
    if started is not None and sub_at is not None and dt.timedelta(0) <= sub_at - started <= dt.timedelta(hours=30):
        return started
    return sub_at


def _near(lesson: pbd.Lesson, when: dt.datetime) -> bool:
    starts, ends = lesson.starts, lesson.ends
    if starts is None or ends is None or when is None:
        return False
    return starts - LONE_LESSON_SLACK <= when <= ends + LONE_LESSON_SLACK


def build_rows(db: Session, attempts: list) -> list[dict]:
    if not attempts:
        return []
    sids = {a.student_id for a in attempts}
    people = {r.student_id: r for r in db.execute(
        select(StudentContingent).where(StudentContingent.student_id.in_(sids))
        .order_by(StudentContingent.status != "active", StudentContingent.id.desc())
    ).scalars().all()[::-1]}
    owners = {a.owner_key for a in attempts if a.owner_key}
    teachers = {u.username: " ".join(x for x in (u.last_name, u.first_name) if x).strip()
                for u in db.execute(select(User).where(User.username.in_(owners))).scalars().all()}
    names = pbd.subject_names(db, {a.subject_code for a in attempts})
    counted_by_day: dict[dt.date, dict] = {}
    group_lessons: dict[tuple[str, dt.date], list[pbd.Lesson]] = {}
    out = []
    for a in attempts:
        st = people.get(a.student_id)
        group = (st.group_name if st else "") or ""
        when = _reference_time(a)
        day = when.astimezone(pbd.TZ).date() if when else a.submitted_date
        if day not in counted_by_day:
            counted_by_day[day] = counted_lessons(db, day)
        owner = (a.owner_key or "").strip()
        candidates = counted_by_day[day].get((owner, group), [])
        lesson = pbd.match_lesson(candidates, when, owner)
        if lesson is None and len(candidates) == 1 and _near(candidates[0], when):
            lesson = candidates[0]
        if lesson is None and not candidates:
            # Talaba keyin guruhini almashtirgan bo'lishi mumkin: o'qituvchining shu paytdagi
            # nazoratdagi darsi qaysi guruhda bo'lsa — test o'sha guruhda o'tgan (2026-10-23).
            mine = [(g, x) for (t, g), ls in counted_by_day[day].items() if t == owner for x in ls]
            found = pbd.match_lesson([x for _g, x in mine], when, owner)
            if found is not None:
                lesson = found
                group = next(g for g, x in mine if x is found)
        in_scope = bool(lesson is not None and getattr(lesson, "monitored", False))
        # Administrator chiqargan test (masalan, 2026-11-13 server yuki paytida javoblar yetib bormagan):
        # natija o'chmaydi, lekin talaba o'rtachasi va rektor hisobotiga qo'shilmaydi. Sabab sessiya
        # `payload.excludeFromResults` da — qayta hisoblash (`refresh_recent`) ham shuni hurmat qiladi.
        if str(getattr(a, "excluded", "") or "").strip():
            in_scope = False
        department = getattr(lesson, "department", "") if lesson else ""
        if lesson is None and group:
            key = (group, day)
            if key not in group_lessons:
                group_lessons[key] = pbd.lessons_on(db, group, day)
            lesson = pbd.match_lesson(group_lessons[key], when, owner)
        subject = (lesson.subject if lesson else "") or pbd.clean_subject(names.get(a.subject_code) or a.subject_code or "")
        percent = round(100 * int(a.score or 0) / int(a.total)) if a.total else 0
        out.append({
            "attempt_id": a.id,
            "session_id": a.session_id or 0,
            "student_id": a.student_id,
            "student_name": (pbd.full_name(st) if st else f"{a.last_name or ''} {a.first_name or ''}".strip())[:255],
            "group_name": group[:128],
            "faculty_name": ((st.faculty_name if st else "") or "")[:255],
            "course": (st.course if st else None),
            "lesson_date": day,
            "submitted_at": a.submitted_at,
            "para": ((lesson.para if lesson else "") or "")[:16],
            "subject_code": (a.subject_code or "")[:200],
            "subject_name": subject[:255],
            "department": (department or "")[:255],
            "teacher_username": owner[:128],
            "teacher_name": teachers.get(owner, "")[:255],
            "topic": a.topic or "",
            "topic_code": (a.topic_code or "")[:64],
            "score": int(a.score or 0),
            "total": int(a.total or 0),
            "percent": percent,
            "grade": grade_of(percent) or 2,
            "duration_sec": int(a.duration_sec or 0),
            "in_scope": in_scope,
        })
    return out


def archive_pending(db: Session, limit: int = BATCH) -> int:
    rows = build_rows(db, pending(db, limit))
    if not rows:
        return 0
    written = 0
    # Postgres bitta so'rovda 65535 dan ortiq parametr qabul qilmaydi (23 ustun × 1000 qator).
    for i in range(0, len(rows), INSERT_CHUNK):
        res = db.execute(insert(StudentResult).values(rows[i:i + INSERT_CHUNK])
                         .on_conflict_do_nothing(index_elements=["attempt_id"]))
        # Ko'p qatorli INSERT'da drayver ba'zan -1 qaytaradi — unda bo'lak hajmi olinadi.
        written += res.rowcount if (res.rowcount or 0) >= 0 else len(rows[i:i + INSERT_CHUNK])
    db.commit()
    return written


#: Oxirgi shuncha kunlik natijalarning qamrovi qayta tekshiriladi: xonaga monitor keyin
#: bog'langan, dars turi tuzatilgan yoki dars HEMIS'dan chiqib ketgan bo'lishi mumkin.
REFRESH_DAYS = 14
REFRESH_EVERY = dt.timedelta(hours=6)
_last_refresh: dt.datetime | None = None


def refresh_recent(db: Session, days: int = REFRESH_DAYS) -> int:
    """Yaqin kunlardagi natijalarning `in_scope`, para, fan va kafedrasi qayta hisoblanadi."""
    since = dt.datetime.now(pbd.TZ).date() - dt.timedelta(days=days)
    ids = [r[0] for r in db.execute(text(
        # Kun bo'yicha tartib: har bo'lak 1-2 kunni oladi va kunning darslari bir marta hisoblanadi.
        "SELECT attempt_id FROM core_studentresult WHERE lesson_date >= :since ORDER BY lesson_date, attempt_id"),
        {"since": since}).all()]
    changed = 0
    for i in range(0, len(ids), BATCH):
        attempts = db.execute(text(_ATTEMPT_COLUMNS + " WHERE a.id = ANY(:ids)"), {"ids": ids[i:i + BATCH]}).all()
        fresh = {r["attempt_id"]: r for r in build_rows(db, attempts)}
        old = db.execute(select(StudentResult).where(StudentResult.attempt_id.in_(list(fresh)))).scalars().all()
        for row in old:
            new = fresh[row.attempt_id]
            for field in ("in_scope", "para", "subject_name", "department", "lesson_date"):
                if getattr(row, field) != new[field]:
                    setattr(row, field, new[field])
                    changed += 1
        db.commit()
    return changed


def run_once_locked() -> int | None:
    from app.core.db import SessionLocal, engine

    with engine.connect() as conn:
        got = conn.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": LOCK_KEY}).scalar()
        conn.commit()
        if not got:
            return None
        try:
            with SessionLocal() as db:
                from app.services.live_test_service import finalize_all_expired, finalize_finished_monitor_sessions

                global _last_refresh
                finalize_finished_monitor_sessions(db)
                finalize_all_expired(db)
                written = archive_pending(db)
                now = dt.datetime.now(dt.timezone.utc)
                if _last_refresh is None or now - _last_refresh >= REFRESH_EVERY:
                    _last_refresh = now
                    changed = refresh_recent(db)
                    if changed:
                        log.info("results-archive: %s ta maydon qayta hisoblandi", changed)
                return written
        finally:
            conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": LOCK_KEY})
            conn.commit()


def _loop() -> None:
    time.sleep(random.uniform(30, 90))
    while True:
        try:
            n = run_once_locked()
            if n:
                log.info("results-archive: %s ta natija arxivga yozildi", n)
        except Exception:  # noqa: BLE001 — oqim to'xtamasin
            log.warning("results-archive: xato", exc_info=True)
        time.sleep(INTERVAL_SECONDS)


def start_background() -> None:
    if os.environ.get("IMENTOR_RESULTS_ARCHIVE", "1") == "0":
        return
    threading.Thread(target=_loop, name="results-archive", daemon=True).start()
