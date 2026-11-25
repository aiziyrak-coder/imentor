"""Test savollari zaxirasi va o'tilgan mavzular (2026-10-21).

Rektor talabi: 10 savollik test — 4 qiyin, 4 o'rta, 2 oson; bugungi mavzu
asosiy, o'tilgan mavzular bilan BOG'LANADI, o'tilmagan mavzulardan savol
TUSHMAYDI. Xarajat talabi: AI'siz qilsa bo'ladigan ish kod bilan.

Bir mavzu bir haftada ko'p guruhga, ko'p o'qituvchi tomonidan o'tiladi
(24 soatda 406 test, 4060 savol). Har safar 10 ta yangi savol yozdirish
o'rniga shu fan va mavzu bo'yicha AVVAL yaratilgan, tekshiruvdan o'tgan
savollar qayta ishlatiladi; AI faqat yetishmaganini yozadi.

O'tilgan / o'tilmagan — sillabusdagi mavzular tartibidan: joriy mavzudan
oldingilari o'tilgan, keyingilari hali o'tilmagan.
"""

from __future__ import annotations

import datetime as dt
import os
import random
import re

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.content import CourseSyllabus
from app.models.prepared_content import KIND_TEST, PreparedContent
from app.services import case_i18n as ci

#: Shu sanadan oldingi savollar olinmaydi: undan oldin testlar eng arzon
#: modelda yozilgan va 35% ida bitta savolda bir nechta savol bo'lgan.
QUALITY_SINCE = dt.datetime(2026, 10, 19, tzinfo=dt.timezone.utc)
MAX_POOL = 80
LEVELS = ("hard", "medium", "easy")
#: Mavzu bankida shuncha yaroqli savol bo'lsa brauzer AI'ga umuman yangi savol yozdirmaydi — test
#: bankdan aralashtirib tuziladi (2026-10-26, "har mavzuga 30 tadan yetadi"). Sukut — O'CHIQ (0):
#: o'sha kuni keyingi qaror "har safar 2 ta yangi, 8 tasi bazadan". `.env`: IMENTOR_QUESTION_BANK_TARGET.
#: 2026-11-20: foydalanuvchi qarori — Claude agentlari oldindan yozgan mavzu banki (10+ savol) to'la bo'lsa test AI'siz.
DEFAULT_BANK_TARGET = 10
#: Foydalanuvchi qarori (2026-10-26): har testda faqat shuncha savol YANGI yoziladi, qolgani
#: (10 dan) shu mavzu bankidan; 22-oktabrdan beri 4 ta edi. `.env`: IMENTOR_TEST_NEW_QUESTIONS.
#: 2026-11-24 (foydalanuvchi qarori): "avval bazadan, yo'q bo'lsa keyin generatsiya, xarajat oshmasin" — majburiy
#: yangi savol yo'q (0): AI faqat bazada yetishmagan o'rinlarni yozadi.
DEFAULT_NEW_QUESTIONS = 0


#: Oddiy (klinik bo'lmagan) farmakologiya — o'quv dasturida laboratoriya mashg'uloti yo'q (2026-11-18, kafedra:
#: "testlar eksperimental laboratoriya natijalari asosida, talabalar mohiyatini tushunmay AI bilan yechyapti").
#: Yangi savollar endi dori/mexanizm/ko'rsatma bo'yicha yoziladi (frontend `isBasicPharmacology`); bankdagi eski
#: tajriba savollari shu fanlarda testga olinmaydi. Prod: oddiy farmakologiyada 20–37% savol shunday edi.
_PHARMACOLOGY = re.compile(r"farmakolog|фармаколог|pharmacolog", re.I)
_CLINICAL_NAME = re.compile(r"klinik|клиническ|clinical", re.I)
_LAB_STEM = re.compile(
    r"tajriba|eksperiment|laborator|kalamush|quyon|sichqon|\bbaqa|ajratilgan organ|izolyatsiya qilingan|in vitro|"
    r"hayvon|опыт|эксперимент|лаборатор|крыс|кролик|мыш[ьи]|лягуш|изолированн|experiment|laborator|\brats?\b|"
    r"rabbit|\bmice\b|isolated organ", re.I)


