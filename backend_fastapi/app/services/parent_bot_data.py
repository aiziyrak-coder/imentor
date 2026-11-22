"""Ota-onalar boti uchun ma'lumot: HEMIS kontingenti, dars jadvali, test urinishlari.

Manbalar (hammasi faqat o'qiladi):
* `core_studentcontingent` — fakultet, kurs, guruh, talaba (HEMIS'dan har kuni);
* `core_hemislesson` — guruhning shu kungi paralari (HEMIS'dan har 10 daqiqada);
* `core_studenttestattempt` + `core_livetestsession` — test natijasi va uning holati.

Natija qachon ko'rsatiladi: o'qituvchi testni yakunlagan bo'lsa (sinfdagi
«Testni tahlil qilish» qoidasi bilan bir xil) yoki talaba topshirganiga
`RELEASE_AFTER` bo'lgan bo'lsa — ya'ni dars tugagan. Dars davomida ota-onaga ham,
talabaga ham ball ketmaydi.
"""

from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass, field

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models.analytics import StudentTestAttempt
from app.models.hemis_lesson import HemisLesson
from app.models.live_test import LiveTestSession
from app.models.student_contingent import StudentContingent
from app.services.analytics_service import TASHKENT_TZ
from app.services.live_test_service import subject_names_for_codes
from app.services.student_report_service import grade_of

TZ = TASHKENT_TZ
RELEASE_AFTER = dt.timedelta(minutes=90)
#: Dars oynasi: boshlanishidan oldin va tugaganidan keyin topshirilgan test ham shu darsniki.
BEFORE_LESSON = dt.timedelta(minutes=15)
AFTER_LESSON = dt.timedelta(minutes=45)
#: «Guruhda test bo'ldi, farzandingiz natijasi yo'q» — kamida shuncha guruhdosh topshirgan bo'lsa.
MISSED_MIN_MATES = 3


@dataclass
class Lesson:
    para: str
    start: str
    end: str
    subject: str
    kind: str = ""
    teacher: str = ""
    day: dt.date | None = None

    def at(self, hhmm: str) -> dt.datetime | None:
        try:
            h, m = (int(x) for x in hhmm.split(":")[:2])
        except (ValueError, AttributeError):
            return None
        if self.day is None:
            return None
        return dt.datetime(self.day.year, self.day.month, self.day.day, h, m, tzinfo=TZ)

    @property
    def starts(self) -> dt.datetime | None:
        return self.at(self.start)

    @property
    def ends(self) -> dt.datetime | None:
        return self.at(self.end)


@dataclass
class Attempt:
    id: int
    student_id: str
    session_id: int
    owner: str
    subject_code: str
    topic: str
    score: int
    total: int
    submitted_at: dt.datetime
    closed: bool

    @property
    def local(self) -> dt.datetime:
        return self.submitted_at.astimezone(TZ)

    @property
    def pct(self) -> int:
        return pct(self.score, self.total)


@dataclass
class DayEntry:
    lesson: Lesson | None
    results: list[Attempt] = field(default_factory=list)
    pending: bool = False
    missed: int = 0


def pct(score: int, total: int) -> int:
    return round(100 * score / total) if total else 0


def grade(score: int, total: int) -> int:
    return grade_of(pct(score, total)) or 2


def released(a: Attempt, now: dt.datetime) -> bool:
    return a.closed or now - a.submitted_at >= RELEASE_AFTER


def natural_key(text: str) -> tuple:
    return tuple(int(p) if p.isdigit() else p.casefold() for p in re.split(r"(\d+)", text or ""))


def student_failures(db: Session, student_id: str, day: dt.date) -> int:
    from app.models.parent_bot import ParentBotVerifyFail

    return int(db.execute(select(ParentBotVerifyFail.fails).where(
        ParentBotVerifyFail.student_id == student_id, ParentBotVerifyFail.day == day)).scalar() or 0)


def add_student_failure(db: Session, student_id: str, day: dt.date) -> None:
    from sqlalchemy.dialects.postgresql import insert

    from app.models.parent_bot import ParentBotVerifyFail

    db.execute(insert(ParentBotVerifyFail).values(student_id=student_id, day=day, fails=1)
               .on_conflict_do_update(constraint="uq_parentbotverifyfail_student_day",
                                      set_={"fails": ParentBotVerifyFail.fails + 1}))


