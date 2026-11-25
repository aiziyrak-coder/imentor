from __future__ import annotations

import datetime as dt
import hashlib
import logging
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy import func, select
from sqlalchemy import text as sa_text
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import ObjectDeletedError, StaleDataError

from app.api.deps import AuthContext, require_roles
from app.core.db import get_db
from app.core.throttling import throttle_live_test_anon, throttle_live_test_student
from app.models.content import CourseSyllabus
from app.models.live_test import LiveTestDraft, LiveTestSession, LiveTestSubmission
from app.schemas.live_test import (
    LiveTestDraftUpsertRequest,
    LiveTestPublicOut,
    LiveTestSubmissionCreateRequest,
    LiveTestUpsertRequest,
)
from app.services import live_test_service as svc
from app.services.live_monitor import MODE as MONITOR_MODE, own_timings as mon_own_timings
from app.services.analytics_service import DuplicateAttemptError, create_student_attempt_from_submission
from app.services.pagination import paginate

router = APIRouter()
logger = logging.getLogger(__name__)

STAFF_ROLES = ("admin", "klinika_admin", "hodim")
# Admin natijalar sahifasida fan biriktirilmagan (eski) testlar guruhi uchun kalit.
UNASSIGNED_SUBJECT_KEY = "__unassigned__"


# Jonli test darsda ishlatiladi: urinishlarning 99% sessiya ochilgandan keyin
# 12 soat ichida keladi. Ilgari o'qituvchi yopmagan sessiya (1 050 ta, 2026-09-26)
# abadiy ochiq qolardi va eski QR bilan kunlar o'tib yuborilgan javob boshqa
# kunning statistikasiga tushardi. 24 soatdan keyin sessiya yopiq hisoblanadi.
SESSION_TTL = dt.timedelta(hours=24)


def _closed(obj: LiveTestSession) -> bool:
    """Yopilgan yoki muddati o'tgan."""
    if obj.is_closed:
        return True
    created = obj.created_at
    return created is not None and dt.datetime.now(dt.timezone.utc) - created > SESSION_TTL


def _get_session(db: Session, session_key: str) -> LiveTestSession | None:
    return db.execute(
        select(LiveTestSession).where(LiveTestSession.session_key == session_key.strip())
    ).scalar_one_or_none()


def _queue_behind_finalize(db: Session, obj: LiveTestSession) -> None:
    """Topshiriqni o'qituvchining yopishi (tahlil) bilan navbatga qo'yadi.

    Topshiriqning sessiyaga tashqi kaliti kechiktirilgan (Django), urinishniki —
    darhol tekshiriladi. Talaba topshirgan paytda o'qituvchi "Testni tahlil
    qilish"ni bossa, ikki tranzaksiya bir-birini kutib qolardi va talabaning
    javobi saqlanmasdi (2026-10-23, deadlock, 2 talaba). Endi topshiriq avval
    sessiya qatorini FOR KEY SHARE bilan oladi: talabalar bir-birini kutmaydi,
    yopish esa ular tugashini kutadi (yoki aksincha). Kutgandan keyin sessiya
    holati (yopilganmi, kim topshirgan) qayta o'qiladi.
    """
    db.execute(
        select(LiveTestSession.id).where(LiveTestSession.id == obj.id)
        .with_for_update(read=True, key_share=True)
    )
    db.expire(obj)


def _submit_lock_key(session_id: int, student_id: str) -> int:
    """Postgres advisory lock kaliti — bitta talabaning bitta sessiyadagi topshirig'i uchun."""
    raw = f"livetest-submit|{session_id}|{student_id}".encode()
    return int.from_bytes(hashlib.sha1(raw).digest()[:8], "big", signed=True)


