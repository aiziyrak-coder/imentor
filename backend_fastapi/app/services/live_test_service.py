from __future__ import annotations

import datetime as dt
import logging
import os
import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.content import CourseSyllabus
from app.models.live_test import LiveTestDraft, LiveTestSession, LiveTestSubmission

logger = logging.getLogger(__name__)


def score_submission(questions: list, answers: list) -> tuple[int, int]:
    """To'g'ri javoblar sonini hisoblaydi (savol.correctOptionIndex bilan solishtirib)."""
    total = len(questions) if isinstance(questions, list) else 0
    if not total or not isinstance(answers, list):
        return 0, total
    correct = 0
    for i, q in enumerate(questions):
        if i >= len(answers) or not isinstance(q, dict):
            continue
        try:
            if int(q.get("correctOptionIndex", -1)) == int(answers[i]):
                correct += 1
        except (TypeError, ValueError):
            continue
    return correct, total


def subject_names_for_codes(db: Session, codes: set[str]) -> dict[str, str]:
    if not codes:
        return {}
    rows = db.execute(
        select(CourseSyllabus.subject_code, CourseSyllabus.subject_name).where(
            CourseSyllabus.subject_code.in_(codes)
        )
    ).all()
    return {code: name for code, name in rows}


_CYR = re.compile(r"[Ѐ-ӿ]")
_LAT = re.compile(r"[A-Za-z]")
_UZ_CYR = re.compile(r"[қҚғҒҳҲўЎ]")
_UZ_LAT = re.compile(r"\b(?:va|bilan|uchun|qaysi|nima|qanday|bo['’‘ʻ]l|o['’‘ʻ]|g['’‘ʻ])", re.I)


def test_language(questions: list) -> str:
    """Test qaysi tilda: "ru" | "en" | "uz" — savol matnlaridan (talaba sahifasi shu tilda chiqadi)."""
    text = " ".join(str(q.get("question") or "") for q in questions[:10] if isinstance(q, dict))
    cyr, lat = len(_CYR.findall(text)), len(_LAT.findall(text))
    if cyr + lat < 20:
        return ""
    if cyr > lat:
        return "uz" if _UZ_CYR.search(text) else "ru"
    return "uz" if len(_UZ_LAT.findall(text)) >= 2 else "en"


def localized_topic(db: Session, subject_code: str, topic: str, lang: str) -> str:
    """Mavzu nomi test tilida (fan sillabusidagi `topics_i18n`); topilmasa asl nom.

    2026-11-12: ruscha testda talaba sahifasi sarlavhasi o'zbekcha qolardi ("9-mavzu. Dorixonalarda…").
    """
    if not (subject_code and topic and lang):
        return topic
    rows = db.execute(
        select(CourseSyllabus.topics_i18n, CourseSyllabus.instruction_language).where(
            CourseSyllabus.subject_code == subject_code
        )
    ).all()
    for topics_i18n, source in rows:
        if (source or "uz").strip().lower() == lang:
            continue
        value = ((topics_i18n or {}).get(lang) or {}).get(topic)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return topic


def questions_of(session: LiveTestSession) -> list[dict]:
    payload = getattr(session, "payload", None)
    payload = payload if isinstance(payload, dict) else {}
    raw = payload.get("questions", [])
    return raw if isinstance(raw, list) else []


def answer_key_signature(questions: list) -> list[tuple]:
    """Savol matni, variantlar va to'g'ri javob — baholashga ta'sir qiladigan hamma narsa.

    Izoh, tarjima va manbalar kirmaydi: ular sessiya davomida yangilanishi
    mumkin (fondagi "enrich"), baholash esa o'zgarmaydi.
    """
    out: list[tuple] = []
    for q in questions if isinstance(questions, list) else []:
        if not isinstance(q, dict):
            out.append(("", (), -1))
            continue
        options = q.get("options") if isinstance(q.get("options"), list) else []
        try:
            correct = int(q.get("correctOptionIndex", -1))
        except (TypeError, ValueError):
            correct = -1
        out.append((str(q.get("question", "")).strip(), tuple(str(o) for o in options), correct))
    return out


