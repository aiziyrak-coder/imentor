"""Tashqi API (fermi.uz) uchun til ma'lumoti — 2026-11-17.

Muammo (fermi.uz jamoasi): sayt uz/ru/en tugmasi kontentni o'zgartirmasdi. Sabablar:

* test hujjatining tili saqlangan `primaryLanguage` dan olinardi, u bo'lmasa "uz" deb qabul qilinardi —
  ruscha yozilgan testlar o'zbekcha bo'lib o'tib ketardi (o'zbekcha 20 savolda 5 tasi ruscha);
* keyslar va hujjat ro'yxatlarida til haqida hech narsa yo'q edi.

Endi til MATNNING O'ZIDAN aniqlanadi (`case_i18n.detect_language`, o'zbek kirili ham), har savol alohida
tekshiriladi, tarjima esa faqat yaroqli bo'lsa (to'g'ri tilda, asl matn nusxasi emas, asl savollar
o'zgargandan keyin eskirmagan) "mavjud til" sanaladi.

Tahlil og'ir (5,5 ming test + 4,7 ming keys — bir necha daqiqa), shuning uchun natija Redis'da hujjat
mazmunining xeshi bilan saqlanadi: mazmun o'zgarmasa qayta hisoblanmaydi. To'liq indeks va statistikani
cron alohida jarayonda yangilaydi (`scripts/build_external_lang_index.py`) — veb ishchilar CPU'ni band
qilmaydi; so'rovda faqat indeksda yo'q (yangi/o'zgargan) hujjatlar hisoblanadi.

Bu yerda AI TARJIMA QILINMAYDI: tibbiy kontentni o'qituvchi ko'rmagan mashina tarjimasi bilan berish
mumkin emas (fermi.uz talabi). Faqat bazada bor tarjimalar qaytariladi.
"""

from __future__ import annotations

import json
import logging
import re
import time
from functools import lru_cache

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.prepared_content import KIND_CASE, KIND_TEST, PreparedContent
from app.services import case_i18n

logger = logging.getLogger(__name__)

#: Tarjima tillari (saytdagi tugmalar).
LANGS = ("uz", "ru", "en")
#: Hujjat asl tili bo'lishi mumkin bo'lgan qiymatlar: o'zbek kirili alohida — sayt uni lotin o'rniga
#: ko'rsatmasligi kerak.
UZ_CYRL = "uz-cyrl"
FILTER_LANGS = LANGS + (UZ_CYRL,)

#: v2 (2026-11-17): `r` — tarjima kelib chiqishi (AI / tasdiqlangan) qo'shildi.
INDEX_KEY = "ext:lang:v2"
STATS_KEY = "ext:stats:v1:{kind}"
#: Statistika shu muddatgacha keshdan beriladi (cron 10 daqiqada yangilaydi; cron to'xtasa ham sayt ishlaydi).
STATS_MAX_AGE = 2 * 3600
#: Tarjima "mavjud" sanaladi, agar savollarning kamida shuncha qismi yaroqli bo'lsa (testlardagi qoida bilan bir xil).
USABLE_SHARE = 0.6


def parse_language(value: str | None, *, param_name: str = "language") -> tuple[str | None, str | None]:
    """`?language=` — uz|ru|en|uz-cyrl. Bo'sh — None (eski xatti-harakat)."""
    if value is None or not str(value).strip():
        return None, None
    lang = str(value).strip().lower().replace("_", "-")
    if lang in ("uz-cyr", "uz-cyrillic"):
        lang = UZ_CYRL
    if lang not in FILTER_LANGS:
        return None, f"{param_name} must be one of: {', '.join(FILTER_LANGS)}."
    return lang, None


def _kind(kind: str) -> str:
    return KIND_CASE if kind == KIND_CASE else KIND_TEST


#: Tilni aniqlash uchun matnning shuncha qismi yetarli — butun matn bilan hujjatga ~44 ms ketardi
#: (10 ming hujjat — 7 daqiqa).
DETECT_CHARS = 1200
DOC_DETECT_CHARS = 6000


def _detect(text: str, limit: int = DETECT_CHARS) -> str:
    got = case_i18n.detect_language((text or "")[:limit])
    return UZ_CYRL if got == "uz-cyr" else got