@router.post("/live-tests/")
def upsert_live_test(
    payload: LiveTestUpsertRequest,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles(*STAFF_ROLES)),
) -> dict:
    key = payload.session_key.strip()
    owner = auth.user.username

    if not key:
        for _ in range(5):
            candidate = f"lts_{secrets.token_urlsafe(16)}"
            if _get_session(db, candidate) is None:
                key = candidate
                break
        else:
            raise HTTPException(status_code=503, detail="Could not allocate session key.")

    existing = _get_session(db, key)
    problems = svc.answer_key_problems(payload.questions)
    if problems:
        raise HTTPException(status_code=422, detail=f"Javob kaliti yaroqsiz: {'; '.join(problems[:5])}")
    # Yangi sessiya kamida 10 savol bilan. Allaqachon ochilganlari (eski,
    # kam savolli) yangilanishda to'xtatilmaydi — dars o'rtasida uzilmasin.
    if existing is None and len(payload.questions) < svc.MIN_LIVE_TEST_QUESTIONS:
        raise HTTPException(
            status_code=422,
            detail=f"Jonli test uchun kamida {svc.MIN_LIVE_TEST_QUESTIONS} ta savol kerak.",
        )
    if existing and existing.owner_key != owner:
        raise HTTPException(status_code=409, detail="Session key already in use.")
    if existing is not None and svc.answer_key_locked(existing, payload.questions):
        raise HTTPException(
            status_code=409,
            detail="Answer key is locked: the session is closed or already has submissions.",
        )

    created_ms = payload.created_at_ms
    if created_ms is None:
        created_ms = int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000)

    body = {
        "topic": payload.topic.strip(),
        "questions": payload.questions,
        "createdAt": created_ms,
    }
    subject_code = payload.subject_code.strip()

    if existing is None:
        # Yangi test ochilayotganda shu o'qituvchining yopilmay qolgan eski
        # sessiyalari yakunlanadi — ulardagi qoralamalar natijaga aylanadi.
        try:
            svc.finalize_expired_sessions(db, owner, SESSION_TTL)
        except Exception:  # eski sessiya muammosi yangi testni to'xtatmasin
            db.rollback()
            logger.exception("live-test: muddati o'tgan sessiyalarni yakunlab bo'lmadi (%s)", owner)
        # O'qituvchining o'z vaqtlari (2026-11-25) — kutish zalida talabalar shu qoidani ko'radi.
        own_read, own_answer = mon_own_timings(db, owner)
        existing = LiveTestSession(
            session_key=key,
            owner_key=owner,
            payload=body,
            subject_code=subject_code,
            is_closed=False,
            closed_at=None,
            created_at=dt.datetime.now(dt.timezone.utc),
            # Faqat monitor rejimi (2026-11-12, foydalanuvchi qarori): savol monitorda, telefonda variantlar.
            mode=MONITOR_MODE,
            monitor_phase="lobby",
            seconds_per_question=own_read + own_answer,
            monitor_read_seconds=own_read,
        )
        db.add(existing)
    else:
        existing.owner_key = owner
        existing.payload = body
        # Bo'sh subject_code eskisini o'chirib yubormasin (masalan fon sync so'rovlarida).
        if subject_code:
            existing.subject_code = subject_code

    db.commit()
    db.refresh(existing)
    return {"ok": True, "session_key": existing.session_key}


@router.get("/live-tests/my-submissions/")
def my_submissions(
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("student")),
) -> list[dict]:
    student_id = auth.student_id
    if not student_id:
        raise HTTPException(status_code=403, detail="Talaba ID topilmadi.")
    rows = (
        db.execute(
            select(LiveTestSubmission)
            .where(LiveTestSubmission.student_id == student_id)
            .order_by(LiveTestSubmission.submitted_at.desc())
            .limit(100)
        )
        .scalars()
        .all()
    )
    codes = {s.session.subject_code for s in rows if s.session.subject_code}
    subject_names = svc.subject_names_for_codes(db, codes)
    out = []
    for s in rows:
        payload = s.session.payload if isinstance(s.session.payload, dict) else {}
        questions = payload.get("questions", [])
        correct, total = svc.score_submission(questions if isinstance(questions, list) else [], s.answers)
        # Natija o'qituvchi testni tahlilga yopgandan keyingina (2026-10-21).
        ready = bool(s.session.is_closed)
        code = s.session.subject_code or ""
        out.append(
            {
                "id": s.id,
                "session_key": s.session.session_key,
                "topic": str(payload.get("topic") or ""),
                # `own-<telefon>-…` — o'qituvchining shaxsiy fan kodi, talabaga ketmaydi.
                "subject_code": "" if code.startswith("own-") else code,
                "subject_name": subject_names.get(code, ""),
                "first_name": s.first_name,
                "last_name": s.last_name,
                "answers": s.answers if ready else [],
                "score": correct if ready else None,
                "total": total,
                "result_ready": ready,
                "submitted_at": s.submitted_at.isoformat(),
                "is_closed": bool(s.session.is_closed),
            }
        )
    return out


