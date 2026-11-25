"""Jonli test — monitor rejimi endpointlari (2026-11-12). Qoidalar: `app/services/live_monitor.py`."""

from __future__ import annotations

import datetime as dt
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import AuthContext, require_roles
from app.api.routes.live_test import STAFF_ROLES, _closed, _find_draft, _get_session, _own_key
from app.core.db import get_db
from app.core.throttling import throttle_live_test_student
from app.models.live_test import LiveTestDraft, LiveTestSession
from app.services import live_monitor as mon
from app.services import live_test_service as svc
from app.services import server_health

router = APIRouter()
logger = logging.getLogger(__name__)


class JoinIn(BaseModel):
    participant_key: str = Field(..., min_length=1, max_length=64)
    first_name: str = Field("", max_length=128)
    last_name: str = Field("", max_length=128)


class AnswerIn(BaseModel):
    participant_key: str = Field(..., min_length=1, max_length=64)
    index: int = Field(..., ge=0, le=199)
    option: int = Field(..., ge=0, le=7)


class ControlIn(BaseModel):
    # Test boshlangach inson omili yo'q (2026-11-12): faqat "start"; keyingi savol, to'xtatish, tugatish — yo'q.
    action: str = Field(..., pattern="^start$")


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _session_or_404(db: Session, key: str) -> LiveTestSession:
    obj = _get_session(db, key)
    if obj is None or not mon.is_monitor(obj):
        raise HTTPException(status_code=404, detail="Test topilmadi.")
    return obj


def _student(auth: AuthContext) -> str:
    student_id = (auth.student_id or "").strip()
    if not student_id:
        raise HTTPException(status_code=403, detail="Talaba ID topilmadi. Qayta kiring.")
    return student_id


def _auto_finalize(db: Session, obj: LiveTestSession, st: dict) -> None:
    """Oxirgi savolning belgilash vaqti tugadi — test o'zi yopiladi, javoblar qabul qilinadi (o'qituvchi bosmaydi).

    Bir vaqtda bir nechta so'rov kelsa ham bir marta: `finalize_live_test_session` qatorni qulflaydi va
    yopilgan sessiyani qayta yopmaydi. Qulf band bo'lsa (boshqa telefon yopayapti) — kutilmaydi
    (`wait=False`): so'rov darhol javob qaytaradi, natija keyingi so'rovda.
    """
    if st["phase"] != mon.DONE or obj.is_closed:
        return
    try:
        svc.finalize_live_test_session(db, obj, wait=False)
    except Exception:  # noqa: BLE001 — holat so'rovi yiqilmasin; keyingi so'rov yana urinadi
        db.rollback()
        logger.warning("live-monitor: %s avtomatik yopilmadi", obj.session_key, exc_info=True)
    db.refresh(obj)


def _my_view(obj: LiveTestSession, draft: LiveTestDraft | None, now: dt.datetime) -> dict:
    questions = svc.questions_of(obj)
    st = mon.state(obj, len(questions), now)
    view = mon.student_view(st, questions, now)
    answers = (draft.answers or []) if draft else []
    idx = st["index"]
    view.update(
        joined=draft is not None,
        ready=bool(draft and draft.ready_at),
        my_answer=answers[idx] if 0 <= idx < len(answers) and isinstance(answers[idx], int) else -1,
        server_now_ms=int(now.timestamp() * 1000),
        submitted=False,
    )
    return view


# ------------------------------------------------------------------ talaba
@router.post("/live-tests/{session_key}/monitor/join/")
def join(
    session_key: str,
    body: JoinIn,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("student")),
    _: None = Depends(throttle_live_test_student),
) -> dict:
    """QR skanerlangach: talaba ro'yxatga qo'shiladi (o'qituvchida "qo'shildi" soni o'sadi)."""
    obj = _session_or_404(db, session_key)
    student_id = _student(auth)
    now = _now()
    # Monitor testida natija faqat test yopilganda yoziladi — ochiq paytda ro'yxatni yuklamaymiz.
    if obj.is_closed and any(s.student_id == student_id for s in obj.submissions):
        return {**_my_view(obj, None, now), "submitted": True}
    if _closed(obj):
        raise HTTPException(status_code=403, detail="Test yakunlangan.")
    key = _own_key(obj, body.participant_key.strip(), student_id)
    draft = _find_draft(db, obj.id, key, student_id)
    if draft is None:
        draft = LiveTestDraft(session_id=obj.id, participant_key=key, student_id=student_id, answers=[],
                              updated_at=now, started_at=now)
        db.add(draft)
    draft.first_name = body.first_name.strip() or draft.first_name or (auth.user.first_name or "").strip()
    draft.last_name = body.last_name.strip() or draft.last_name or (auth.user.last_name or "").strip()
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        draft = _find_draft(db, obj.id, key, student_id)
    return _my_view(obj, draft, now)