def _q_text(q: dict, kind: str) -> str:
    return case_i18n._questions_text([q], _kind(kind)).strip()


def _stem(q: dict, kind: str) -> str:
    """Savolning tilini ko'rsatadigan qismi: savol/ssenariy va variantlar (uzun izohsiz)."""
    main = str(q.get("question") or q.get("text") or q.get("scenario") or "")
    options = q.get("options") if isinstance(q.get("options"), list) else []
    return (main[:DETECT_CHARS] + "\n" + "\n".join(str(o) for o in options)).strip()


def _list_fields(kind: str) -> tuple[str, ...]:
    return case_i18n.FIELDS[_kind(kind)][1]


def _questions(payload: dict) -> list[dict]:
    qs = payload.get("questions") if isinstance(payload, dict) else None
    return [q for q in qs if isinstance(q, dict)] if isinstance(qs, list) else []


def _stored_primary(payload: dict) -> str:
    raw = str(payload.get("primaryLanguage") or payload.get("primary_language") or "uz").strip().lower()
    if raw in ("uz-cyr", UZ_CYRL):
        return UZ_CYRL
    return raw if raw in LANGS else "uz"


def _translation_row_ok(src: dict, dst: dict, code: str, kind: str) -> bool:
    text = _stem(dst, kind)
    if not text:
        return False
    if text == _stem(src, kind):
        return False  # asl matn tarjima kaliti ostida
    for f in _list_fields(kind):
        a, b = src.get(f), dst.get(f)
        if isinstance(a, list) and a and (not isinstance(b, list) or len(a) != len(b)
                                          or not all(str(x or "").strip() for x in b)):
            return False
    # Asl savolda izoh bo'lsa, tarjimada ham bo'lishi shart (to'liq versiya).
    if str(src.get("explanation") or "").strip() and not str(dst.get("explanation") or "").strip():
        return False
    got = _detect(text)
    if got not in ("?", code):
        return False
    if code in ("ru", "en") and case_i18n.uzbek_left(text, code):
        return False
    return True


def analyse(payload: dict | None, kind: str) -> dict:
    """Bitta hujjat: {"p": asl til, "a": mavjud tillar, "q": {til: [yaroqli savol indekslari]}, "n": savollar}."""
    payload = payload if isinstance(payload, dict) else {}
    qs = _questions(payload)
    n = len(qs)
    stems = [_stem(q, kind) for q in qs]
    primary = _detect("\n".join(stems), DOC_DETECT_CHARS)
    if primary == "?":
        primary = _stored_primary(payload)
    per: dict[str, list[int]] = {}
    # Asl tildagi savollar: boshqa tilda yozilgan savol (o'zbekcha testdagi ruscha savol) shu tilga sanalmaydi.
    keep = []
    for i, stem in enumerate(stems):
        got = _detect(stem)
        if got in ("?", primary):
            keep.append(i)
    if keep:
        per[primary] = keep
    tr = payload.get("translations")
    if isinstance(tr, dict) and n and not case_i18n.translations_stale(payload):
        for code in LANGS:
            if code == primary:
                continue
            block = tr.get(code)
            rows = block.get("questions") if isinstance(block, dict) else None
            if not isinstance(rows, list) or len(rows) != len(payload.get("questions") or []):
                continue
            good = [i for i, (s, t) in enumerate(zip(qs, rows))
                    if isinstance(t, dict) and _translation_row_ok(s, t, code, kind)]
            if good and len(good) >= max(1, int(n * USABLE_SHARE)):
                per[code] = good
    if primary not in per:
        per[primary] = []
    available = [c for c in [primary] + [c for c in LANGS if c != primary] if per.get(c)]
    from app.services import translation_review

    review = {c: translation_review.status_for(payload, c) for c in available if c != primary}
    return {"p": primary, "a": available, "q": per, "n": n, "r": review}


# ── Kesh (Redis) ───────────────────────────────────────────────────────────


@lru_cache(maxsize=1)
def _redis():
    import redis

    from app.core.config import get_settings

    return redis.Redis.from_url(get_settings().redis_url, decode_responses=True,
                                socket_connect_timeout=0.5, socket_timeout=5)


