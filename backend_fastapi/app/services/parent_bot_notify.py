"""Ota-onalar boti: natijalarni o'zi yuborish (2026-10-22).

Har daqiqada (ilova ichidagi fon oqimi, `start_background`):
1. o'qituvchi yopishni unutgan, 24 soatdan oshgan jonli testlar yakunlanadi —
   aks holda «topshirish»ni bosmagan talabaning natijasi hech qachon chiqmasdi
   (o'qituvchi ro'yxatni ochganda ham xuddi shu ish bajariladi);
2. ota-onasi ulangan talabaning chiqarilgan (`parent_bot_data.released`) har bir
   yangi natijasi yuboriladi;
3. kechqurun (`DAILY_AT`) — kunlik hisobot: guruhning barcha paralari va natijalar.

Bir xabar ikki marta ketmasligi: avval `core_parentbotnotice` ga yozib olinadi
(unique kalit), keyin yuboriladi. 4 ta ishchi jarayon bo'lsa ham, Postgres
advisory lock bilan bir vaqtda faqat bittasi ishlaydi.
"""

from __future__ import annotations

import datetime as dt
import logging
import os
import random
import threading
import time

from sqlalchemy import select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models.parent_bot import ParentBotChat, ParentBotLink, ParentBotNotice
from app.services import parent_bot as bot
from app.services import parent_bot_data as data
from app.services import telegram_api
from app.services.live_test_service import finalize_all_expired
from app.services.telegram_api import Api, TelegramError

log = logging.getLogger("app.parent_bot")

LOCK_KEY = 7_210_822
INTERVAL_SECONDS = 60
#: live_test_service.EXPIRED_TTL bilan bir xil (eski nom saqlandi).
SESSION_TTL = dt.timedelta(hours=24)
DAILY_UNTIL = dt.time(22, 30)
MAX_TRIES = 5
#: Bitta xabarda ko'pi bilan shuncha natija (Telegram 4096 belgi; 40 tasi 10 500 belgi edi).
NOTICE_CHUNK = 10
BATCH = 300
RUN_BUDGET_SECONDS = 50
SEND_GAP_SECONDS = 0.04


def _now() -> dt.datetime:
    return dt.datetime.now(data.TZ)


def finalize_expired(db: Session, now: dt.datetime) -> int:
    return finalize_all_expired(db, now)


def claim(db: Session, chat_id: int, kind: str, ref: str, status: str = "claimed") -> bool:
    res = db.execute(
        insert(ParentBotNotice).values(chat_id=chat_id, kind=kind, ref=ref, status=status, tries=1)
        .on_conflict_do_nothing(constraint="uq_parentbotnotice_chat_kind_ref")
        .returning(ParentBotNotice.id)
    ).first()
    db.commit()
    return res is not None


def finish(db: Session, chat_id: int, kind: str, ref: str, status: str, error: str = "") -> None:
    row = db.execute(select(ParentBotNotice).where(
        ParentBotNotice.chat_id == chat_id, ParentBotNotice.kind == kind, ParentBotNotice.ref == ref)).scalar_one()
    row.status = status
    row.error = error[:500]
    if status == "sent":
        row.sent_at = dt.datetime.now(dt.timezone.utc)
    db.commit()


def pending_tests(db: Session, now: dt.datetime) -> list[tuple[int, int, str]]:
    """[(chat_id, urinish id, talaba)] — yuborilmagan, chiqarilgan natijalar (ulanishdan keyin topshirilgan)."""
    rows = db.execute(text("""
        SELECT l.chat_id, a.id, a.student_id
        FROM core_studenttestattempt a
        JOIN core_livetestsession s ON s.id = a.session_id
        JOIN core_parentbotlink l ON l.student_id = a.student_id AND l.is_active
        JOIN core_parentbotchat c ON c.chat_id = l.chat_id AND NOT c.is_blocked
        WHERE a.submitted_at > :since
          AND a.submitted_at >= l.created_at
          AND (s.is_closed OR a.submitted_at <= :released)
          AND NOT EXISTS (SELECT 1 FROM core_parentbotnotice n
                          WHERE n.chat_id = l.chat_id AND n.kind = 'test' AND n.ref = a.id::text)
        ORDER BY a.submitted_at
        LIMIT :limit
    """), {"since": now - dt.timedelta(days=3), "released": now - data.RELEASE_AFTER, "limit": BATCH}).all()
    return [(int(c), int(a), str(s)) for c, a, s in rows]


#: N-urinish yozib olingandan keyin qachon (2026-10-23). Ilgari 3 urinish bir daqiqada
#: tugab ketardi va Telegram 2 daqiqa javob bermasa natija butunlay yo'qolardi.
RETRY_AFTER = {1: dt.timedelta(minutes=2), 2: dt.timedelta(minutes=12), 3: dt.timedelta(minutes=42),
               4: dt.timedelta(hours=3)}


