"""Admin «Monitorli xonalar» → «Nazoratdagi fanlar» (2026-11-16).

Rektor hisoboti faqat KLINIK fanlarning AMALIY mashg'ulotlarini, faqat MONITORLI xonada nazorat qiladi.
Bu yerda HEMIS jadvalidagi amaliy mashg'ulotli har bir fan ko'rinadi: avtomatik qaror (va sababi),
admin qarori, oxirgi 4 haftadagi darslari va ulardan nechtasi monitorli xonada bo'lgani.
"""

from __future__ import annotations

import datetime as dt
import logging
from collections import Counter, defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.hemis_lesson import HemisLesson
from app.models.subject_scope import SubjectScope
from app.services import clinical_subjects as cs

logger = logging.getLogger(__name__)

WINDOW_DAYS = 28


def _today() -> dt.date:
    from app.services.lesson_report_service import current_time

    return current_time().date()


def subjects(db: Session, *, days: int = WINDOW_DAYS) -> dict:
    """Amaliy mashg'ulotli fanlar: qaror, sabab, darslar (jami / monitorli), o'qituvchilar."""
    from app.services import lesson_report_service as lr
    from app.services import report_exclusion
    from app.services.dean_access import official_of

    today = _today()
    start = today - dt.timedelta(days=days)
    end = today + dt.timedelta(days=6)
    raw = [r for r in db.execute(
        select(HemisLesson).where(HemisLesson.lesson_date >= start, HemisLesson.lesson_date <= end)
    ).scalars() if r.hemis_status != "missing_from_hemis" and lr.counts_lesson_type(r.lesson_type)]
    lessons = lr.merge_group_rows(raw)
    excluded = report_exclusion.load(db)
    manual = {r.subject_key: r for r in db.execute(select(SubjectScope)).scalars()}
    agg: dict[str, dict] = {}
    for x in lessons:
        key = cs.norm_subject(x.subject_name)
        if not key:
            continue
        a = agg.setdefault(key, {"names": Counter(), "departments": Counter(), "lessons": 0,
                                 "monitor_lessons": 0, "teachers": set(), "verdicts": Counter(),
                                 "reasons": Counter(), "excluded": 0, "monitor_teachers": set()})
        dep = official_of(x.department_name or "") or (x.department_name or "").strip()
        who = x.teacher_username or x.teacher_name
        a["names"][x.subject_name] += 1
        a["departments"][dep] += 1
        a["lessons"] += 1
        a["teachers"].add(who)
        if x.monitor_id:
            a["monitor_lessons"] += 1
            a["monitor_teachers"].add(who)
        ok, why = cs.auto_verdict(x.subject_name or "", x.department_name or "")
        a["verdicts"][ok] += 1
        a["reasons"][why] += 1
        if excluded.lesson_excluded(x):
            a["excluded"] += 1
    out = []
    for key, a in agg.items():
        auto = a["verdicts"][True] >= a["verdicts"][False]
        mixed = bool(a["verdicts"][True] and a["verdicts"][False])
        m = manual.get(key)
        out.append({
            "key": key,
            "name": a["names"].most_common(1)[0][0],
            "departments": [d for d, _ in a["departments"].most_common()],
            "lessons": a["lessons"],
            "monitor_lessons": a["monitor_lessons"],
            "teachers": len(a["teachers"]),
            "monitor_teachers": len(a["monitor_teachers"]),
            "auto": auto,
            "auto_mixed": mixed,
            "reason": "Kafedraga qarab" if mixed else a["reasons"].most_common(1)[0][0],
            "override": None if m is None else bool(m.clinical),
            "clinical": auto if m is None else bool(m.clinical),
            # Kafedrasi yoki fani hisobotdan butunlay chiqarilgan (Kafedralar bo'limi) — klinik bo'lsa ham kirmaydi.
            "excluded": a["excluded"] == a["lessons"],
        })
    out.sort(key=lambda r: (not r["clinical"], -r["monitor_lessons"], -r["lessons"], r["name"]))
    in_scope = [r for r in out if r["clinical"] and not r["excluded"]]
    return {
        "subjects": out,
        "from": start.isoformat(),
        "to": end.isoformat(),
        "summary": {
            "subjects": len(out),
            "clinical": len(in_scope),
            "lessons": sum(r["lessons"] for r in out),
            "clinical_lessons": sum(r["lessons"] for r in in_scope),
            "clinical_monitor_lessons": sum(r["monitor_lessons"] for r in in_scope),
        },
    }


def set_override(db: Session, name: str, clinical: bool | None, *, by: str = "") -> dict:
    """Admin qarori. `None` — avtomatik qoidaga qaytarish."""
    key = cs.norm_subject(name)
    if not key:
        raise ValueError("Fan nomi bo'sh.")
    row = db.get(SubjectScope, key)
    if clinical is None:
        if row is not None:
            db.delete(row)
    elif row is None:
        db.add(SubjectScope(subject_key=key, subject_name=name.strip()[:300], clinical=clinical,
                            updated_by=by[:150]))
    else:
        row.clinical = clinical
        row.subject_name = name.strip()[:300]
        row.updated_by = by[:150]
    db.commit()
    invalidate_reports()
    return {"key": key, "override": clinical}


def invalidate_reports() -> None:
    """Fan qarori o'zgardi — hisobot keshlari tozalanadi (boshqa ishchilarda ≤5 daqiqa)."""
    cs.clear()
    try:
        from app.services import control_report_service as control

        control.clear_cache()
    except Exception:  # noqa: BLE001
        logger.warning("control cache clear failed", exc_info=True)
    try:
        from app.services.ai_response_cache import _redis

        r = _redis()
        keys = list(r.scan_iter("rx:overview:v1:*", count=500))
        if keys:
            r.delete(*keys)
    except Exception:  # noqa: BLE001
        logger.warning("shared overview cache clear failed", exc_info=True)


def room_scope(db: Session, start: dt.date, end: dt.date) -> dict[str, dict]:
    """Har monitor: davrdagi NAZORATDAGI darslar (klinik fan, amaliy) soni, o'qituvchilari va fanlari."""
    from app.services import lesson_report_service as lr

    lessons = lr._lessons(db, start, end, pending=True)
    acc: dict[str, dict] = defaultdict(lambda: {"lessons": 0, "subjects": Counter(), "teachers": set()})
    for x in lessons:
        if not x.monitor_id:
            continue
        o = acc[x.monitor_id]
        o["lessons"] += 1
        o["subjects"][x.subject_name] += 1
        o["teachers"].add(x.teacher_username or x.teacher_name)
    return {k: {"lessons": v["lessons"], "teachers": len(v["teachers"]),
                "subjects": [s for s, _ in v["subjects"].most_common(3)]} for k, v in acc.items()}