def _fingerprints(db: Session, ids: list[int]) -> dict[int, str]:
    """Hujjat mazmunining xeshi — bazaning o'zida (payload Python'ga ikkinchi marta o'qilmaydi)."""
    out: dict[int, str] = {}
    for start in range(0, len(ids), 2000):
        chunk = ids[start:start + 2000]
        rows = db.execute(
            select(PreparedContent.id, func.md5(func.cast(PreparedContent.payload, _text_type())))
            .where(PreparedContent.id.in_(chunk))
        ).all()
        out.update({int(r[0]): str(r[1]) for r in rows})
    return out


@lru_cache(maxsize=1)
def _text_type():
    from sqlalchemy import Text

    return Text()


def infos_for(db: Session, items: list[PreparedContent], *, store: bool = True) -> dict[int, dict]:
    """Hujjatlar uchun til ma'lumoti. Indeksdan olinadi; yo'q yoki o'zgarganlari shu yerda hisoblanadi."""
    if not items:
        return {}
    ids = [int(i.id) for i in items]
    prints = _fingerprints(db, ids)
    cached: dict[int, dict] = {}
    try:
        raw = _redis().hmget(INDEX_KEY, [str(i) for i in ids])
        for pk, value in zip(ids, raw):
            if not value:
                continue
            try:
                row = json.loads(value)
            except ValueError:
                continue
            if row.get("f") == prints.get(pk):
                cached[pk] = row
    except Exception:  # noqa: BLE001 — Redis bo'lmasa ham API ishlaydi (sekinroq)
        logger.warning("external-lang: indeks o'qilmadi", exc_info=True)
    fresh: dict[str, str] = {}
    for item in items:
        pk = int(item.id)
        if pk in cached:
            continue
        info = analyse(item.payload, item.kind)
        info["f"] = prints.get(pk, "")
        cached[pk] = info
        fresh[str(pk)] = json.dumps(info, separators=(",", ":"))
    if fresh and store:
        try:
            _redis().hset(INDEX_KEY, mapping=fresh)
        except Exception:  # noqa: BLE001
            logger.warning("external-lang: indeks yozilmadi", exc_info=True)
    return cached


def translation_fields(info: dict | None, lang: str | None) -> dict:
    """`translated_by`/`reviewed_at` — so'ralgan til tarjima bo'lsa; asl tilda maydon yo'q (fermi.uz, E)."""
    info = info or {}
    if not lang or lang == info.get("p") or not has_language(info, lang):
        return {}
    rec = (info.get("r") or {}).get(lang) or {}
    return {"translated_by": rec.get("translated_by") or "ai", "reviewed_at": rec.get("reviewed_at")}


def summary_fields(info: dict | None) -> dict:
    info = info or {}
    review = info.get("r") or {}
    return {
        "primary_language": info.get("p") or "uz",
        "available_languages": list(info.get("a") or [info.get("p") or "uz"]),
        # Har tarjima tili uchun: kim tarjima qilgan (asl til bu yerda yo'q).
        "translations": {lang: {"translated_by": (review.get(lang) or {}).get("translated_by") or "ai",
                                "reviewed_at": (review.get(lang) or {}).get("reviewed_at")}
                         for lang in (info.get("a") or []) if lang != info.get("p")},
    }


def has_language(info: dict | None, lang: str) -> bool:
    """Hujjat shu tilda bormi: kamida bitta savol shu tilda to'liq bo'lishi shart."""
    if not info:
        return False
    if lang == UZ_CYRL and info.get("p") != UZ_CYRL:
        return False
    if lang not in (info.get("a") or []):
        return False
    return bool((info.get("q") or {}).get(lang))


def language_count(info: dict | None, lang: str) -> int:
    """Shu tilda to'liq mavjud savollar soni — `?language=` bilan qaytariladigan savollar soni."""
    return len((info or {}).get("q", {}).get(lang) or []) if has_language(info, lang) else 0


# ── Matnni so'ralgan tilda berish ──────────────────────────────────────────

#: Tilga bog'liq bo'lmagan maydonlar tarjima qatoriga asl savoldan ko'chiriladi.
_SHARED_FIELDS = ("correctOptionIndex", "references", "id", "difficulty", "bloom", "topic_code")