def lab_free(subject_name: str) -> bool:
    """Fan oddiy farmakologiyami (laboratoriya mashg'ulotisiz): tajriba savollari bankdan olinmaydi."""
    name = subject_name or ""
    return bool(_PHARMACOLOGY.search(name)) and not _CLINICAL_NAME.search(name)


def lab_question(text: str) -> bool:
    return bool(_LAB_STEM.search(text or ""))


def has_books(db: Session, department_id: int | None) -> bool:
    """Kafedrada qidiriladigan kitob parchasi bormi (bo'lmasa — bank avvalgidek, hamma savol)."""
    if not department_id:
        return False
    try:
        from app.models.book import BookChunk

        return db.execute(select(BookChunk.id).where(BookChunk.department_id == int(department_id)).limit(1)).first() is not None
    except Exception:  # noqa: BLE001 — tekshirib bo'lmasa bank cheklanmaydi
        return False


def _env_int(name: str, default: int, top: int) -> int:
    try:
        return min(top, max(0, int(os.environ.get(name) or default)))
    except ValueError:
        return default


def bank_target() -> int:
    return _env_int("IMENTOR_QUESTION_BANK_TARGET", DEFAULT_BANK_TARGET, 500)


def new_questions() -> int:
    return _env_int("IMENTOR_TEST_NEW_QUESTIONS", DEFAULT_NEW_QUESTIONS, 10)


def enabled() -> bool:
    return (os.environ.get("IMENTOR_QUESTION_POOL") or "1").strip() not in ("0", "false", "no")


def _topics(syllabus: CourseSyllabus, variant: str) -> list[dict]:
    for v in syllabus.variants or []:
        if isinstance(v, dict) and (v.get("label") or "") == (variant or "") and v.get("topics"):
            return [t for t in v["topics"] if isinstance(t, dict)]
    return [t for t in (syllabus.topics or []) if isinstance(t, dict)]


def topic_plan(syllabus: CourseSyllabus, variant: str, topic_code: str) -> dict:
    """Joriy mavzu, o'tilgan (oldingi) va o'tilmagan (keyingi) mavzular."""
    topics = _topics(syllabus, variant)
    code = (topic_code or "").strip().lower()
    idx = next((i for i, t in enumerate(topics) if str(t.get("id") or "").strip().lower() == code), None)
    if idx is None:
        return {"current": None, "taught": [], "later": []}

    def row(t: dict) -> dict:
        return {"code": str(t.get("id") or "").strip().lower(), "title": str(t.get("title") or "").strip(),
                "type": str(t.get("type") or "")}

    return {"current": row(topics[idx]), "taught": [row(t) for t in topics[:idx]],
            "later": [row(t) for t in topics[idx + 1:]]}


_SPACE = re.compile(r"\s+")


def _key(text: str) -> str:
    return _SPACE.sub(" ", (text or "").strip().lower())


def _questions_in(payload: dict, language: str) -> list[dict]:
    """Saqlangan testning savollari so'ralgan tilda (tarjima yaroqli bo'lsa)."""
    questions = [q for q in payload.get("questions") or [] if isinstance(q, dict)]
    if not questions:
        return []
    if ci.primary_language(payload) == language:
        return questions
    if language not in ci.available_languages(payload):
        return []
    block = (payload.get("translations") or {}).get(language) or {}
    rows = [q for q in block.get("questions") or [] if isinstance(q, dict)]
    if len(rows) != len(questions):
        return []
    # To'g'ri javob raqami faqat asl savolda saqlanadi.
    return [{**t, "correctOptionIndex": s.get("correctOptionIndex"), "level": s.get("level"),
             "link": s.get("link")} for s, t in zip(questions, rows)]