def answer_key_locked(session, new_questions: list) -> bool:
    """Talaba topshirgan yoki yopilgan sessiyada javob kalitini almashtirish taqiqlanadi.

    Aks holda server ballni yangi kalit bo'yicha hisoblab, allaqachon
    topshirganlarning natijasi orqaga qarab o'zgarib ketardi.
    """
    # Qoralama bor — talabalar savollarni ochib, javob belgilashni boshlagan.
    # Ilgari qulf faqat birinchi topshiriqdan keyin ishlardi: shu orada
    # o'qituvchi boshqa versiyani ochsa (yoki fon variantlarni qayta
    # aralashtirsa), talabalar eski savollarga bergan javoblar YANGI kalit
    # bo'yicha baholanardi.
    if not (session.is_closed or session.submissions or getattr(session, "drafts", None)):
        return False
    payload = session.payload if isinstance(session.payload, dict) else {}
    return answer_key_signature(payload.get("questions", [])) != answer_key_signature(new_questions)


# Jonli test kamida shuncha savol bilan ochiladi (talab, 2026-10-16).
MIN_LIVE_TEST_QUESTIONS = 10


def answer_key_problems(questions: list) -> list[str]:
    """Kaliti baholab bo'lmaydigan savollar — har biri uchun qisqa sabab.

    Ilgari server istalgan `correctOptionIndex` ni qabul qilardi: kalit yo'q,
    matn ("B") yoki variantlar sonidan katta bo'lsa ham sessiya ochilardi va
    talabalar to'g'ri javob uchun ham "xato" olardi.
    """
    problems: list[str] = []
    for i, q in enumerate(questions if isinstance(questions, list) else []):
        n = i + 1
        if not isinstance(q, dict):
            problems.append(f"{n}: savol obyekt emas")
            continue
        options = q.get("options")
        if not str(q.get("question") or "").strip():
            problems.append(f"{n}: savol matni yo'q")
        if not isinstance(options, list) or len(options) < 2:
            problems.append(f"{n}: variantlar yetarli emas")
            continue
        key = q.get("correctOptionIndex")
        if isinstance(key, bool) or not isinstance(key, int) or not 0 <= key < len(options):
            problems.append(f"{n}: to'g'ri javob raqami noto'g'ri ({key!r})")
    return problems


def strip_questions_for_student(questions: list[dict]) -> list[dict]:
    stripped: list[dict] = []
    for q in questions:
        if not isinstance(q, dict):
            continue
        item: dict = {
            "question": q.get("question", ""),
            "options": q.get("options", []) if isinstance(q.get("options"), list) else [],
        }
        refs = q.get("references")
        if isinstance(refs, list) and refs:
            item["references"] = refs
        stripped.append(item)
    return stripped


def build_wrong_answers(questions: list[dict]) -> list[int]:
    answers: list[int] = []
    for q in questions:
        if not isinstance(q, dict):
            answers.append(0)
            continue
        try:
            correct = int(q.get("correctOptionIndex", -1))
        except (TypeError, ValueError):
            correct = -1
        options = q.get("options", [])
        count = len(options) if isinstance(options, list) else 0
        if count <= 0:
            answers.append(0)
            continue
        wrong = 0
        for idx in range(count):
            if idx != correct:
                wrong = idx
                break
        answers.append(wrong)
    return answers


def is_complete_draft(answers: list, question_count: int) -> bool:
    if question_count <= 0:
        return False
    if not isinstance(answers, list) or len(answers) != question_count:
        return False
    return all(isinstance(a, int) and a >= 0 for a in answers)


