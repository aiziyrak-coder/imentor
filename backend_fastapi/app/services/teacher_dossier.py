"""O'qituvchining davr bo'yicha dalillar jadvali (2026-11-16).

Rektor: «yana kuchaytiring» — bitta dars emas, o'qituvchining HAMMA nazoratdagi darslari bitta jadvalda,
har birida aniq dalil: necha daqiqa kech ochgan, dars vaqtining necha foizida faol, eng uzun tanaffus,
qaysi tarmoqdan, QR bilan xona kompyuteriga kirganmi, guruhdan nechta talaba faol, HEMIS'da nechta baho.

Eng kuchli belgi: HEMIS'da shu darsga baho qo'yilgan, lekin iMentor umuman ochilmagan.

Hammasi bir necha so'rov bilan (dars boshiga so'rov yo'q); HEMIS baholari parallel olinadi va keshlanadi.
"""

from __future__ import annotations

import datetime as dt
import statistics
from bisect import bisect_left
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.models.analytics import StudentTestAttempt, UserActivityEvent
from app.models.device_pairing import DevicePairingSession
from app.models.hemis_lesson import HemisLesson
from app.models.live_test import LiveTestSession
from app.models.student_contingent import StudentContingent
from app.services import lesson_report_service as lrs
from app.services.lesson_proof import HEARTBEAT_CAP, _aware, _campus_nets, _minute

LATE_FLAG = 10
MAX_LESSONS = 160


def _grades_for(lessons_by_id: dict[int, list[str]], day_of: dict[int, dt.date]) -> tuple[dict[int, int], bool]:
    """Har dars uchun HEMIS'da qo'yilgan baholar soni. (natija, xato bo'ldimi)."""
    from app.services.lesson_detail_service import hemis_grades

    def one(item):
        lid, hids = item
        rows, err = hemis_grades(hids, day_of[lid])
        return lid, len({r["hemis_student"] for r in rows if r.get("grade") is not None}), bool(err)

    out: dict[int, int] = {}
    failed = False
    with ThreadPoolExecutor(max_workers=3) as pool:
        for lid, n, err in pool.map(one, lessons_by_id.items()):
            out[lid] = n
            failed = failed or err
    return out, failed


