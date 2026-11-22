from __future__ import annotations

import logging
import os
from typing import Literal

import datetime as dt

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import AuthContext, require_roles
from app.core.db import get_db
from app.core.throttling import throttle_translate
from app.services.prepared_translation import (
    TRANSLATABLE_KINDS,
    merge_on_update,
    missing_languages,
    translate_in_background,
    translate_saved_content,
)
from app.models.content import CourseSyllabus, StaffCourseSelection
from app.models.prepared_content import KIND_CASE, KIND_TEST, PreparedContent
from app.schemas.prepared_content import (
    PreparedContentIn,
    PreparedContentLatestOut,
    PreparedContentOut,
    PreparedContentPayloadIn,
    PreparedContentSummaryOut,
    TranslationReviewIn,
)
from app.services.case_i18n import without_stale_translations
from app.services.live_test_service import MIN_LIVE_TEST_QUESTIONS
from app.services.json_sanitize import clean_json
from app.services import case_pool
from app.services import content_heading_guard as heading_guard
from app.services import content_catalog as cc
from app.services import question_pool
from app.services import refusal_guard
from app.services import translation_review
from app.services import syllabus_access as access
from app.services import topic_norm as tn
from app.services.pagination import paginate

logger = logging.getLogger(__name__)

router = APIRouter()

#: Saqlangach qolgan tillarga darhol fonda tarjima. Sukut — O'CHIQ (2026-10-21):
#: tarjima o'sha tilni kimdir ochganda qilinadi. `.env`: IMENTOR_EAGER_TRANSLATION=1.
EAGER_TRANSLATION = (os.environ.get("IMENTOR_EAGER_TRANSLATION") or "").strip() in ("1", "true", "yes")

STAFF_ROLES = ("admin", "klinika_admin", "hodim")
# Ma'ruza matni va taqdimot — shu fan/mavzuni o'tadigan barcha o'qituvchilarga
# umumiy. Keys/test esa faqat muallifnikida qoladi.
SHARED_KINDS = frozenset({"lecture", "presentation"})


def _is_privileged(auth: AuthContext) -> bool:
    return auth.role in ("admin", "klinika_admin")


def _syllabus_id_from_norm(topic_norm: str) -> int | None:
    raw = cc.parse_topic_norm(topic_norm).get("syllabus_id") or ""
    if not raw:
        head = (topic_norm or "").split("::", 1)[0].strip()
        raw = head if head.isdigit() else ""
    try:
        sid = int(raw)
    except (TypeError, ValueError):
        return None
    return sid or None


def _existing_syllabus_id(db: Session, sid: int | None) -> int | None:
    """Sillabus katalogi qayta import qilinganda eski id'lar yo'qoladi, lekin
    o'qituvchining brauzeridagi `topic_norm` hamon eski id bilan keladi.
    O'sha id'ni tekshirmasdan yozsak FK buziladi va tayyor bo'lgan test/keys
    butunlay yo'qoladi. Topilmasa NULL qoldiramiz — ustun nullable va
    yozuvlarning katta qismi allaqachon shunday saqlangan."""
    if not sid:
        return None
    return db.execute(
        select(CourseSyllabus.id).where(CourseSyllabus.id == sid)
    ).scalar_one_or_none()


def _taught_syllabus_ids(db: Session, auth: AuthContext) -> set[int]:
    rows = db.execute(
        select(StaffCourseSelection.syllabus_id).where(
            StaffCourseSelection.owner_key == auth.user.username
        )
    ).scalars().all()
    # O'zi yuklagan fanlar ham — ro'yxatdan chiqarib qo'yilgan bo'lsa ham.
    own = db.execute(
        select(CourseSyllabus.id).where(
            CourseSyllabus.created_by == auth.user.username, CourseSyllabus.is_active.is_(True)
        )
    ).scalars().all()
    return {int(sid) for sid in [*rows, *own] if sid}


def _teaches_syllabus(db: Session, auth: AuthContext, syllabus_id: int | None) -> bool:
    if _is_privileged(auth):
        return True
    if not syllabus_id:
        return False
    # Fan egasi (Excel'dan o'zi yuklagan) ro'yxatdan chiqarib qo'ygan bo'lsa ham
    # o'z fanidagi umumiy ma'ruza/taqdimotni ko'raveradi.
    if access.is_subject_owner(db, syllabus_id, auth.user.username):
        return True
    return syllabus_id in _taught_syllabus_ids(db, auth)