def masked_name(name: str) -> str:
    """"AZIZOV AZIZ AZIZOVICH" → "AZIZOV A." — tasdiqlashdan oldingi ro'yxat uchun.

    Botga istalgan odam kira oladi: guruhdagi har talabaning to'liq ismi ochiq
    ko'rinmasin (2026-10-23). Ota-ona farzandini familiyasi va ismining harfidan taniydi.
    """
    words = str(name or "").split()
    if len(words) < 2:
        return " ".join(words)
    return f"{words[0]} {words[1][0]}."


def full_name(row: StudentContingent) -> str:
    return " ".join(x for x in ((row.last_name or "").strip(), (row.first_name or "").strip()) if x) or "—"


# ------------------------------------------------------------------ kontingent

def _active():
    return StudentContingent.status == "active"


def faculties(db: Session) -> list[str]:
    rows = db.execute(
        select(StudentContingent.faculty_name, func.count())
        .where(_active(), StudentContingent.faculty_name != "")
        .group_by(StudentContingent.faculty_name)
        .order_by(func.count().desc())
    ).all()
    return [name for name, _n in rows]


def courses(db: Session, faculty: str) -> list[int]:
    rows = db.execute(
        select(StudentContingent.course).distinct()
        .where(_active(), StudentContingent.faculty_name == faculty, StudentContingent.course.is_not(None))
    ).scalars().all()
    return sorted(int(c) for c in rows)


def groups(db: Session, faculty: str, course: int) -> list[str]:
    rows = db.execute(
        select(StudentContingent.group_name).distinct()
        .where(_active(), StudentContingent.faculty_name == faculty, StudentContingent.course == course,
               StudentContingent.group_name != "")
    ).scalars().all()
    return sorted(rows, key=natural_key)


def students(db: Session, group: str) -> list[tuple[str, str]]:
    rows = db.execute(
        select(StudentContingent)
        .where(_active(), StudentContingent.group_name == group, StudentContingent.student_id != "")
    ).scalars().all()
    out = [(r.student_id, full_name(r)) for r in rows]
    return sorted(out, key=lambda x: x[1].casefold())


def student(db: Session, student_id: str) -> StudentContingent | None:
    if not student_id:
        return None
    return db.execute(
        select(StudentContingent).where(StudentContingent.student_id == student_id)
        .order_by(StudentContingent.status != "active", StudentContingent.id.desc())
    ).scalars().first()


def students_by_id(db: Session, student_ids: list[str]) -> dict[str, StudentContingent]:
    if not student_ids:
        return {}
    rows = db.execute(
        select(StudentContingent).where(StudentContingent.student_id.in_(student_ids))
        .order_by(StudentContingent.status != "active", StudentContingent.id.desc())
    ).scalars().all()
    out: dict[str, StudentContingent] = {}
    for r in rows:
        out.setdefault(r.student_id, r)
    return out


# ------------------------------------------------------------------ dars jadvali

def lessons_on(db: Session, group: str, day: dt.date) -> list[Lesson]:
    if not group:
        return []
    rows = db.execute(
        select(HemisLesson)
        .where(HemisLesson.group_name == group, HemisLesson.lesson_date == day,
               HemisLesson.hemis_status != "missing_from_hemis")
        .order_by(HemisLesson.start_time, HemisLesson.id)
    ).scalars().all()
    out: list[Lesson] = []
    seen: set[tuple] = set()
    for r in rows:
        key = (r.para, r.subject_name, r.teacher_username)
        if key in seen:
            continue
        seen.add(key)
        out.append(Lesson(para=r.para or "", start=r.start_time or "", end=r.end_time or "",
                          subject=r.subject_name or "", kind=r.lesson_type or "",
                          teacher=r.teacher_username or "", day=r.lesson_date))
    return out


def lessons_between(db: Session, group: str, start: dt.date, end: dt.date) -> dict[dt.date, list[Lesson]]:
    if not group:
        return {}
    rows = db.execute(
        select(HemisLesson)
        .where(HemisLesson.group_name == group, HemisLesson.lesson_date >= start, HemisLesson.lesson_date <= end,
               HemisLesson.hemis_status != "missing_from_hemis")
        .order_by(HemisLesson.lesson_date, HemisLesson.start_time, HemisLesson.id)
    ).scalars().all()
    out: dict[dt.date, list[Lesson]] = {}
    for r in rows:
        out.setdefault(r.lesson_date, []).append(
            Lesson(para=r.para or "", start=r.start_time or "", end=r.end_time or "", subject=r.subject_name or "",
                   kind=r.lesson_type or "", teacher=r.teacher_username or "", day=r.lesson_date))
    return out


