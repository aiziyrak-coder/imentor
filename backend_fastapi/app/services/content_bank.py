"""Institut bo'yicha material banki: "bir mavzuga bir marta" (2026-10-22).

Foydalanuvchi qarori: shu mavzuda institutda material bo'lsa — o'qituvchining
o'zinikimi, hamkasbinikimi — o'sha olinadi; AI faqat YANGI mavzuga yozadi.

Mavzu ikki yo'l bilan topiladi:
* aniq — shu sillabus va mavzu kodi;
* o'xshash — boshqa o'qituvchining boshqa sillabusida, lekin nomi deyarli bir xil
  mavzu (so'zlar Jaccard o'xshashligi >= `SIMILAR_MIN`). 2026-10-22 o'lchovi: bugungi
  testlarning 17% ida shunday mavzu bor edi, aniq kalit esa uni ko'rmasdi.

Hamkasbning materiali o'qituvchiga NUSXA sifatida beriladi (frontend o'ziga saqlaydi,
`copiedFrom` belgisi bilan) — asl nusxa o'zgarmaydi, nazorat hisobotida nusxa
"o'zi yaratgan" deb sanalmaydi.

2026-10-23 tuzatishlari (o'xshash nom boshqa mavzu va boshqa fanni olib kelardi):
* "Qandli diabet 1-tip" ≠ "2-tip", "Gepatit B" ≠ "C", "1-qism" ≠ "2-qism" — raqam,
  rim raqami va bitta harfli belgilar AYNAN mos bo'lishi kerak;
* "Fanga kirish", "Amaliy mashg'ulot 7" kabi umumiy nomlar — o'xshash deb olinmaydi
  (kamida 3 ta mazmunli so'z);
* faqat SHU KAFEDRA sillabuslaridan, faol va o'qituvchiga ochiq fanlardan;
* semestr varianti bor sillabusda boshqa semestrning shu kodli mavzusi olinmaydi;
* sifat: rad javobi, juda qisqa (eski, kesilgan) ma'ruza, bo'sh taqdimot berilmaydi;
* til matnning o'zidan aniqlanadi (eski taqdimotlarda til belgisi yo'q edi).
"""

from __future__ import annotations

import re

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models.content import CourseSyllabus
from app.models.prepared_content import PreparedContent
from app.services import case_i18n as ci

SIMILAR_MIN = 0.8
#: O'xshash deb olish uchun nomda shuncha mazmunli so'z bo'lishi kerak.
MIN_WORDS = 3
#: Shundan qisqa ma'ruza — eski (1200 token chegarali) yoki kesilgan: bankdan berilmaydi.
MIN_LECTURE_CHARS = 3000
MIN_DECK_SLIDES = 5
_TOKEN = re.compile(r"[^\W_]+", re.U)
_ROMAN = re.compile(r"^(?=[ivxlc]+$)c{0,3}(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$")
_STOP = {"va", "ning", "bilan", "uchun", "hamda", "yoki", "and", "of", "the", "in", "for", "with",
         "и", "в", "на", "при", "для", "или", "mavzu", "topic", "тема"}
#: Ko'p fanda takrorlanadigan umumiy so'zlar — mavzuni ajratmaydi.
_GENERIC = {"kirish", "fanga", "fanning", "fani", "maqsadi", "vazifalari", "amaliy", "mashgulot", "mashg'ulot",
            "seminar", "maruza", "ma'ruza", "dars", "darsi", "nazorat", "oraliq", "yakuniy", "qism", "qismi",
            "takrorlash", "umumiy", "asosiy", "tushuncha", "tushunchalar", "введение", "занятие", "практическое",
            "лекция", "семинар", "часть", "контроль", "основы", "общие", "понятия", "introduction", "lecture",
            "practical", "lesson", "seminar", "part", "basics", "general", "concepts", "review", "control"}


def _norm(title: str) -> str:
    text = (title or "").lower().replace("‘", "'").replace("’", "'").replace("ʻ", "'").replace("ʼ", "'")
    return text.replace("'", "")


def topic_words(title: str) -> frozenset[str]:
    """Mavzuning mazmunli so'zlari (umumiy va yordamchi so'zlarsiz)."""
    return frozenset(w for w in _TOKEN.findall(_norm(title))
                     if len(w) > 3 and not w.isdigit() and w not in _STOP and w not in _GENERIC)