@router.get("/live-tests/{session_key}/", response_model=LiveTestPublicOut)
def get_public_live_test(
    session_key: str,
    db: Session = Depends(get_db),
    _: None = Depends(throttle_live_test_anon),
) -> LiveTestPublicOut:
    obj = _get_session(db, session_key)
    if obj is None:
        raise HTTPException(status_code=404, detail="Not found.")
    payload = obj.payload if isinstance(obj.payload, dict) else {}
    created_ms = payload.get("createdAt")
    if created_ms is None:
        created_ms = int(obj.created_at.timestamp() * 1000)
    raw_questions = payload.get("questions", [])
    questions = svc.strip_questions_for_student(raw_questions) if isinstance(raw_questions, list) else []
    monitor = (getattr(obj, "mode", "") or "") == MONITOR_MODE
    # Monitor rejimida savol matnlari TELEFONGA BERILMAYDI (aks holda ochiq API orqali hammasi olinardi).
    public_questions = [] if monitor else questions
    closed_ms = int(obj.closed_at.timestamp() * 1000) if obj.closed_at else None
    limit = svc.time_limit(obj)
    topic = str(payload.get("topic") or "")
    lang = svc.test_language(raw_questions if isinstance(raw_questions, list) else [])
    try:
        topic_display = svc.localized_topic(db, obj.subject_code or "", topic, lang)
    except Exception:  # noqa: BLE001 — sarlavha tarjimasi test ochilishini to'xtatmasin
        logger.warning("live-test %s: mavzu tarjimasi topilmadi", session_key, exc_info=True)
        topic_display = topic
    return LiveTestPublicOut(
        topic=topic,
        language=lang,
        topic_display=topic_display,
        questions=public_questions,
        mode=getattr(obj, "mode", "") or "",
        question_count=len(questions),
        created_at_ms=created_ms,
        is_closed=_closed(obj),
        closed_at_ms=closed_ms,
        time_limit_sec=int(limit.total_seconds()) if limit else 0,
    )


@router.get("/live-tests/{session_key}/submissions/")
def list_submissions(
    session_key: str,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles(*STAFF_ROLES)),
) -> list[dict]:
    obj = db.execute(
        select(LiveTestSession).where(
            LiveTestSession.session_key == session_key.strip(),
            LiveTestSession.owner_key == auth.user.username,
        )
    ).scalar_one_or_none()
    if obj is None:
        raise HTTPException(status_code=404, detail="Not found.")
    # Test ochiq paytida — faqat jarayon (kim qo'shildi, nechta javob), ball yo'q.
    # Natija "Testni tahlil qilish" (finalize) dan keyin (2026-10-21).
    if not obj.is_closed:
        return svc.progress_payload(obj)
    return svc.annotate_submissions(svc.submissions_payload(obj), svc.questions_of(obj), svc.behaviour(db, obj))


@router.get("/live-tests/{session_key}/my-result/")
def my_result(
    session_key: str,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("student")),
    _: None = Depends(throttle_live_test_student),
) -> dict:
    """Talaba telefonida natija va tahlil — o'qituvchi testni tahlilga yopgach."""
    obj = _get_session(db, session_key)
    if obj is None:
        raise HTTPException(status_code=404, detail="Not found.")
    return svc.student_result(obj, (auth.student_id or "").strip())