_SYLLABUS_NOISE = re.compile(r"\s*\(\s*(?:xalqaro|milliy|international)\s*\)", re.I)
_SYLLABUS_SEMESTER = re.compile(r"^(.*?)\s*\b\d+\s*-?\s*semestr\b\s*\|?\s*(.*)$", re.I)
_SYLLABUS_YEARS = re.compile(r"\s*\b\d{4}\s*[-–]\s*\d{4}\b.*$")
_SYLLABUS_TAIL = re.compile(r"[\s,|]+\d+\s*-?\s*(?:kurs|semestr|sm|s|k)\b.*$", re.I)


def clean_subject(name: str) -> str:
    """Sillabus nomidan yo'nalish, o'quv yili va semestrni olib tashlaydi (HEMIS nomi bo'lmaganda)."""
    name = (name or "").strip()
    base = _SYLLABUS_NOISE.sub("", name)
    m = _SYLLABUS_SEMESTER.match(base)
    cand = (m.group(2).strip(" |") or m.group(1)) if m else base
    cand = _SYLLABUS_TAIL.sub("", _SYLLABUS_YEARS.sub("", cand)).strip(" ,|")
    return cand or name


def match_lesson(lessons: list[Lesson], when: dt.datetime, owner: str) -> Lesson | None:
    """Test qaysi darsda bo'lgan: vaqt oynasi ichida, testni o'tkazgan o'qituvchining darsi afzal."""
    when = when.astimezone(TZ)
    best, best_key = None, None
    for lesson in lessons:
        start, end = lesson.starts, lesson.ends
        if start is None or end is None or not (start - BEFORE_LESSON <= when <= end + AFTER_LESSON):
            continue
        inside = start <= when <= end
        gap = 0 if inside else min(abs((when - start).total_seconds()), abs((when - end).total_seconds()))
        key = (bool(owner) and lesson.teacher == owner, inside, -gap)
        if best_key is None or key > best_key:
            best, best_key = lesson, key
    return best


# ------------------------------------------------------------------ test urinishlari

def _attempt_query():
    # Faqat kerakli ustunlar (2026-10-23): butun urinish (JSONB savollar, javoblar va
    # har bir voqea uchun alohida so'rov) kunlik hisobotda har farzand uchun 25 kursdoshi
    # bilan birga yuklanardi.
    return (
        select(StudentTestAttempt.id, StudentTestAttempt.student_id, StudentTestAttempt.session_id,
               StudentTestAttempt.subject_code, StudentTestAttempt.topic, StudentTestAttempt.score,
               StudentTestAttempt.total, StudentTestAttempt.submitted_at,
               LiveTestSession.owner_key, LiveTestSession.is_closed)
        .join(LiveTestSession, LiveTestSession.id == StudentTestAttempt.session_id)
    )


def _attempt(row) -> Attempt:
    return Attempt(id=row.id, student_id=row.student_id, session_id=row.session_id, owner=row.owner_key or "",
                   subject_code=row.subject_code or "", topic=(row.topic or "").strip(), score=int(row.score or 0),
                   total=int(row.total or 0), submitted_at=row.submitted_at, closed=bool(row.is_closed))


def attempts_on(db: Session, student_ids: list[str], day: dt.date) -> list[Attempt]:
    if not student_ids:
        return []
    rows = db.execute(
        _attempt_query().where(StudentTestAttempt.student_id.in_(student_ids),
                               StudentTestAttempt.submitted_date == day)
        .order_by(StudentTestAttempt.submitted_at)
    ).all()
    return [_attempt(r) for r in rows]


def group_mates(db: Session, group: str, exclude: str) -> list[str]:
    return [sid for sid, _name in students(db, group) if sid != exclude]


def attempt_by_id(db: Session, attempt_id: int) -> Attempt | None:
    row = db.execute(_attempt_query().where(StudentTestAttempt.id == attempt_id)).first()
    return _attempt(row) if row else None


def _released_clause(now: dt.datetime):
    return or_(LiveTestSession.is_closed.is_(True), StudentTestAttempt.submitted_at <= now - RELEASE_AFTER)


def attempt_page(db: Session, student_id: str, *, offset: int, limit: int, now: dt.datetime) -> tuple[list[Attempt], bool]:
    rows = db.execute(
        _attempt_query().where(StudentTestAttempt.student_id == student_id, _released_clause(now))
        .order_by(StudentTestAttempt.submitted_at.desc())
        .offset(offset).limit(limit + 1)
    ).all()
    items = [_attempt(r) for r in rows[:limit]]
    return items, len(rows) > limit


