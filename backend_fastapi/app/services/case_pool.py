"""Keyslar zaxirasi: shu mavzuda avval yaratilgan keyslar qayta ishlatiladi (2026-10-22).

Xarajat: 2026-10-22 kuni 115 keys to'plami yaratildi, har biriga ~3.6 generatsiya
va ~3.1 tekshiruv chaqiruvi. Ulardan 46 tasi shu sillabus va mavzuda 19-oktabrdan
keyin yaratilgan, tekshiruvdan o'tgan keys bor bo'lgan holda qaytadan yozildi.

Qoida:
* faqat shu sillabus va mavzu kodi (yoki shu fan va shu mavzu nomi) bo'yicha;
* 19-oktabrdan keyingilari (sifat nazorati kuchaytirilgandan keyin), nafaqaga
  chiqarilmagan;
* o'qituvchining O'ZI yaratganlaridan faqat ENG OXIRGISI olinmaydi — qayta bosganda u
  boshqa keys ko'radi; eskiroqlari (boshqa guruhga yozilgan) qayta ishlatiladi (2026-10-22:
  bugungi keyslarning 46% ini o'qituvchi shu mavzuda avval ham yaratgan edi);
* har uchala yo'nalish (tashxis, davolash, profilaktika) uchun nomzodlar, so'ralgan
  tilda (tarjimasi yaroqli bo'lsa).
"""

from __future__ import annotations

import os
import random
import re

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models.prepared_content import KIND_CASE, PreparedContent
from app.services import case_i18n as ci
from app.services.question_pool import QUALITY_SINCE

FOCUSES = ("profilaktika", "davolash", "tashxis")
PER_FOCUS = 4


def enabled() -> bool:
    return (os.environ.get("IMENTOR_CASE_POOL") or "1").strip() not in ("0", "false", "no")


def _cases_in(payload: dict, language: str) -> list[dict]:
    """Saqlangan keys savollari so'ralgan tilda (tarjima yaroqli bo'lsa)."""
    cases = [q for q in payload.get("questions") or [] if isinstance(q, dict)]
    if not cases:
        return []
    if ci.primary_language(payload) == language:
        return cases
    if language not in ci.available_languages(payload):
        return []
    rows = [q for q in ((payload.get("translations") or {}).get(language) or {}).get("questions") or []
            if isinstance(q, dict)]
    if len(rows) != len(cases):
        return []
    # Yo'nalish va to'g'ri javob raqami faqat asl keysda.
    return [{**t, "focus": s.get("focus"), "correctOptionIndex": s.get("correctOptionIndex")}
            for s, t in zip(cases, rows)]


#: Jins mosligi (2026-11-20, akusherlik-ginekologiya: "ayol shikoyatlari bilan erkak bemor" — 10-19 dagi eski
#: keyslar bankdan qayta chiqardi). Mavzu ayollarniki bo'lsa — erkak bemorli keys olinmaydi va aksincha.
_FEMALE_TOPIC = re.compile(
    r"akusher|ginekolog|homilador|tug['‘’ʻʼ]?ruq|bachadon|tuxumdon|hayz|\bqin\b|vulva|sut\s*bez|mammolog|ayollar|"
    r"preeklamps|eklamps|endometr|menopauza|акушер|гинеколог|беремен|матк|яичник|менстру|obstetr|gyn[ae]?colog|"
    r"pregnan|uter|ovar|menstru", re.I)
_MALE_TOPIC = re.compile(r"prostat|moyak|erkaklar\s*jinsiy|androlog|предстат|яичк|андролог|testic", re.I)
_MALE_PATIENT = re.compile(r"\berkak\b|o['‘’ʻʼ]?g['‘’ʻʼ]?il\s+bola|\bmale\b|\bman\b|\bhe\b|\bhis\b|мужчин|мальчик", re.I)
_FEMALE_PATIENT = re.compile(r"\bayol\b|qiz\s+bola|\bfemale\b|\bwoman\b|\bshe\b|\bher\b|женщин|девочк", re.I)