@router.post("/live-tests/{session_key}/submissions/", status_code=status.HTTP_201_CREATED)
def submit_answer(
    session_key: str,
    payload: LiveTestSubmissionCreateRequest,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("student")),
    _: None = Depends(throttle_live_test_student),
) -> dict:
    obj = _get_session(db, session_key)
    if obj is None:
        raise HTTPException(status_code=404, detail="Not found.")

    student_id = auth.student_id
    if not student_id:
        raise HTTPException(status_code=403, detail="Talaba ID topilmadi. OnlineTest orqali qayta kiring.")
    if (getattr(obj, "mode", "") or "") == MONITOR_MODE:
        # Monitor rejimida javob faqat joriy savolga beriladi (`/monitor/answer/`) — to'liq ro'yxat bilan
        # o'tgan savollarga qaytib yozib bo'lmaydi; natija o'qituvchi tahlil qilganda qoralamadan olinadi.
        raise HTTPException(status_code=409, detail="Bu test monitor rejimida — javoblar savol-savol beriladi.")

    _queue_behind_finalize(db, obj)
    # Bitta talabaning parallel topshiriqlari ketma-ket bajariladi (2026-11-17 auditi, G14):
    # ikki marta bosilgan "Topshirish" ikkalasi ham "hali topshirmagan" deb o'qib, ikki
    # natija yozardi. Qulf tranzaksiya tugaguncha turadi; kutgandan keyin quyidagi tekshiruv
    # birinchisining yozuvini ko'radi (sessiya `_queue_behind_finalize` da eskirgan).
    db.execute(
        sa_text("SELECT pg_advisory_xact_lock(:k)"),
        {"k": _submit_lock_key(obj.id, student_id)},
    )
    participant_key = _own_key(obj, payload.participant_key.strip(), student_id)
    # Avval "topshirilganmi": test yopilganda qoralamasi avtomatik topshirilgan
    # talaba "sessiya yakunlangan" xatosini emas, "qabul qilindi"ni ko'rsin.
    if any(s.student_id == student_id for s in obj.submissions):
        return {"ok": True, "already_submitted": True}
    if participant_key and any(s.participant_key == participant_key for s in obj.submissions):
        return {"ok": True, "already_submitted": True}
    if _closed(obj):
        raise HTTPException(status_code=403, detail="Test sessiyasi yakunlangan.")

    first_name = payload.first_name.strip() or (auth.user.first_name or "").strip() or "Talaba"
    last_name = payload.last_name.strip() or (auth.user.last_name or "").strip() or student_id

    now = dt.datetime.now(dt.timezone.utc)
    draft = _find_draft(db, obj.id, participant_key, student_id)
    answers = list(payload.answers)
    # Vaqt tugagan (2026-10-22: 10 savolga 15 daqiqa) — faqat vaqt ichida saqlangan
    # javoblar olinadi, keyin belgilangani hisobga kirmaydi.
    if draft is not None and svc.time_over(obj, draft.started_at, now):
        answers = list(draft.answers or [])

    sub = LiveTestSubmission(
        session_id=obj.id,
        participant_key=participant_key,
        student_id=student_id,
        first_name=first_name,
        last_name=last_name,
        # Javoblar soni savollar soniga keltiriladi: ortiqchasi kesiladi,
        # yetishmagani va yaroqsizi -1 (javobsiz) bo'ladi.
        answers=svc.normalize_answers(answers, len(svc.questions_of(obj))),
        submitted_at=now,
    )
    db.add(sub)
    if draft is None and svc.time_limit(obj):
        # Vaqt chegarasi qoralamadan sanaladi; qoralamasiz kelgan topshiriqni vaqt bilan tekshirib
        # bo'lmaydi (savollar ochiq GET'dan olinib, istalgan payt yuborilishi mumkin). Rad etilmaydi
        # — interneti uzilgan halol talaba ham shunday bo'ladi — lekin tahlilda belgilanadi (2026-10-23).
        from app.models.analytics import StudentTestAttemptEvent

        db.add(StudentTestAttemptEvent(
            attempt_id=None, session_id=obj.id, student_id=student_id[:64], participant_key=participant_key[:64],
            event_type=svc.NO_TIMER_EVENT, occurred_at=now, client_ts_ms=None, meta={},
        ))
    try:
        db.flush()
        started_at = None
        if payload.started_at_ms:
            try:
                started_at = dt.datetime.fromtimestamp(int(payload.started_at_ms) / 1000.0, tz=dt.timezone.utc)
            except (TypeError, ValueError, OSError):
                started_at = None
        duration = int(payload.duration_sec or 0)
        # Server bilgan boshlanish vaqti ishonchliroq (brauzer soati noto'g'ri bo'lishi mumkin).
        if draft is not None and draft.started_at:
            started_at = draft.started_at
            duration = svc.capped_duration(obj, draft.started_at, now)
        create_student_attempt_from_submission(
            db,
            session=obj,
            submission=sub,
            started_at=started_at,
            duration_sec=duration,
            strict=True,
        )
        db.commit()
    except (IntegrityError, DuplicateAttemptError):
        # Ikki marta bosilgan "topshirish": birinchisi yozilgan. `IntegrityError` —
        # `uq_livetestsubmission_session_student` yoki urinishlar arxivining noyob kaliti;
        # `DuplicateAttemptError` — arxivda urinish bor, ikkinchi topshiriq yozilmaydi.
        db.rollback()
        return {"ok": True, "already_submitted": True}
    except Exception:
        # Ilgari HAR QANDAY xato "allaqachon topshirilgan" deb qaytarilardi:
        # talaba "qabul qilindi"ni ko'rardi, javoblari esa saqlanmagan bo'lardi.
        db.rollback()
        logger.exception("live-test: topshiriq saqlanmadi (sessiya=%s, talaba=%s)", obj.session_key, student_id)
        raise HTTPException(status_code=500, detail="Javoblar saqlanmadi. Qayta urinib ko'ring.")

    # Shu talabaning barcha qoralamalari (boshqa oyna/qurilmadagisi ham) o'chadi.
    for d in [d for d in obj.drafts
              if (participant_key and d.participant_key == participant_key) or d.student_id == student_id]:
        db.delete(d)
    db.commit()

    return {"ok": True}