#: Savolga ajratilgan vaqt (2026-10-22, rektor talabi: 10 savolga 15 daqiqa). 0 — chegarasiz.
#: Vaqt talaba testni OCHGAN paytdan sanaladi va server tomonda tekshiriladi.
SECONDS_PER_QUESTION = int(os.environ.get("LIVE_TEST_SECONDS_PER_QUESTION") or 90)
#: Tarmoq kechikishi: vaqt tugagach shuncha soniya ichida kelgan javoblar hali qabul qilinadi.
DEADLINE_GRACE = dt.timedelta(seconds=20)
#: Tahlilda "shubhali" belgilari: ilovadan chiqish, juda tez yechish, bir xil xato javoblar.
AWAY_COUNT_FLAG = 2
AWAY_SECONDS_FLAG = 30
FAST_SECONDS_PER_QUESTION = 20
SAME_WRONG_FLAG = 3
#: Sinfning shuncha qismi tanlagan xato variant "ko'chirish" dalili emas — mashhur
#: chalg'ituvchi (qiyin savolda ko'pchilik bir xil xato qiladi). Kamida 6 kishilik sinfda.
POPULAR_WRONG_SHARE = 0.35
#: Qoralamasiz (vaqt hisoblanmagan) topshiriq voqeasi.
NO_TIMER_EVENT = "submit_without_draft"
POPULAR_MIN_CLASS = 6


def time_limit(session: LiveTestSession) -> dt.timedelta | None:
    n = len(questions_of(session))
    if SECONDS_PER_QUESTION <= 0 or n <= 0:
        return None
    return dt.timedelta(seconds=n * SECONDS_PER_QUESTION)


def deadline_of(session: LiveTestSession, started_at: dt.datetime | None) -> dt.datetime | None:
    limit = time_limit(session)
    return started_at + limit if limit and started_at else None


def time_over(session: LiveTestSession, started_at: dt.datetime | None, now: dt.datetime) -> bool:
    """Talabaning vaqti tugaganmi (kechikish uchun `DEADLINE_GRACE` bilan)."""
    deadline = deadline_of(session, started_at)
    return deadline is not None and now > deadline + DEADLINE_GRACE


def capped_duration(session: LiveTestSession, started: dt.datetime | None, last: dt.datetime | None) -> int:
    """Testga ketgan vaqt, ajratilgan vaqtdan oshmaydi (kech topshirilgani ham)."""
    if not started or not last or last <= started:
        return 0
    seconds = int((last - started).total_seconds())
    limit = time_limit(session)
    return min(seconds, int((limit + DEADLINE_GRACE).total_seconds())) if limit else seconds


def epoch_ms(value: dt.datetime | None) -> int | None:
    return int(value.timestamp() * 1000) if value else None


def behaviour(db: Session, session: LiveTestSession) -> dict[str, dict]:
    """Talaba kesimida: test sahifasidan necha marta chiqqan, qancha vaqt tashqarida
    bo'lgan va testga qancha vaqt ketgan (`student_id` → ko'rsatkichlar)."""
    from app.models.analytics import StudentTestAttempt, StudentTestAttemptEvent

    rows = db.execute(
        select(StudentTestAttemptEvent.student_id, StudentTestAttemptEvent.event_type,
               StudentTestAttemptEvent.client_ts_ms, StudentTestAttemptEvent.occurred_at)
        .where(StudentTestAttemptEvent.session_id == session.id,
               StudentTestAttemptEvent.event_type.in_(("visibility_hidden", "visibility_visible", NO_TIMER_EVENT)))
        .order_by(StudentTestAttemptEvent.student_id, StudentTestAttemptEvent.client_ts_ms,
                  StudentTestAttemptEvent.occurred_at)
    ).all()
    out: dict[str, dict] = {}
    hidden_at: dict[str, float] = {}
    for sid, kind, ts_ms, occurred in rows:
        info = out.setdefault(sid or "", {"away_count": 0, "away_sec": 0.0, "duration_sec": 0})
        at = ts_ms / 1000.0 if ts_ms else (occurred.timestamp() if occurred else None)
        if kind == NO_TIMER_EVENT:
            info["no_timer"] = True
            continue
        if at is None:
            continue
        if kind == "visibility_hidden":
            info["away_count"] += 1
            hidden_at[sid] = at
        elif sid in hidden_at:
            info["away_sec"] += max(0.0, at - hidden_at.pop(sid))
    for sid, duration in db.execute(
        select(StudentTestAttempt.student_id, StudentTestAttempt.duration_sec)
        .where(StudentTestAttempt.session_id == session.id)
    ).all():
        out.setdefault(sid or "", {"away_count": 0, "away_sec": 0.0, "duration_sec": 0})["duration_sec"] = int(duration or 0)
    return out


