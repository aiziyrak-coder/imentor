"""Dars dalillarining ikkinchi qatlami (2026-11-16): xona isboti, o'qituvchining 30 kunlik odati, test halolligi.

* Xona isboti — shu kuni o'sha monitorli xonada boshqa darslar iMentor'da o'tilganmi.
  O'tilgan bo'lsa «monitor ishlamadi» bahonasi yopiladi.
* 30 kunlik odat — shu dars o'qituvchining odatiy darsidan yaxshiroqmi yoki yomonroq.
* Test halolligi — savollar bo'yicha to'g'ri javob ulushi (savollar aralash tartibda, shuning uchun
  matni bo'yicha solishtiriladi), bir xil XATO javoblar (ko'chirish belgisi), juda tez topshirish.
"""

from __future__ import annotations

import datetime as dt
import statistics
from collections import defaultdict
from itertools import combinations

from sqlalchemy.orm import Session

from app.services import lesson_report_service as lrs

HISTORY_DAYS = 30
#: Bir savolga shundan kam soniya — "juda tez" (o'qimasdan belgilash).
FAST_SECONDS_PER_QUESTION = 8
#: Ko'chirish belgisi (2026-11-16 qat'iylashtirildi). Qiyin testda bir xil xato TASODIFAN ham ko'p uchraydi
#: (mashhur chalg'ituvchi variant), shuning uchun oddiy sanoq nohaq ayblaydi. Har savol uchun xato javoblar
#: taqsimotidan ikki talabaning tasodifan bir xil xato tanlash ehtimoli hisoblanadi; juftlik faqat kuzatilgan
#: mos xatolar kutilganidan kamida Z_MIN standart og'ishga ko'p va kamida SAME_WRONG_MIN ta bo'lsa ko'rsatiladi.
SAME_WRONG_MIN = 4
Z_MIN = 3.0

def room_day(db: Session, lesson, own_ids: set[int]) -> dict | None:
    """Shu kuni shu monitorli xonadagi BOSHQA darslar va ularning holati."""
    if not lesson.monitor_id:
        return None
    day = lesson.lesson_date
    rows = [x for x in lrs._lessons(db, day, day, pending=True, all_types=True)
            if x.monitor_id == lesson.monitor_id and x.id not in own_ids]
    now = lrs.current_time()
    over = [x for x in rows if lrs.is_over(x, now)]
    measured = lrs.measure_map(db, over) if over else {}
    out = []
    for x in sorted(rows, key=lambda r: r.start_time or r.para):
        m = measured.get(x.id) or {}
        out.append({
            "para": x.para, "start_time": x.start_time, "end_time": x.end_time,
            "teacher_name": x.teacher_name, "teacher_key": x.teacher_username or "",
            "subject": x.subject_name, "lesson_type": x.lesson_type,
            # Shu o'qituvchining o'z darsi — "boshqa o'qituvchi" emas (2026-11-16 tuzatish).
            "own": bool(lesson.teacher_username) and x.teacher_username == lesson.teacher_username,
            "pending": not lrs.is_over(x, now),
            # Xona ishlayotgani isboti — vaqt bo'yicha (test/keys qoidasi emas).
            "used": bool(m) and lrs.time_taught(m),
            "minutes": int(m.get("seconds", 0) or 0) // 60,
        })
    done = [r for r in out if not r["pending"]]
    return {"monitor_id": lesson.monitor_id, "room": lesson.auditorium_name, "lessons": out,
            "used": sum(1 for r in out if r["used"]),
            "others_done": sum(1 for r in done if not r["own"]),
            "others_used": sum(1 for r in done if not r["own"] and r["used"]),
            "own_done": sum(1 for r in done if r["own"]),
            "own_used": sum(1 for r in done if r["own"] and r["used"])}


def teacher_history(db: Session, owner: str, day: dt.date, this_id: int) -> dict | None:
    """O'qituvchining oxirgi 30 kundagi nazoratdagi darslari: o'tilgan ulushi, o'rtacha daqiqa,
    iMentor'ni odatda dars boshlanganidan necha daqiqa keyin ochishi."""
    if not owner:
        return None
    from app.services.control_report_service import _shared_get, _shared_put

    key = f"rx:teacherhist:v1:{owner}:{day.isoformat()}"
    cached = _shared_get(key, 30 * 60)
    if cached is not None:
        return cached
    value = _teacher_history(db, owner, day)
    _shared_put(key, value)
    return value