def _own_key(obj: LiveTestSession, participant_key: str, student_id: str) -> str:
    """Brauzer kaliti boshqa talabaga tegishli bo'lsa — shu talabaning o'z kaliti.

    Bitta telefondan ikki talaba yechsa brauzer kaliti bir xil bo'ladi:
    ikkinchisi "allaqachon topshirilgan" javobini olib, yecha olmay qolardi.
    """
    if not participant_key or not student_id:
        return participant_key
    taken = any(
        x.participant_key == participant_key and (x.student_id or "") not in ("", student_id)
        for x in [*obj.submissions, *obj.drafts]
    )
    return f"s{student_id}_{participant_key}"[:64] if taken else participant_key


def _find_draft(db: Session, session_id: int, participant_key: str, student_id: str) -> LiveTestDraft | None:
    draft = db.execute(
        select(LiveTestDraft).where(
            LiveTestDraft.session_id == session_id,
            LiveTestDraft.participant_key == participant_key,
        )
    ).scalar_one_or_none()
    if draft is None and student_id:
        # Boshqa oyna yoki qurilma: shu talabaning qoralamasi davom ettiriladi,
        # ikkinchisi ochilmaydi (aks holda u yopilishda alohida "talaba" bo'lardi).
        draft = db.execute(
            select(LiveTestDraft)
            .where(LiveTestDraft.session_id == session_id, LiveTestDraft.student_id == student_id)
            .order_by(LiveTestDraft.updated_at.desc())
        ).scalars().first()
    return draft


def merge_answers(saved: list, incoming: list) -> list:
    """Savol bo'yicha birlashtirish: yangi belgilangan javob ustun, belgilanmagani (-1)
    avval saqlanganini o'chirmaydi.

    Ikki qurilma (2026-10-23): B qurilma eskiroq holatdan bitta javobni o'zgartirib
    yuborsa, A da shu orada belgilangan javoblar butun ro'yxat bilan ustidan yozilardi.
    """
    saved = list(saved or [])
    out = list(incoming)
    for i, old in enumerate(saved[:len(out)]):
        new = out[i]
        if not (isinstance(new, int) and not isinstance(new, bool) and new >= 0) and isinstance(old, int) and old >= 0:
            out[i] = old
    return out


def _fill_draft(draft: LiveTestDraft, payload: LiveTestDraftUpsertRequest, auth: AuthContext, student_id: str) -> None:
    incoming = list(payload.answers or [])
    # Sahifa qayta ochilganda brauzer bo'sh javoblar yuborardi va saqlangan
    # ish o'chib ketardi. Bo'sh ro'yxat belgilangan javoblarni o'chirmaydi.
    if svc.answered_count(incoming) or not svc.answered_count(draft.answers):
        draft.answers = merge_answers(draft.answers, incoming)
    draft.first_name = payload.first_name.strip() or draft.first_name or (auth.user.first_name or "").strip()
    draft.last_name = payload.last_name.strip() or draft.last_name or (auth.user.last_name or "").strip()
    if student_id:
        draft.student_id = student_id
    draft.updated_at = dt.datetime.now(dt.timezone.utc)


