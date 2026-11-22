"""Rektor hisoboti, TALABALAR: natijalar arxivi va bilim dinamikasi (2026-10-23).

Rektor talabi: "qaysi talaba qaysi mavzudan qaysi sanada necha baho olgan — doimiy
saqlansin; bilimi o'syaptimi, pasayaptimi — fan bo'yicha; faqat o'qituvchilar
nazoratida hisobga olinayotgan kafedralarda o'qiydigan talabalar; jami nechta".

* Qamrov — shu davrda o'qituvchilar nazoratida sanaladigan darsi (monitorli xona,
  sanaladigan tur, hisobotdan chiqarilmagan kafedra) bo'lgan guruhlarning faol
  talabalari (`student_report_service.lesson_scope`, "monitor").
* Natijalar — `core_studentresult` arxividan, faqat shunday darslarda topshirilgani
  (`in_scope`).
* Dinamika — fan bo'yicha, o'quv yili boshidan: natijalar vaqt tartibida ikkiga
  bo'linadi, keyingi yarmining o'rtachasi oldingisidan `TREND_POINTS` foiz punkt
  yuqori bo'lsa — o'syapti, past bo'lsa — pasayapti. Fanda `TREND_MIN` dan kam natija
  bo'lsa — baho berilmaydi ("kam").
* Hisobotdan keyinroq chiqarilgan kafedra yoki fan natijalari o'qishda tashlanadi
  (arxivdagi `in_scope` yozilgan paytdagi holat).
"""

from __future__ import annotations

import datetime as dt
from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.student_contingent import StudentContingent
from app.models.student_result import StudentResult
from app.services import student_report_service as sr
from app.services.student_report_service import grade_of

#: Test 10 savollik — natija 10 foizlik qadam bilan o'zgaradi. 2026-10-23 gacha 3 natija
#: va 8 punkt edi: bitta savol farqi (10 punkt) ham "pasayapti" deb chiqardi, ya'ni
#: 3 natijada bir natija boshqasiga solishtirilardi. Endi har yarmida kamida 2 ta natija
#: va o'rtacha kamida bir savoldan ortiq farq.
TREND_MIN = 4
TREND_POINTS = 10
TRENDS = ("up", "down", "flat", "few")


def academic_year_start(day: dt.date) -> dt.date:
    return dt.date(day.year if day.month >= 9 else day.year - 1, 9, 1)


def trend_of(percents: list[int]) -> tuple[str, int | None]:
    """("up" | "down" | "flat" | "few", farq foiz punktda). Natijalar vaqt tartibida."""
    n = len(percents)
    if n < TREND_MIN:
        return "few", None
    half = n // 2
    early = sum(percents[:half]) / half
    late = sum(percents[n - half:]) / half
    delta = round(late - early)
    if delta >= TREND_POINTS:
        return "up", delta
    if delta <= -TREND_POINTS:
        return "down", delta
    return "flat", delta


def overall_trend(subjects: list[tuple[str, int | None, int]]) -> tuple[str, int | None]:
    """Fanlar dinamikasidan umumiy: (yo'nalish, farq, natijalar soni) — soni bo'yicha o'rtacha."""
    rated = [(d, n) for t, d, n in subjects if t != "few" and d is not None]
    if not rated:
        return "few", None
    delta = round(sum(d * n for d, n in rated) / sum(n for _d, n in rated))
    if delta >= TREND_POINTS:
        return "up", delta
    if delta <= -TREND_POINTS:
        return "down", delta
    return "flat", delta


def _department_match(db: Session, department: str):
    """Arxivda kafedra RASMIY nomi bilan yozilgan — aniq tenglik.

    `department_filter` HEMIS yozilishlari uchun: katalogda yo'q nomda qism-matn
    o'xshashligiga o'tadi va "Pediatriya" "…, Pediatriya 2" ni ham olardi (2026-10-23).
    """
    if not department:
        return lambda _name: True
    from app.services.dean_access import official_of

    want = official_of(department) or department.strip()
    seen: dict[str, bool] = {}

    def match(name: str) -> bool:
        key = name or ""
        if key not in seen:
            seen[key] = bool(key) and (official_of(key) or key.strip()) == want
        return seen[key]

    return match


def _not_excluded(db: Session):
    """Arxivga yozilgandan keyin hisobotdan chiqarilgan kafedra yoki fan natijasi sanalmaydi."""
    from app.services import report_exclusion

    ex = report_exclusion.load(db)
    return lambda r: not ex.department_excluded(r.department) and not ex.subject_excluded(
        r.subject_name, r.subject_code, department=r.department)


