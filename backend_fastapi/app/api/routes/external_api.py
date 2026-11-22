from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_external_api_key
from app.core.db import get_db
from app.models.content import AcademicDepartment, CourseSyllabus
from app.models.prepared_content import PreparedContent
from app.services import content_catalog as cc
from app.services import external_catalog as ec
from app.services import external_lang as el
from app.services import subject_meta as sm
from app.services.pagination import paginate

router = APIRouter(dependencies=[Depends(require_external_api_key)])

QL_BOUNDS = {"min": cc.TEST_QUESTION_LIMIT_MIN, "max": cc.TEST_QUESTION_LIMIT_MAX}
KEYS_QL_BOUNDS = {"min": cc.CASE_QUESTION_LIMIT_MIN, "max": cc.CASE_QUESTION_LIMIT_MAX}


#: nginx `/api/` 300 s da uzadi; javob undan oldin chiqishi kerak.
EXAM_RESPONSE_BUDGET_SEC = 280
#: Bundan kam vaqt qolsa gpt-5.4 tekshiruvi ulgurmaydi — o'tkazib yuboriladi.
EXAM_REVIEW_MIN_SEC = 45


def _params(request: Request) -> dict:
    return dict(request.query_params)


def _language(params: dict) -> str | None:
    """`?language=` (yoki `lang`) — uz|ru|en|uz-cyrl; noto'g'ri qiymat — 400."""
    lang, err = el.parse_language(params.get("language") or params.get("lang"))
    if err:
        raise HTTPException(status_code=400, detail=err)
    return lang


def _language_fields(item, info: dict | None, lang: str | None, data: dict) -> dict:
    """`?language=` bilan: mavzu shu tilda (+ `topic_language`), savollar soni shu tildagisi,
    tarjima kimniki (`translated_by`). Hujjat qatori va hujjatning o'zi uchun bir xil."""
    if not lang:
        return data
    data["topic"], data["topic_language"] = el.topic_for(item, info, lang, data.get("topic"))
    data["question_count_all"] = data.get("question_count")
    data["question_count"] = el.language_count(info, lang)
    data["language"] = lang
    data.update(el.translation_fields(info, lang))
    return data


def _document_rows(db: Session, items: list, lang: str | None) -> list[dict]:
    """Ro'yxat qatorlari: har biriga `primary_language` va `available_languages`.

    `lang` berilsa — faqat shu tilda mavjud hujjatlar; `topic`, fan va kafedra nomi shu tilda,
    `question_count` — shu tilda haqiqatan qaytadigan savollar soni (2026-11-17, fermi.uz).
    """
    infos = el.infos_for(db, list(items))
    subjects = sm.lookup(db)
    rows = []
    for item in items:
        info = infos.get(int(item.id))
        if lang and not el.has_language(info, lang):
            continue
        row = cc.catalog_item_summary(item, include_verification=True)
        row.update(el.summary_fields(info))
        sm.apply(row, subjects.get(row.get("subject_code") or ""), lang)
        rows.append(_language_fields(item, info, lang, row))
    return rows


def _localized_stats(db: Session, body: dict, lang: str | None) -> dict:
    """Statistika (keshdan) — fan qatorlariga yo'nalish/kurs/semestr va nomlar; `lang` bilan shu tilda."""
    import copy

    out = copy.deepcopy(body)
    subjects = sm.lookup(db)
    for key in ("by_subject", "by_variant", "by_topic", "recent"):
        for row in out.get(key) or []:
            if isinstance(row, dict):
                sm.apply(row, subjects.get(row.get("subject_code") or ""), lang)
    if lang:
        out["language"] = lang
    return out


# ---------------- tests ----------------


@router.get("/external/tests/stats/")
def external_tests_stats(request: Request, db: Session = Depends(get_db)) -> dict:
    # Keshdan (cron 10 daqiqada yangilaydi): ilgari har so'rov ~15 soniya edi (2026-11-17).
    body = _localized_stats(db, el.cached_stats(db, "test"), _language(_params(request)))
    body["question_limit_bounds"] = QL_BOUNDS
    return body