@router.post("/live-tests/{session_key}/drafts/")
def upsert_draft(
    session_key: str,
    payload: LiveTestDraftUpsertRequest,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("student")),
    _: None = Depends(throttle_live_test_student),
) -> dict:
    obj = _get_session(db, session_key)
    if obj is None:
        raise HTTPException(status_code=404, detail="Not found.")

    student_id = (auth.student_id or "").strip()
    if student_id and any(s.student_id == student_id for s in obj.submissions):
        return {"ok": True, "already_submitted": True}
    if (getattr(obj, "mode", "") or "") == MONITOR_MODE:
        raise HTTPException(status_code=409, detail="Bu test monitor rejimida — javoblar savol-savol beriladi.")

    participant_key = payload.participant_key.strip()
    if not participant_key:
        raise HTTPException(status_code=400, detail="participant_key required.")
    participant_key = _own_key(obj, participant_key, student_id)
    if any(s.participant_key == participant_key for s in obj.submissions):
        return {"ok": True, "already_submitted": True}
    if _closed(obj):
        raise HTTPException(status_code=403, detail="Test sessiyasi yakunlangan.")

    now = dt.datetime.now(dt.timezone.utc)
    draft = _find_draft(db, obj.id, participant_key, student_id)
    if draft is None:
        draft = LiveTestDraft(
            session_id=obj.id,
            participant_key=participant_key,
            first_name="",
            last_name="",
            answers=[],
            updated_at=now,
            started_at=now,
        )
        db.add(draft)
    # Vaqt chegarasi (2026-10-22): sahifa birinchi ochilgan paytdan sanaladi.
    if draft.started_at is None:
        draft.started_at = now
    expired = svc.time_over(obj, draft.started_at, now)
    if not expired:
        _fill_draft(draft, payload, auth, student_id)
    # Commitdan OLDIN olinadi: commitdan keyin qoralama bazadan qayta o'qiladi va
    # shu orada "topshirish" uni o'chirgan bo'lsa 500 bo'lardi (2026-10-23).
    answers, started_at = list(draft.answers or []), draft.started_at
    try:
        db.commit()
    except IntegrityError:
        # Talabaning telefoni bir vaqtda ikki marta saqlaganda ikkala so'rov
        # ham "qoralama yo'q" deb ko'rib, ikkitasini qo'shardi — ikkinchisi
        # 500 bilan yiqilardi (2026-10-07). Endi borini yangilaymiz.
        db.rollback()
        draft = _find_draft(db, obj.id, participant_key, student_id)
        if draft is None:
            raise
        if draft.started_at is None:
            draft.started_at = now
        expired = svc.time_over(obj, draft.started_at, now)
        if not expired:
            _fill_draft(draft, payload, auth, student_id)
        answers, started_at = list(draft.answers or []), draft.started_at
        try:
            db.commit()
        except (StaleDataError, ObjectDeletedError):
            db.rollback()
            return {"ok": True, "already_submitted": True}
    except (StaleDataError, ObjectDeletedError):
        # Avto-saqlash yo'lda ekan talaba "topshirish"ni bosdi: topshiriq yozilib,
        # qoralama o'chirildi — saqlanadigan narsa qolmadi (2026-10-23: 500 xato).
        db.rollback()
        return {"ok": True, "already_submitted": True}
    # Saqlangan javoblar qaytadi: sahifa qayta ochilganda yoki boshqa
    # qurilmada talaba to'xtagan joyidan davom etadi. Muddat — server soati bo'yicha.
    return {"ok": True, "answers": answers, "expired": expired,
            "deadline_ms": svc.epoch_ms(svc.deadline_of(obj, started_at)),
            "server_now_ms": svc.epoch_ms(now)}


@router.post("/live-tests/{session_key}/finalize/")
def finalize(
    session_key: str,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles(*STAFF_ROLES)),
) -> dict:
    obj = db.execute(
        select(LiveTestSession).where(
            LiveTestSession.session_key == session_key.strip(),
            LiveTestSession.owner_key == auth.user.username,
        )
    ).scalar_one_or_none()
    if obj is None:
        raise HTTPException(status_code=404, detail="Not found.")
    auto_count = svc.finalize_live_test_session(db, obj)
    closed_ms = int(obj.closed_at.timestamp() * 1000) if obj.closed_at else None
    return {
        "ok": True,
        "is_closed": obj.is_closed,
        "closed_at_ms": closed_ms,
        "auto_submitted": auto_count,
        "submissions": svc.annotate_submissions(svc.submissions_payload(obj), svc.questions_of(obj),
                                                svc.behaviour(db, obj)),
    }