def stats_since(db: Session, student_id: str, since: dt.date, now: dt.datetime) -> tuple[int, int]:
    """(testlar soni, o'rtacha foiz) — `since` dan beri."""
    row = db.execute(
        select(func.count(), func.avg(100.0 * StudentTestAttempt.score / func.nullif(StudentTestAttempt.total, 0)))
        .select_from(StudentTestAttempt)
        .join(LiveTestSession, LiveTestSession.id == StudentTestAttempt.session_id)
        .where(StudentTestAttempt.student_id == student_id, StudentTestAttempt.submitted_date >= since,
               _released_clause(now))
    ).one()
    return int(row[0] or 0), round(float(row[1] or 0))


def subject_stats(db: Session, student_id: str, group: str, since: dt.date,
                  now: dt.datetime) -> list[tuple[str, int, int, dt.date]]:
    """[(fan nomi, testlar soni, o'rtacha foiz, oxirgi sana)] — ko'p testlisi birinchi.

    Fan nomi dars jadvalidan (HEMIS) — test o'tkazilgan para bo'yicha; para topilmasa
    sillabus nomi tozalanib olinadi ("Davolash ishi 2024-2025 (Milliy) 5-semestr Biokimyo" → "Biokimyo").
    """
    rows = db.execute(
        _attempt_query().where(StudentTestAttempt.student_id == student_id,
                               StudentTestAttempt.submitted_date >= since, _released_clause(now))
        .order_by(StudentTestAttempt.submitted_at)
    ).all()
    attempts = [_attempt(r) for r in rows]
    lessons = lessons_between(db, group, since, now.date())
    names = subject_names(db, {a.subject_code for a in attempts})
    agg: dict[str, list] = {}
    for a in attempts:
        lesson = match_lesson(lessons.get(a.local.date(), []), a.submitted_at, a.owner)
        subject = (lesson.subject if lesson else "") or clean_subject(names.get(a.subject_code) or a.subject_code)
        row = agg.setdefault(subject or "—", [0, 0, a.local.date()])
        row[0] += 1
        row[1] += a.pct
        row[2] = max(row[2], a.local.date())
    out = [(name, n, round(total / n), last) for name, (n, total, last) in agg.items()]
    return sorted(out, key=lambda x: (-x[1], x[0]))


def session_averages(db: Session, session_ids: list[int]) -> dict[int, float]:
    if not session_ids:
        return {}
    rows = db.execute(
        select(StudentTestAttempt.session_id, func.avg(StudentTestAttempt.score), func.count())
        .where(StudentTestAttempt.session_id.in_(session_ids))
        .group_by(StudentTestAttempt.session_id)
    ).all()
    return {sid: float(avg) for sid, avg, n in rows if n >= 3}


def subject_names(db: Session, codes: set[str]) -> dict[str, str]:
    return subject_names_for_codes(db, {c for c in codes if c})


def academic_year_start(day: dt.date) -> dt.date:
    return dt.date(day.year if day.month >= 9 else day.year - 1, 9, 1)


# ------------------------------------------------------------------ kun ko'rinishi

def day_view(lessons: list[Lesson], mine: list[Attempt], mates: list[Attempt], now: dt.datetime) -> tuple[list[DayEntry], list[Attempt]]:
    """Har bir para va undagi natija; jadvalga to'g'ri kelmagan testlar alohida."""
    entries = [DayEntry(lesson=lesson) for lesson in lessons]
    by_lesson = {id(e.lesson): e for e in entries}
    extras: list[Attempt] = []
    for a in mine:
        lesson = match_lesson(lessons, a.submitted_at, a.owner)
        entry = by_lesson.get(id(lesson)) if lesson else None
        if not released(a, now):
            if entry is not None:
                entry.pending = True
            continue
        if entry is None:
            extras.append(a)
        else:
            entry.results.append(a)
    mates_by_lesson: dict[int, set[str]] = {}
    for a in mates:
        lesson = match_lesson(lessons, a.submitted_at, a.owner)
        if lesson is not None:
            mates_by_lesson.setdefault(id(lesson), set()).add(a.student_id)
    # Bitta vaqtda ikki dars (kichik guruhlar, har birida o'z o'qituvchisi): farzand
    # birida test topshirgan bo'lsa, ikkinchisida "topshirmagan" deyilmaydi (2026-10-23).
    took = {(e.lesson.start, e.lesson.end) for e in entries if e.lesson and (e.results or e.pending)}
    for e in entries:
        ends = e.lesson.ends if e.lesson else None
        if e.results or e.pending or ends is None or now < ends + dt.timedelta(minutes=10):
            continue
        if (e.lesson.start, e.lesson.end) in took:
            continue
        n = len(mates_by_lesson.get(id(e.lesson), ()))
        if n >= MISSED_MIN_MATES:
            e.missed = n
    return entries, extras