@router.get("/external/tests/")
def external_tests_list(request: Request, db: Session = Depends(get_db)) -> dict:
    params = _params(request)
    min_q, err = cc.parse_test_question_limit(params.get("min_questions"), param_name="min_questions")
    if err:
        raise HTTPException(status_code=400, detail=err)
    max_q, err = cc.parse_test_question_limit(params.get("max_questions"), param_name="max_questions")
    if err:
        raise HTTPException(status_code=400, detail=err)
    if min_q is not None and max_q is not None and min_q > max_q:
        raise HTTPException(status_code=400, detail="min_questions cannot be greater than max_questions.")
    lang = _language(params)

    stmt = cc.filter_catalog_stmt(
        cc.published_catalog_stmt().where(PreparedContent.kind == "test"), params
    )
    stmt = cc.filter_by_stored_question_count(stmt, min_questions=min_q, max_questions=max_q)
    items = db.execute(stmt).scalars().all()
    rows = _document_rows(db, items, lang)
    payload = paginate(rows, request, default_page_size=50, max_page_size=200)
    payload["question_limit_bounds"] = QL_BOUNDS
    if lang:
        payload["language"] = lang
    return payload


@router.get("/external/tests/{pk}/")
def external_test_detail(pk: int, request: Request, db: Session = Depends(get_db)) -> dict:
    params = _params(request)
    raw_limit = params.get("question_limit") or params.get("question_count")
    limit, err = cc.parse_test_question_limit(raw_limit)
    if err:
        raise HTTPException(status_code=400, detail=err)
    lang = _language(params)

    item = db.execute(
        cc.published_catalog_stmt().where(PreparedContent.id == pk, PreparedContent.kind == "test")
    ).scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="Not found.")

    # 2026-11-17: tarjima yo'q bo'lsa AI bilan o'girilmaydi (o'qituvchi ko'rmagan tibbiy tarjima
    # talabani adashtiradi) — asl til qaytadi va `language` buni ko'rsatadi.
    payload_raw = item.payload if isinstance(item.payload, dict) else {}
    info = el.infos_for(db, [item]).get(int(item.id)) or el.analyse(payload_raw, "test")
    if lang:
        projected, used_lang = el.project(payload_raw, info, lang)
    else:
        projected, _ = cc.project_test_payload_language(payload_raw, None)
        projected["primaryLanguage"] = info["p"]
        used_lang = info["p"]
    payload, available, returned = cc.slice_test_payload(projected, limit)

    data = cc.catalog_item_summary(item, include_verification=True)
    data.update(el.summary_fields(info))
    sm.apply(data, sm.lookup(db).get(data.get("subject_code") or ""), lang)
    _language_fields(item, info, lang if used_lang == lang else None, data)
    if lang and used_lang == lang:
        payload["topic"] = data["topic"]
    elif lang:
        # Bu tilda yo'q — asl tildagi hujjat; mavzu ham shu tilda bo'lsin va tili aytilsin.
        data["topic"], data["topic_language"] = el.topic_for(item, info, used_lang, data.get("topic"))
    data["payload"] = payload
    data["language"] = used_lang
    data["question_count_available"] = available
    data["question_count_returned"] = returned
    data["question_limit_bounds"] = QL_BOUNDS
    if limit is not None:
        data["question_limit"] = limit
    return data