def _results(db: Session, student_ids: list[str], start: dt.date, end: dt.date, *, light: bool = False) -> list:
    """Qamrovdagi natijalar. `light` — ro'yxat uchun faqat kerakli ustunlar (ORM obyektisiz, tezroq)."""
    if not student_ids:
        return []
    cols = (StudentResult.student_id, StudentResult.lesson_date, StudentResult.submitted_at, StudentResult.percent,
            StudentResult.subject_name, StudentResult.subject_code, StudentResult.department)
    out: list = []
    for i in range(0, len(student_ids), 1000):
        stmt = select(*cols) if light else select(StudentResult)
        res = db.execute(
            stmt.where(
                StudentResult.student_id.in_(student_ids[i:i + 1000]),
                StudentResult.in_scope.is_(True),
                StudentResult.lesson_date >= start,
                StudentResult.lesson_date <= end,
            ).order_by(StudentResult.submitted_at)
        )
        out += res.all() if light else res.scalars().all()
    return out


def in_scope_students(db: Session, start: dt.date, end: dt.date, *, faculty: str = "", group: str = "",
                      course: int | None = None, query: str = "", department: str = "",
                      groups: tuple[str, ...] = ()) -> dict[str, StudentContingent]:
    area = sr.lesson_scope(db, start, end, scope="monitor", department=department, groups=groups)
    people = sr._contingent(db, groups)
    if area is not None:
        people = {sid: row for sid, row in people.items() if area.has(row.group_name)}
    return sr._wanted(people, faculty=faculty, group=group, course=course, query=query)


def _subject_key(r: StudentResult) -> str:
    return (r.subject_name or r.subject_code or "—").strip()


#: Asosiy hisob (davr, kafedra, fan, dekan guruhlari bo'yicha) 2 daqiqa saqlanadi:
#: sahifa har daqiqada yangilanadi, hisob esa ~5 soniya. Qidiruv, fakultet, kurs, guruh
#: va dinamika filtrlari tayyor hisob ustidan — har harf terilganda qayta hisoblanmaydi.
CACHE_SECONDS = 120
_cache: dict[tuple, tuple[float, dict]] = {}


def roster(db: Session, start: dt.date, end: dt.date, *, faculty: str = "", group: str = "",
           course: int | None = None, subject_code: str = "", query: str = "", department: str = "",
           trend: str = "", groups: tuple[str, ...] = ()) -> dict:
    import time

    key = (start, end, subject_code, department, tuple(groups))
    hit = _cache.get(key)
    if hit and time.monotonic() - hit[0] < CACHE_SECONDS:
        base = hit[1]
    else:
        base = _base(db, start, end, subject_code=subject_code, department=department, groups=groups)
        if len(_cache) > 64:
            _cache.clear()
        _cache[key] = (time.monotonic(), base)
    q = query.casefold()
    rows = [r for r in base["students"]
            if (not faculty or r["faculty"] == faculty)
            and (not group or r["group_name"] == group)
            and (course is None or int(r["course"] or 0) == course)
            and (not q or q in f"{r['full_name']} {r['student_id']}".casefold())]
    # Tepadagi raqamlar dinamika filtridan OLDIN (2026-10-23): ilgari "Pasayapti"
    # bosilganda "Qamrovdagi talabalar" ham pasayayotganlar soniga tushib qolardi.
    tested = [r for r in rows if r["tests"]]
    results = sum(r["tests"] for r in tested)
    grades = {5: 0, 4: 0, 3: 0, 2: 0}
    trends = {t: 0 for t in TRENDS}
    for r in rows:
        trends[r["trend"]] += 1
        if r["tests"]:
            grades[r["grade"] or 2] += 1
    percent_sum = sum(r["_percent_sum"] for r in tested)
    students = [{k: v for k, v in r.items() if not k.startswith("_")} for r in rows if not trend or r["trend"] == trend]
    return {
        "from": start.isoformat(),
        "to": end.isoformat(),
        "year_from": base["year_from"],
        "headline": {
            "students": len(rows),
            "tested": len(tested),
            "never": len(rows) - len(tested),
            "results": results,
            "percent": round(percent_sum / results) if results else None,
            "grades": grades,
            "trend": trends,
        },
        "students": students,
    }