def _can_view_item(item: PreparedContent, db: Session, auth: AuthContext) -> bool:
    if item.owner_key == auth.user.username:
        return True
    sid = item.syllabus_id or _syllabus_id_from_norm(item.topic_norm)
    # Fan egasi o'z fanidagi har qanday kontentni ko'radi va boshqaradi.
    if access.is_subject_owner(db, sid, auth.user.username):
        return True
    # Yopiq (shaxsiy) fanga begona — hatto klinika_admin ham — kirmaydi.
    if not access.can_access_syllabus(db, sid, auth.user.username, auth.role):
        return False
    if item.kind not in SHARED_KINDS:
        return False
    if _is_privileged(auth):
        return True
    return _teaches_syllabus(db, auth, sid)


def _topic_lookup_filter(
    wanted_norms: list[str],
    syllabus_id: int | None = None,
    topic_code: str = "",
    variant_label: str = "",
    db: Session | None = None,
):
    """Ma'ruza kaliti: aniq topic_norm YOKI shu fan + mavzu kodi.

    Semestr variantlari bor sillabusda (2026-10-23) kod bilan birga variant ham mos bo'lishi
    kerak: 9- va 10-semestrda ikkalasida ham "L1" bor va 9-semestr L1 sahifasida 10-semestr
    ma'ruzasi ochilib, tahrir ham o'sha yozuvga tushardi. Bitta variantli sillabusda — eskicha.
    """
    from app.services.content_bank import _variant_ok

    clauses = []
    norms: set[str] = set()

    def add_structured(sid: int, variant: str, code: str) -> None:
        if not sid or not code:
            return
        for alias in tn.structured_aliases(sid, variant, code):
            if alias:
                norms.add(alias)
        same_variant = _variant_ok(db, sid, variant) if db is not None else None
        clauses.append(
            and_(
                PreparedContent.syllabus_id == sid,
                func.lower(PreparedContent.topic_code) == code[:32],
                *((same_variant,) if same_variant is not None else ()),
            )
        )

    for raw in wanted_norms:
        w = (raw or "").strip().lower()
        if not w:
            continue
        norms.add(w)
        parsed = cc.parse_topic_norm(w)
        sid = 0
        try:
            sid = int(parsed.get("syllabus_id") or 0)
        except (TypeError, ValueError):
            sid = 0
        if not sid:
            sid = _syllabus_id_from_norm(w) or 0
        code = (parsed.get("topic_code") or "").strip().lower().replace(" ", "")
        if not code:
            parts = w.split("::")
            code = parts[-1].strip() if len(parts) >= 3 else ""
        variant = (parsed.get("variant_label") or variant_label or "").strip()
        add_structured(sid, variant, code)

    code_q = (topic_code or "").strip().lower().replace(" ", "")
    if syllabus_id and code_q:
        add_structured(int(syllabus_id), variant_label, code_q)

    if norms:
        clauses.append(PreparedContent.topic_norm.in_(list(norms)))
    if not clauses:
        return None
    return or_(*clauses)


def _can_change_item(item: PreparedContent, auth: AuthContext) -> bool:
    """O'zgartirish va o'chirish — faqat muallif yoki admin.

    2026-10-07: ilgari fan egasi o'chira, shu fanni o'tadigan o'qituvchi esa
    ma'ruza/taqdimotni ustidan yozib saqlay olardi. Bitta fanni o'zbek va rus
    guruhlarida o'tadigan o'qituvchilar bir-birining materialini almashtirib
    yoki o'chirib yuborardi.
    """
    return item.owner_key == auth.user.username or auth.role == "admin"


def _summary(item: PreparedContent, auth: AuthContext) -> dict:
    return PreparedContentSummaryOut(
        id=item.id,
        kind=item.kind,
        topic=item.topic,
        topic_norm=item.topic_norm,
        subject_name=item.subject_name,
        author_display_name=item.author_display_name or "",
        created_at=item.created_at,
        can_delete=_can_change_item(item, auth),
        retired_reason=getattr(item, "retired_reason", "") or "",
    ).model_dump()


