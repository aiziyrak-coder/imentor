"""RAG retrieval: subject_code bo'yicha eng mos kitob chunk'larini topish."""

from __future__ import annotations

import logging
import os
import re

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.services.syllabus_access import like_prefix
from app.core.config import get_settings
from app.models.book import BookChunk, SubjectBook
from app.models.content import AcademicDepartment, CourseSyllabus
from app.services.openai_client import OpenAiClientError, create_embeddings

logger = logging.getLogger(__name__)

_EMBED_TEXT_MAX = 800


def resolve_book_department_id(
    db: Session,
    subject_code: str,
    *,
    syllabus_id: int | None = None,
) -> int | None:
    code = (subject_code or "").strip()
    if syllabus_id:
        try:
            sid = int(syllabus_id)
        except (TypeError, ValueError):
            sid = 0
        if sid > 0:
            syl = db.get(CourseSyllabus, sid)
            if syl and syl.department_id:
                return int(syl.department_id)

    if not code:
        return None

    syl = db.execute(
        select(CourseSyllabus).where(CourseSyllabus.subject_code == code)
    ).scalar_one_or_none()
    if syl and syl.department_id:
        return int(syl.department_id)

    # Online ta'lim fanlari alohida jadvalda turadi, lekin DARSLIKLAR umumiy:
    # `core_bookchunk` kafedra bo'yicha indekslangan. Shu qidiruvsiz online
    # fanda AI ma'ruza va testni darsliksiz, faqat o'z xotirasidan yozardi.
    #
    # Import shu yerda: modul yuklanishida aylanma bog'liqlik bo'lmasin.
    from app.models.online_edu import OnlineSyllabus

    online = db.execute(
        select(OnlineSyllabus).where(OnlineSyllabus.subject_code == code)
    ).scalar_one_or_none()
    if online and online.department_id:
        return int(online.department_id)

    dept_code = code.split("__", 1)[0].strip() if "__" in code else code

    syl = db.execute(
        select(CourseSyllabus)
        .join(AcademicDepartment, CourseSyllabus.department_id == AcademicDepartment.id, isouter=True)
        .where(
            or_(
                CourseSyllabus.subject_code.like(f"{like_prefix(dept_code)}\\_\\_%", escape="\\"),
                AcademicDepartment.code == dept_code,
            ),
            CourseSyllabus.department_id.is_not(None),
        )
    ).scalars().first()
    if syl and syl.department_id:
        return int(syl.department_id)

    dept = db.execute(
        select(AcademicDepartment).where(AcademicDepartment.code == dept_code)
    ).scalar_one_or_none()
    if dept:
        return int(dept.id)
    return None


# --- Kontekstni siqish: takror va shovqinni promptga yubormaslik --------------
#
# Ikkala funksiya ham BAZAGA TEGMAYDI — faqat qidiruv natijasini tozalaydi.
# Chunklar joyida qoladi, shunchaki promptga toza va zich matn boradi.

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?…])\s+|\n+")
_WORD = re.compile(r"[^\W\d_]{4,}", re.UNICODE)

# Bitta parchadan promptga ketadigan maksimal belgi. Korpusda o'rtacha chunk
# ~3 200 belgi (mediana 3 900) — bu RAG uchun 3-4 barobar katta va kerakli
# jumla shovqin ichida ko'milib ketadi. Savolga eng yaqin oynani kesib olsak,
# model ham aniqroq javob beradi, token ham kamayadi.
FOCUS_WINDOW_CHARS = 1200

# Takrorlarni tashlagach yetarli noyob parcha qolishi uchun necha barobar
# ko'p nomzod olamiz. Korpusda takror ulushi ~57% bo'lgani uchun 3 barobar
# deyarli har doim yetadi.
OVERFETCH = 3

# Bundan qisqa parcha generatsiyaga hech narsa bermaydi.
#
# Korpusda 14 873 ta (1.95%) shunday yozuv bor — OCR chiqindisi, ba'zilari
# bitta belgidan iborat (".", "s"). Ularning vektorlari mazmunsiz bo'lgani
# uchun ISTALGAN savolga "yaqin" chiqishi va haqiqiy matnni siqib chiqarishi
# mumkin. Bir sinovda 30 nomzoddan atigi 127 belgi foydali matn qolgan edi.
MIN_CHUNK_CHARS = 200