def retries(db: Session, now: dt.datetime) -> list[ParentBotNotice]:
    """Yuborilmay qolganlar: xato bo'lgan yoki yozib olinib, jarayon uzilib qolgan."""
    rows = db.execute(select(ParentBotNotice).where(
        ParentBotNotice.created_at > now - dt.timedelta(days=1),
        ParentBotNotice.tries < MAX_TRIES,
        ParentBotNotice.status.in_(("failed", "claimed")),
    ).order_by(ParentBotNotice.created_at).limit(300)).scalars().all()
    out = []
    for row in rows:
        wait = RETRY_AFTER.get(row.tries, dt.timedelta(hours=3))
        if row.status == "claimed":
            wait = max(wait, dt.timedelta(minutes=10))  # jarayon uzilib qolgan bo'lishi mumkin
        if row.created_at <= now - wait:
            out.append(row)
    return out[:100]


def close_stuck(db: Session, now: dt.datetime) -> None:
    """Urinishlari tugagan yoki bir kundan oshib "claimed"da qolganlar — yopiladi."""
    db.execute(update(ParentBotNotice).where(
        ParentBotNotice.status == "claimed",
        (ParentBotNotice.tries >= MAX_TRIES) | (ParentBotNotice.created_at <= now - dt.timedelta(days=1)),
        ParentBotNotice.created_at <= now - dt.timedelta(minutes=30),
    ).values(status="failed", error="uzilib qolgan"))
    db.commit()


def _chat(db: Session, chat_id: int) -> ParentBotChat | None:
    return db.execute(select(ParentBotChat).where(ParentBotChat.chat_id == chat_id)).scalar_one_or_none()


def _link(db: Session, chat_id: int, student_id: str) -> ParentBotLink | None:
    return db.execute(select(ParentBotLink).where(
        ParentBotLink.chat_id == chat_id, ParentBotLink.student_id == student_id,
        ParentBotLink.is_active.is_(True))).scalar_one_or_none()


def test_message(db: Session, chat: ParentBotChat, attempt_ids: list[int]) -> tuple[str, dict] | None:
    """Bitta natija — to'liq xabar; bir vaqtda bir nechtasi chiqqan bo'lsa — bitta umumiy xabar."""
    attempts = [a for a in (data.attempt_by_id(db, pk) for pk in attempt_ids) if a is not None]
    if not attempts:
        return None
    sid = attempts[0].student_id
    link = _link(db, chat.chat_id, sid)
    if link is None:
        return None
    st = data.student(db, sid)
    group = st.group_name if st else ""
    name = data.full_name(st) if st else sid
    lang = bot.lang_of(chat.language)
    names = data.subject_names(db, {a.subject_code for a in attempts})
    lessons: dict[dt.date, list[data.Lesson]] = {}
    items = []
    for a in sorted(attempts, key=lambda x: x.submitted_at):
        day = a.local.date()
        if day not in lessons:
            lessons[day] = data.lessons_on(db, group, day)
        lesson = data.match_lesson(lessons[day], a.submitted_at, a.owner)
        subject = (lesson.subject if lesson else "") or data.clean_subject(names.get(a.subject_code) or a.subject_code) \
            or "—"
        items.append((a, lesson, subject))
    if len(items) == 1:
        a, lesson, subject = items[0]
        avg = data.session_averages(db, [a.session_id]).get(a.session_id)
        body = bot.notice_text(lang, name, group, a, lesson, subject, avg)
    else:
        body = bot.notice_many_text(lang, name, group, items)
    last_day = items[-1][0].local.date()
    label = "btn_today_short" if last_day == _now().date() else "btn_that_day"
    markup = bot.kb([[(bot.tr(lang, label), f"!D:{link.id}:{last_day.strftime('%Y%m%d')}"),
                      (bot.tr(lang, "btn_results"), f"!H:{link.id}:0")]])
    return body, markup


def daily_message(db: Session, chat: ParentBotChat, link: ParentBotLink, now: dt.datetime) -> tuple[str, dict] | None:
    lang = bot.lang_of(chat.language)
    st = data.student(db, link.student_id)
    if st is not None and st.status != "active":
        # O'qishni tugatgan / chetlashtirilgan: eski guruh darslari bo'yicha hisobot kerak emas.
        return None
    body, markup, has = bot.render_day(db, lang, link, now.date(), now, nav=False)
    if not has:
        return None
    return bot.tr(lang, "daily_title") + "\n\n" + body, markup


def deliver(db: Session, api: Api, chat_id: int, kind: str, refs: list[str], build) -> str:
    """Bitta xabar (bir yoki bir nechta yozib olingan natija uchun). Natija: sent | failed | skipped | blocked."""

    def done(status: str, error: str = "") -> str:
        for ref in refs:
            finish(db, chat_id, kind, ref, status, error)
        return status

    chat = _chat(db, chat_id)
    if chat is None or chat.is_blocked:
        return done("skipped", "blocked")
    try:
        built = build(chat)
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        log.warning("parent-bot: xabarni tayyorlab bo'lmadi (%s %s)", kind, refs, exc_info=True)
        return done("failed", type(exc).__name__)
    if built is None:
        return done("skipped")
    body, markup = built
    try:
        api.send(chat_id, body, markup)
    except TelegramError as exc:
        if exc.blocked:
            chat.is_blocked = True
            db.commit()
            done("skipped", f"{exc.code} {exc.description}")
            return "blocked"
        if exc.retry_after:
            time.sleep(min(int(exc.retry_after), 30))
        return done("failed", f"{exc.code} {exc.description}")
    time.sleep(SEND_GAP_SECONDS)
    return done("sent")