@router.get("/prepared-content/question-pool/")
def prepared_question_pool(
    syllabus_id: int,
    topic_code: str,
    variant: str = "",
    language: Literal["uz", "ru", "en"] = "uz",
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles(*STAFF_ROLES)),
) -> dict:
    """Test uchun: o'tilgan/o'tilmagan mavzular va shu mavzuda avval yaratilgan
    savollar zaxirasi (`question_pool`, 2026-10-21). `{pk}` yo'lidan OLDIN turadi."""
    if not access.can_access_syllabus(db, syllabus_id, auth.user.username, auth.role):
        raise HTTPException(status_code=404, detail="Topilmadi.")
    out = question_pool.pool(db, syllabus_id=syllabus_id, variant=variant, topic_code=topic_code,
                             language=language, owner_key=auth.user.username)
    # Claude banki tayyorlanmoqda bo'lsa (2026-11-20) — brauzer OpenAI'ni chaqirmay kutadi.
    out["bank_pending_until"] = question_pool.bank_pending_until(db, syllabus_id, topic_code, out)
    return out


@router.get("/prepared-content/case-pool/")
def prepared_case_pool(
    syllabus_id: int | None = None,
    topic_code: str = "",
    subject_code: str = "",
    topic_norm: str = "",
    title: str = "",
    language: Literal["uz", "ru", "en"] = "uz",
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles(*STAFF_ROLES)),
) -> dict:
    """Keys uchun: shu mavzuda boshqa o'qituvchilar avval yaratgan keyslar
    (`case_pool`, 2026-10-22). `{pk}` yo'lidan OLDIN turadi."""
    if syllabus_id and not access.can_access_syllabus(db, syllabus_id, auth.user.username, auth.role):
        raise HTTPException(status_code=404, detail="Topilmadi.")
    return case_pool.pool(db, syllabus_id=syllabus_id, topic_code=topic_code.strip(),
                          subject_code=subject_code.strip(), topic_norm=topic_norm.strip().lower(),
                          language=language, owner_key=auth.user.username, title=title.strip()[:300])


@router.get("/prepared-content/bank/")
def prepared_content_bank(
    kind: Literal["lecture", "presentation"],
    title: str = "",
    syllabus_id: int | None = None,
    topic_code: str = "",
    language: Literal["uz", "ru", "en"] = "uz",
    variant_label: str = Query(default="", max_length=128),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles(*STAFF_ROLES)),
) -> dict:
    """Shu mavzuga institutdagi tayyor ma'ruza/taqdimot (2026-10-22, "bir mavzuga bir marta"):
    avval o'qituvchining o'zi, keyin hamkasbi, keyin o'xshash nomli mavzu. Topilmasa —
    `{"item": null}` va AI yozadi. `{pk}` yo'lidan OLDIN turadi."""
    if syllabus_id and not access.can_access_syllabus(db, syllabus_id, auth.user.username, auth.role):
        raise HTTPException(status_code=404, detail="Topilmadi.")
    from app.services import content_bank

    item = content_bank.bank_item(db, kind=kind, syllabus_id=syllabus_id, topic_code=topic_code.strip(),
                                  title=title.strip()[:300], language=language, owner_key=auth.user.username,
                                  variant=variant_label.strip(), role=auth.role)
    return {"item": item}


