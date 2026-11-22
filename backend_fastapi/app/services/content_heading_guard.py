"""Ruscha/inglizcha ma'ruza va taqdimot sarlavhasi o'zbekcha qolmasin — server tomonidagi himoya (2026-11-12).

Shikoyat: "tarjimada doim muammo" — ruscha ma'ruza "9-мавзу. Dorixonalarda yoritilganlik…" sarlavhasi bilan
saqlanardi: AI'ga mavzu nomi sillabus tilida berilib, u sarlavhaga ko'chirardi. Frontend endi nomni material
tilida beradi (`topicTitleFor`), lekin boshqa yo'llar (eski brauzer keshi, nusxa, tashqi skript) qolishi mumkin.
Shuning uchun material saqlanayotganda sarlavha qatori tekshiriladi: o'zbekcha bo'lsa va fan sillabusida shu
tildagi tarjima bo'lsa, faqat SHU QATOR almashtiriladi. Tarjima bo'lmasa — material o'zgarishsiz saqlanadi
(saqlash hech qachon to'xtamaydi).
"""

from __future__ import annotations

import re

_CYR = re.compile(r"[Ѐ-ӿ]")
_LAT = re.compile(r"[A-Za-z]")
# -lar: inglizcha -ular/-olar (mandibular, Scholar) o'zbekcha emas.
_UZ_MARK = re.compile(r"[oOgG]['’‘ʻ]|\b(?:va|bilan|uchun|hamda)\b|(?:(?<![uo])lar|lari|ning|dagi|ishi|ligi)\b|‘|’", re.I)
_UZ_EN_MARK = re.compile(r"\b(?:va|bilan|uchun|hamda)\b|\w(?<![uo])(?:lar|lari|larning)\b", re.I)


def looks_uzbek(line: str, lang: str) -> bool:
    """`lang` (ru/en) tilidagi material sarlavhasi aslida o'zbekchami."""
    cyr, lat = len(_CYR.findall(line)), len(_LAT.findall(line))
    if cyr + lat < 15:
        return False
    if lang == "ru":
        return lat > cyr and bool(_UZ_MARK.search(line))
    if lang == "en":
        return bool(_UZ_EN_MARK.search(line))
    return False


def localized_title(syllabus, topic: str, lang: str) -> str:
    if syllabus is None or not topic:
        return ""
    value = ((getattr(syllabus, "topics_i18n", None) or {}).get(lang) or {}).get(topic)
    return value.strip() if isinstance(value, str) else ""


def _with_tail(old: str, new: str, lang: str) -> str:
    """Asl qatordagi qavs ichidagi qism shu tilda bo'lsa ("(Практика, тема 11)") — saqlanadi."""
    tail = re.search(r"\s*\(([^()]*)\)\s*$", old)
    if tail and lang == "ru" and _CYR.search(tail.group(1)) and tail.group(1) not in new:
        return f"{new} ({tail.group(1)})"
    return new


def fix_heading(kind: str, payload: dict, syllabus, topic: str) -> tuple[dict, bool]:
    """(yangi payload, o'zgardimi). Faqat ma'ruza (birinchi '#' qatori) va taqdimot (`presentation_title`)."""
    if not isinstance(payload, dict):
        return payload, False
    lang = str(payload.get("primaryLanguage") or "")
    if lang not in ("ru", "en") or kind not in ("lecture", "presentation"):
        return payload, False
    if kind == "lecture":
        content = str(payload.get("content") or "")
        lines = content.split("\n")
        idx = next((i for i, line in enumerate(lines) if line.strip().startswith("#")), None)
        if idx is None:
            return payload, False
        m = re.match(r"^(\s*#+\s*)(.*)$", lines[idx])
        old = m.group(2).strip()
        if not looks_uzbek(old, lang):
            return payload, False
        new = localized_title(syllabus, topic, lang)
        if not new:
            return payload, False
        lines[idx] = m.group(1) + _with_tail(old, new, lang)
        return {**payload, "content": "\n".join(lines)}, True
    old = str(payload.get("presentation_title") or "").strip()
    if not looks_uzbek(old, lang):
        return payload, False
    new = localized_title(syllabus, topic, lang)
    if not new:
        return payload, False
    return {**payload, "presentation_title": _with_tail(old, new, lang)}, True