@router.get("/external/questions/sample/")
def external_questions_sample(request: Request, db: Session = Depends(get_db)) -> dict:
    params = _params(request)
    subject_code = (params.get("subject_code") or "").strip()
    department_code = (params.get("department_code") or "").strip()
    if not subject_code and not department_code:
        raise HTTPException(status_code=400, detail="subject_code or department_code is required.")

    raw_count = params.get("count") or params.get("question_limit") or params.get("question_count")
    count, err = cc.parse_test_question_limit(raw_count, param_name="count")
    if err:
        raise HTTPException(status_code=400, detail=err)
    lang = _language(params)

    stmt = cc.filter_catalog_stmt(cc.published_catalog_stmt().where(PreparedContent.kind == "test"), params)
    items = db.execute(stmt).scalars().all()
    if lang:
        # 2026-11-17 (fermi.uz): namuna FAQAT shu tilda to'liq mavjud savollardan olinadi — til matndan
        # aniqlanadi (saqlangan `primaryLanguage` ga ishonilmaydi), AI tarjima qilinmaydi. Yetmasa —
        # kamroq qaytadi, `count_available` buni aytadi.
        infos = el.infos_for(db, list(items))
        questions, available, tests_scanned = el.collect_test_questions(items, infos, lang, count=count)
    else:
        questions, available, tests_scanned = cc.collect_unique_questions_from_tests(
            items, shuffle=True, count=count, language=None
        )

    body = {
        "subject_code": subject_code,
        "department_code": department_code,
        "variant_label": (params.get("variant_label") or "").strip(),
        "topic_code": (params.get("topic_code") or "").strip().lower(),
        "syllabus_id": (params.get("syllabus_id") or "").strip(),
        "available_languages": [code for code in cc.SUPPORTED_TEST_LANGUAGES if any(code in row["languages"] for row in questions)],
        "count_requested": count,
        "count_available": available,
        "count_returned": len(questions),
        "tests_scanned": tests_scanned,
        "question_limit_bounds": QL_BOUNDS,
        "questions": questions,
    }
    if lang:
        body["language"] = lang
        body["available_languages"] = [lang] if questions else []
    return body


# ---------------- keys (case) ----------------


@router.get("/external/keys/stats/")
def external_keys_stats(request: Request, db: Session = Depends(get_db)) -> dict:
    body = _localized_stats(db, el.cached_stats(db, "case"), _language(_params(request)))
    body["question_limit_bounds"] = KEYS_QL_BOUNDS
    return body


@router.get("/external/keys/")
def external_keys_list(request: Request, db: Session = Depends(get_db)) -> dict:
    params = _params(request)
    min_q, err = cc.parse_case_question_limit(params.get("min_questions"), param_name="min_questions")
    if err:
        raise HTTPException(status_code=400, detail=err)
    max_q, err = cc.parse_case_question_limit(params.get("max_questions"), param_name="max_questions")
    if err:
        raise HTTPException(status_code=400, detail=err)
    if min_q is not None and max_q is not None and min_q > max_q:
        raise HTTPException(status_code=400, detail="min_questions cannot be greater than max_questions.")

    lang = _language(params)

    stmt = cc.filter_catalog_stmt(
        cc.published_catalog_stmt().where(PreparedContent.kind == "case"), params
    )
    stmt = cc.filter_by_stored_question_count(stmt, min_questions=min_q, max_questions=max_q)
    items = db.execute(stmt).scalars().all()
    rows = _document_rows(db, items, lang)
    payload = paginate(rows, request, default_page_size=50, max_page_size=200)
    payload["question_limit_bounds"] = KEYS_QL_BOUNDS
    if lang:
        payload["language"] = lang
    return payload


@router.get("/external/keys/scenarios/")
def external_keys_scenarios(request: Request, db: Session = Depends(get_db)) -> dict:
    """Keys savollarining tekis banki — UI da to'g'ridan-to'g'ri ro'yxat qilib chiqarish uchun."""
    params = _params(request)
    raw_count = params.get("count") or params.get("question_limit") or params.get("question_count")
    count, err = cc.parse_case_question_limit(raw_count, param_name="count")
    if err:
        raise HTTPException(status_code=400, detail=err)
    shuffle = str(params.get("shuffle") or "").strip().lower() not in ("0", "false", "no")
    lang = _language(params)

    stmt = cc.filter_catalog_stmt(
        cc.published_catalog_stmt().where(PreparedContent.kind == "case"), params
    )
    items = db.execute(stmt).scalars().all()
    if lang:
        infos = el.infos_for(db, list(items))
        scenarios, available, cases_scanned = el.collect_case_scenarios(items, infos, lang, shuffle=shuffle,
                                                                       count=count)
    else:
        scenarios, available, cases_scanned = cc.collect_case_scenarios(items, shuffle=shuffle, count=count)

    body = paginate(scenarios, request, default_page_size=50, max_page_size=200)
    # Qaytarilgan ssenariylarda HAQIQATAN uchraydigan tillar. Bu ro'yxat
    # `SUPPORTED_TEST_LANGUAGES` ning nusxasi EMAS: keys tarjimasi hali
    # yaratilmagan bo'lsa, faqat asl til qaytadi va mijoz shunga qarab
    # o'zbekchaga ongli ravishda qaytadi.
    present_langs: set[str] = set()
    for row in body.get("results") or []:
        present_langs.update((row.get("languages") or {}).keys())
    body["available_languages"] = [c for c in el.FILTER_LANGS if c in present_langs]
    if lang:
        body["language"] = lang
    body.update(
        {
            "subject_code": (params.get("subject_code") or "").strip(),
            "department_code": (params.get("department_code") or "").strip(),
            "variant_label": (params.get("variant_label") or "").strip(),
            "topic_code": (params.get("topic_code") or "").strip().lower(),
            "syllabus_id": (params.get("syllabus_id") or "").strip(),
            "count_requested": count,
            "count_available": available,
            "count_returned": len(scenarios),
            "cases_scanned": cases_scanned,
            "question_limit_bounds": KEYS_QL_BOUNDS,
        }
    )
    return body