@router.get("/prepared-content/mine/")
def list_my_prepared_content(
    request: Request,
    kind: str,
    topic_norm: list[str] = Query(default=[]),
    shared: bool = Query(default=False),
    syllabus_id: int | None = Query(default=None),
    topic_code: str = Query(default=""),
    variant_label: str = Query(default=""),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles(*STAFF_ROLES)),
) -> dict:
    """Saqlangan yozuvlar ro'yxati — faqat joriy o'qituvchiniki.

    2026-09-24: ilgari `shared=1` bilan ma'ruza matni va taqdimot shu fanni
    o'tadigan BARCHA o'qituvchiga ko'rinardi. Endi har kim faqat o'zinikini
    ko'radi; admin (va klinika admini) nazorat uchun hammasini ko'radi.
    Ochiq kutubxona (katalog) bundan mustasno — u yerga o'qituvchi o'zi chiqaradi.
    """
    if not kind.strip():
        raise HTTPException(status_code=400, detail="kind majburiy.")
    kind_value = kind.strip()
    wanted = [t.strip().lower() for t in topic_norm if t and t.strip()]
    lookup = _topic_lookup_filter(wanted, syllabus_id, topic_code, variant_label, db=db)

    if shared:
        if kind_value not in SHARED_KINDS:
            raise HTTPException(status_code=400, detail="shared faqat lecture/presentation uchun.")
        if lookup is None:
            raise HTTPException(status_code=400, detail="shared=1 uchun topic_norm yoki syllabus_id+topic_code kerak.")
        stmt = select(PreparedContent).where(PreparedContent.kind == kind_value, lookup)
        if not _is_privileged(auth):
            stmt = stmt.where(PreparedContent.owner_key == auth.user.username)
    else:
        stmt = select(PreparedContent).where(
            PreparedContent.owner_key == auth.user.username,
            PreparedContent.kind == kind_value,
        )
        if lookup is not None:
            stmt = stmt.where(lookup)

    rows = db.execute(stmt.order_by(PreparedContent.created_at.desc())).scalars().all()
    out = [_summary(r, auth) for r in rows]
    return paginate(out, request, default_page_size=100, max_page_size=300)


@router.get("/prepared-content/{pk}/")
def get_prepared_content_by_id(
    pk: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles(*STAFF_ROLES)),
) -> PreparedContentOut:
    """Bitta yozuvni to'liq payload bilan olish."""
    item = db.execute(
        select(PreparedContent).where(PreparedContent.id == pk)
    ).scalar_one_or_none()
    if item is None or not _can_view_item(item, db, auth):
        raise HTTPException(status_code=404, detail="Topilmadi.")
    return _out(item)


def _out(item: PreparedContent) -> PreparedContentOut:
    return PreparedContentOut(
        id=item.id,
        owner_key=item.owner_key,
        kind=item.kind,
        topic=item.topic,
        topic_norm=item.topic_norm,
        author_display_name=item.author_display_name,
        subject_name=item.subject_name,
        subject_code=item.subject_code,
        variant_label=item.variant_label,
        topic_code=item.topic_code,
        payload=without_stale_translations(item.payload),
        created_at=item.created_at,
    )


@router.get("/prepared-content/", response_model=PreparedContentLatestOut)
def get_latest_prepared_content(
    kind: str,
    topic_norm: str = "",
    syllabus_id: int | None = Query(default=None),
    topic_code: str = Query(default=""),
    variant_label: str = Query(default=""),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles(*STAFF_ROLES)),
) -> PreparedContentLatestOut:
    if not kind.strip():
        raise HTTPException(status_code=400, detail="kind majburiy.")
    kind_value = kind.strip()
    wanted = [topic_norm.strip().lower()] if topic_norm.strip() else []
    lookup = _topic_lookup_filter(wanted, syllabus_id, topic_code, variant_label, db=db)
    if lookup is None:
        raise HTTPException(status_code=400, detail="kind, topic_norm yoki syllabus_id+topic_code kerak.")
    stmt = select(PreparedContent).where(
        PreparedContent.kind == kind_value,
        lookup,
        # Eskirgan material mavzu ochilganda avtomatik yuklanmaydi — o'qituvchi
        # yangisini yaratadi va u endi to'g'ri domenda yoziladi (2026-09-25).
        PreparedContent.retired_reason == "",
    )
    # Har kim faqat o'zinikini ochadi; admin nazorat uchun hammasini ko'radi (2026-09-24).
    if not _is_privileged(auth):
        stmt = stmt.where(PreparedContent.owner_key == auth.user.username)
    item = db.execute(
        stmt.order_by(PreparedContent.created_at.desc()).limit(1)
    ).scalar_one_or_none()
    if item is None:
        return PreparedContentLatestOut(payload=None)
    return PreparedContentLatestOut(payload=without_stale_translations(item.payload))