def sex_conflict(case: dict, title: str) -> bool:
    text_ = str(case.get("scenario") or "")
    if _FEMALE_TOPIC.search(title or ""):
        return bool(_MALE_PATIENT.search(text_))
    if _MALE_TOPIC.search(title or ""):
        return bool(_FEMALE_PATIENT.search(text_))
    return False


def _usable(case: dict, language: str) -> bool:
    scenario = str(case.get("scenario") or "")
    answer = str(case.get("answer") or "")
    if len(scenario.split()) < 40 or len(answer.split()) < 20:
        return False
    return not (ci.uzbek_left(scenario, language) or ci.uzbek_left(answer, language))


def pool(db: Session, *, syllabus_id: int | None, topic_code: str, subject_code: str, topic_norm: str,
         language: str, owner_key: str, rng: random.Random | None = None, title: str = "") -> dict:
    """{"cases": {focus: [keys, ...]}, "references": [...]} — har yo'nalishga ko'pi bilan PER_FOCUS.

    2026-10-22 ("bir mavzuga bir marta"): o'xshash nomli boshqa sillabus mavzusi ham olinadi;
    boshqa nomzod bo'lmagan yo'nalishga o'qituvchining OXIRGI keysi beriladi — AI faqat
    institutda hali umuman yo'q yo'nalishni yozadi.
    """
    from app.services import content_bank

    empty = {"cases": {f: [] for f in FOCUSES}, "references": []}
    if not enabled():
        return empty
    match = []
    variant = (topic_norm or "").split("::")[1] if (topic_norm or "").count("::") >= 2 else ""
    exact = content_bank.match_clause(syllabus_id, topic_code, [], db=db, variant=variant) if topic_code else None
    if exact is not None:
        match.append(exact)
    if subject_code and topic_norm:
        match.append((PreparedContent.subject_code == subject_code) & (PreparedContent.topic_norm == topic_norm))
    similar = content_bank.similar_ids(db, KIND_CASE, title, since=QUALITY_SINCE, exclude_syllabus=syllabus_id,
                                       username=owner_key) if title else []
    if similar:
        match.append(PreparedContent.id.in_(similar))
    if not match:
        return empty
    rows = db.execute(
        select(PreparedContent.id, PreparedContent.owner_key, PreparedContent.payload, PreparedContent.syllabus_id,
               PreparedContent.topic_code).where(
            PreparedContent.kind == KIND_CASE,
            PreparedContent.retired_reason == "",
            PreparedContent.created_at >= QUALITY_SINCE,
            or_(*match),
        ).order_by(PreparedContent.created_at.desc()).limit(40)
    ).all()
    # O'z oxirgi keysi — faqat SHU mavzudagi (o'xshash nomli boshqa sillabusdagisi emas, 2026-10-23).
    own_latest = next((r.id for r in rows if r.owner_key == owner_key and r.syllabus_id == syllabus_id
                       and (r.topic_code or "").lower() == (topic_code or "").lower()), None)
    out = {f: [] for f in FOCUSES}
    refs: list = []
    seen: set[str] = set()
    fallback: dict[str, dict] = {}
    for row in rows:
        payload = row.payload
        if not isinstance(payload, dict):
            continue
        if row.id == own_latest:
            for case in _cases_in(payload, language):
                if case.get("focus") in out and _usable(case, language) and not sex_conflict(case, title):
                    fallback.setdefault(case["focus"], case)
            continue
        for case in _cases_in(payload, language):
            focus = case.get("focus")
            key = " ".join(str(case.get("scenario") or "").lower().split())
            if focus not in out or key in seen or not _usable(case, language) or sex_conflict(case, title):
                continue
            seen.add(key)
            out[focus].append(case)
        for ref in payload.get("references") or []:
            if isinstance(ref, dict) and ref not in refs and len(refs) < 12:
                refs.append(ref)
    generator = rng or random
    for focus in out:
        generator.shuffle(out[focus])
        out[focus] = out[focus][:PER_FOCUS] or ([fallback[focus]] if focus in fallback else [])
    return {"cases": out, "references": refs}