@router.post("/live-tests/{session_key}/monitor/ready/")
def ready(
    session_key: str,
    body: JoinIn,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("student")),
    _: None = Depends(throttle_live_test_student),
) -> dict:
    obj = _session_or_404(db, session_key)
    student_id = _student(auth)
    draft = _find_draft(db, obj.id, _own_key(obj, body.participant_key.strip(), student_id), student_id)
    if draft is None:
        raise HTTPException(status_code=409, detail="Avval QR orqali qo'shiling.")
    now = _now()
    if draft.ready_at is None:
        draft.ready_at = now
        db.commit()
    return _my_view(obj, draft, now)


@router.get("/live-tests/{session_key}/monitor/state/")
def student_state(
    session_key: str,
    participant_key: str,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("student")),
    _: None = Depends(throttle_live_test_student),
    __: None = Depends(server_health.poll_slot),
) -> dict:
    """Telefon bosqich chegarasida va zaxira uchun ~5 soniyada so'raydi: joriy savol variantlari (savol matnisiz), qolgan vaqt, o'z javobi."""
    obj = _session_or_404(db, session_key)
    student_id = _student(auth)
    now = _now()
    _auto_finalize(db, obj, mon.state(obj, len(svc.questions_of(obj)), now))
    # Monitor testida natija faqat test yopilganda yoziladi — ochiq paytda ro'yxatni yuklamaymiz.
    if obj.is_closed and any(s.student_id == student_id for s in obj.submissions):
        return {**_my_view(obj, None, now), "submitted": True}
    draft = _find_draft(db, obj.id, _own_key(obj, participant_key.strip()[:64], student_id), student_id)
    return _my_view(obj, draft, now)


@router.post("/live-tests/{session_key}/monitor/answer/")
def answer(
    session_key: str,
    body: AnswerIn,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("student")),
    _: None = Depends(throttle_live_test_student),
) -> dict:
    """Faqat JORIY savolga va faqat uning 10 soniyalik belgilash bosqichida; o'tgan savolga qaytib bo'lmaydi."""
    obj = _session_or_404(db, session_key)
    student_id = _student(auth)
    if _closed(obj):
        raise HTTPException(status_code=403, detail="Test yakunlangan.")
    questions = svc.questions_of(obj)
    now = _now()
    if not mon.can_answer(obj, len(questions), body.index, now):
        raise HTTPException(status_code=409, detail="Javob faqat belgilash vaqtida (10 soniya) qabul qilinadi.")
    if body.option >= len(mon.options_of(questions[body.index])):
        raise HTTPException(status_code=400, detail="Bunday variant yo'q.")
    draft = _find_draft(db, obj.id, _own_key(obj, body.participant_key.strip(), student_id), student_id)
    if draft is None:
        raise HTTPException(status_code=409, detail="Avval QR orqali qo'shiling.")
    draft.answers = mon.put_answer(draft.answers, body.index, body.option, len(questions))
    draft.updated_at = now
    db.commit()
    _advance_if_everyone_answered(db, obj, body.index, len(questions), now)
    return _my_view(obj, draft, now)


def _session_drafts(db: Session, obj: LiveTestSession) -> list:
    return list(db.execute(select(LiveTestDraft).where(LiveTestDraft.session_id == obj.id)).scalars().all())


def _lock_session(db: Session, obj: LiveTestSession) -> LiveTestSession:
    return db.execute(select(LiveTestSession).where(LiveTestSession.id == obj.id).with_for_update()).scalar_one()


def _advance_if_everyone_answered(db: Session, obj: LiveTestSession, index: int, total: int, now: dt.datetime) -> None:
    """Hamma javob belgiladi — keyingi savol darhol (2026-11-16). Bir vaqtda kelgan javoblar sessiya qatorini
    qulflab tekshiradi, shuning uchun savol faqat BIR marta suriladi. Xatoda jim — vaqt bo'yicha o'tadi."""
    try:
        drafts = _session_drafts(db, obj)
        if not mon.should_advance(obj, total, index, drafts, now):
            return
        locked = _lock_session(db, obj)
        if mon.should_advance(locked, total, index, drafts, now):
            mon.advance(locked, index, now)
            db.commit()
        else:
            db.rollback()
        db.refresh(obj)
    except Exception:  # noqa: BLE001 — javob saqlangan; keyingi savol baribir vaqt bo'yicha chiqadi
        db.rollback()
        logger.warning("live-monitor: %s erta o'tkazilmadi", obj.session_key, exc_info=True)