def _base(db: Session, start: dt.date, end: dt.date, *, subject_code: str = "", department: str = "",
          groups: tuple[str, ...] = ()) -> dict:
    people = in_scope_students(db, start, end, department=department, groups=groups)
    year_start = academic_year_start(end)
    dep_ok = _department_match(db, department)
    keep = _not_excluded(db)
    rows = [r for r in _results(db, list(people), min(year_start, start), end, light=True)
            if dep_ok(r.department) and keep(r) and (not subject_code or r.subject_code == subject_code)]
    by_student: dict[str, list] = defaultdict(list)
    for r in rows:
        by_student[r.student_id].append(r)

    students = []
    for sid, st in people.items():
        mine = by_student.get(sid, [])
        period = [r for r in mine if start <= r.lesson_date <= end]
        year = [r for r in mine if r.lesson_date >= year_start]
        per_subject: dict[str, list[int]] = defaultdict(list)
        for r in year:
            per_subject[_subject_key(r)].append(int(r.percent))
        subject_trends = [(*trend_of(p), len(p)) for p in per_subject.values()]
        label, delta = overall_trend(subject_trends)
        percent_sum = sum(int(r.percent) for r in period)
        percent = round(percent_sum / len(period)) if period else None
        students.append({
            "student_key": f"ot_{sid}",
            "student_id": sid,
            "full_name": sr._full_name(st),
            "group_name": st.group_name or "",
            "course": st.course,
            "faculty": st.faculty_name or "",
            "tests": len(period),
            "percent": percent,
            "grade": grade_of(percent) if percent is not None else None,
            "trend": label,
            "trend_delta": delta,
            "subjects": len(per_subject),
            "falling_subjects": sum(1 for t, _d, _n in subject_trends if t == "down"),
            # O'quv yili boshidan (davr avgustdan boshlansa ham sentyabrdan oldingisi kirmaydi).
            "year_tests": len(year),
            "last_date": period[-1].lesson_date.isoformat() if period else None,
            "_percent_sum": percent_sum,
        })
    students.sort(key=lambda s: (s["tests"] == 0, s["full_name"].casefold()))
    return {"year_from": year_start.isoformat(), "students": students}


def profile(db: Session, student_key: str, end: dt.date, *, groups: tuple[str, ...] = ()) -> dict:
    """Bitta talaba: o'quv yili boshidan har fan bo'yicha barcha natijalar va dinamika."""
    sid = student_key.replace("ot_", "").strip()
    st = db.execute(
        select(StudentContingent).where(StudentContingent.student_id == sid)
        .order_by(StudentContingent.status != "active", StudentContingent.id.desc())
    ).scalars().first()
    if st is None:
        raise LookupError("Talaba topilmadi.")
    if groups and not sr.in_groups(st.group_name, groups):
        raise PermissionError("Bu talaba sizning guruhlaringizda emas.")
    year_start = academic_year_start(end)
    keep = _not_excluded(db)
    rows = [r for r in _results(db, [sid], year_start, end) if keep(r)]
    by_subject: dict[str, list[StudentResult]] = defaultdict(list)
    for r in rows:
        by_subject[_subject_key(r)].append(r)
    subjects = []
    for name, items in by_subject.items():
        percents = [int(r.percent) for r in items]
        label, delta = trend_of(percents)
        avg = round(sum(percents) / len(percents))
        subjects.append({
            "subject": name,
            "department": next((r.department for r in reversed(items) if r.department), ""),
            "tests": len(items),
            "percent": avg,
            "grade": grade_of(avg),
            "trend": label,
            "trend_delta": delta,
            "first_date": items[0].lesson_date.isoformat(),
            "last_date": items[-1].lesson_date.isoformat(),
            "results": [{
                "attempt_id": r.attempt_id,
                "date": r.lesson_date.isoformat(),
                "para": r.para,
                "topic": r.topic,
                "teacher": r.teacher_name or r.teacher_username,
                "score": r.score,
                "total": r.total,
                "percent": r.percent,
                "grade": r.grade,
            } for r in reversed(items)],
        })
    subjects.sort(key=lambda s: (-s["tests"], s["subject"]))
    label, delta = overall_trend([(s["trend"], s["trend_delta"], s["tests"]) for s in subjects])
    percent = round(sum(r.percent for r in rows) / len(rows)) if rows else None
    # Haftalik o'rtacha — umumiy dinamika grafigi uchun.
    weeks: dict[dt.date, list[int]] = defaultdict(list)
    for r in rows:
        weeks[r.lesson_date - dt.timedelta(days=r.lesson_date.weekday())].append(int(r.percent))
    return {
        "student": {
            "student_key": f"ot_{sid}",
            "student_id": sid,
            "full_name": sr._full_name(st),
            "group_name": st.group_name or "",
            "course": st.course,
            "faculty": st.faculty_name or "",
            "direction": st.direction_name or "",
            "status": st.status,
        },
        "year_from": year_start.isoformat(),
        "to": end.isoformat(),
        "summary": {"tests": len(rows), "percent": percent, "grade": grade_of(percent) if percent is not None else None,
                    "trend": label, "trend_delta": delta, "subjects": len(subjects),
                    "falling_subjects": sum(1 for s in subjects if s["trend"] == "down")},
        "weeks": [{"week_start": w.isoformat(), "percent": round(sum(p) / len(p)), "tests": len(p)}
                  for w, p in sorted(weeks.items())],
        "subjects": subjects,
    }