@router.get("/external/keys/{pk}/")
def external_key_detail(pk: int, request: Request, db: Session = Depends(get_db)) -> dict:
    params = _params(request)
    raw_limit = params.get("question_limit") or params.get("question_count")
    limit, err = cc.parse_case_question_limit(raw_limit)
    if err:
        raise HTTPException(status_code=400, detail=err)

    lang = _language(params)

    item = db.execute(
        cc.published_catalog_stmt().where(PreparedContent.id == pk, PreparedContent.kind == "case")
    ).scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="Not found.")

    payload_raw = item.payload if isinstance(item.payload, dict) else {}
    info = el.infos_for(db, [item]).get(int(item.id)) or el.analyse(payload_raw, "case")
    if lang:
        # Testlardagi tuzilma (2026-11-17): `topic`/`questions` so'ralgan tilda, asl matn
        # `translations[asl]` da; til yo'q bo'lsa — asl holicha, `language` asl tilni ko'rsatadi.
        projected, used_lang = el.project(payload_raw, info, lang)
        payload, available, returned = cc.slice_test_payload(projected, limit)
    else:
        payload, available, returned = cc.slice_case_payload(payload_raw, limit)
        payload["primaryLanguage"] = info["p"]
        used_lang = info["p"]

    data = cc.catalog_item_summary(item, include_verification=True)
    data.update(el.summary_fields(info))
    sm.apply(data, sm.lookup(db).get(data.get("subject_code") or ""), lang)
    _language_fields(item, info, lang if used_lang == lang else None, data)
    if lang and used_lang == lang:
        payload["topic"] = data["topic"]
    elif lang:
        # Bu tilda yo'q — asl tildagi hujjat; mavzu ham shu tilda bo'lsin va tili aytilsin.
        data["topic"], data["topic_language"] = el.topic_for(item, info, used_lang, data.get("topic"))
    data["payload"] = payload
    data["language"] = used_lang
    data["question_count_available"] = available
    data["question_count_returned"] = returned
    data["question_limit_bounds"] = KEYS_QL_BOUNDS
    if limit is not None:
        data["question_limit"] = limit
    return data


# ---------------- catalog ----------------


@router.get("/external/catalog/stats/")
def external_catalog_stats(db: Session = Depends(get_db)) -> dict:
    body = ec.build_external_catalog_stats(db)
    body["question_limit_bounds"] = QL_BOUNDS
    return body


@router.get("/external/catalog/departments/")
def external_catalog_departments(db: Session = Depends(get_db)) -> dict:
    rows = ec.external_departments_list(db)
    return {
        "count": len(rows),
        "results": rows,
        "next_step": "GET /v1/external/catalog/departments/<department_code>/subjects/",
    }


@router.get("/external/catalog/departments/{department_code}/subjects/")
def external_catalog_department_subjects(department_code: str, db: Session = Depends(get_db)) -> dict:
    exists = db.execute(
        select(AcademicDepartment).where(
            AcademicDepartment.is_active.is_(True), AcademicDepartment.code == department_code.strip()
        )
    ).scalar_one_or_none()
    if exists is None:
        raise HTTPException(status_code=404, detail="Department not found.")
    rows = ec.external_catalog_subjects_for_department(db, department_code)
    return {
        "count": len(rows),
        "results": rows,
        "department": {"code": exists.code, "name": exists.name, "sort_order": exists.sort_order},
        "next_step": "GET /v1/external/catalog/subjects/<subject_code>/",
    }