# ------------------------------------------------------------------ o'qituvchi (monitor)
def _own_session(db: Session, key: str, auth: AuthContext) -> LiveTestSession:
    obj = db.execute(
        select(LiveTestSession).where(LiveTestSession.session_key == key.strip(),
                                      LiveTestSession.owner_key == auth.user.username)
    ).scalar_one_or_none()
    if obj is None or not mon.is_monitor(obj):
        raise HTTPException(status_code=404, detail="Test topilmadi.")
    return obj


def _host_beat(db: Session, obj: LiveTestSession, now: dt.datetime) -> bool:
    """Monitor ko'rindi. Uzoq yo'q bo'lgan bo'lsa (test to'xtab turgan) — to'xtagan savol HOZIR boshidan
    boshlanadi (`live_monitor.HOST_GRACE`); shunda True. Bazaga har so'rovda emas, `HOST_BEAT` da bir yoziladi."""
    if obj.is_closed or obj.monitor_phase != mon.RUNNING:
        return False
    seen = obj.monitor_host_seen_at
    if seen is not None and now - seen <= mon.HOST_BEAT:
        return False
    try:
        db.refresh(obj, with_for_update=True)
        if obj.is_closed or obj.monitor_phase != mon.RUNNING:
            db.rollback()
            return False
        index = mon.resume_index(obj, len(svc.questions_of(obj)), now)
        if index is not None:
            logger.info("live-monitor: %s monitor qaytdi — %s-savol qayta boshlandi", obj.session_key, index + 1)
            obj.monitor_index, obj.monitor_started_at = index, now
        obj.monitor_host_seen_at = now
        db.commit()
        return index is not None
    except Exception:  # noqa: BLE001 — holat so'rovi yiqilmasin; keyingi so'rov yana yozadi
        db.rollback()
        logger.warning("live-monitor: %s monitor belgisi yozilmadi", obj.session_key, exc_info=True)
        return False


def _host_view(db: Session, obj: LiveTestSession, now: dt.datetime) -> dict:
    db.refresh(obj)
    restarted = _host_beat(db, obj, now)
    if restarted:
        db.refresh(obj)
    questions = svc.questions_of(obj)
    st = mon.state(obj, len(questions), now)
    _auto_finalize(db, obj, st)
    st = mon.state(obj, len(questions), now)
    return {**mon.monitor_view(st, questions), **mon.roster(obj.drafts, obj.submissions, st),
            "restarted": restarted, "server_now_ms": int(now.timestamp() * 1000), "is_closed": bool(obj.is_closed)}


@router.get("/live-tests/{session_key}/monitor/host/")
def host_state(
    session_key: str,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles(*STAFF_ROLES)),
    __: None = Depends(server_health.poll_slot),
) -> dict:
    """Monitor: kutish xonasi (qo'shilganlar, tayyorlar), joriy savol matni va variantlari, vaqt."""
    return _host_view(db, _own_session(db, session_key, auth), _now())


@router.post("/live-tests/{session_key}/monitor/control/")
def control(
    session_key: str,
    body: ControlIn,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles(*STAFF_ROLES)),
) -> dict:
    """Faqat "start" — hamma qo'shilgan talaba tayyor bo'lsa. Keyin hammasi vaqt bo'yicha o'zi ketadi."""
    obj = _own_session(db, session_key, auth)
    if obj.is_closed:
        raise HTTPException(status_code=409, detail="Test yakunlangan.")
    now = _now()
    st = mon.state(obj, len(svc.questions_of(obj)), now)
    if st["phase"] != mon.LOBBY:
        raise HTTPException(status_code=409, detail="Test allaqachon boshlangan.")
    r = mon.roster(obj.drafts, obj.submissions, st)
    if not r["can_start"]:
        raise HTTPException(status_code=409, detail=f"Hamma tayyor emas: {r['ready']}/{r['joined']}.")
    obj.monitor_phase, obj.monitor_index, obj.monitor_started_at = mon.RUNNING, 0, now
    obj.monitor_host_seen_at = now
    # Joriy qoida shu test uchun qotiriladi (kutish zalida deploydan oldin ochilgan bo'lsa ham).
    obj.seconds_per_question = mon.CYCLE_SECONDS
    db.commit()
    return _host_view(db, obj, now)
