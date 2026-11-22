"""O'qituvchi (hodim) kirishi faqat NAZORATDAGILARGA (2026-11-20, foydalanuvchi qarori).

"Nazoratdan tashqari o'qituvchilar umuman kira olmasin — server yuklamasi va ortiqcha AI sarfi."
Nazoratda = so'nggi/keyingi `WINDOW_DAYS` kun ichida MONITORLI xonada hisobotga kiradigan (amaliy/seminar,
nazoratdagi fan) HEMIS darsi bor. Admin, rektor/dekan va talabalar — tegilmaydi.

`.env`: IMENTOR_TEACHER_ACCESS_ONLY_CONTROLLED=0 — cheklovni o'chiradi;
IMENTOR_TEACHER_ACCESS_ALLOW=login1,login2 — istisno (masalan kafedra mudiri).
"""
from __future__ import annotations

import datetime as dt
import logging
import os
import threading
import time

from sqlalchemy import text
from sqlalchemy.orm import Session

log = logging.getLogger(__name__)
WINDOW_DAYS = 14
TTL = 600.0
DENIED = "Siz monitorli xonada amaliy dars o'tmaganingiz uchun iMentor'ga kirishga ruxsat yo'q."
_lock = threading.Lock()
_cache: tuple[float, frozenset[str]] = (0.0, frozenset())


def enabled() -> bool:
    return os.environ.get("IMENTOR_TEACHER_ACCESS_ONLY_CONTROLLED", "1") != "0"


#: Istisnolar bazada ham (repo ochiq — loginlar kodda emas): `core_lessonbotsetting` kaliti, vergul bilan.
ALLOW_KEY = "teacher_access_allow"


def _extra(db: Session | None = None) -> set[str]:
    out = {x.strip() for x in (os.environ.get("IMENTOR_TEACHER_ACCESS_ALLOW") or "").split(",") if x.strip()}
    if db is not None:
        try:
            from app.models.lesson_bot import LessonBotSetting

            row = db.get(LessonBotSetting, ALLOW_KEY)
            out |= {x.strip() for x in str(getattr(row, "value", "") or "").split(",") if x.strip()}
        except Exception:  # noqa: BLE001
            pass
    return out


def controlled_teachers(db: Session) -> frozenset[str]:
    global _cache
    if _cache[1] and time.monotonic() - _cache[0] < TTL:
        return _cache[1]
    with _lock:
        if _cache[1] and time.monotonic() - _cache[0] < TTL:
            return _cache[1]
        from app.services import clinical_subjects
        from app.services import lesson_report_service as lr

        today = dt.datetime.now(dt.timezone(dt.timedelta(hours=5))).date()
        rows = db.execute(text(
            "select distinct teacher_username, lesson_type, subject_name, department_name from core_hemislesson "
            "where monitor_id <> '' and teacher_username <> '' and lesson_date between :lo and :hi "
            "and coalesce(hemis_status, '') <> 'missing_from_hemis'"),
            {"lo": today - dt.timedelta(days=WINDOW_DAYS), "hi": today + dt.timedelta(days=WINDOW_DAYS)}).all()
        out = {t for t, kind, subj, dep in rows
               if lr.counts_lesson_type(kind) and clinical_subjects.is_clinical(subj, dep)}
        if not out:  # HEMIS bo'sh qolsa hammani bloklab qo'ymaslik
            log.warning("teacher_access: nazoratdagi o'qituvchilar ro'yxati bo'sh — cheklov qo'llanmadi")
            return frozenset()
        _cache = (time.monotonic(), frozenset(out))
        return _cache[1]


def allowed(db: Session, username: str, role: str) -> bool:
    if role != "hodim" or not enabled():
        return True
    teachers = controlled_teachers(db)
    return not teachers or username in teachers or username in _extra(db)