def annotate_submissions(rows: list[dict], questions: list, info: dict[str, dict]) -> list[dict]:
    """Tahlil jadvali uchun shubhali belgilar (2026-10-22, rektor: "hamma yuqori baho olyapti").

    * `left_app` — test paytida sahifadan (boshqa ilovaga) kamida 2 marta chiqqan
      yoki jami 30 soniyadan ko'p tashqarida bo'lgan;
    * `fast` — javob bergan savoliga o'rtacha 20 soniyadan tez;
    * `same_answers` — boshqa talaba bilan kamida 3 ta AYNAN bir xil XATO javob
      (to'g'ri javoblarning bir xilligi dalil emas, xatoniki — dalil; sinfning
      35% dan ko'pi tanlagan xato variant hisobga olinmaydi).
    """
    key = [q.get("correctOptionIndex") if isinstance(q, dict) else None for q in questions]
    total = len(key)
    popular: set[tuple[int, int]] = set()
    if len(rows) >= POPULAR_MIN_CLASS:
        picks: dict[tuple[int, int], int] = {}
        for row in rows:
            for k, x in enumerate((row.get("answers") or [])[:total]):
                if isinstance(x, int) and x >= 0 and x != key[k]:
                    picks[(k, x)] = picks.get((k, x), 0) + 1
        popular = {kx for kx, n in picks.items() if n / len(rows) > POPULAR_WRONG_SHARE}
    same: dict[int, set[int]] = {}
    for i in range(len(rows)):
        for j in range(i + 1, len(rows)):
            a, b = rows[i].get("answers") or [], rows[j].get("answers") or []
            wrong = sum(1 for k, (x, y) in enumerate(zip(a, b))
                        if k < total and x == y and isinstance(x, int) and x >= 0 and x != key[k]
                        and (k, x) not in popular)
            if wrong >= SAME_WRONG_FLAG:
                same.setdefault(i, set()).add(j)
                same.setdefault(j, set()).add(i)
    out = []
    for i, row in enumerate(rows):
        stats = info.get(row.get("student_id") or "", {})
        away_count = int(stats.get("away_count") or 0)
        away_sec = int(round(stats.get("away_sec") or 0))
        duration = int(stats.get("duration_sec") or 0)
        flags = []
        if away_count >= AWAY_COUNT_FLAG or away_sec >= AWAY_SECONDS_FLAG:
            flags.append("left_app")
        # Javob BELGILANGAN savollar soni bo'yicha (2026-10-23): 1 ta savolga javob berib
        # to'xtagan talaba "juda tez" emas, 9 tasini tez yechib 10-sida o'ylagani ham emas.
        answered = answered_count(row.get("answers") or [])
        if duration and answered >= 3 and duration < answered * FAST_SECONDS_PER_QUESTION:
            flags.append("fast")
        if i in same:
            flags.append("same_answers")
        if stats.get("no_timer"):
            flags.append("no_timer")
        partners = [f"{rows[j].get('last_name', '')} {rows[j].get('first_name', '')}".strip() for j in sorted(same.get(i, ()))]
        out.append({**row, "away_count": away_count, "away_sec": away_sec, "duration_sec": duration,
                    "flags": flags, "same_as": partners[:5]})
    return out


def submissions_payload(session: LiveTestSession) -> list[dict]:
    """O'qituvchi jadvali uchun. Ball SERVERDA, sessiyaning o'z kaliti bo'yicha
    hisoblanadi — brauzerdagi test nusxasi boshqa versiya bo'lishi mumkin."""
    questions = questions_of(session)
    out = []
    for s in session.submissions:
        correct, total = score_submission(questions, s.answers)
        out.append({
            "first_name": s.first_name,
            "last_name": s.last_name,
            "student_id": s.student_id or "",
            "answers": s.answers,
            "correct": correct,
            "total": total,
            "submitted_at": s.submitted_at.isoformat(),
        })
    return out