@router.get("/admin/live-test-stats/")
def admin_live_test_stats(
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("admin")),
) -> dict:
    """
    Fan (va kafedra) kesimida — kim qancha jonli test yechgani statistikasi.
    subject_code bo'sh (eski, fan biriktirilmagan testlar) ham "" kaliti ostida
    alohida guruh sifatida qaytadi — frontend buni "Noma'lum fan" deb ko'rsatadi,
    aks holda tarixiy ma'lumot butunlay ko'rinmay qolardi.
    """
    rows = (
        db.execute(
            select(
                LiveTestSession.subject_code,
                func.count(LiveTestSubmission.id).label("submission_count"),
                func.count(func.distinct(LiveTestSubmission.student_id)).label("student_count"),
            )
            .join(LiveTestSubmission, LiveTestSubmission.session_id == LiveTestSession.id)
            .group_by(LiveTestSession.subject_code)
            .order_by(func.count(LiveTestSubmission.id).desc())
        )
        .all()
    )
    codes = [r.subject_code for r in rows if r.subject_code]
    subjects = {
        s.subject_code: {"subject_name": s.subject_name, "department": s.department.name if s.department else ""}
        for s in db.execute(
            select(CourseSyllabus).where(CourseSyllabus.subject_code.in_(codes))
        ).scalars()
    }

    avg_scores: dict[str, list[float]] = {}
    subs = db.execute(select(LiveTestSubmission).join(LiveTestSession)).scalars().all()
    for sub in subs:
        payload = sub.session.payload if isinstance(sub.session.payload, dict) else {}
        questions = payload.get("questions", [])
        correct, total = svc.score_submission(questions if isinstance(questions, list) else [], sub.answers)
        if total:
            avg_scores.setdefault(sub.session.subject_code, []).append(correct / total * 100)

    data = []
    for r in rows:
        code = r.subject_code
        meta = subjects.get(code, {"subject_name": "", "department": ""})
        scores = avg_scores.get(code, [])
        data.append(
            {
                "subject_code": code or UNASSIGNED_SUBJECT_KEY,
                "subject_name": meta["subject_name"],
                "department": meta["department"],
                "submission_count": r.submission_count,
                "student_count": r.student_count,
                "avg_score_pct": round(sum(scores) / len(scores), 1) if scores else None,
            }
        )
    return {"results": data}


@router.get("/admin/live-test-sessions/")
def admin_live_test_sessions(
    subject_code: str = "",
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("admin")),
) -> dict:
    """Fan ichidagi har bir jonli test (mavzu + sana) — nechta talaba yechgani bilan."""
    query = select(
        LiveTestSession.session_key,
        LiveTestSession.payload,
        LiveTestSession.created_at,
        LiveTestSession.is_closed,
        func.count(LiveTestSubmission.id).label("submission_count"),
    ).join(LiveTestSubmission, LiveTestSubmission.session_id == LiveTestSession.id)
    # "__unassigned__" — fan biriktirilmagan (eski) testlar guruhi.
    if subject_code == UNASSIGNED_SUBJECT_KEY:
        query = query.where(LiveTestSession.subject_code == "")
    elif subject_code:
        query = query.where(LiveTestSession.subject_code == subject_code)
    query = query.group_by(
        LiveTestSession.session_key, LiveTestSession.payload, LiveTestSession.created_at, LiveTestSession.is_closed
    ).order_by(LiveTestSession.created_at.desc())
    rows = db.execute(query).all()

    data = []
    for r in rows:
        payload = r.payload if isinstance(r.payload, dict) else {}
        data.append(
            {
                "session_key": r.session_key,
                "topic": str(payload.get("topic") or ""),
                "created_at_ms": int(r.created_at.timestamp() * 1000),
                "is_closed": bool(r.is_closed),
                "submission_count": r.submission_count,
            }
        )
    return {"results": data}


@router.get("/admin/live-test-submissions/")
def admin_live_test_submissions(
    request: Request,
    subject_code: str = "",
    session_key: str = "",
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("admin")),
) -> dict:
    """Har bir talabaning jonli test (QR) topshirig'i — sahifalangan, fan/sessiya bo'yicha filtrlanadi."""
    query = select(LiveTestSubmission).join(LiveTestSession).order_by(LiveTestSubmission.submitted_at.desc())
    if subject_code == UNASSIGNED_SUBJECT_KEY:
        query = query.where(LiveTestSession.subject_code == "")
    elif subject_code:
        query = query.where(LiveTestSession.subject_code == subject_code)
    if session_key:
        query = query.where(LiveTestSession.session_key == session_key)
    rows = db.execute(query).scalars().all()

    codes = {s.session.subject_code for s in rows if s.session.subject_code}
    subject_names = svc.subject_names_for_codes(db, codes)

    def _map(sub: LiveTestSubmission) -> dict:
        payload = sub.session.payload if isinstance(sub.session.payload, dict) else {}
        questions = payload.get("questions", [])
        correct, total = svc.score_submission(questions if isinstance(questions, list) else [], sub.answers)
        code = sub.session.subject_code or ""
        return {
            "id": sub.id,
            "session_key": sub.session.session_key,
            "topic": str(payload.get("topic") or ""),
            "subject_code": code,
            "subject_name": subject_names.get(code, ""),
            "student_id": sub.student_id or "",
            "first_name": sub.first_name,
            "last_name": sub.last_name,
            "score": correct,
            "total": total,
            "submitted_at": sub.submitted_at.isoformat(),
        }

    page = paginate(rows, request, default_page_size=50, max_page_size=200)
    page["results"] = [_map(r) for r in page["results"]]
    return page