def _norm_for_dedup(text: str) -> str:
    """Takrorni aniqlash uchun matnni bir ko'rinishga keltiradi."""
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def dedupe_chunks(chunks: list[dict], limit: int) -> list[dict]:
    """Bir xil matnli parchalarni tashlab, `limit` tagacha noyobini qaytaradi.

    Korpusning 57 foizi aynan takror (bir kitob bir necha marta yuklangan).
    Filtrsiz `top_k=10` amalda 4-5 ta har xil manba beradi, qolgani nusxa —
    ya'ni pul ham ketadi, model ko'radigan manbalar xilma-xilligi ham kamayadi.
    """
    seen: set[str] = set()
    out: list[dict] = []
    for c in chunks:
        if not isinstance(c, dict):
            continue
        key = _norm_for_dedup(str(c.get("text") or ""))
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(c)
        if len(out) >= limit:
            break
    return out


def focus_window(text: str, query: str, max_chars: int = FOCUS_WINDOW_CHARS) -> str:
    """Parchadan savolga eng aloqador uzluksiz qismni kesib oladi.

    Gap chegaralari bo'yicha ishlaydi, ya'ni jumla o'rtasidan kesilmaydi.
    Savol so'zlari umuman uchramasa — parchaning boshini qaytaradi (parcha
    baribir vektor qidiruvi bo'yicha eng yaqinlaridan biri).
    """
    body = (text or "").strip()
    if len(body) <= max_chars:
        return body

    terms = {w.lower() for w in _WORD.findall(query or "")}
    sentences = [s2.strip() for s2 in _SENTENCE_SPLIT.split(body) if s2.strip()]
    if not sentences:
        return body[:max_chars].rstrip()

    scores = []
    for sent in sentences:
        if not terms:
            scores.append(0)
            continue
        words = {w.lower() for w in _WORD.findall(sent)}
        scores.append(len(terms & words))

    # Belgilar bo'yicha cheklangan oyna ichida eng ko'p mos so'z to'plangan joy.
    best_start, best_end, best_score, best_len = 0, 0, -1, -1
    start = 0
    length = 0
    running = 0
    for end, sent in enumerate(sentences):
        length += len(sent) + 1
        running += scores[end]
        while length > max_chars and start < end:
            length -= len(sentences[start]) + 1
            running -= scores[start]
            start += 1
        # Ball teng bo'lsa - to'liqroq oyna. Busiz savol so'zlari umuman
        # uchramaganda (hamma ball 0) birinchi jumlagina qaytardi, ya'ni
        # 1200 belgilik joyga 10 belgi ketardi va ma'lumot yo'qolardi.
        if running > best_score or (running == best_score and length > best_len):
            best_start, best_end, best_score, best_len = start, end, running, length

    window = " ".join(sentences[best_start : best_end + 1]).strip()
    if not window:
        return body[:max_chars].rstrip()
    # Kesilganini bildirib qo'yamiz — model matn to'liq emasligini bilsin.
    if len(window) > max_chars:
        # Bitta gapning o'zi chegaradan uzun - so'z chegarasida kesamiz.
        cut = window[:max_chars]
        space = cut.rfind(" ")
        window = (cut[:space] if space > max_chars // 2 else cut).rstrip()
    prefix = "… " if best_start > 0 else ""
    suffix = " …" if best_end < len(sentences) - 1 else ""
    return prefix + window + suffix


def _page_label(start: int | None, end: int | None) -> str:
    """Sahifa yorlig'i. Sahifasiz saqlangan hujjatlarda (o'qituvchi yuklagan Word/matnli fayllar)
    `page_start = page_end = 0`: bu "0-bet" emas, "sahifa noma'lum" — bo'sh qaytadi, aks holda
    model sarlavhadagi "0-bet" ni matnga ko'chirardi (2026-10-21)."""
    start, end = int(start or 0), int(end or 0)
    if start <= 0 and end <= 0:
        return ""
    if start <= 0:
        return str(end)
    return str(start) if start == end or end <= 0 else f"{start}-{end}"


def _chunk_to_dict(chunk: BookChunk) -> dict:
    return {
        "book_title": chunk.book.title,
        "page": _page_label(chunk.page_start, chunk.page_end),
        "text": chunk.text,
    }


def retrieve_book_context(
    db: Session,
    subject_code: str,
    query_text: str,
    *,
    top_k: int = 10,
    syllabus_id: int | None = None,
) -> list[dict]:
    rows = retrieve_book_context_many(db, subject_code, [query_text], top_k=top_k, syllabus_id=syllabus_id)
    return rows[0] if rows else []


def _norm_subject(value: str) -> str:
    return " ".join((value or "").lower().replace("’", "'").replace("‘", "'").replace("ʼ", "'").split())


def book_fits_subject(keywords: list | None, subject_name: str) -> bool:
    """Kitob shu fan uchunmi: kalit so'zi yo'q kitob — kafedraning hamma fanlari uchun.

    Fan nomi noma'lum bo'lsa (qidiruvda fan topilmadi) kitob ham olinadi — oldingidek.
    """
    words = [_norm_subject(str(k)) for k in (keywords or []) if _norm_subject(str(k))]
    name = _norm_subject(subject_name)
    if not words or not name:
        return True
    # So'z boshidan (2026-11-25): "organik kimyo" kaliti "Noorganik kimyo" faniga mos kelmasin.
    return any(re.search(r"(?<!\w)" + re.escape(w), name) for w in words)


def _subject_name(db: Session, subject_code: str, syllabus_id: int | None = None) -> str:
    """Fanning nomi — kitobning qaysi fan uchun ekanini tekshirishga (`subject_keywords`)."""
    try:
        sid = int(syllabus_id or 0)
    except (TypeError, ValueError):
        sid = 0
    if sid > 0:
        syl = db.get(CourseSyllabus, sid)
        if syl is not None:
            return syl.subject_name or ""
    code = (subject_code or "").strip()
    if not code:
        return ""
    name = db.execute(select(CourseSyllabus.subject_name).where(CourseSyllabus.subject_code == code)).scalar()
    if name:
        return name
    from app.models.online_edu import OnlineSyllabus

    return db.execute(select(OnlineSyllabus.subject_name).where(OnlineSyllabus.subject_code == code)).scalar() or ""


def books_not_for_subject(db: Session, dept_id: int, subject_name: str) -> list[int]:
    """Kafedraning BOSHQA fanga bog'langan kitoblari — shu fanda manba bo'lmaydi.

    2026-11-03: kafedra kutubxonasi fanlarga bo'linmagan edi — Farmakognoziya ma'ruzasi eng
    yaqin parchani Farmakologiya darsligidan (Azizova, yagona o'zbekcha kitob) olardi.
    """
    rows = db.execute(
        select(SubjectBook.id, SubjectBook.subject_keywords).where(
            SubjectBook.department_id == dept_id,
            func.jsonb_array_length(SubjectBook.subject_keywords) > 0,
        )
    ).all()
    return [book_id for book_id, keywords in rows if not book_fits_subject(keywords, subject_name)]


#: Manba ustuvorligi (2026-11-19, foydalanuvchi qarori): avval institut (admin/skript) yuklagan kitoblar, ularda
#: mavzu bo'yicha ma'lumot bo'lmasa — o'qituvchilar yuklagan «Kafedra kutubxonasi». "Bo'lmasa" = institut
#: kitobining eng yaqin parchasi kutubxonanikidan `PREFER_MARGIN` dan ko'proq uzoq yoki `PREFER_MAX` dan uzoq.
#: O'lchov (16 real mavzu): institut kitoblari ko'pincha boshqa tilda va 0.50–0.79 masofada, kutubxona
#: 0.26–0.69 — qat'iy "doim institut" qoidasi 13/16 mavzuda mavzuga uzoq parcha berardi.
PREFER_MARGIN = float(os.environ.get("IMENTOR_BOOK_PREFER_MARGIN", "0.08"))
PREFER_MAX = float(os.environ.get("IMENTOR_BOOK_PREFER_MAX", "0.62"))


def _prefer_institute_books(db: Session, chunks: list, vec, where: tuple, top_k: int) -> list:
    """Parchalar tartibi: institut kitoblari oldinda (agar mavzuga yetarli yaqin bo'lsa), keyin kutubxona."""
    book_ids = {getattr(c, "book_id", None) for c in chunks} - {None}
    if not book_ids:
        return chunks
    try:
        owners = dict(db.execute(
            select(SubjectBook.id, SubjectBook.owner_key).where(SubjectBook.id.in_(book_ids))
        ).all())
    except Exception:  # noqa: BLE001 — ustuvorlik ishlamasa ham qidiruv natijasi qaytadi
        logger.warning("RAG manba ustuvorligi o'tkazib yuborildi", exc_info=True)
        return chunks
    distance = BookChunk.embedding.cosine_distance(vec)
    inst = [c for c in chunks if not owners.get(c.book_id)]
    lib = [c for c in chunks if owners.get(c.book_id)]
    if not lib:
        return chunks
    if not inst:
        # Eng yaqin nomzodlar orasida institut kitobi yo'q — baribir uning eng yaqin parchasini tekshiramiz.
        inst = db.execute(
            select(BookChunk).join(SubjectBook, SubjectBook.id == BookChunk.book_id)
            .where(*where, SubjectBook.owner_key == "").order_by(distance + 0).limit(top_k * OVERFETCH)
        ).scalars().all()
        if not inst:
            return chunks
    ids = [c.id for c in (list(inst) + list(lib))]
    dist = dict(db.execute(select(BookChunk.id, distance).where(BookChunk.id.in_(ids))).all())
    best_inst, best_lib = dist.get(inst[0].id, 9.0), dist.get(lib[0].id, 9.0)
    if best_inst <= PREFER_MAX and best_inst <= best_lib + PREFER_MARGIN:
        # Institut kitobining faqat mavzuga yetarli yaqin parchalari oldinda; qolgan joyni kutubxona to'ldiradi.
        close = [c for c in inst if dist.get(c.id, 9.0) <= max(PREFER_MAX, best_lib + PREFER_MARGIN)]
        far = [c for c in inst if c not in close]
        logger.info("RAG manba: institut kitoblari (%.3f, kutubxona %.3f, %d parcha)", best_inst, best_lib, len(close))
        return close + list(lib) + far
    logger.info("RAG manba: kafedra kutubxonasi (institut %.3f, kutubxona %.3f)", best_inst, best_lib)
    return list(lib) + list(inst)


def retrieve_book_context_many(
    db: Session,
    subject_code: str,
    queries: list[str],
    *,
    top_k: int = 10,
    syllabus_id: int | None = None,
) -> list[list[dict]]:
    subject_code = (subject_code or "").strip()
    cleaned = [str(q or "").strip()[:2000] for q in (queries or [])]
    if not cleaned:
        return []
    if not subject_code and not syllabus_id:
        return [[] for _ in cleaned]

    dept_id = resolve_book_department_id(db, subject_code, syllabus_id=syllabus_id)
    if not dept_id:
        logger.warning("book RAG: department topilmadi subject_code=%r syllabus_id=%r", subject_code, syllabus_id)
        return [[] for _ in cleaned]

    settings = get_settings()
    api_key = (settings.openai_api_key or os.environ.get("OPENAI_API_KEY", "")).strip()
    if not api_key:
        logger.warning("book RAG: OPENAI_API_KEY yo'q")
        return [[] for _ in cleaned]

    embed_texts = [(q[:_EMBED_TEXT_MAX] if q else ".") for q in cleaned]
    try:
        vectors = create_embeddings(api_key, embed_texts, cache=True)
    except OpenAiClientError as e:
        logger.warning("book RAG embedding xato: %s", e)
        return [[] for _ in cleaned]

    if len(vectors) != len(cleaned):
        logger.warning("book RAG embedding soni mos emas: got=%s want=%s", len(vectors), len(cleaned))
        return [[] for _ in cleaned]

    excluded = books_not_for_subject(db, dept_id, _subject_name(db, subject_code, syllabus_id))
    out: list[list[dict]] = []
    for q, vec in zip(cleaned, vectors):
        if not q.strip():
            out.append([])
            continue
        # Takrorlar tashlangach `top_k` ta NOYOB parcha qolishi uchun ortig'i
        # bilan olamiz. HNSW indeksi bilan bu ~20 ms, ya'ni deyarli tekin.
        where = (
            BookChunk.department_id == dept_id,
            func.length(BookChunk.text) >= MIN_CHUNK_CHARS,
            *([BookChunk.book_id.not_in(excluded)] if excluded else []),
        )
        distance = BookChunk.embedding.cosine_distance(vec)
        chunks = (
            db.execute(select(BookChunk).where(*where).order_by(distance).limit(top_k * OVERFETCH * 2))
            .scalars()
            .all()
        )
        if len(chunks) < top_k:
            # HNSW indeksi BUTUN korpus (hamma kafedra) bo'yicha eng yaqin ~800 ni oladi, kafedra va
            # kitob filtri esa SHUNDAN KEYIN qo'llanadi. O'zbekcha savolga boshqa kafedralarning
            # o'zbekcha kitoblari yaqin chiqib, kafedraning inglizcha darsliklari siqib chiqariladi —
            # natija bo'sh (2026-11-03: Farmakognoziya 0 parcha; bir kunda 73 qidiruvdan 4 tasi bo'sh).
            # Shunda kafedra ichida ANIQ qidiruv (`+ 0` indeksni chetlab o'tadi): ~3 s, faqat shu holatda.
            chunks = (
                db.execute(select(BookChunk).where(*where).order_by(distance + 0).limit(top_k * OVERFETCH))
                .scalars()
                .all()
            )
            logger.info("RAG: indeks %d dan kam berdi — kafedra %s ichida aniq qidiruv: %d", top_k, dept_id, len(chunks))
        chunks = _prefer_institute_books(db, chunks, vec, where, top_k)
        cands = [_chunk_to_dict(c) for c in chunks]
        picked = dedupe_chunks(cands, top_k)
        raw_chars = sum(len(c["text"]) for c in picked)
        for item in picked:
            item["text"] = focus_window(item["text"], q)
        logger.info(
            "RAG kontekst: %d nomzod -> %d noyob parcha, %d -> %d belgi",
            len(cands),
            len(picked),
            raw_chars,
            sum(len(c["text"]) for c in picked),
        )
        out.append(picked)
    return out


def retrieve_book_context_by_department_id(
    db: Session,
    department_id: int,
    query_text: str,
    *,
    top_k: int = 12,
) -> list[dict]:
    """Kafedra id bo'yicha to'g'ridan-to'g'ri RAG (subject_code shart emas)."""
    try:
        dept_id = int(department_id)
    except (TypeError, ValueError):
        return []
    if dept_id <= 0:
        return []
    q = str(query_text or "").strip()[:2000]
    if not q:
        q = "asosiy tushunchalar diagnostika davolash"

    settings = get_settings()
    api_key = (settings.openai_api_key or os.environ.get("OPENAI_API_KEY", "")).strip()
    if not api_key:
        logger.warning("book RAG: OPENAI_API_KEY yo'q")
        return []

    try:
        vectors = create_embeddings(api_key, [q[:_EMBED_TEXT_MAX] or "."], cache=True)
    except OpenAiClientError as e:
        logger.warning("book RAG embedding xato: %s", e)
        return []
    if not vectors:
        return []
    vec = vectors[0]
    chunks = (
        db.execute(
            select(BookChunk)
            .where(
                BookChunk.department_id == dept_id,
                func.length(BookChunk.text) >= MIN_CHUNK_CHARS,
            )
            .order_by(BookChunk.embedding.cosine_distance(vec))
            .limit(top_k * OVERFETCH)
        )
        .scalars()
        .all()
    )
    picked = dedupe_chunks([_chunk_to_dict(c) for c in chunks], top_k)
    for item in picked:
        item["text"] = focus_window(item["text"], q)
    return picked


def _real_page(value) -> str:
    """"0", "0-0" va bo'sh qiymat — sahifa noma'lum."""
    page = str(value or "").strip()
    return "" if re.fullmatch(r"0+(\s*-\s*0+)?", page) or not page else page


def format_book_context_message(chunks: list[dict]) -> str | None:
    if not chunks:
        return None
    parts = []
    pageless = False
    for c in chunks:
        if not isinstance(c, dict):
            continue
        text = str(c.get("text") or "").strip()
        if not text:
            continue
        raw_title = str(c.get("book_title") or "").strip()
        # Fayl nomi ("10_2025_M.K.Azimova_Gigiena_Darslik") emas, adabiyotlar ro'yxatidagi bilan
        # bir xil tozalangan nom — model nomni sarlavhadan AYNAN ko'chiradi.
        title = clean_book_title(raw_title) or raw_title or "Darslik"
        page = _real_page(c.get("page"))
        head = f"[Manba: {title}, {page}-bet]" if page else f"[Manba: {title}]"
        pageless = pageless or not page
        parts.append(f"{head}\n{text}")
    if not parts:
        return None
    joined = "\n\n---\n\n".join(parts)
    page_rule = (
        "DIQQAT: sarlavhasida sahifa raqami YO'Q parchalar uchun sahifa MA'LUM EMAS. Ularni "
        "faqat \"(Manba: kitob nomi)\" deb ko'rsating; bet/sahifa raqamini hech qachon o'ylab "
        "topmang va o'z xotirangizdan yozmang.\n\n"
        if pageless
        else ""
    )
    return (
        # 2026-10-21: "FAQAT shu parchalardan" qoidasida parcha mavzuga mos kelmasa model
        # vazifa o'rniga "parcha yuboring" deb javob berardi — bir kunda 23 ta ma'ruza.
        "Quyida shu fanga tegishli RASMIY DARSLIK parchalari berilgan. "
        "MANBA QOIDASI: faktlarni avvalo shu parchalardan oling va ularga parcha sarlavhasidagi "
        "manbani ko'rsating. Parchada yo'q narsani umume'tirof etilgan darslik bilimi bilan "
        "yozing, lekin unga manba yoki sahifa yozmang. Parchalar yetarli yoki mos bo'lmasa ham "
        "vazifani TO'LIQ bajaring — savol bermang, uzr so'ramang, qo'shimcha material so'ramang.\n\n"
        + page_rule + joined
    )


#: Test faqat yuklangan kitob/protokoldan (2026-11-18). Kafedralar: "tizim savolni umumiy manbalardan tuzyapti,
#: atamalar va chuqurlik bizning darslik va dasturimizdan farq qiladi — biz yuklagan kitoblardan yaratsin,
#: ortiqcha ochiq manba kerak emas; testda ham, keysda ham qaysi kitob, qaysi betdan olingani chiqmayapti".
#: Ilgari parcha "avvalo" manba edi, qolgani model xotirasidan; savol manbasi esa KEYIN o'xshash parcha
#: qidiruvi bilan yopishtirilardi (savol o'sha betdan olinganini bildirmasdi). Endi parchalar raqamlanadi
#: (P1… kitob, K1… protokol), har savol bitta parchaga tayanadi va uning raqamini `source` da qaytaradi —
#: brauzer raqamni shu parchaning kitobi va betiga aylantiradi; raqamsiz savol testga kirmaydi.
STRICT_TEST_PURPOSES = frozenset({"test_generate", "test_generate_brief"})
STRICT_BOOK_TOP_K = 14


#: Qat'iy rejim uchun mavzuga tegishli parcha kamida shuncha bo'lsin; kam bo'lsa — test avvalgidek (parchalar
#: «avvalo» manba), chunki 2026-11-18 sinovida mos parcha bo'lmagan mavzuda model savolni aloqasiz parchadan
#: tuzdi (tuxumdon o'smasi mavzusiga sperma tahlili, 30 tadan 12 savol mavzudan tashqari).
MIN_RELEVANT_FRAGMENTS = 3
#: Saralash modeli: arzon model (nano) sinovda "Akusherlik rivojlanishi" mavzusiga homiladorlikdagi gepatit
#: parchalarini "mos" dedi — 6 savoldan 5 tasi mavzudan tashqari. `.env`: OPENAI_SOURCE_FILTER_MODEL.
DEFAULT_SOURCE_FILTER_MODEL = "gpt-5.4-mini"


def relevant_chunks(api_key: str, topic: str, chunks: list[dict]) -> list[dict]:
    """Mavzuga tegishli parchalar (arzon model saralaydi). Xato bo'lsa — bo'sh ro'yxat (qat'iy rejim yoqilmaydi)."""
    return relevant_chunks_or_none(api_key, topic, chunks) or []


def relevant_chunks_or_none(api_key: str, topic: str, chunks: list[dict]) -> list[dict] | None:
    """`relevant_chunks` kabi, lekin saralab bo'lmasa (xato) — None; mos parcha yo'q bo'lsa — [].
    2026-11-23: "Huqnalar" mavzusiga embedding churra (hernia) parchalarini berdi va slayd churra haqida
    chiqdi — endi slayd/matn yaratishda ham parchalar mavzuga mosligi bo'yicha saralanadi."""
    if not chunks or not api_key:
        return None
    from app.services import openai_client as oai

    listed = "\n\n".join(
        f"[{i}] {clean_book_title(str(c.get('book_title') or ''))[:80]}: {' '.join(str(c.get('text') or '').split())[:420]}"
        for i, c in enumerate(chunks, 1))
    try:
        raw = oai.generate_openai_chat(
            api_key,
            messages=[{"role": "system", "content": (
                "You select textbook excerpts for writing exam questions on ONE lesson topic. Keep an excerpt only "
                "if a student who studied THIS topic in class could answer a question written from it: it must be "
                "about the topic itself (its definition, classification, causes, mechanisms, features, diagnosis, "
                "treatment, drugs or methods). Reject excerpts about another organ, disease, drug group, a "
                "neighbouring topic, a special population not named in the topic, or a general introduction. "
                "When unsure — reject. Excerpts may be in another language. The TOPIC is usually written in Uzbek "
                "medical terminology: first translate it precisely (e.g. 'huqna' = enema, 'churra' = hernia) and "
                "judge excerpts against that exact meaning, not a similar-sounding term. "
                "Answer JSON {\"relevant\": [numbers]}.")},
                {"role": "user", "content": f"TOPIC: {topic}\n\nEXCERPTS:\n{listed}"}],
            model=oai._env_model("OPENAI_SOURCE_FILTER_MODEL", DEFAULT_SOURCE_FILTER_MODEL), max_tokens=1200,
            temperature=0, response_format={"type": "json_object"},
            usage_kind="test_source_filter")
        import json as _json

        picked = {int(x) for x in (_json.loads(raw).get("relevant") or []) if str(x).strip().isdigit()}
    except Exception:  # noqa: BLE001 — saralab bo'lmasa qat'iy rejim yo'q, test avvalgidek yoziladi
        logger.warning("test manbasi: parchalar saralanmadi", exc_info=True)
        return None
    return [c for i, c in enumerate(chunks, 1) if i in picked]


def strict_fragments_message(book_chunks: list[dict], protocol_chunks: list[dict] | None = None) -> tuple[str | None, list[dict]]:
    """(system xabari, parchalar ro'yxati [{id, title, pages, kind}]) — parcha bo'lmasa (None, [])."""
    parts: list[str] = []
    fragments: list[dict] = []
    for i, c in enumerate(protocol_chunks or [], 1):
        text = str((c or {}).get("text") or "").strip()
        if not text:
            continue
        fid = f"K{i}"
        title = str(c.get("title") or "Protokol").strip()[:300]
        fragments.append({"id": fid, "title": title, "pages": "", "kind": "protocol"})
        parts.append(f"[{fid}] (Protokol) {title}\n{text[:2000]}")
    n = 0
    for c in book_chunks or []:
        text = str((c or {}).get("text") or "").strip()
        if not text:
            continue
        n += 1
        fid = f"P{n}"
        raw = str(c.get("book_title") or "").strip()
        title = clean_book_title(raw) or raw or "Darslik"
        page = _real_page(c.get("page"))
        fragments.append({"id": fid, "title": title[:300], "pages": page, "kind": "book"})
        parts.append(f"[{fid}] (Darslik) {title}" + (f", {page}-bet" if page else "") + f"\n{text}")
    if not parts:
        return None, []
    rule = (
        "MANBA — FAQAT quyidagi raqamlangan parchalar: kafedra yuklagan darslik va o'quv qo'llanmalari (P…) va "
        "amaldagi protokollar (K…). TEST QOIDASI: HAR savol bitta parchadagi faktga tayansin — savol, to'g'ri javob "
        "va izoh o'sha parchadan; atama va chuqurlik parchadagidek (talaba shu kitobdan o'qiydi). Parchada YO'Q fakt, "
        "boshqa atama, internet yoki xotiradan qo'shimcha ma'lumot YOZILMASIN. Har savolda \"source\" — tayangan "
        "parcha raqami (masalan \"P3\" yoki \"K1\"). Protokol bilan darslik ziddiyat qilsa — protokol ustun. "
        "MAVZU USTUN: faqat shu MAVZUGA tegishli parchadan foydalaning; mavzuga aloqasi yo'q parchani (boshqa a'zo, "
        "boshqa kasallik, umumiy kirish) e'tiborsiz qoldiring. Mavzuga tegishli parcha savol uchun yetmasa — o'sha "
        "savolni mavzu bo'yicha darslik darajasida yozing va \"source\": \"\" qoldiring (manba o'ylab topilmasin). "
        "Vazifani to'liq bajaring, savol bermang."
    )
    return rule + "\n\n" + "\n\n---\n\n".join(parts), fragments


_TITLE_NOISE = frozenset({
    "pdf", "epub", "djvu", "doc", "docx", "txt", "scan", "scanned", "ocr",
    "final", "copy", "pca", "dr", "notes", "note", "book", "ebook", "free",
    "download", "compressed", "merged", "org", "com", "net", "www",
    "konkur", "in",
    # Fayl nomi oxiridagi "tayyor" belgisi ("...qo'llanma tayyor"): kitob nomining qismi emas.
    "tayyor", "tayyr", "тайёр", "готов", "готово",
})

_BRACKET_URL_RE = re.compile(r"[\[\(]\s*(?:https?://|www\.)[^\]\)]*[\]\)]", re.I)
_MD_LINK_RE = re.compile(r"\[([^\]]*)\]\((?:[^)]*)\)")
_BARE_URL_RE = re.compile(r"(?:https?://\S+|www\.[^\s\]\)]+)", re.I)
_LETTER_YEAR_RE = re.compile(r"([A-Za-zЀ-ӿ])((?:19|20)\d{2})\b")


def clean_book_title(raw: str) -> str:
    s = str(raw or "").strip()
    if not s:
        return ""
    s = _MD_LINK_RE.sub(r"\1", s)
    s = _BRACKET_URL_RE.sub(" ", s)
    s = _BARE_URL_RE.sub(" ", s)
    s = re.sub(r"\.(pdf|epub|djvu|docx?|txt)\b", " ", s, flags=re.I)
    # Fayl nusxasi belgisi: "O‘zMSt 134-2024 (2)", "... 5.01.2019 (1)". Nomga tegishli emas va
    # ma'ruzadagi "(Manba: ...)" iqtibosini ikkinchi qavs bilan buzardi (2026-10-21).
    s = re.sub(r"\s*\(\d{1,2}\)\s*$", "", s.strip())
    # Fayl tartib raqami ("10_2025_...") olib tashlanadi, lekin hujjat raqami ("0341-16",
    # "134-2024") nomning bir qismi — u "16 школа" bo'lib qolmasin.
    s = re.sub(r"^\s*\d+(?!\s*[-‐–]\s*\d)[\s.)\-_]+", "", s)
    # Raqamlar orasidagi chiziqcha (hujjat raqami "134-2024", "0341-16") saqlanadi.
    s = re.sub(r"(?<!\d)-|-(?!\d)", " ", s.replace("_", " "))
    s = _LETTER_YEAR_RE.sub(r"\1 \2", s)

    kept: list[str] = []
    for i, part in enumerate(p for p in s.split() if p):
        # Unikod: kirill so'zlar ("тайёр") ham solishtiriladi (oldin [^a-z0-9] ularni bo'shatib yuborardi).
        low = re.sub(r"[\W_]+", "", part.lower())
        if low in _TITLE_NOISE and i >= 1:
            continue
        if kept and kept[-1].lower() == part.lower():
            continue
        kept.append(part)

    out = re.sub(r"\s{2,}", " ", " ".join(kept)).strip(" .,-–—")
    for op, cl in (("(", ")"), ("[", "]"), ("{", "}")):
        extra = out.count(op) - out.count(cl)
        if extra > 0:
            out = out.replace(op, "", extra)
        elif extra < 0:
            out = out.replace(cl, "", -extra)
    out = re.sub(r"\s{2,}", " ", out).strip(" .,-–—")

    if len(out) < 3:
        return str(raw).strip()
    return out[0].upper() + out[1:] if out.islower() else out


def book_references_from_chunks(chunks: list[dict]) -> list[dict]:
    by_title: dict[str, list[str]] = {}
    for c in chunks or []:
        title = str((c or {}).get("book_title") or "").strip()
        page = _real_page((c or {}).get("page"))
        if not title:
            continue
        pages = by_title.setdefault(title, [])
        if page and page not in pages:
            pages.append(page)

    out: list[dict] = []
    for title, pages in by_title.items():
        ref: dict = {"title": clean_book_title(title)[:300]}
        if pages:
            def _first_page(p: str) -> int:
                head = p.split("-", 1)[0].strip()
                return int(head) if head.isdigit() else 0

            ordered = sorted(pages, key=_first_page)[:12]
            ref["pages"] = ", ".join(ordered)
        out.append(ref)
    out.sort(key=lambda r: -len(str(r.get("pages") or "")))
    return out[:8]


def retrieve_references_for_queries(
    db: Session,
    subject_code: str,
    queries: list[str],
    *,
    top_k: int = 3,
    syllabus_id: int | None = None,
) -> list[list[dict]]:
    chunk_lists = retrieve_book_context_many(db, subject_code, queries, top_k=top_k, syllabus_id=syllabus_id)
    return [book_references_from_chunks(chunks) for chunks in chunk_lists]