def topic_markers(title: str) -> frozenset[str]:
    """Mavzuni AJRATADIGAN belgilar: raqamlar ("1-tip", "2-qism"), rim raqamlari, bitta harf ("B", "C")."""
    out = set()
    for tok in _TOKEN.findall(_norm(title)):
        digits = re.findall(r"\d+", tok)
        if digits:
            out.update(str(int(d)) for d in digits)
        elif len(tok) == 1 or (len(tok) <= 4 and _ROMAN.match(tok)):
            out.add(tok)
    return frozenset(out)


def similarity(a: frozenset[str], b: frozenset[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def same_topic(a: str, b: str) -> bool:
    words = topic_words(a)
    if len(words) < MIN_WORDS:
        return False
    return topic_markers(a) == topic_markers(b) and similarity(words, topic_words(b)) >= SIMILAR_MIN


def _subject_words(name: str) -> frozenset[str]:
    from app.services.parent_bot_data import clean_subject

    return topic_words(clean_subject(name or ""))


def similar_ids(db: Session, kind: str, title: str, *, since=None, exclude_syllabus: int | None = None,
                limit: int = 40, username: str = "", role: str = "hodim") -> list[int]:
    """Nomi deyarli bir xil, SHU KAFEDRA boshqa sillabusidagi mavzu yozuvlari (yangisi birinchi).

    `exclude_syllabus` — joriy sillabus: kafedra shundan olinadi. U bo'lmasa (kafedrani
    bilmasak) o'xshash qidirilmaydi — boshqa fanning materiali kelib qolmasin.
    """
    from app.services.syllabus_access import visible_to

    if len(topic_words(title)) < MIN_WORDS or not exclude_syllabus:
        return []
    anchor = db.execute(select(CourseSyllabus.department_id, CourseSyllabus.subject_name)
                        .where(CourseSyllabus.id == exclude_syllabus)).first()
    if anchor is None:
        return []
    stmt = (
        select(PreparedContent.id, PreparedContent.topic, PreparedContent.syllabus_id,
               CourseSyllabus.subject_name, CourseSyllabus.allowed_owner_keys)
        .join(CourseSyllabus, CourseSyllabus.id == PreparedContent.syllabus_id)
        .where(PreparedContent.kind == kind, PreparedContent.retired_reason == "",
               CourseSyllabus.is_active.is_(True), PreparedContent.syllabus_id != exclude_syllabus)
    )
    # 2026-11-24 (HEMIS fanlari): HEMIS sillabusi kafedraning HEMIS bilan bog'langan yozuviga, eski sillabus esa
    # o'sha kafedraning boshqa yozuviga tegishli bo'lishi mumkin — faqat kafedra bo'yicha qidirilsa, mos savollar
    # topilmasdi (bugungi HEMIS testlarining 14/20 ida bank 10 dan kam edi). Endi: kafedra YOKI fan nomi mos.
    stmt = stmt.add_columns(CourseSyllabus.department_id)
    if since is not None:
        stmt = stmt.where(PreparedContent.created_at >= since)
    rows = db.execute(stmt.order_by(PreparedContent.created_at.desc())).all()
    subject = _subject_words(anchor.subject_name)
    out = []
    for pk, topic, _sid, subject_name, allowed, dep_id in rows:
        # Test savollari — institut banki: o'qituvchi sillabusni emas, savolni ko'radi (ko'rinish cheklovi faqat
        # ma'ruza/taqdimot kabi butun material uchun).
        if username and kind != "test" and not visible_to(allowed, username, role):
            continue
        same_dep = bool(anchor.department_id) and dep_id == anchor.department_id
        other = _subject_words(subject_name)
        # Qamrov: qisqa nomning so'zlari uzunida bormi ("Terapevtik stomatologiya" ⊂ "Stomatologiya 2025 … Terapevtik
        # stomatologiya") — Jaccard uzun eski nomlarda past chiqardi.
        overlap = len(subject & other) / min(len(subject), len(other)) if subject and other else 0.0
        if not same_dep and overlap < 0.75:
            continue
        if same_topic(title, topic):
            out.append(pk)
            if len(out) >= limit:
                break
    return out


def _usable(item: PreparedContent, language: str) -> bool:
    """Bankdan berishga yaraydimi: rad javobi emas, to'liq va so'ralgan tilda."""
    from app.services import content_i18n, refusal_guard

    payload = item.payload if isinstance(item.payload, dict) else {}
    if not payload:
        return False
    if item.kind == content_i18n.KIND_LECTURE:
        content = str(payload.get("content") or "")
        if len(content) < MIN_LECTURE_CHARS or refusal_guard.lecture_is_refusal(content):
            return False
        return content_i18n.has_translation(item.kind, payload, language)
    if item.kind == content_i18n.KIND_PRESENTATION:
        slides = payload.get("slides")
        if not isinstance(slides, list) or len(slides) < MIN_DECK_SLIDES or refusal_guard.deck_is_refusal(payload):
            return False
        # Taqdimotdan slaydlar o'zi olinadi (tarjimasi emas) — asosiy til AYNAN shu bo'lsin.
        return content_i18n.primary_language(item.kind, payload) == language
    return ci.primary_language(payload) == language or language in ci.available_languages(payload)


def _variant_ok(db: Session, syllabus_id: int | None, variant: str):
    """Semestr variantlari bor sillabusda boshqa semestrning shu kodli mavzusi — boshqa mavzu."""
    variant = (variant or "").strip()
    if not syllabus_id or not variant:
        return None
    variants = db.execute(select(CourseSyllabus.variants).where(CourseSyllabus.id == syllabus_id)).scalar()
    if not isinstance(variants, list) or len(variants) < 2:
        return None
    return PreparedContent.variant_label.in_((variant, "", "asosiy"))


def bank_item(db: Session, *, kind: str, syllabus_id: int | None, topic_code: str, title: str,
              language: str, owner_key: str, variant: str = "", role: str = "hodim") -> dict | None:
    """Shu mavzu uchun eng mos tayyor material: avval o'qituvchining o'zi, keyin hamkasbi
    (shu sillabus), keyin o'xshash nomli mavzu. So'ralgan tilda bo'lishi shart."""
    exact = []
    # Mavzu kodi bazada kichik harf bilan ("a6"), brauzer esa sillabusdagidek ("A6") yuboradi.
    code = (topic_code or "").strip().lower().replace(" ", "")
    if syllabus_id and code:
        stmt = select(PreparedContent).where(
            PreparedContent.kind == kind, PreparedContent.retired_reason == "",
            PreparedContent.syllabus_id == syllabus_id, func.lower(PreparedContent.topic_code) == code,
        )
        same_variant = _variant_ok(db, syllabus_id, variant)
        if same_variant is not None:
            stmt = stmt.where(same_variant)
        exact = db.execute(stmt.order_by(PreparedContent.created_at.desc()).limit(30)).scalars().all()
    own = [r for r in exact if r.owner_key == owner_key]
    others = [r for r in exact if r.owner_key != owner_key]
    for group in (own, others):
        for item in group:
            if _usable(item, language):
                return _as_bank(item, owner_key, exact=True)
    ids = similar_ids(db, kind, title, exclude_syllabus=syllabus_id, username=owner_key, role=role)
    if ids:
        rows = db.execute(
            select(PreparedContent).where(PreparedContent.id.in_(ids)).order_by(PreparedContent.created_at.desc())
        ).scalars().all()
        for item in rows:
            if _usable(item, language):
                return _as_bank(item, owner_key, exact=False)
    return None


def _as_bank(item: PreparedContent, owner_key: str, *, exact: bool) -> dict:
    # `own` — AYNAN shu mavzudagi o'z materiali (nusxa kerak emas). O'xshash nomli boshqa
    # mavzudagi o'z materiali NUSXA bo'ladi: aks holda tahrir o'sha boshqa mavzuni
    # o'zgartirardi va bu mavzuda hech narsa saqlanmasdi (2026-10-23).
    return {
        "id": item.id,
        "own": exact and item.owner_key == owner_key,
        "exact": exact,
        "author": item.author_display_name or "",
        "topic": item.topic,
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "payload": ci.without_stale_translations(item.payload),
    }


def match_clause(syllabus_id: int | None, topic_code: str, similar: list[int], *, db: Session | None = None,
                 variant: str = ""):
    """Pool so'rovlari uchun: aniq mavzu YOKI o'xshash nomli yozuvlar."""
    clauses = []
    code = (topic_code or "").strip().lower()
    if syllabus_id and code:
        exact = (PreparedContent.syllabus_id == syllabus_id) & (func.lower(PreparedContent.topic_code) == code)
        same_variant = _variant_ok(db, syllabus_id, variant) if db is not None else None
        clauses.append(exact & same_variant if same_variant is not None else exact)
    if similar:
        clauses.append(PreparedContent.id.in_(similar))
    return or_(*clauses) if clauses else None