def _rows_in(payload: dict, info: dict, lang: str) -> list | None:
    if lang == info.get("p") or (lang == UZ_CYRL and info.get("p") == UZ_CYRL):
        return payload.get("questions") if isinstance(payload.get("questions"), list) else []
    block = (payload.get("translations") or {}).get(lang) if isinstance(payload.get("translations"), dict) else None
    rows = block.get("questions") if isinstance(block, dict) else None
    return rows if isinstance(rows, list) else None


def project(payload: dict | None, info: dict, lang: str) -> tuple[dict, str]:
    """Hujjat payload'i so'ralgan tilda: `topic` va `questions` shu tilda, asl matn `translations[asl]` da.

    Til mavjud bo'lmasa — asl holicha, ikkinchi qiymat asl til (mijoz `language` ga qarab biladi).
    """
    base = dict(payload) if isinstance(payload, dict) else {}
    primary = info.get("p") or "uz"
    base["primaryLanguage"] = primary
    if not has_language(info, lang):
        return base, primary
    originals = base.get("questions") if isinstance(base.get("questions"), list) else []
    # 2026-11-17 (fermi.uz, D): FAQAT shu tilda to'liq mavjud savollar qaytadi — 60% tarjima qilingan
    # hujjatda qolgan 40% asl tilda ruscha ro'yxat orasiga tushib qolardi.
    keep = [i for i in (info.get("q") or {}).get(lang, []) if i < len(originals)]
    if lang == primary:
        base["questions"] = [originals[i] for i in keep]
        return base, primary
    rows = _rows_in(base, info, lang) or []
    merged = []
    for i in keep:
        row = rows[i] if i < len(rows) else None
        if not isinstance(row, dict):
            continue
        src = originals[i] if isinstance(originals[i], dict) else {}
        out = dict(row)
        for f in _SHARED_FIELDS:
            if f not in out and f in src:
                out[f] = src[f]
        merged.append(out)
    translations = dict(base.get("translations") or {})
    block = translations.get(lang) if isinstance(translations.get(lang), dict) else {}
    if primary not in translations and originals:
        original_block = {"topic": base.get("topic"), "questions": list(originals)}
        if isinstance(base.get("references"), list):
            original_block["references"] = list(base["references"])
        translations[primary] = original_block
    base["translations"] = translations
    base["topic"] = block.get("topic") or base.get("topic")
    if isinstance(block.get("references"), list):
        base["references"] = list(block["references"])
    base["questions"] = merged
    return base, lang


#: Mavzu nomining tilini aniqlash uchun shuncha belgi yetarli.
TOPIC_CHARS = 400
_CYRILLIC = re.compile("[Ѐ-ӿ]")


@lru_cache(maxsize=50000)
def _topic_lang(text: str) -> str:
    return _detect(text, TOPIC_CHARS)


def topic_for(item, info: dict | None, lang: str, default: str | None = None) -> tuple[str, str]:
    """(mavzu nomi, uning tili) — iloji bo'lsa so'ralgan tilda (fermi.uz, C, 2026-11-17).

    Manbalar: hujjatning o'z tarjimasi (`translations[til].topic`), keyin sillabus mavzusining tarjimasi
    (`CourseSyllabus.topics_i18n`). Hech biri bo'lmasa — asl nom va uning HAQIQIY tili: ilgari ruscha
    javobda o'zbekcha mavzu "ru" deb kelardi (ruscha test, mavzusi esa o'zbekcha sillabusdan).
    """
    payload = item.payload if isinstance(getattr(item, "payload", None), dict) else {}
    original = str(default if default is not None else (getattr(item, "topic", "") or payload.get("topic") or ""))
    info = info or {}
    syllabus = getattr(item, "syllabus", None)
    syllabus_lang = str(getattr(syllabus, "instruction_language", "") or "").strip().lower()
    got = _topic_lang(original)
    if got == "?":
        # Qisqa nomda til aniqlanmadi — sillabus yoki hujjat tili, lekin yozuviga mos keladigani:
        # lotin yozuvidagi nom "ru" bo'lolmaydi (ruscha test, mavzusi o'zbekcha sillabusdan).
        cyrillic = bool(_CYRILLIC.search(original))
        options = [syllabus_lang, info.get("p"), "ru" if cyrillic else "uz"]
        got = next(c for c in options if c in FILTER_LANGS and (c in ("ru", UZ_CYRL)) == cyrillic)
    if not lang or lang == got:
        return original, got

    def usable(text: object) -> str:
        value = str(text or "").strip()
        if not value or value == original.strip():
            return ""
        return value if _topic_lang(value) in ("?", lang) else ""

    translations = payload.get("translations") if isinstance(payload.get("translations"), dict) else {}
    block = translations.get(lang) if isinstance(translations.get(lang), dict) else {}
    found = usable(block.get("topic"))
    if not found and syllabus is not None:
        by_lang = (getattr(syllabus, "topics_i18n", None) or {}).get(lang) or {}
        if isinstance(by_lang, dict):
            found = usable(by_lang.get(original) or by_lang.get(original.strip()))
    return (found, lang) if found else (original, got)