def _reject_empty_test(kind: str, payload: object) -> None:
    """Savolsiz test saqlanmaydi: undan jonli sessiya ochib bo'lmaydi va
    o'qituvchi tushunarsiz "Sessiyani boshlab bo'lmadi"ni ko'radi (2026-10-13)."""
    if kind != "test":
        return
    questions = payload.get("questions") if isinstance(payload, dict) else None
    if not isinstance(questions, list) or not questions:
        raise HTTPException(status_code=422, detail="Testda savol yo'q — qayta yarating.")


def _reject_short_test(kind: str, payload: object) -> None:
    """YANGI test kamida 10 savol bilan saqlanadi (talab, 2026-10-16).

    Faqat yaratishda: eski, kam savolli yozuvlarning tarjimasi yoki manbasi
    yangilanganda (PATCH) ular to'xtatilmaydi.
    """
    if kind != "test":
        return
    questions = payload.get("questions") if isinstance(payload, dict) else None
    if isinstance(questions, list) and 0 < len(questions) < MIN_LIVE_TEST_QUESTIONS:
        raise HTTPException(
            status_code=422,
            detail=f"Testda kamida {MIN_LIVE_TEST_QUESTIONS} ta savol bo'lishi kerak — qayta yarating.",
        )


def _reject_refusal(kind: str, payload: object) -> None:
    """AI rad javobi ("parcha yuboring") ma'ruza yoki taqdimot bo'lib saqlanmaydi."""
    if kind == "lecture" and isinstance(payload, dict):
        if refusal_guard.lecture_is_refusal(str(payload.get("content") or "")):
            raise HTTPException(
                status_code=422,
                detail="Ma'ruza matni yaratilmadi: AI ma'ruza o'rniga savol qaytardi. Sahifani yangilab, qayta yarating.",
            )
    elif kind == "presentation" and refusal_guard.deck_is_refusal(payload):
        raise HTTPException(
            status_code=422,
            detail="Taqdimot yaroqsiz ma'ruza matnidan yasalgan. Sahifani yangilab, qayta yarating.",
        )


def _test_awaiting_enrichment(kind: str, payload: object) -> bool:
    """Test birinchi marta variant izohlarisiz saqlanadi; izohlar fonda qo'shilib,
    PATCH bilan qayta yoziladi (`TestQuestions.tsx`). Izohlar ham tarjima qilinadi,
    shuning uchun POST dagi tarjima PATCH dan keyin eskirib, bekorga ketardi —
    test PATCH dan keyin bir marta tarjima qilinadi (2026-10-20)."""
    if kind != KIND_TEST or not isinstance(payload, dict):
        return False
    questions = [q for q in payload.get("questions") or [] if isinstance(q, dict)]
    return bool(questions) and not any(q.get("optionExplanations") for q in questions)