def _teacher_history(db: Session, owner: str, day: dt.date) -> dict:
    start = day - dt.timedelta(days=HISTORY_DAYS - 1)
    lessons = [x for x in lrs._lessons(db, start, day, teacher=owner) if x.monitor_id]
    if not lessons:
        return {"days": HISTORY_DAYS, "lessons": 0}
    measured = lrs.measure_map(db, lessons)
    from app.services.lesson_evidence import for_lessons

    evidence = for_lessons(db, lessons, lrs.clipped_windows(lessons))
    done = 0
    minutes = []
    late = []
    for x in lessons:
        m = measured.get(x.id) or {}
        if m and lrs.is_taught(m):
            done += 1
        minutes.append(int(m.get("seconds", 0) or 0) // 60)
        first = (evidence.get(x.id) or {}).get("first_event")
        if first:
            s, _ = lrs._scheduled(x)
            late.append(round((dt.datetime.fromisoformat(first) - s).total_seconds() / 60))
    return {
        "days": HISTORY_DAYS,
        "lessons": len(lessons),
        "done": done,
        "percent": round(100 * done / len(lessons)),
        "avg_minutes": round(sum(minutes) / len(minutes)),
        "median_late": round(statistics.median(late)) if late else None,
        "opened": len(late),
    }


def test_integrity(attempts: list, names: dict[str, str]) -> dict:
    """Savollar bo'yicha natija, bir xil xato javoblar va juda tez topshirganlar."""
    per_q: dict[str, dict] = {}
    wrong: dict[str, dict[str, str]] = defaultdict(dict)
    fast = []
    seen = set()
    for a in attempts:
        if a.student_id in seen:  # bir talabaning eng birinchi urinishi
            continue
        seen.add(a.student_id)
        qs = a.questions_snapshot or []
        ans = a.answers_final or []
        for i, q in enumerate(qs):
            if not isinstance(q, dict):
                continue
            text = " ".join(str(q.get("question") or "").split())
            if not text:
                continue
            options = q.get("options") or []
            pick = ans[i] if i < len(ans) and isinstance(ans[i], int) else -1
            slot = per_q.setdefault(text, {"question": text, "answered": 0, "correct": 0, "skipped": 0})
            if pick < 0:
                slot["skipped"] += 1
                continue
            slot["answered"] += 1
            if pick == q.get("correctOptionIndex"):
                slot["correct"] += 1
            elif 0 <= pick < len(options):
                wrong[a.student_id][text] = " ".join(str(options[pick]).split())
        if a.duration_sec and a.total and a.duration_sec / a.total < FAST_SECONDS_PER_QUESTION:
            fast.append({"student_id": a.student_id, "name": names.get(a.student_id, ""),
                         "seconds": a.duration_sec, "questions": a.total, "score": a.score})
    # Har savolda xato variantlar ulushi (shu savolga xato javob berganlar ichida).
    dist: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for answers in wrong.values():
        for q, opt in answers.items():
            dist[q][opt] += 1

    def chance(q: str) -> float:
        total = sum(dist[q].values())
        return sum((n / total) ** 2 for n in dist[q].values()) if total else 0.0

    pairs = []
    for x, y in combinations(sorted(wrong), 2):
        both = [q for q in wrong[x] if q in wrong[y]]
        same = sum(1 for q in both if wrong[x][q] == wrong[y][q])
        if same < SAME_WRONG_MIN:
            continue
        expected = sum(chance(q) for q in both)
        var = sum(chance(q) * (1 - chance(q)) for q in both)
        z = (same - expected) / (var ** 0.5) if var > 0 else 0.0
        # Dispersiya nol (hamma bir xil xato qilgan) — bu ko'chirish emas, savolning o'zi shunday.
        if z >= Z_MIN:
            pairs.append({"a": names.get(x, x), "b": names.get(y, y), "same_wrong": same, "both_wrong": len(both),
                          "expected": round(expected, 1), "wrong_a": len(wrong[x]), "wrong_b": len(wrong[y])})
    pairs.sort(key=lambda p: (-(p["same_wrong"] - p["expected"]), -p["same_wrong"]))
    questions = sorted(per_q.values(), key=lambda q: (q["correct"] / q["answered"]) if q["answered"] else 0)
    for q in questions:
        q["percent"] = round(100 * q["correct"] / q["answered"]) if q["answered"] else None
        q["question"] = q["question"][:600]
    return {"students": len(seen), "questions": questions, "same_wrong_pairs": pairs[:8], "fast": fast}
