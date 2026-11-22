"""Mavzular bo'yicha material qamrovi (`teacher_activity_service` ishlatadi).

Qaysi sillabus mavzusida taqdimot, video yoki tarqatma bor. (Kafedra kesimi,
kamchiliklar va dinamika hisobotlari 2026-11-17 da olib tashlandi — ularni
hech qaysi sahifa ochmasdi.)

Material mavzuga `topic_norm` orqali bog'lanadi: `{sillabus_id}::{variant}::{kod}`
(masalan `2568::asosiy::l1`). Shakl tarqatma, video, taqdimot va tayyor
materialda bir xil, shuning uchun qamrov bitta guruhlangan so'rov bilan
yig'iladi — 481 sillabus va o'n minglab material bo'lsa ham so'rovlar soni
o'zgarmaydi.
"""

from __future__ import annotations

from sqlalchemy import Integer, cast, func, literal, select
from sqlalchemy.orm import Session

from app.models.content import CourseSyllabus
from app.models.prepared_content import PreparedContent
from app.models.topic_content import TopicHandout, TopicPresentation, TopicVideo

# Rektor hisobotida faqat darsdan oldin yuklanishi kerak bo'lgan materiallar
# kamchilik sifatida ko'rsatiladi. Ma'ruza matni, vaziyatli masala va testlar
# dars jarayonida generatsiya qilinadi, shuning uchun qamrov tanqisligiga kirmaydi.
COVERAGE_KINDS = ("presentation", "video", "handout")

def _sid_expr(column):
    """`topic_norm` ning birinchi bo'lagi — sillabus id (faqat raqamli yozuvlar)."""
    return cast(func.split_part(column, "::", 1), Integer)


def _code_expr(column):
    """Uchinchi bo'lak — mavzu kodi."""
    return func.lower(func.split_part(column, "::", 3))


def _variant_expr(column):
    """Ikkinchi bo'lak — yo'nalish (semestr) yorlig'i."""
    return func.lower(func.split_part(column, "::", 2))


def _structured(column):
    # Eski yozuvlarda `topic_norm` sarlavhaning o'zi bo'lishi mumkin —
    # ular mavzuga bog'lanmaydi va qamrovga kirmaydi.
    return column.op("~")(literal("^[0-9]+::"))


def material_coverage(db: Session) -> dict[tuple[int, str], set[str]]:
    """(sillabus_id, mavzu_kodi) → qaysi material turlari bor."""
    pieces = []

    # Tayyor materiallardan faqat taqdimot oldindan tayyorlanadigan qamrovga kiradi.
    pieces.append(
        select(
            _sid_expr(PreparedContent.topic_norm).label("sid"),
            _variant_expr(PreparedContent.topic_norm).label("variant"),
            _code_expr(PreparedContent.topic_norm).label("code"),
            func.lower(PreparedContent.kind).label("kind"),
        ).where(
            _structured(PreparedContent.topic_norm),
            func.lower(PreparedContent.kind) == "presentation",
        )
    )
    # Fayl sifatida yuklanadigan tarqatma, video va taqdimotlar.
    for model, kind in (
        (TopicHandout, "handout"),
        (TopicVideo, "video"),
        (TopicPresentation, "presentation"),
    ):
        pieces.append(
            select(
                _sid_expr(model.topic_norm).label("sid"),
                _variant_expr(model.topic_norm).label("variant"),
                _code_expr(model.topic_norm).label("code"),
                literal(kind).label("kind"),
            ).where(_structured(model.topic_norm))
        )

    union = pieces[0].union_all(*pieces[1:]).subquery()
    rows = db.execute(
        select(union.c.sid, union.c.variant, union.c.code, union.c.kind).distinct()
    ).all()

    # Ikki kalit: (fan, kod) — bitta yo'nalishli fanlar uchun (eski yozuvlarda
    # yorliq har xil bo'lishi mumkin), va (fan, yo'nalish, kod) — semestrlarga
    # bo'lingan fanlar uchun, aks holda 10-semestr L1 dagi material 9-semestr
    # L1 ni ham "to'ldirilgan" qilib ko'rsatardi.
    out: dict[tuple, set[str]] = {}
    for r in rows:
        if r.sid is None or not r.code:
            continue
        kind = r.kind if r.kind in COVERAGE_KINDS else None
        if kind is None:
            continue
        out.setdefault((int(r.sid), str(r.code)), set()).add(kind)
        out.setdefault((int(r.sid), str(r.variant or ""), str(r.code)), set()).add(kind)
    return out


def syllabus_topics(db: Session) -> dict[int, list[dict]]:
    """sillabus_id → mavzular ro'yxati (kod va sarlavha).

    Barcha yo'nalishlar (semestrlar) olinadi: `topics` faqat birinchi
    variantning nusxasi, semestrlarga bo'lingan fanda ikkinchi semestr
    mavzulari hisobdan tushib qolardi. Har mavzuda `key` — `material_coverage`
    dagi mos kalit.
    """
    rows = db.execute(
        select(CourseSyllabus.id, CourseSyllabus.topics, CourseSyllabus.variants)
    ).all()
    out: dict[int, list[dict]] = {}
    for r in rows:
        variants = [
            v for v in (r.variants or [])
            if isinstance(v, dict) and isinstance(v.get("topics"), list) and v.get("topics")
        ]
        multi = len(variants) > 1
        pairs: list[tuple[str, dict]] = []
        if variants:
            for v in variants:
                label = str(v.get("label") or "").strip().lower()
                pairs += [(label, t) for t in v["topics"] if isinstance(t, dict)]
        else:
            pairs = [("", t) for t in (r.topics or []) if isinstance(t, dict)]
        items = pairs
        # Mavzu kodi JSON'da `id` kalitida keladi ("L1", "A7"); eski
        # yozuvlarda `code` bo'lishi mumkin. `topic_norm` ham aynan shu
        # kodning kichik harfli shaklidan yig'iladi (`2161::asosiy::l1`),
        # shuning uchun bu yerda ham xuddi shunday normallashtiramiz.
        rows_out = []
        for label, t in items:
            code = str(t.get("code") or t.get("id") or "").strip().lower().replace(" ", "")[:16]
            rows_out.append(
                {
                    "code": code,
                    "title": str(t.get("title") or "").strip(),
                    "type": str(t.get("type") or "").strip().lower(),
                    "variant": label,
                    "key": (r.id, label, code) if multi else (r.id, code),
                }
            )
        out[r.id] = rows_out
    return out