@router.post("/prepared-content/", response_model=PreparedContentOut, status_code=status.HTTP_201_CREATED)
def create_prepared_content(
    payload: PreparedContentIn,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles(*STAFF_ROLES)),
) -> PreparedContentOut:
    _reject_empty_test(payload.kind, payload.payload)
    _reject_short_test(payload.kind, payload.payload)
    _reject_refusal(payload.kind, payload.payload)
    topic_norm = (payload.topic_norm or "").strip().lower() or payload.topic.lower()

    syllabus = None
    subject_name = payload.subject_name
    subject_code = payload.subject_code.strip()
    if subject_code:
        syllabus = db.execute(
            select(CourseSyllabus).where(CourseSyllabus.subject_code == subject_code)
        ).scalar_one_or_none()
        if syllabus:
            subject_name = syllabus.subject_name
            subject_code = subject_code or syllabus.subject_code

    variant_label = payload.variant_label.strip()
    topic_code = payload.topic_code.strip()
    if not variant_label or not topic_code:
        parsed = cc.parse_topic_norm(topic_norm)
        variant_label = variant_label or parsed.get("variant_label", "")
        topic_code = topic_code or parsed.get("topic_code", "")

    if topic_code:
        sid = syllabus.id if syllabus else 0
        if not sid:
            try:
                sid = int(cc.parse_topic_norm(topic_norm).get("syllabus_id") or 0)
            except ValueError:
                sid = 0
        if sid:
            rebuilt = tn.build_topic_norm(sid, variant_label, topic_code)
            if rebuilt:
                topic_norm = rebuilt

    # Begona o'qituvchining yopiq (shaxsiy) faniga kontent biriktirilmaydi —
    # u egasining "umumiy ma'ruza" ro'yxatiga tushib qolardi.
    target_sid = syllabus.id if syllabus else _syllabus_id_from_norm(topic_norm)
    if not access.can_access_syllabus(db, target_sid, auth.user.username, auth.role):
        raise HTTPException(status_code=404, detail="Fan topilmadi.")

    clean_payload = clean_json(payload.payload)
    # Ruscha/inglizcha ma'ruza yoki taqdimot sarlavhasi o'zbekcha bo'lsa — fan tarjimasidan (2026-11-12).
    try:
        heading_syllabus = syllabus or (db.get(CourseSyllabus, target_sid) if target_sid else None)
        clean_payload, fixed = heading_guard.fix_heading(payload.kind, clean_payload, heading_syllabus, payload.topic)
        if fixed:
            logger.info("prepared-content: %s sarlavhasi %s tiliga almashtirildi", payload.kind, clean_payload.get("primaryLanguage"))
    except Exception:  # noqa: BLE001 — saqlash hech qachon to'xtamasin
        logger.warning("prepared-content: sarlavha tekshiruvi bajarilmadi", exc_info=True)

    obj = PreparedContent(
        owner_key=auth.user.username[:128],
        kind=payload.kind[:32],
        # DB ustunlari (Django bilan bir xil sxema) VARCHAR(255)/(128)/(64) —
        # mavzu nomlari juda uzun bo'lishi mumkin (masalan, ko'p qatorli
        # sarlavhalar), shuning uchun DB xatosiga olib kelmasligi uchun
        # kesib qo'yiladi (Django DRF ham xuddi shu max_length'larga
        # validatsiya qiladi).
        topic=payload.topic[:255],
        topic_norm=topic_norm[:255],
        # Muallif: frontend yubormasa ham, server foydalanuvchini biladi —
        # Baza ro'yxatida "kim yaratgan" doim ko'rinishi kerak.
        author_display_name=(
            payload.author_display_name.strip()
            or f"{auth.user.first_name} {auth.user.last_name}".strip()
            or auth.user.username
        )[:128],
        subject_name=subject_name[:255],
        subject_code=subject_code[:64],
        variant_label=variant_label[:128],
        topic_code=topic_code[:32],
        syllabus_id=(
            syllabus.id
            if syllabus
            else _existing_syllabus_id(db, _syllabus_id_from_norm(topic_norm))
        ),
        # Nol belgisi bo'lsa jsonb butun so'rovni rad etadi — tozalab yoziladi.
        payload=clean_payload,
        created_at=dt.datetime.now(dt.timezone.utc),
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)

    # Fon tarjimasi faqat EAGER_TRANSLATION yoqilganda (2026-10-21, xarajat):
    # har saqlangan material 2 tilga o'girilardi, ko'pini hech kim o'sha tilda
    # ochmasdi — kuniga ~13 000 AI chaqiruvi. Endi til so'ralganda o'giriladi
    # (`translate_prepared_content`, frontend "Tarjima qilinmoqda…" ko'rsatadi).
    if EAGER_TRANSLATION and obj.kind in TRANSLATABLE_KINDS and not _test_awaiting_enrichment(obj.kind, obj.payload):
        background.add_task(translate_in_background, obj.id)
    return _out(obj)


@router.post("/prepared-content/{pk}/translate/{lang}/", response_model=PreparedContentOut)
def translate_prepared_content(
    pk: int,
    lang: Literal["uz", "ru", "en"],
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles(*STAFF_ROLES)),
    _: None = Depends(throttle_translate),
) -> PreparedContentOut:
    item = db.get(PreparedContent, pk)
    if item is None or not _can_view_item(item, db, auth):
        raise HTTPException(status_code=404, detail="Topilmadi.")
    if item.kind not in TRANSLATABLE_KINDS:
        raise HTTPException(status_code=400, detail="This material type cannot be translated.")
    # Ruxsat yuqorida, AYNAN shu yozuv uchun tekshirilgan. Ikkinchi marta
    # tekshirib bo'lmaydi: tarjima paytida bazaga ulanish yopiladi
    # (`db.close()`), `auth.user` sessiyadan uziladi va undan o'qish
    # DetachedInstanceError -> 500 berardi (2026-10-12 jurnalida).
    return _out(translate_saved_content(db, item, lang))