def progress_payload(session: LiveTestSession) -> list[dict]:
    """Sessiya OCHIQ paytida o'qituvchi ekrani uchun: kim qo'shildi, nechta savolga
    javob belgiladi, topshirdimi. Ball va javoblar YO'Q (2026-10-21: o'qituvchi
    "Testni tahlil qilish"ni bosmaguncha natijani hech kim — ekran ham, talaba
    ham — ko'rmasin). Ro'yxat shakli `submissions_payload` bilan bir xil."""
    total = len(questions_of(session))
    now = dt.datetime.now(dt.timezone.utc)
    rows: list[dict] = []
    students: set[str] = set()
    keys: set[str] = set()
    for s in session.submissions:
        rows.append({
            "first_name": s.first_name, "last_name": s.last_name, "student_id": s.student_id or "",
            "answers": [], "correct": None, "total": total, "answered": answered_count(s.answers),
            "status": "submitted", "submitted_at": s.submitted_at.isoformat(),
        })
        students.add(s.student_id or "")
        keys.add(s.participant_key or "")
    for d in sorted(session.drafts, key=lambda d: (answered_count(d.answers), d.updated_at), reverse=True):
        sid = (d.student_id or "").strip()
        if (sid and sid in students) or (d.participant_key and d.participant_key in keys):
            continue
        students.add(sid)
        keys.add(d.participant_key or "")
        deadline = deadline_of(session, getattr(d, "started_at", None))
        over = deadline is not None and now > deadline + DEADLINE_GRACE
        rows.append({
            "first_name": d.first_name or "", "last_name": d.last_name or "", "student_id": sid,
            "answers": [], "correct": None, "total": total, "answered": answered_count(d.answers),
            # Vaqti tugagan — endi javob o'zgarmaydi; tahlilda belgilagani bilan topshiriladi.
            "status": "time_over" if over else "in_progress", "submitted_at": None,
            # Talabaning qolgan vaqti (vaqt chegarasi, 2026-10-22).
            "seconds_left": max(0, int((deadline - now).total_seconds())) if deadline else None,
        })
    return rows


def student_result(session: LiveTestSession, student_id: str) -> dict:
    """Talabaning o'z natijasi — FAQAT test tahlilga yopilgandan keyin.

    Shundan so'ng talaba har savolda o'z javobini, to'g'ri javobni va qisqa
    izohni ko'radi (o'qituvchi ekrandagi tahlil bilan bir vaqtda)."""
    mine = next((s for s in session.submissions if student_id and s.student_id == student_id), None)
    if not session.is_closed:
        return {"ready": False, "submitted": mine is not None}
    if mine is None:
        return {"ready": True, "submitted": False}
    questions = questions_of(session)
    correct, total = score_submission(questions, mine.answers)
    review = []
    for i, q in enumerate(questions):
        if not isinstance(q, dict):
            continue
        given = mine.answers[i] if i < len(mine.answers) else -1
        review.append({
            "question": q.get("question", ""),
            "options": q.get("options", []) if isinstance(q.get("options"), list) else [],
            "correct_index": q.get("correctOptionIndex", -1),
            "answer": given if isinstance(given, int) else -1,
            "explanation": str(q.get("explanation") or "")[:1200],
        })
    return {"ready": True, "submitted": True, "score": correct, "total": total, "questions": review}


def normalize_answers(raw, question_count: int) -> list[int]:
    """Talaba BELGILAGAN javoblar; belgilanmagan yoki yaroqsiz o'rin: -1."""
    out: list[int] = []
    for i in range(max(0, question_count)):
        value = raw[i] if isinstance(raw, list) and i < len(raw) else -1
        ok = isinstance(value, int) and not isinstance(value, bool) and value >= 0
        out.append(value if ok else -1)
    return out


def answered_count(answers) -> int:
    if not isinstance(answers, list):
        return 0
    return sum(1 for a in answers if isinstance(a, int) and not isinstance(a, bool) and a >= 0)


def _name_key(first: str, last: str) -> tuple[str, str] | None:
    first, last = (first or "").strip().casefold(), (last or "").strip().casefold()
    return (first, last) if first and last else None