def _spares_in(payload: dict, language: str) -> list[dict]:
    """Testga kirmagan zaxira savollar (2026-10-22) — faqat asl tilda, tarjimasi yo'q."""
    if ci.primary_language(payload) != language:
        return []
    return [q for q in payload.get("spareQuestions") or [] if isinstance(q, dict)]


def _usable(q: dict, language: str, min_words: int = 20) -> bool:
    options = q.get("options")
    idx = q.get("correctOptionIndex")
    text = str(q.get("question") or "")
    if not isinstance(options, list) or len(options) != 5 or not all(str(o or "").strip() for o in options):
        return False
    if not isinstance(idx, int) or not 0 <= idx < 5:
        return False
    if len({_key(str(o)) for o in options}) != 5:
        return False
    if text.count("?") > 1 or len(text.split()) < min_words:
        return False
    if ci.uzbek_left(text, language) or any(ci.uzbek_left(str(o), language) for o in options):
        return False
    return True


def key_length_rank(q: dict) -> int:
    """0 — to'g'ri javob eng uzun emas; 1 — eng uzuni, lekin sezilmas; 2 — keskin eng uzun (1.35× va 15+ belgi).

    2026-11-13 o'lchovi: kecha prompt tuzatilgandan keyin ham testlarda 60% savolda to'g'ri javob eng uzun
    variant edi (oldin 64%), chunki testning 8/10 savoli BANKDAN — bank esa tuzatishdan oldin yozilgan.
    Talaba eng uzun variantni tanlab 60% ball olardi. Bankdan tanlashda balansli savollar birinchi."""
    options = [str(o or "") for o in q.get("options") or []]
    idx = q.get("correctOptionIndex")
    if not isinstance(idx, int) or not 0 <= idx < len(options) or len(options) < 2:
        return 1
    key = len(options[idx])
    longest_other = max(len(o) for k, o in enumerate(options) if k != idx)
    if key <= longest_other:
        return 0
    return 2 if key > longest_other * 1.35 and key - longest_other > 15 else 1


def _foreign_book_titles(db: Session, syllabus) -> list[str]:
    """Kafedraning BOSHQA fanga bog'langan kitoblari nomlari (tozalangan, kichik harfda)."""
    dept_id = getattr(syllabus, "department_id", None)
    if not dept_id:
        return []
    try:
        from app.models.book import SubjectBook
        from app.services import book_retrieval as br

        ids = br.books_not_for_subject(db, int(dept_id), getattr(syllabus, "subject_name", "") or "")
        if not ids:
            return []
        titles = db.execute(select(SubjectBook.title).where(SubjectBook.id.in_(ids))).scalars().all()
        out = {_key(br.clean_book_title(t) or t) for t in titles} | {_key(t) for t in titles}
        return [t for t in out if len(t) >= 6]
    except Exception:  # noqa: BLE001 — filtr ishlamasa ham savollar berilsin
        return []


