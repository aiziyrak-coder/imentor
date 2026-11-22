"""Test va keys tarjimalarining kelib chiqishi: AI, o'qituvchi tahrirlagan yoki o'qituvchi tasdiqlagan (2026-11-17).

Bazadagi barcha tarjimalarni iMentor'ning AI tarjimoni yaratgan va ularni fan o'qituvchisi ko'rmagan.
fermi.uz saytda "AI tarjimasi" belgisini ko'rsatadi va o'qituvchi tasdiqlagach uni olib tashlaydi.

Belgi payload'ning yuqori darajasida saqlanadi (tarjima blokining ichida EMAS: frontend blokni payload
ustiga yoyib ko'rsatadi va qayta saqlaganda kalit boshqa joyga ko'chib ketardi):

    "translationReview": {"ru": {"status": "reviewed", "at": "2026-11-17T12:00:00+00:00", "by": "<owner_key>"}}

Qoidalar:
* yozuv yo'q — tarjima AI niki (`ai`);
* o'qituvchi "Tarjimani tasdiqlash" ni bossa — `reviewed`;
* tarjima matni o'zgarsa (AI qaytadan tarjima qilgan, asl savollar o'zgarib tarjima eskirgan yoki PATCH
  bilan boshqa matn kelgan) — yozuv o'chadi, yana `ai`. PATCH dagi o'zgarishni o'qituvchi qilganini
  bilib bo'lmaydi: test yaratilganda frontend AI tarjimasini ham shu yo'l bilan saqlaydi. Shuning uchun
  `teacher` hozircha qo'yilmaydi — o'qituvchining o'z tarjima muharriri paydo bo'lganda ishlatiladi.
"""

from __future__ import annotations

import datetime as dt

KEY = "translationReview"
STATUSES = ("ai", "teacher", "reviewed")
#: Tarjima blokining mazmuni (tahrir bo'lganini aniqlash uchun solishtiriladi).
_CONTENT_FIELDS = ("questions", "topic", "references")


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def records(payload: dict | None) -> dict[str, dict]:
    raw = (payload or {}).get(KEY) if isinstance(payload, dict) else None
    return {k: dict(v) for k, v in raw.items() if isinstance(v, dict)} if isinstance(raw, dict) else {}


def status_for(payload: dict | None, lang: str) -> dict:
    """{"translated_by": ai|teacher|reviewed, "reviewed_at": iso|None} — tarjima tili uchun."""
    rec = records(payload).get(lang) or {}
    status = rec.get("status") if rec.get("status") in STATUSES else "ai"
    return {"translated_by": status, "reviewed_at": rec.get("at") if status != "ai" else None}


def with_records(payload: dict, recs: dict[str, dict]) -> dict:
    out = dict(payload)
    if recs:
        out[KEY] = recs
    else:
        out.pop(KEY, None)
    return out


def mark(payload: dict, lang: str, status: str, by: str = "") -> dict:
    """`reviewed`/`teacher` — yozuv qo'yiladi; `ai` — yozuv olib tashlanadi."""
    recs = records(payload)
    if status == "ai":
        recs.pop(lang, None)
    else:
        recs[lang] = {"status": status, "at": _now(), **({"by": by} if by else {})}
    return with_records(payload, recs)


def drop(payload: dict, langs) -> dict:
    """AI qaytadan tarjima qilgan tillar — yozuv o'chadi."""
    recs = records(payload)
    changed = False
    for lang in langs:
        if recs.pop(lang, None) is not None:
            changed = True
    return with_records(payload, recs) if changed else payload


def _content(block: object) -> dict:
    if not isinstance(block, dict):
        return {}
    return {f: block.get(f) for f in _CONTENT_FIELDS if f in block}


def after_update(old: dict | None, new: dict, *, by: str = "") -> dict:
    """PATCH dan keyin: matni o'zgarmagan tarjimaning yozuvi saqlanadi, qolganlari o'chadi (`ai`).

    Mijoz yuborgan `translationReview` hisobga olinmaydi — tasdiq faqat alohida endpoint orqali."""
    old = old if isinstance(old, dict) else {}
    old_tr = old.get("translations") if isinstance(old.get("translations"), dict) else {}
    new_tr = new.get("translations") if isinstance(new.get("translations"), dict) else {}
    old_recs = records(old)
    recs: dict[str, dict] = {}
    for lang, block in new_tr.items():
        if not isinstance(block, dict):
            continue
        before = old_tr.get(lang)
        if before is not None and lang in old_recs and _content(before) == _content(block):
            recs[lang] = old_recs[lang]
    return with_records(new, recs)
