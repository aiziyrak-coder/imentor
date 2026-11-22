"""«HEMIS'da baho bor, iMentor ochilmagan» darslar — butun institut bo'yicha (2026-11-16).

Har kuni 02:30 va 19:30 da (hamda dastur ishga tushganidan keyin natija bo'lmasa) oxirgi 14 kunning
monitorli xonadagi, iMentor'da birorta qaydi YO'Q darslari uchun HEMIS baholari olinadi
(`/data/student-grade-list?_subject_schedule=…`, FAQAT O'QISH). Natija Redis'da saqlanadi — bazaga
hech narsa yozilmaydi. Rektor sahifasi tayyor ro'yxatni o'qiydi, shuning uchun bir zumda ochiladi.

«Ochilmagan» = dars oynasida o'qituvchining birorta ishi ham, jonli testi ham, QR kirishi ham,
talabalar dalili ham yo'q (`lesson_report_service.measure_map` da yozuvi yo'q).
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.hemis_lesson import HemisLesson
from app.models.student_contingent import StudentContingent
from app.services import lesson_report_service as lrs

logger = logging.getLogger(__name__)

KEY = "rx:gradednotopened:v1"
SCAN_DAYS = int(os.environ.get("IMENTOR_GRADED_SCAN_DAYS", "30"))
RUN_AT = ((2, 30), (19, 30))
LOCK_ID = 7211117


def _redis():
    from app.services.ai_response_cache import _redis as r

    return r()


def load() -> dict | None:
    try:
        raw = _redis().get(KEY)
        return json.loads(raw) if raw else None
    except Exception:  # noqa: BLE001
        return None


def scan(db: Session, start_day: dt.date, end_day: dt.date) -> dict:
    from app.services.lesson_detail_service import hemis_grades

    started = time.time()
    lessons = [x for x in lrs._lessons(db, start_day, end_day) if x.monitor_id and x.teacher_username]
    measured = lrs.measure_map(db, lessons) if lessons else {}
    silent = [x for x in lessons if x.id not in measured]
    # Har darsning hamma guruh qatorlari (HEMIS har guruhga alohida dars ID beradi).
    rows = db.execute(select(HemisLesson).where(HemisLesson.lesson_date >= start_day,
                                                HemisLesson.lesson_date <= end_day,
                                                HemisLesson.monitor_id != "")).scalars().all()
    by_key: dict[tuple, list[HemisLesson]] = {}
    for r in rows:
        if getattr(r, "hemis_status", "") != "missing_from_hemis":
            by_key.setdefault(lrs.lesson_key(r), []).append(r)

    def one(x):
        sib = by_key.get(lrs.lesson_key(x), [x])
        got, err = hemis_grades([r.hemis_id for r in sib if r.hemis_id], x.lesson_date)
        return x, sib, len({g["hemis_student"] for g in got if g.get("grade") is not None}), bool(err)

    found = []
    failed = 0
    with ThreadPoolExecutor(max_workers=3) as pool:
        for x, sib, graded, err in pool.map(one, silent):
            failed += int(err)
            if graded:
                found.append((x, sib, graded))
    groups = sorted({r.group_name for _, sib, _ in found for r in sib if r.group_name})
    roster = dict(db.execute(select(StudentContingent.group_name, func.count())
                             .where(StudentContingent.group_name.in_(groups),
                                    StudentContingent.status.in_(("active", "")))
                             .group_by(StudentContingent.group_name)).all()) if groups else {}
    items = []
    for x, sib, graded in found:
        names = sorted({r.group_name for r in sib if r.group_name})
        items.append({
            "lesson_id": x.id, "date": x.lesson_date.isoformat(), "weekday": x.weekday, "para": x.para,
            "start_time": x.start_time, "end_time": x.end_time,
            "teacher_name": x.teacher_name, "teacher_key": x.teacher_username, "department": x.department_name,
            "subject": x.subject_name, "group": ", ".join(names), "groups": names, "room": x.auditorium_name,
            "lesson_type": x.lesson_type, "graded": graded, "roster": sum(int(roster.get(g, 0)) for g in names),
        })
    items.sort(key=lambda i: (i["date"], i["start_time"] or i["para"]), reverse=True)
    return {
        "at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "from": start_day.isoformat(), "to": end_day.isoformat(),
        "checked": len(silent), "lessons": len(lessons), "hemis_failed": failed,
        "seconds": round(time.time() - started, 1),
        "items": items,
    }


def run_once() -> dict | None:
    from sqlalchemy import text as _sql

    from app.core.db import SessionLocal, engine

    with engine.connect() as conn:
        got = conn.execute(_sql("SELECT pg_try_advisory_lock(:id)"), {"id": LOCK_ID}).scalar()
        conn.commit()
        if not got:
            return None
        try:
            today = lrs.current_time().date()
            with SessionLocal() as db:
                result = scan(db, today - dt.timedelta(days=SCAN_DAYS - 1), today)
            _redis().set(KEY, json.dumps(result, ensure_ascii=False), ex=4 * 86400)
            logger.info("HEMIS/iMentor tekshiruvi: %d dars tekshirildi, %d tasida baho bor, iMentor ochilmagan (%.0f s)",
                        result["checked"], len(result["items"]), result["seconds"])
            return result
        finally:
            conn.execute(_sql("SELECT pg_advisory_unlock(:id)"), {"id": LOCK_ID})
            conn.commit()


def start_background() -> None:
    if os.environ.get("IMENTOR_GRADED_SCAN", "1") != "1":
        return

    def loop() -> None:
        time.sleep(180)  # dastur to'liq ishga tushsin
        while True:
            try:
                now = lrs.current_time()
                # Bugun o'tib ketgan eng oxirgi rejadagi vaqt; natija undan eski bo'lsa — qayta tekshiriladi.
                # Bir nechta ishchi jarayon bo'lsa ham bir marta: vaqt Redis'dagi natijadan olinadi.
                passed = [now.replace(hour=h, minute=m, second=0, microsecond=0) for h, m in RUN_AT
                          if (now.hour, now.minute) >= (h, m)]
                last = load()
                at = dt.datetime.fromisoformat(last["at"]) if last else None
                if at is None or (passed and at < max(passed)):
                    run_once()
            except Exception:  # noqa: BLE001
                logger.warning("HEMIS/iMentor tekshiruvi bajarilmadi", exc_info=True)
            time.sleep(300)

    threading.Thread(target=loop, name="graded-scan", daemon=True).start()