def finalize_live_test_session(db: Session, session: LiveTestSession, *,
                               expired_at: dt.datetime | None = None, wait: bool = True) -> int:
    """Qoralamalarni topshiriqqa aylantiradi va sessiyani yopadi (transaction ichida).

    Yechib ulgurmagan talaba BELGILAGAN javoblari bilan baholanadi, belgilamagani
    noto'g'ri sanaladi. Ilgari to'liq bo'lmagan qoralama butunlay noto'g'ri
    javoblar bilan almashtirilardi: 10 savoldan 9 tasini to'g'ri belgilagan
    talaba ham 0 ball olardi (7 kunda 907 avtomatik topshiriqning 772 tasi).

    `expired_at` — o'qituvchi yopmagan, muddati o'tgan sessiya: topshiriq
    vaqti qoralamaning oxirgi saqlangan vaqti bo'ladi (boshqa kun statistikasiga
    tushib ketmasin).

    `wait=False` (2026-11-17) — telefonlarning holat so'rovlari uchun: boshqa so'rov allaqachon yopayotgan
    bo'lsa KUTMASDAN 0 qaytadi. Monitor testi tugagan lahzada sinfdagi 15–45 telefon bir vaqtda so'raydi;
    ilgari hammasi qator qulfida navbatda turib server oqimlarini band qilardi, bir nechta test birga
    tugasa — sayt qotardi.
    """
    locked = db.execute(
        select(LiveTestSession).where(LiveTestSession.id == session.id).with_for_update(skip_locked=not wait)
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if locked is None:
        return 0
    # Qulf olinguncha talaba topshirgan bo'lishi mumkin (topshiriq yopishni kutadi):
    # sessiya obyekti oldinroq yuklangan, shuning uchun topshiriqlar va qoralamalar
    # QAYTA o'qiladi. Aks holda yangi topshirgan talabaning qoralamasi yana
    # topshirilib, 500 (unique) yoki ikkinchi natija bo'lardi (2026-10-23).
    db.expire(locked)
    if locked.is_closed:
        return 0

    question_count = len(questions_of(locked))
    now = dt.datetime.now(dt.timezone.utc)

    submitted_keys = {s.participant_key for s in locked.submissions if s.participant_key}
    submitted_students = {s.student_id for s in locked.submissions if s.student_id}
    submitted_names = {k for k in (_name_key(s.first_name, s.last_name) for s in locked.submissions) if k}

    # Bitta talabaning bir nechta qoralamasi bo'lsa (ikkinchi oyna, boshqa
    # qurilma) — eng ko'p javob belgilangani olinadi.
    drafts = sorted(locked.drafts, key=lambda d: (answered_count(d.answers), d.updated_at), reverse=True)

    auto_count = 0
    for draft in drafts:
        if draft.participant_key in submitted_keys:
            continue
        student_id = (draft.student_id or "").strip()
        name = _name_key(draft.first_name, draft.last_name)
        if student_id:
            if student_id in submitted_students:
                continue  # o'zi topshirgan yoki boshqa qoralamasi olingan
        elif name and name in submitted_names:
            # Eski qoralama (talaba ID'siz): shu ismli talaba topshirib bo'lgan.
            continue

        sub = LiveTestSubmission(
            session_id=locked.id,
            first_name=(draft.first_name or "").strip() or "Noma'lum",
            last_name=(draft.last_name or "").strip() or "Talaba",
            answers=normalize_answers(draft.answers, question_count),
            participant_key=draft.participant_key,
            student_id=student_id,
            submitted_at=(draft.updated_at or now) if expired_at else now,
        )
        db.add(sub)
        db.flush()
        from app.services.analytics_service import create_student_attempt_from_submission

        # Testga ketgan vaqt — talaba testni ochgandan oxirgi javobigacha (tahlilda "juda tez" belgisi uchun).
        started = draft.started_at
        last = draft.updated_at or now
        create_student_attempt_from_submission(
            db, session=locked, submission=sub, started_at=started,
            duration_sec=capped_duration(locked, started, last),
        )
        submitted_keys.add(draft.participant_key)
        if student_id:
            submitted_students.add(student_id)
        if name:
            submitted_names.add(name)
        auto_count += 1

    locked.is_closed = True
    locked.closed_at = expired_at or now
    db.commit()
    db.refresh(locked)
    return auto_count


#: Jonli sessiya shuncha vaqtdan keyin yopiq hisoblanadi (routes/live_test.SESSION_TTL bilan bir xil).
EXPIRED_TTL = dt.timedelta(hours=24)


def finalize_all_expired(db: Session, now: dt.datetime | None = None, *, limit: int = 50) -> int:
    """Barcha o'qituvchilarning muddati o'tgan (24 soat), yopilmagan sessiyalari.

    Ilgari bu faqat ota-onalar boti oqimida edi: bot o'chirilsa (token yo'q,
    PARENT_BOT_NOTIFY=0) qoralamalar natijaga aylanmay, arxivga ham tushmasdi (2026-10-23).
    30 kundan eskisiga tegilmaydi — eski kunlar statistikasi o'zgarmasin.
    """
    now = now or dt.datetime.now(dt.timezone.utc)
    rows = db.execute(
        select(LiveTestSession).where(
            LiveTestSession.is_closed.is_(False),
            LiveTestSession.created_at < now - EXPIRED_TTL,
            LiveTestSession.created_at > now - dt.timedelta(days=30),
        ).limit(limit)
    ).scalars().all()
    total = 0
    for row in rows:
        try:
            total += finalize_live_test_session(db, row, expired_at=row.created_at + EXPIRED_TTL)
        except Exception:  # noqa: BLE001 — bitta sessiya boshqalarini to'xtatmasin
            db.rollback()
            logger.warning("live-test: muddati o'tgan sessiyani yakunlab bo'lmadi (id=%s)", row.id, exc_info=True)
    return total


def finalize_finished_monitor_sessions(db: Session, now: dt.datetime | None = None, *, limit: int = 100) -> int:
    """Monitor rejimidagi testlar: oxirgi savol vaqti tugagan, lekin yopilmagan (2026-11-13).

    Odatda test oxirgi savoldan keyingi birinchi so'rovda (monitor yoki telefon) o'zi yopiladi.
    Hamma sahifani yopib ketsa, hech kim so'ramaydi va test 24 soat ochiq turib qolardi — natijalar
    arxivga, ota-onalarga va rektor hisobotiga kech tushardi. Fon oqimi (har 5 daqiqa) ularni yopadi.
    """
    from app.services import live_monitor as mon

    now = now or dt.datetime.now(dt.timezone.utc)
    rows = db.execute(
        select(LiveTestSession).where(
            LiveTestSession.is_closed.is_(False),
            LiveTestSession.mode == mon.MODE,
            LiveTestSession.monitor_phase == mon.RUNNING,
            LiveTestSession.monitor_started_at.is_not(None),
            LiveTestSession.monitor_started_at > now - dt.timedelta(days=2),
        ).limit(limit)
    ).scalars().all()
    total = 0
    for row in rows:
        if mon.state(row, len(questions_of(row)), now)["phase"] != mon.DONE:
            continue
        try:
            total += finalize_live_test_session(db, row)
        except Exception:  # noqa: BLE001 — bitta sessiya boshqalarini to'xtatmasin
            db.rollback()
            logger.warning("live-monitor: tugagan testni yopib bo'lmadi (id=%s)", row.id, exc_info=True)
    return total


def finalize_expired_sessions(db: Session, owner_key: str, ttl: dt.timedelta) -> int:
    """O'qituvchi yopishni unutgan, muddati o'tgan sessiyalarni yakunlaydi.

    Ularda yechib, lekin "topshirish"ni bosmagan talabalarning qoralamalari
    hech qachon natijaga aylanmasdi (7 kunda 319 sessiyada 986 ta qoralama).
    """
    now = dt.datetime.now(dt.timezone.utc)
    rows = db.execute(
        select(LiveTestSession).where(
            LiveTestSession.owner_key == owner_key,
            LiveTestSession.is_closed.is_(False),
            LiveTestSession.created_at < now - ttl,
            LiveTestSession.created_at > now - dt.timedelta(days=30),
        )
    ).scalars().all()
    total = 0
    for row in rows:
        total += finalize_live_test_session(db, row, expired_at=row.created_at + ttl)
    return total