@router.get("/external/catalog/departments/{department_code}/")
def external_catalog_department_detail(department_code: str, db: Session = Depends(get_db)) -> dict:
    detail = ec.external_department_detail(db, department_code)
    if detail is None:
        raise HTTPException(status_code=404, detail="Not found.")
    return detail


@router.get("/external/catalog/subjects/")
def external_catalog_subjects(request: Request, db: Session = Depends(get_db)) -> dict:
    params = _params(request)
    stmt = ec.filter_external_subjects(ec.active_syllabus_stmt(), params)
    rows_raw = db.execute(stmt).scalars().all()
    rows = []
    for obj in rows_raw:
        summary = ec.external_catalog_subject_summary(obj)
        if summary["topics_count"] > 0:
            rows.append(summary)
    return paginate(rows, request, default_page_size=50, max_page_size=200)


@router.get("/external/catalog/subjects/{subject_code:path}/")
def external_catalog_subject_detail(subject_code: str, db: Session = Depends(get_db)) -> dict:
    code = subject_code.strip()
    obj = db.execute(ec.active_syllabus_stmt().where(CourseSyllabus.subject_code == code)).scalar_one_or_none()
    if obj is None:
        raise HTTPException(status_code=404, detail="Not found.")
    detail = ec.external_catalog_subject_detail(obj)
    if detail["topics_count"] <= 0:
        raise HTTPException(status_code=404, detail="Not found.")
    return detail