# ── Savollar banki (namuna) ────────────────────────────────────────────────


def collect_test_questions(items: list[PreparedContent], infos: dict[int, dict], lang: str, *,
                           count: int | None, shuffle: bool = True) -> tuple[list[dict], int, int]:
    """Faqat `lang` da TO'LIQ mavjud savollar (savol, variantlar, izoh) — namuna shulardan olinadi."""
    import random

    from app.services import content_catalog as cc
    from app.services.question_quality import ungradable_flaws

    seen: set[str] = set()
    pool: list[dict] = []
    scanned = 0
    for item in items:
        info = infos.get(int(item.id))
        if not has_language(info, lang):
            continue
        scanned += 1
        payload = item.payload if isinstance(item.payload, dict) else {}
        originals = payload.get("questions") if isinstance(payload.get("questions"), list) else []
        rows = _rows_in(payload, info, lang) or []
        refs_doc = payload.get("references") if isinstance(payload.get("references"), list) else []
        idx_key = UZ_CYRL if lang == UZ_CYRL else lang
        for i in (info.get("q") or {}).get(idx_key, []):
            if i >= len(originals) or i >= len(rows) or not isinstance(originals[i], dict) or not isinstance(rows[i], dict):
                continue
            src, row = originals[i], rows[i]
            block = cc._question_text_block(row)
            if not block or not block["options"] or not all(str(o or "").strip() for o in block["options"]):
                continue
            correct = src.get("correctOptionIndex")
            options = src.get("options") if isinstance(src.get("options"), list) else []
            if isinstance(correct, bool) or not isinstance(correct, int) or not 0 <= correct < len(options):
                continue
            if len(block["options"]) != len(options) or ungradable_flaws(options):
                continue
            key = cc.normalize_question_text_key(block["question"])
            if not key or key in seen:
                continue
            seen.add(key)
            refs = src.get("references") if isinstance(src.get("references"), list) and src.get("references") else refs_doc
            out: dict = {"correctOptionIndex": correct, "available_languages": [lang], "languages": {lang: block}}
            out.update(translation_fields(info, lang))
            if refs:
                out["references"] = list(refs)
            if item.id:
                out["source_test_id"] = int(item.id)
            pool.append(out)
    available = len(pool)
    if shuffle:
        random.shuffle(pool)
    if count is not None:
        pool = pool[:max(0, int(count))]
    return pool, available, scanned


def collect_case_scenarios(items: list[PreparedContent], infos: dict[int, dict], lang: str, *,
                           count: int | None, shuffle: bool = True) -> tuple[list[dict], int, int]:
    """Keys savollari faqat `lang` da — asosiy maydonlar shu tilda, `languages` da faqat shu til."""
    import random

    from app.services import content_catalog as cc

    seen: set[str] = set()
    pool: list[dict] = []
    scanned = 0
    for item in items:
        info = infos.get(int(item.id))
        if not has_language(info, lang):
            continue
        scanned += 1
        payload = item.payload if isinstance(item.payload, dict) else {}
        originals = payload.get("questions") if isinstance(payload.get("questions"), list) else []
        rows = _rows_in(payload, info, lang) or []
        refs_doc = payload.get("references") if isinstance(payload.get("references"), list) else []
        idx_key = UZ_CYRL if lang == UZ_CYRL else lang
        topic, topic_lang = topic_for(item, info, lang)
        for i in (info.get("q") or {}).get(idx_key, []):
            if i >= len(originals) or i >= len(rows) or not isinstance(rows[i], dict):
                continue
            src = originals[i] if isinstance(originals[i], dict) else {}
            merged = {**{f: src[f] for f in _SHARED_FIELDS if f in src}, **rows[i]}
            block = cc._case_scenario_block(merged)
            if block is None:
                continue
            key = cc.normalize_question_text_key(block["scenario"])
            if not key or key in seen:
                continue
            seen.add(key)
            block["languages"] = {lang: cc._case_language_block(merged)}
            block["available_languages"] = [c for c in (info.get("a") or []) if c in (info.get("q") or {})]
            block["primary_language"] = info.get("p")
            block["language"] = lang
            if not block.get("references") and refs_doc:
                block["references"] = list(refs_doc)
            if item.id:
                block["source_case_id"] = int(item.id)
            block["topic"] = topic
            block["topic_language"] = topic_lang
            block.update(translation_fields(info, lang))
            pool.append(block)
    available = len(pool)
    if shuffle:
        random.shuffle(pool)
    if count is not None:
        pool = pool[:max(0, int(count))]
    return pool, available, scanned


