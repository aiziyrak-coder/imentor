"""Fan va mavzu nomlari tarjimasidagi bo'shliqlarni fonda to'ldirish (2026-11-12).

Shikoyat: "tarjimalarda doim muammo bo'ladi" — ruscha ma'ruzaning sarlavhasi o'zbekcha qolardi. 2026-11-12
holati: 830 faol fandan 346 tasida 11 740 mavzu nomi tarjimasiz edi. Tarjima fan yaratilganda (fon vazifasi)
va interfeys tili almashganda (brauzer so'rovi) boshlanadi, lekin vazifa yiqilsa (AI navbati band — 429,
vaqt tugashi) yoki fan skript bilan yozilsa, bo'shliq abadiy qolardi: uni hech kim qayta so'ramasdi.

Endi har `INTERVAL` da yetishmayotgan tilni topib, `ensure_syllabus_translations` bilan to'ldiriladi.
Bir yurishda `PER_RUN` tagacha fan (xarajat chegaralangan), yangi o'zgarganlari birinchi. Doim yiqiladigan
fan 24 soatgacha qayta urinilmaydi — navbatni egallab qolmasin. Bir nechta worker bo'lsa ham bittasi
ishlaydi (Postgres advisory lock).
"""

from __future__ import annotations

import datetime as dt
import logging
import os
import random
import threading
import time

from sqlalchemy import select, text

from app.models.content import CourseSyllabus
from app.services import syllabus_i18n as si

log = logging.getLogger(__name__)

LOCK_KEY = 7_311_202_611
INTERVAL_SECONDS = int(os.environ.get("IMENTOR_SYLLABUS_I18N_REPAIR_MINUTES") or 120) * 60
PER_RUN = int(os.environ.get("IMENTOR_SYLLABUS_I18N_REPAIR_PER_RUN") or 40)
RETRY_AFTER = dt.timedelta(hours=24)

#: Shu jarayonda yaqinda urinilgan, lekin to'lmagan fanlar: {id: vaqt}.
_failed_at: dict[int, dt.datetime] = {}


def missing_languages(syllabus: CourseSyllabus, langs: tuple[str, ...] = si.SUPPORTED_LANGS) -> tuple[str, ...]:
    """Qaysi tillarda fan nomi yoki biror mavzu nomi tarjimasi yo'q (asl tildan tashqari)."""
    titles = si.collect_topic_titles(syllabus)
    source = (syllabus.instruction_language or "uz").strip().lower()
    names = syllabus.name_i18n or {}
    topics = syllabus.topics_i18n or {}
    out = []
    for lang in langs:
        if lang == source and not si._titles_look_foreign(titles, lang):
            continue
        have = topics.get(lang) or {}
        # Bo'sh YOKI noto'g'ri tilda (masalan ruscha ichida o'zbekcha so'z) — `ensure_syllabus_translations`
        # bunday tarjimani o'zi tozalab, qayta tarjima qiladi.
        if any(
            not str(have.get(t) or "").strip() or si.looks_wrong_language(str(have.get(t)), lang, t) for t in titles
        ) or (
            syllabus.subject_name and not str(names.get(lang) or "").strip()
        ):
            out.append(lang)
    return tuple(out)


def pending(db, limit: int = PER_RUN, now: dt.datetime | None = None) -> list[tuple[int, tuple[str, ...]]]:
    """To'ldirish kerak bo'lgan fanlar: (id, tillar), yangi o'zgarganlari birinchi."""
    now = now or dt.datetime.now(dt.timezone.utc)
    out: list[tuple[int, tuple[str, ...]]] = []
    rows = db.execute(
        select(CourseSyllabus).where(CourseSyllabus.is_active.is_(True)).order_by(CourseSyllabus.updated_at.desc())
    ).scalars()
    for syl in rows:
        failed = _failed_at.get(syl.id)
        if failed is not None and now - failed < RETRY_AFTER:
            continue
        langs = missing_languages(syl)
        if langs:
            out.append((syl.id, langs))
            if len(out) >= limit:
                break
    return out


def repair(db, limit: int = PER_RUN) -> dict:
    """Bir yurish: `limit` tagacha fanni to'ldiradi. Qaytaradi: {"tried", "filled", "still_missing"}."""
    stats = {"tried": 0, "filled": 0, "still_missing": 0}
    for syllabus_id, langs in pending(db, limit):
        stats["tried"] += 1
        try:
            obj = db.get(CourseSyllabus, syllabus_id)
            if obj is None:
                continue
            si.ensure_syllabus_translations(db, obj, langs)
            db.refresh(obj)
            left = missing_languages(obj, langs)
        except Exception:  # noqa: BLE001 — bitta fan butun yurishni to'xtatmasin
            db.rollback()
            log.warning("syllabus-i18n-repair: #%s tarjimasi bajarilmadi", syllabus_id, exc_info=True)
            left = langs
        if left:
            stats["still_missing"] += 1
            _failed_at[syllabus_id] = dt.datetime.now(dt.timezone.utc)
        else:
            stats["filled"] += 1
            _failed_at.pop(syllabus_id, None)
    return stats


def run_once_locked(limit: int = PER_RUN) -> dict | None:
    from app.core.db import SessionLocal, engine

    with engine.connect() as conn:
        got = conn.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": LOCK_KEY}).scalar()
        conn.commit()
        if not got:
            return None
        try:
            with SessionLocal() as db:
                return repair(db, limit)
        finally:
            conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": LOCK_KEY})
            conn.commit()


def _loop() -> None:
    time.sleep(random.uniform(120, 300))
    while True:
        try:
            stats = run_once_locked()
            if stats and stats["tried"]:
                log.info("syllabus-i18n-repair: %s", stats)
        except Exception:  # noqa: BLE001 — oqim to'xtamasin
            log.warning("syllabus-i18n-repair: xato", exc_info=True)
        time.sleep(INTERVAL_SECONDS)


def start_background() -> None:
    if os.environ.get("IMENTOR_SYLLABUS_I18N_REPAIR", "1") == "0":
        return
    threading.Thread(target=_loop, name="syllabus-i18n-repair", daemon=True).start()