@router.post("/external/education-ai/generate-mcq/")
async def external_generate_mcq(request: Request, db: Session = Depends(get_db)) -> dict:
    """Kafedra vektor kitoblaridan AI MCQ (OnlineTest o'qituvchi imtihoni).

    Body JSON: department_name | department_code, subject (fan), count (default 20), language (uz|ru|en).
    """
    import json as _json
    import logging
    import random as _random
    import time as _time

    from fastapi.concurrency import run_in_threadpool

    from app.services.exam_review import review_exam_questions
    from app.services.question_quality import ungradable_flaws

    from app.core.config import get_settings
    from app.services import book_retrieval as rag
    from app.services import openai_client as oai

    try:
        body = await request.json()
    except Exception:
        body = {}
    if not isinstance(body, dict):
        body = {}

    dept_code = str(body.get("department_code") or "").strip()
    dept_name = str(body.get("department_name") or "").strip()
    subject = str(body.get("subject") or body.get("topic") or "").strip()
    lang = str(body.get("language") or body.get("lang") or "uz").strip().lower()[:5]
    if lang not in ("uz", "ru", "en"):
        lang = "uz"
    try:
        count = int(body.get("count") or 20)
    except (TypeError, ValueError):
        count = 20
    count = max(5, min(30, count))

    dept = None
    if dept_code:
        dept = db.execute(
            select(AcademicDepartment).where(AcademicDepartment.code == dept_code)
        ).scalar_one_or_none()
    if dept is None and dept_name:
        dept = db.execute(
            select(AcademicDepartment).where(AcademicDepartment.name.ilike(dept_name))
        ).scalar_one_or_none()
        if dept is None:
            dept = db.execute(
                select(AcademicDepartment).where(AcademicDepartment.name.ilike(f"%{dept_name}%"))
            ).scalars().first()
        if dept is None:
            # Fuzzy: apostrof / "kafedrasi" / token overlap (OnlineTest nomlari farq qiladi)
            import re as _re
            import unicodedata as _ud

            def _norm(s: str) -> str:
                t = _ud.normalize("NFKC", s or "").casefold()
                for ch in ("ʻ", "ʼ", "'", "`", "‘", "’"):
                    t = t.replace(ch, "'")
                for suf in (" kafedrasi", " kafedra"):
                    if t.endswith(suf):
                        t = t[: -len(suf)]
                t = _re.sub(r"[^\w\s]+", " ", t)
                return _re.sub(r"\s+", " ", t).strip()

            qn = _norm(dept_name)
            qtok = {w for w in qn.split() if len(w) > 2}
            best = None
            best_score = 0.0
            for row in db.execute(select(AcademicDepartment)).scalars().all():
                cn = _norm(str(row.name or ""))
                if not cn:
                    continue
                if qn == cn:
                    best, best_score = row, 1000.0
                    break
                if qn in cn or cn in qn:
                    sc = 800.0 + min(len(qn), len(cn))
                else:
                    ctok = {w for w in cn.split() if len(w) > 2}
                    if not qtok or not ctok:
                        continue
                    inter = qtok & ctok
                    if not inter:
                        continue
                    cov = len(inter) / len(qtok)
                    j = len(inter) / len(qtok | ctok)
                    if cov < 0.45 and j < 0.35:
                        continue
                    sc = 400.0 * cov + 200.0 * j
                if sc > best_score:
                    best, best_score = row, sc
            if best is not None and best_score >= 200:
                dept = best
    if dept is None:
        raise HTTPException(status_code=404, detail="Department not found.")

    topic = subject or dept_name or dept.name or "kafedra asosiy fanlari"
    chunks = rag.retrieve_book_context_by_department_id(db, int(dept.id), topic, top_k=16)
    context_message = rag.format_book_context_message(chunks)
    # Kitob yo'q bo'lsa ham AI (fan bo'yicha) — imtihon kuni bo'sh qolmasin.
    allow_no_books = True
    if not context_message and not allow_no_books:
        raise HTTPException(
            status_code=404,
            detail="Bu kafedra uchun vektorlashtirilgan kitob topilmadi.",
        )


    settings = get_settings()
    api_key = (settings.openai_api_key or "").strip()
    if not api_key:
        raise HTTPException(status_code=503, detail="OpenAI API kaliti sozlanmagan.")

    lang_name = {"uz": "o'zbek", "ru": "rus", "en": "english"}.get(lang, "o'zbek")
    system = (
        "Siz tibbiyot universiteti PROFESSOR-O'QITUVCHILARI bilimini baholovchi "
        "USMLE Step 2 CK / Step 3 va KROK-2 darajasidagi MCQ ekspertisiz. "
        "Auditoriyя: 1–2 kurs talabasi EMAS — kafedra o'qituvchilari. "
        "FAQAT berilgan darslik/kitob parchalariga tayaning; uydirma manba yozilmasin. "
        "HAR SAVOL: uzun klinik vignette (anamnez, yosh/jins, shikoyatlar, fizikal topilmalar, "
        "vital belgilar, laboratoriya/vizualizatsiya qiymatlari bilan); "
        "keyin aniq klinik qaror / differensial / mexanizm / davo tanlovi. "
        "QISQA yoki oddiy fakt-eslatma savollari TAQIQLANADI. "
        "5 ta variant: bitta to'g'ri, qolganlari ishonchli chalg'ituvchilar (yaqin differensial). "
        "explanation: 2–4 jumla, nima uchun to'g'ri va nima uchun boshqalar noto'g'ri. "
        f"Javob FAQAT JSON: {{questions:[{{id,text,options:[5 string],correctIndex:0-4,explanation}}]}}. "
        f"Til: {lang_name}."
    )
    user_msg = (
        f"{count} ta NOYOB, QIYIN, BATAFSIL MCQ yarating.\n"
        f"Kafedra: {dept.name}\n"
        f"FAN (majburiy mavzu doirasi): {topic}\n"
        "Talablar:\n"
        "- Har stem kamida 4–8 jumla / boy klinik kontekst\n"
        "- Faqat shu FAN bo'yicha; boshqa fanlarga chiqilmasin\n"
        "- Oliy tibbiy ta'lim / o'qituvchi kompetentsiyasi (farmakokinetika, "
        "patofiziologiya, murakkab differensial, guidelines)\n"
        "- Maktab/kollej yoki 1-kurs 'ta'rif bering' uslubi YO'Q\n"
        "- Variantlar bir xil uzunlikda, 'hammasi to'g'ri' uslubi YO'Q"
    )
    messages = []
    if context_message:
        messages.append({"role": "system", "content": context_message})
    else:
        system = (
            system
            + " Kitob parchasi YO'Q — umumiy tibbiy ekspert bilimiga tayaning;"
            + " uydirma manba/iqtibos yozmang; faqat shu FAN doirasida."
        )
    messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": user_msg})


    try:
        db.close()
    except Exception:
        pass

    started = _time.monotonic()
    try:
        # Bloklovchi so'rov — threadpool'da: aks holda worker daqiqalab band bo'lardi.
        content = await run_in_threadpool(
            oai.generate_openai_chat,
            api_key,
            messages=messages,
            # Imtihon savoli — yozish modeli test bilan bir xil, tekshiruvchi kuchliroq (pastda).
            model=oai.model_for("exam_generate"),
            # Ko'p modellarda completion limi 16k — 20×1100=22k yiqilardi.
            max_tokens=min(16000, max(4000, count * 750 + 600)),
            temperature=0.45,
            timeout_sec=280,
            response_format={"type": "json_object"},
            usage_kind="external_mcq",
        )
    except oai.OpenAiClientError as e:
        raise HTTPException(status_code=502, detail=str(e))

    try:
        parsed = _json.loads(content)
    except Exception:
        raise HTTPException(status_code=502, detail="AI JSON parse xato")

    raw_qs = parsed.get("questions") if isinstance(parsed, dict) else None
    if not isinstance(raw_qs, list) or not raw_qs:
        raise HTTPException(status_code=502, detail="AI savollar qaytarmadi")

    candidates = []
    for q in raw_qs[:count]:
        if not isinstance(q, dict):
            continue
        opts = q.get("options") or q.get("choices") or []
        if not isinstance(opts, list):
            continue
        opts = [str(o).strip() for o in opts][:5]
        while len(opts) < 5:
            opts.append("")
        try:
            ci = int(q.get("correctIndex", q.get("correct_index", q.get("correct", 0))) or 0)
        except (TypeError, ValueError):
            ci = 0
        ci = max(0, min(4, ci))
        text = str(q.get("text") or q.get("question") or "").strip()
        if not text:
            continue
        # Bir xil / bo'sh variantli savol imtihonga berilmaydi.
        if ungradable_flaws(opts):
            continue
        candidates.append(
            {"text": text, "options": opts, "correctIndex": ci, "explanation": str(q.get("explanation") or "").strip()}
        )

    # Yakuniy imtihon — kuchli tekshiruvchi (`exam_review`, standart gpt-5.4).
    # nginx 300 s da uzadi: vaqt qolmagan bo'lsa tekshiruvsiz beriladi.
    review_budget = int(EXAM_RESPONSE_BUDGET_SEC - (_time.monotonic() - started))
    if review_budget >= EXAM_REVIEW_MIN_SEC:
        candidates = await run_in_threadpool(
            review_exam_questions,
            api_key,
            candidates,
            subject=topic,
            department=dept.name,
            lang_name=lang_name,
            timeout_sec=review_budget,
        )
    else:
        logging.getLogger(__name__).warning("EXAM_REVIEW_SKIPPED: generatsiyadan keyin %ss qoldi", review_budget)

    out = []
    for i, q in enumerate(candidates):
        opts, ci = q["options"], q["correctIndex"]
        # Model to'g'ri javobni ko'pincha A ga qo'yadi — aralashtiramiz.
        order = list(range(len(opts)))
        _random.shuffle(order)
        opts = [opts[k] for k in order]
        ci = order.index(ci)
        out.append(
            {
                "id": i + 1,
                "text": q["text"],
                "options": opts,
                "correctIndex": ci,
                "explanation": q["explanation"],
                "source": "imentor_faculty_ai_books",
                "department_code": dept.code,
                "department_name": dept.name,
                "subject": topic,
            }
        )

    if len(out) < max(5, count // 2):
        raise HTTPException(status_code=502, detail="AI yetarli savol qaytarmadi")

    return {
        "count": len(out),
        "department": {"id": dept.id, "code": dept.code, "name": dept.name},
        "chunks_used": len(chunks),
        "questions": out,
    }