# ── Statistika ─────────────────────────────────────────────────────────────


def add_language_counts(body: dict, items: list[PreparedContent], infos: dict[int, dict], kind: str) -> dict:
    """`by_subject[].languages` va `totals.languages`: testda — shu tildagi savollar, keysda — keyslar soni."""
    from app.services import content_catalog as cc

    by_subject: dict[str, dict[str, int]] = {}
    totals = {c: 0 for c in FILTER_LANGS}
    for item in items:
        info = infos.get(int(item.id))
        if not info:
            continue
        code = cc.effective_subject_code(item)
        row = by_subject.setdefault(code, {c: 0 for c in FILTER_LANGS})
        for lang in FILTER_LANGS:
            if not has_language(info, lang):
                continue
            n = 1 if kind == KIND_CASE else len((info.get("q") or {}).get(lang, []))
            row[lang] += n
            totals[lang] += n
    for subj in body.get("by_subject") or []:
        counts = by_subject.get(subj.get("subject_code") or "", {})
        subj["languages"] = {c: counts.get(c, 0) for c in LANGS}
        if counts.get(UZ_CYRL):
            subj["languages"][UZ_CYRL] = counts[UZ_CYRL]
    body.setdefault("totals", {})["languages"] = {c: totals[c] for c in LANGS} | (
        {UZ_CYRL: totals[UZ_CYRL]} if totals[UZ_CYRL] else {})
    body["languages_unit"] = "cases" if kind == KIND_CASE else "questions"
    return body


def build_stats(db: Session, kind: str) -> dict:
    from app.services import content_catalog as cc

    body = cc.build_catalog_stats(db, published_only=True, kind=kind)
    items = db.execute(cc.published_catalog_stmt().where(PreparedContent.kind == kind)).scalars().all()
    infos = infos_for(db, list(items))
    return add_language_counts(body, list(items), infos, kind)


_stats_memo: dict[str, tuple[float, dict]] = {}


def cached_stats(db: Session, kind: str) -> dict:
    """Statistika keshdan (cron yangilaydi). Kesh yo'q bo'lsa — bir marta hisoblanib saqlanadi."""
    now = time.time()
    memo = _stats_memo.get(kind)
    if memo and now - memo[0] < 60:
        return memo[1]
    key = STATS_KEY.format(kind=kind)
    try:
        raw = _redis().get(key)
        if raw:
            data = json.loads(raw)
            if now - float(data.get("at") or 0) < STATS_MAX_AGE:
                _stats_memo[kind] = (now, data["body"])
                return data["body"]
    except Exception:  # noqa: BLE001
        logger.warning("external-lang: statistika keshi o'qilmadi", exc_info=True)
    body = build_stats(db, kind)
    store_stats(kind, body)
    _stats_memo[kind] = (now, body)
    return body


def store_stats(kind: str, body: dict) -> None:
    try:
        _redis().set(STATS_KEY.format(kind=kind), json.dumps({"at": time.time(), "body": body},
                                                             ensure_ascii=False, default=str),
                     ex=STATS_MAX_AGE * 2)
    except Exception:  # noqa: BLE001
        logger.warning("external-lang: statistika yozilmadi", exc_info=True)