def build(db: Session, owner: str, start_day: dt.date, end_day: dt.date, *,
          groups: tuple[str, ...] = (), with_hemis: bool = True) -> dict:
    # O'qituvchi oynasidagi «Nazoratdagi» bilan bir xil: baholanadigan darslar va iMentor'da o'tilgan
    # boshqa turdagi (masalan, laboratoriya) darslar.
    pool = [x for x in lrs._lessons(db, start_day, end_day, teacher=owner, groups=groups, all_types=True) if x.monitor_id]
    pool.sort(key=lambda x: (x.lesson_date, x.start_time or x.para))
    pool = pool[-MAX_LESSONS:]
    if not pool:
        return {"rows": [], "summary": {"lessons": 0}, "hemis_error": False}
    counted = [x for x in pool if lrs.is_counted(x)]
    other = [x for x in pool if not lrs.is_counted(x)]
    measured = {**(lrs.measure_map(db, other) if other else {}), **(lrs.measure_map(db, counted) if counted else {})}
    lessons = [x for x in pool if lrs.is_counted(x) or (x.id in measured and lrs.is_taught(measured[x.id]))]
    if not lessons:
        return {"rows": [], "summary": {"lessons": 0}, "hemis_error": False}
    windows = lrs.clipped_windows(pool)
    lo = min(windows[x.id][0] for x in lessons)
    hi = max(windows[x.id][1] for x in lessons)

    # O'qituvchi hodisalari — bitta so'rov.
    events = db.execute(select(UserActivityEvent.occurred_at, UserActivityEvent.event_type,
                               UserActivityEvent.duration_sec, UserActivityEvent.meta)
                        .where(UserActivityEvent.owner_key == owner, UserActivityEvent.occurred_at >= lo,
                               UserActivityEvent.occurred_at < hi)
                        .order_by(UserActivityEvent.occurred_at)).all()
    ev_times = [_aware(e[0]) for e in events]

    # Guruhlar: barcha qatorlar (HEMIS har guruhga alohida) — hemis_id va guruh nomlari.
    sib = db.execute(select(HemisLesson).where(
        HemisLesson.teacher_username == owner, HemisLesson.lesson_date >= start_day,
        HemisLesson.lesson_date <= end_day)).scalars().all()
    by_key: dict[tuple, list[HemisLesson]] = defaultdict(list)
    for r in sib:
        if getattr(r, "hemis_status", "") != "missing_from_hemis":
            by_key[lrs.lesson_key(r)].append(r)
    groups_of = {x.id: sorted({r.group_name for r in by_key.get(lrs.lesson_key(x), [x]) if r.group_name}) for x in lessons}
    hemis_of = {x.id: [r.hemis_id for r in by_key.get(lrs.lesson_key(x), [x]) if r.hemis_id] for x in lessons}
    all_groups = sorted({g for v in groups_of.values() for g in v})

    roster = dict(db.execute(select(StudentContingent.group_name, func.count())
                             .where(StudentContingent.group_name.in_(all_groups),
                                    StudentContingent.status.in_(("active", "")))
                             .group_by(StudentContingent.group_name)).all()) if all_groups else {}

    # Talabalar hodisalari — bitta so'rov, guruh bo'yicha.
    srows = db.execute(text(
        "select c.group_name, c.student_id, e.occurred_at from core_useractivityevent e "
        "join core_studentcontingent c on c.student_id = regexp_replace(e.owner_key, '^ot_', '') "
        "where e.role = 'student' and e.occurred_at >= :lo and e.occurred_at < :hi and c.group_name = any(:g)"
    ), {"lo": lo, "hi": hi, "g": all_groups}).all() if all_groups else []
    s_by_group: dict[str, list[tuple[dt.datetime, str]]] = defaultdict(list)
    for g, sid, when in srows:
        s_by_group[g].append((_aware(when), sid))
    for v in s_by_group.values():
        v.sort()
    s_times = {g: [w for w, _ in v] for g, v in s_by_group.items()}

    pairings = db.execute(select(DevicePairingSession.picked_up_at, DevicePairingSession.confirmed_at)
                          .where(DevicePairingSession.owner_key == owner,
                                 DevicePairingSession.created_at >= lo - dt.timedelta(hours=3),
                                 DevicePairingSession.created_at < hi,
                                 DevicePairingSession.status.in_(("picked_up", "confirmed")))).all()
    qr_times = sorted(_aware(a or b) for a, b in pairings if (a or b))

    sessions = db.execute(select(LiveTestSession.id, LiveTestSession.created_at)
                          .where(LiveTestSession.owner_key == owner, LiveTestSession.created_at >= lo,
                                 LiveTestSession.created_at < hi)).all()
    tested = dict(db.execute(select(StudentTestAttempt.session_id, func.count(func.distinct(StudentTestAttempt.student_id)))
                             .where(StudentTestAttempt.session_id.in_([s[0] for s in sessions]))
                             .group_by(StudentTestAttempt.session_id)).all()) if sessions else {}

    grades: dict[int, int] = {}
    hemis_failed = False
    if with_hemis:
        grades, hemis_failed = _grades_for({k: v for k, v in hemis_of.items() if v}, {x.id: x.lesson_date for x in lessons})

    campus_by_day: dict[dt.date, set] = {}
    rows = []
    for x in lessons:
        w0, w1 = windows[x.id]
        s0, s1 = lrs._scheduled(x)
        a, b = bisect_left(ev_times, w0), bisect_left(ev_times, w1)
        mine = events[a:b]
        active: set = set()
        nets: set = set()
        first = last = None
        for when, kind, dur, meta in mine:
            when = _aware(when)
            first = first or when
            last = when
            if (meta or {}).get("ip_hash"):
                nets.add(meta["ip_hash"])
            if kind == "heartbeat":
                st = when - dt.timedelta(seconds=min(max(0, int(dur or 0)), HEARTBEAT_CAP) or 30)
                m = _minute(st)
                while m <= _minute(when):
                    if s0 <= m < s1:
                        active.add(m)
                    m += dt.timedelta(minutes=1)
        length = max(1, int((s1 - s0).total_seconds() // 60))
        # Eng uzun harakatsiz oraliq (dars ichida, faqat ochilgan darsda).
        max_gap = 0
        if active:
            run = 0
            m = _minute(s0)
            while m < s1:
                run = 0 if m in active else run + 1
                max_gap = max(max_gap, run)
                m += dt.timedelta(minutes=1)
        if nets and x.lesson_date not in campus_by_day:
            campus_by_day[x.lesson_date] = _campus_nets(db, x.lesson_date)
        campus = campus_by_day.get(x.lesson_date, set())
        net = "none" if not nets else ("campus" if nets <= campus else "outside")
        students = set()
        for g in groups_of[x.id]:
            ts = s_times.get(g, [])
            i, j = bisect_left(ts, w0), bisect_left(ts, w1)
            students.update(sid for _, sid in s_by_group[g][i:j])
        n_tested = sum(tested.get(sid_, 0) for sid_, created in sessions if w0 <= _aware(created) < w1)
        m = measured.get(x.id) or {}
        used = bool(m) and lrs.is_taught(m)
        minutes = int(m.get("seconds", 0) or 0) // 60
        late = round((first - s0).total_seconds() / 60) if first else None
        early = round((s1 - last).total_seconds() / 60) if last else None
        graded = grades.get(x.id)
        # Belgilar faqat ANIQ holatlar uchun (2026-11-16 tuzatish). «Ochilmagan» — hisobotdagi bilan bir xil:
        # dars oynasida HECH QANDAY dalil yo'q (o'qituvchi ishi, jonli test, QR, talabalar). Talabalar testi
        # yoki ketma-ket paralar bloki bilan o'tilgan dars o'qituvchi hisobida qayd bo'lmasa ham ochilmagan EMAS.
        # Dars ichidagi tanaffus va erta to'xtash — odatiy hol (doskada tushuntirish), belgi emas, faqat ustun.
        trace = x.id in measured
        flags = []
        if not trace:
            flags.append("not_opened")
            if graded:
                flags.append("graded_not_opened")
        elif not used and lrs.time_taught(m):
            flags.append("misuse")  # vaqt yetarli, lekin test/keys yo'q yoki kam (2026-11-19)
        elif not used:
            flags.append("short")
        if late is not None and late > LATE_FLAG:
            flags.append("late")
        if net == "outside":
            flags.append("outside")
        rows.append({
            "id": x.id, "date": x.lesson_date.isoformat(), "weekday": x.weekday, "para": x.para,
            "start_time": x.start_time, "end_time": x.end_time, "subject": x.subject_name,
            "group": ", ".join(groups_of[x.id]), "room": x.auditorium_name, "lesson_type": x.lesson_type,
            "used": used, "minutes": minutes, "verdict": lrs.lesson_verdict(m), "modules": lrs.module_info(m),
            "first": first.isoformat() if first else None, "late": late, "early": early,
            "coverage": round(100 * len(active) / length), "max_gap": max_gap, "network": net,
            "qr": any(w0 - dt.timedelta(hours=3) <= t < w1 for t in qr_times),
            "students_active": len(students), "roster": sum(int(roster.get(g, 0)) for g in groups_of[x.id]),
            "tested": n_tested, "hemis_graded": graded, "flags": flags, "trace": trace,
        })

    opened = [r for r in rows if r["first"]]
    lates = [r["late"] for r in opened if r["late"] is not None]
    count = lambda f: sum(1 for r in rows if f in r["flags"])  # noqa: E731
    summary = {
        "lessons": len(rows),
        "used": sum(1 for r in rows if r["used"]),
        "opened": len(opened),
        "median_late": round(statistics.median(lates)) if lates else None,
        "avg_coverage": round(sum(r["coverage"] for r in opened) / len(opened)) if opened else 0,
        "flags": {f: count(f) for f in ("graded_not_opened", "not_opened", "short", "misuse", "late", "outside")},
        "qr": sum(1 for r in rows if r["qr"]),
        "hemis_graded_lessons": sum(1 for r in rows if r["hemis_graded"]),
    }
    rows.reverse()  # eng yangisi tepada
    return {"rows": rows, "summary": summary, "hemis_error": hemis_failed}