@router.get("/admin/student-live-test-report/")
def admin_student_live_test_report(
    student_id: str = "",
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("admin")),
) -> dict:
    """
    Bitta talabaning to'liq test hisoboti: talaba ID → fanlar → darslar.

    Har fan uchun o'sha fanda o'tkazilgan BARCHA testlar qaytariladi — talaba
    yechganlari ball bilan, yechmaganlari `taken: false` bilan. Shu tufayli
    "qaysi darsni yechgan, qaysinisini yechmagan" ko'rinib turadi.

    Fanlar ro'yxati talaba kamida bitta test topshirgan fanlardan olinadi
    (platformada talaba–fan biriktiruvi yo'q).
    """
    sid = (student_id or "").strip()
    if not sid:
        raise HTTPException(status_code=400, detail="student_id parametri kerak.")

    own = (
        db.execute(
            select(LiveTestSubmission)
            .join(LiveTestSession)
            .where(LiveTestSubmission.student_id == sid)
            .order_by(LiveTestSubmission.submitted_at.desc())
        )
        .scalars()
        .all()
    )
    if not own:
        return {"found": False, "student_id": sid, "first_name": "", "last_name": "", "subjects": []}

    latest = own[0]
    # Talaba qatnashgan fanlar; fan biriktirilmagan sessiyalar "" guruhida.
    subject_codes = {sub.session.subject_code or "" for sub in own}

    sessions = (
        db.execute(
            select(LiveTestSession, func.count(LiveTestSubmission.id).label("submission_count"))
            .outerjoin(LiveTestSubmission, LiveTestSubmission.session_id == LiveTestSession.id)
            .where(LiveTestSession.subject_code.in_(subject_codes))
            .group_by(LiveTestSession.id)
            .order_by(LiveTestSession.created_at.desc())
        )
        .all()
    )
    names = svc.subject_names_for_codes(db, {c for c in subject_codes if c})
    by_session = {sub.session.session_key: sub for sub in own}

    grouped: dict[str, list[dict]] = {code: [] for code in subject_codes}
    for sess, submission_count in sessions:
        payload = sess.payload if isinstance(sess.payload, dict) else {}
        questions = payload.get("questions", [])
        questions = questions if isinstance(questions, list) else []
        sub = by_session.get(sess.session_key)
        row = {
            "session_key": sess.session_key,
            "topic": str(payload.get("topic") or ""),
            "created_at_ms": int(sess.created_at.timestamp() * 1000),
            "is_closed": bool(sess.is_closed),
            "question_count": len(questions),
            "participant_count": int(submission_count or 0),
            "taken": sub is not None,
            "score": None,
            "total": len(questions),
            "submitted_at": None,
        }
        if sub is not None:
            correct, total = svc.score_submission(questions, sub.answers)
            row["score"] = correct
            row["total"] = total
            row["submitted_at"] = sub.submitted_at.isoformat()
        grouped.setdefault(sess.subject_code or "", []).append(row)

    subjects = []
    for code, rows_ in grouped.items():
        taken_rows = [r for r in rows_ if r["taken"] and r["total"]]
        pcts = [r["score"] / r["total"] * 100 for r in taken_rows]
        subjects.append(
            {
                "subject_code": code or UNASSIGNED_SUBJECT_KEY,
                "subject_name": names.get(code, ""),
                "total_sessions": len(rows_),
                "taken_sessions": sum(1 for r in rows_ if r["taken"]),
                "avg_score_pct": round(sum(pcts) / len(pcts), 1) if pcts else None,
                "sessions": rows_,
            }
        )
    subjects.sort(key=lambda x: (-x["taken_sessions"], x["subject_name"] or x["subject_code"]))

    return {
        "found": True,
        "student_id": sid,
        "first_name": latest.first_name,
        "last_name": latest.last_name,
        "subjects": subjects,
    }