def dispatch_once(db: Session, api: Api, now: dt.datetime | None = None) -> dict:
    now = now or _now()
    started = time.monotonic()
    stats = {"finalized": 0, "sent": 0, "failed": 0, "skipped": 0, "blocked": 0, "daily": 0}
    stats["finalized"] = finalize_expired(db, now)

    def over_budget() -> bool:
        return time.monotonic() - started > RUN_BUDGET_SECONDS

    # Bir talabaning bir vaqtda chiqqan natijalari — bitta xabar.
    batches: dict[tuple[int, str], list[int]] = {}
    for chat_id, attempt_id, sid in pending_tests(db, now):
        batches.setdefault((chat_id, sid), []).append(attempt_id)
    chunks = [(chat_id, ids[i:i + NOTICE_CHUNK]) for (chat_id, _sid), ids in batches.items()
              for i in range(0, len(ids), NOTICE_CHUNK)]
    for chat_id, attempt_ids in chunks:
        if over_budget():
            return stats
        claimed = [pk for pk in attempt_ids if claim(db, chat_id, "test", str(pk))]
        if not claimed:
            continue
        outcome = deliver(db, api, chat_id, "test", [str(pk) for pk in claimed],
                          lambda chat, ids=claimed: test_message(db, chat, ids))
        stats[outcome] += 1

    close_stuck(db, now)

    for notice in retries(db, now):
        if over_budget():
            return stats
        notice.tries += 1
        notice.status = "claimed"
        db.commit()
        if notice.kind == "test":
            build = lambda chat, a=int(notice.ref): test_message(db, chat, [a])  # noqa: E731
        else:
            day_ref, _, sid = notice.ref.partition(":")
            if day_ref != now.date().isoformat():
                finish(db, notice.chat_id, notice.kind, notice.ref, "skipped", "eskirgan")
                continue
            build = lambda chat, s=sid: (lambda link: daily_message(db, chat, link, now) if link else None)(  # noqa: E731
                _link(db, chat.chat_id, s))
        stats[deliver(db, api, notice.chat_id, notice.kind, [notice.ref], build)] += 1

    local = now.astimezone(data.TZ)
    if bot.DAILY_AT <= local.time() <= DAILY_UNTIL:
        day = local.date().isoformat()
        rows = db.execute(text("""
            SELECT l.chat_id, l.student_id FROM core_parentbotlink l
            JOIN core_parentbotchat c ON c.chat_id = l.chat_id AND NOT c.is_blocked AND c.daily_summary
            WHERE l.is_active AND NOT EXISTS (
                SELECT 1 FROM core_parentbotnotice n
                WHERE n.chat_id = l.chat_id AND n.kind = 'daily' AND n.ref = :day || ':' || l.student_id)
            ORDER BY l.chat_id, l.id
        """), {"day": day}).all()
        for chat_id, sid in rows:
            if over_budget():
                return stats
            ref = f"{day}:{sid}"
            if not claim(db, int(chat_id), "daily", ref):
                continue
            outcome = deliver(db, api, int(chat_id), "daily", [ref],
                              lambda chat, s=sid: (lambda link: daily_message(db, chat, link, now) if link else None)(
                                  _link(db, chat.chat_id, s)))
            stats[outcome] += 1
            stats["daily"] += outcome == "sent"
    return stats


def run_once_locked() -> dict | None:
    """Advisory lock bilan: bir vaqtda faqat bitta ishchi jarayon yuboradi."""
    from app.core.db import SessionLocal, engine

    with engine.connect() as conn:
        got = conn.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": LOCK_KEY}).scalar()
        conn.commit()
        if not got:
            return None
        try:
            with SessionLocal() as db:
                return dispatch_once(db, Api())
        finally:
            conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": LOCK_KEY})
            conn.commit()


def _loop() -> None:
    time.sleep(random.uniform(5, 20))
    while True:
        try:
            stats = run_once_locked()
            if stats and any(stats.values()):
                log.info("parent-bot: %s", stats)
        except Exception:  # noqa: BLE001 — oqim to'xtab qolmasin
            log.warning("parent-bot: yuborishda xato", exc_info=True)
        time.sleep(INTERVAL_SECONDS)


def start_background() -> None:
    if not telegram_api.enabled() or os.environ.get("PARENT_BOT_NOTIFY", "1") == "0":
        return
    threading.Thread(target=_loop, name="parent-bot-notify", daemon=True).start()