def pool(db: Session, *, syllabus_id: int, variant: str, topic_code: str, language: str,
         owner_key: str, rng: random.Random | None = None) -> dict:
    """Joriy mavzu bo'yicha qayta ishlatsa bo'ladigan savollar + mavzular rejasi.

    O'qituvchining shu mavzudagi OXIRGI testidagi savollar olinmaydi: ketma-ket
    ikki guruh bir xil test olmasin.
    """
    syllabus = db.get(CourseSyllabus, syllabus_id)
    if syllabus is None:
        return {"plan": {"current": None, "taught": [], "later": []}, "questions": []}
    plan = topic_plan(syllabus, variant, topic_code)
    if plan["current"] is None or not enabled():
        return {"plan": plan, "questions": [], "bank_size": 0, "bank_target": bank_target(),
                "new_questions": new_questions()}
    # Boshqa sillabusdagi o'xshash nomli mavzu ham (2026-10-22, "bir mavzuga bir marta").
    from app.services import content_bank

    # Mavzuning O'Z banki bor bo'lsa (Claude oldindan yozgan) o'xshash nomli mavzular qidirilmaydi (2026-11-25):
    # `similar_ids` har so'rovda bazadagi BARCHA testlarni ko'rib chiqadi (~1–2 s) — test "darhol" chiqmasdi,
    # bank kattalashgani sari yana sekinlashardi.
    own_bank = db.execute(
        select(func.count()).select_from(PreparedContent).where(
            PreparedContent.kind == KIND_TEST, PreparedContent.owner_key == "imentor-bank",
            PreparedContent.retired_reason == "", PreparedContent.syllabus_id == syllabus_id,
            func.lower(PreparedContent.topic_code) == plan["current"]["code"])).scalar() or 0
    similar = [] if own_bank else content_bank.similar_ids(
        db, KIND_TEST, plan["current"]["title"], since=QUALITY_SINCE,
        exclude_syllabus=syllabus_id, username=owner_key)
    rows = db.execute(
        select(PreparedContent.id, PreparedContent.owner_key, PreparedContent.payload, PreparedContent.created_at,
               PreparedContent.syllabus_id)
        .where(
            PreparedContent.kind == KIND_TEST,
            content_bank.match_clause(syllabus_id, plan["current"]["code"], similar, db=db, variant=variant),
            PreparedContent.retired_reason == "",
            PreparedContent.created_at >= QUALITY_SINCE,
        )
        .order_by(PreparedContent.created_at.desc())
    ).all()
    # 2026-11-24 (foydalanuvchi qarori): testlar MAVZUGA biriktiriladi — shu mavzudagi savollar har qanday
    # o'qituvchi va guruhga beriladi (AI'siz, tezroq). Ilgari o'qituvchining o'z oxirgi testi unga qayta
    # berilmasdi ("ketma-ket ikki guruh bir xil test olmasin") va bazada savol bo'la turib yangisi yozilardi.
    own_latest = None
    blocked: set[str] = set()
    seen: set[str] = set()
    no_lab = lab_free(getattr(syllabus, "subject_name", "") or "")
    # Kafedrada kitob bo'lsa — bankdan faqat kitob parchasiga tayangan savollar (`grounded`, 2026-11-18).
    books_only = has_books(db, getattr(syllabus, "department_id", None))
    # Mavzu banki hajmi — o'qituvchining oxirgi testi ham kiradi (u faqat shu o'qituvchiga bloklangan).
    bank: set[str] = set()
    out: list[dict] = []
    # Boshqa FANNING kitobidan yozilgan savollar berilmaydi (2026-11-25, Tibbiy kimyo kafedrasi: "testlar
    # Analitik kimyo va Biokimyo darsliklaridan — o'quv dasturimizda yo'q"). Kitoblar fanga bog'langach
    # (`subject_keywords`) yangi savollar to'g'ri kitobdan yoziladi, lekin bazadagi eskilari qolardi.
    foreign = _foreign_book_titles(db, syllabus)

    def from_foreign_book(q: dict) -> bool:
        if not foreign:
            return False
        for ref in q.get("references") or []:
            title = _key(str(ref.get("title") if isinstance(ref, dict) else ref))
            if title and any(title == f or title.startswith(f) or f.startswith(title) for f in foreign):
                return True
        return False

    for r in rows:
        payload = r.payload or {}
        # Claude oldindan yozgan bank savollari qisqa va aniq (2026-11-25): 20 so'zlik chegara ularning 99% ini
        # rad etib, bank to'la bo'lsa ham test har safar AI bilan yozilardi. Chegara AI yozgan eski savollarga qoladi.
        min_words = 3 if r.owner_key == "imentor-bank" else 20
        for q in _questions_in(payload, language) + _spares_in(payload, language):
            key = _key(str(q.get("question") or ""))
            if key and _usable(q, language, min_words) and not from_foreign_book(q):
                bank.add(key)
        # O'qituvchining oxirgi testidan faqat zaxira savollar: ular o'sha guruhda bo'lmagan.
        own_last = own_latest is not None and r.id == own_latest.id
        candidates = _spares_in(payload, language)
        if not own_last:
            candidates = _questions_in(payload, language) + candidates
        for q in candidates:
            key = _key(str(q.get("question") or ""))
            if not key or key in seen or key in blocked or not _usable(q, language, min_words):
                continue
            if no_lab and lab_question(str(q.get("question") or "")):
                continue
            if from_foreign_book(q):
                continue
            seen.add(key)
            level = q.get("level") if q.get("level") in LEVELS else None
            item = {
                "question": str(q.get("question") or "").strip(),
                "options": [str(o).strip() for o in q["options"]],
                "correctOptionIndex": q["correctOptionIndex"],
                "explanation": str(q.get("explanation") or "").strip(),
                "level": level,
                "link": q.get("link") if isinstance(q.get("link"), str) else None,
            }
            if isinstance(q.get("optionExplanations"), list) and len(q["optionExplanations"]) == 5:
                item["optionExplanations"] = [str(e or "") for e in q["optionExplanations"]]
            if isinstance(q.get("references"), list):
                item["references"] = q["references"][:4]
            if q.get("grounded"):
                item["grounded"] = True
            out.append(item)
    (rng or random).shuffle(out)
    # Brauzer bankdan ro'yxat TARTIBIDA tanlaydi: to'g'ri javobi eng uzun bo'lmagan savollar oldinga.
    # 2026-11-23: kitobga tayangan savollar OLDINDA, yetmasa bazadagi boshqa savollar ham olinadi
    # (ilgari ular butunlay tashlanardi — 123 savollik bankdan 0 qaytib, har test AI bilan yozilardi).
    out.sort(key=lambda q: (books_only and not q.get("grounded"), key_length_rank(q)))
    return {"plan": plan, "questions": out[:MAX_POOL], "bank_size": len(bank), "bank_target": bank_target(),
            "new_questions": new_questions()}