@router.post("/prepared-content/{pk}/translation-review/{lang}/", response_model=PreparedContentOut)
def review_prepared_translation(
    pk: int,
    lang: Literal["uz", "ru", "en"],
    body: TranslationReviewIn,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles(*STAFF_ROLES)),
) -> PreparedContentOut:
    """O'qituvchi tarjimani tekshirib tasdiqlaydi (yoki tasdiqni bekor qiladi) — 2026-11-17.

    Tashqi API (fermi.uz) `translated_by` ni shundan oladi: tasdiqlanmagan tarjima saytda "AI tarjimasi"
    belgisi bilan chiqadi.
    """
    item = db.execute(
        select(PreparedContent).where(PreparedContent.id == pk).with_for_update(of=PreparedContent)
    ).scalar_one_or_none()
    if item is None or not _can_view_item(item, db, auth):
        raise HTTPException(status_code=404, detail="Topilmadi.")
    if not _can_change_item(item, auth):
        raise HTTPException(status_code=403, detail="Faqat muallif yoki admin tasdiqlay oladi.")
    if item.kind not in (KIND_TEST, KIND_CASE):
        raise HTTPException(status_code=400, detail="Faqat test va keys tarjimasi tasdiqlanadi.")
    payload = without_stale_translations(item.payload) if isinstance(item.payload, dict) else {}
    if lang == payload.get("primaryLanguage") or not isinstance((payload.get("translations") or {}).get(lang), dict):
        raise HTTPException(status_code=400, detail="Bu tilda tarjima yo'q.")
    item.payload = translation_review.mark(
        dict(item.payload), lang, "reviewed" if body.reviewed else "ai", by=auth.user.username
    )
    db.commit()
    db.refresh(item)
    return _out(item)


@router.patch("/prepared-content/{pk}/", response_model=PreparedContentOut)
def update_prepared_content_payload(
    pk: int,
    body: PreparedContentPayloadIn,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles(*STAFF_ROLES)),
) -> PreparedContentOut:
    """Yozuvning payload'ini almashtirish — faqat muallif yoki admin."""
    item = db.execute(
        select(PreparedContent).where(PreparedContent.id == pk)
    ).scalar_one_or_none()
    if item is None or not _can_view_item(item, db, auth):
        raise HTTPException(status_code=404, detail="Topilmadi.")
    if not _can_change_item(item, auth):
        raise HTTPException(status_code=403, detail="Faqat muallif yoki admin o'zgartira oladi.")
    # Asosiy matn tahrirlangan-u, tarjimalar o'shaligicha qolgan bo'lsa — ular eskirgan:
    # olib tashlanadi; kerakli til tanlanganda qayta tarjima qilinadi (aks holda ruscha nusxa eski matnni ko'rsatardi).
    _reject_empty_test(item.kind, body.payload)
    item.payload = merge_on_update(item.kind, item.payload, body.payload, by=auth.user.username)
    db.commit()
    db.refresh(item)
    # Matn o'zgargan bo'lsa eskirgan tillar olib tashlangan; qayta tarjima —
    # shu til so'ralganda (yoki EAGER_TRANSLATION yoqilsa, fonda).
    if EAGER_TRANSLATION and missing_languages(item):
        background.add_task(translate_in_background, item.id)
    return _out(item)


@router.delete("/prepared-content/{pk}/", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def delete_prepared_content(
    pk: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles(*STAFF_ROLES)),
) -> None:
    item = db.execute(
        select(PreparedContent).where(PreparedContent.id == pk)
    ).scalar_one_or_none()
    if item is None or not _can_view_item(item, db, auth):
        raise HTTPException(status_code=404, detail="Topilmadi.")
    if not _can_change_item(item, auth):
        raise HTTPException(status_code=403, detail="O'chirish uchun ruxsat yo'q.")
    db.delete(item)
    db.commit()