#: Claude test banki agenti (2026-11-20): nazoratdagi o'qituvchi mavzuni ochgach (`topic_open`) bank shu vaqt ichida
#: yoziladi; bu oraliqda brauzer test uchun OpenAI'ni chaqirmay kutadi. `.env`: IMENTOR_BANK_WAIT_MIN.
BANK_WAIT_MIN = 0  # 2026-11-20 11:40: o'qituvchilar 16–23 daqiqa kutib qoldi — kutish o'chirildi


def bank_pending_until(db: Session, syllabus_id: int, topic_code: str, pool_result: dict) -> str | None:
    """Bank yozilayotgan bo'lsa — kutish tugash vaqti (ISO), aks holda None."""
    if (pool_result.get("bank_size") or 0) >= max(1, pool_result.get("bank_target") or 0) and             sum(1 for q in pool_result.get("questions") or [] if q.get("grounded")) >= 10:
        return None
    from sqlalchemy import text

    try:
        wait = int(os.environ.get("IMENTOR_BANK_WAIT_MIN") or BANK_WAIT_MIN)
    except ValueError:
        wait = BANK_WAIT_MIN
    if wait <= 0:
        return None
    first = db.execute(text(
        "select min(occurred_at) from core_useractivityevent where event_type = 'topic_open' "
        "and occurred_at >= now() - make_interval(mins => :w) and meta->>'sid' = :sid and lower(meta->>'code') = :code"),
        {"w": wait, "sid": str(syllabus_id), "code": (topic_code or "").strip().lower()}).scalar()
    if first is None:
        return None
    from app.services import teacher_access

    owners = db.execute(text(
        "select distinct owner_key from core_useractivityevent where event_type = 'topic_open' "
        "and occurred_at >= :f and meta->>'sid' = :sid and lower(meta->>'code') = :code"),
        {"f": first, "sid": str(syllabus_id), "code": (topic_code or "").strip().lower()}).scalars().all()
    watched = teacher_access.controlled_teachers(db)
    if watched and not any(o in watched for o in owners):
        return None
    until = first + dt.timedelta(minutes=wait)
    return until.isoformat() if until > dt.datetime.now(dt.timezone.utc) else None
