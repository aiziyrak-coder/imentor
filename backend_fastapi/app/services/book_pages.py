"""Kitob parchasi qaysi sahifadan (2026-10-21).

Shikoyat: ma'ruzadagi iqtibosda sahifa yo'q — "(Source: Pathoma Fundamentals
of Pathology 2021)". O'qituvchi yuklagan hujjatlar va klinik protokollar butun
matn bitta qilib parchalanardi va har parcha `page_start = page_end = 0`
bilan saqlanardi: 435 faol kitobdan 196 tasi sahifasiz edi.

PDF'da sahifa bor. Parcha matni PDF sahifalari matni bilan solishtiriladi:
harf va raqamlardan boshqa hamma narsa olib tashlanadi, parchaning boshi va
oxiri sahifalar ketma-ketligida qidiriladi. Topilmasa — 0 ("noma'lum"),
taxmin qilinmaydi. Word hujjatida qat'iy sahifa yo'q — u sahifasiz qoladi.
"""

from __future__ import annotations

import io
import re
from bisect import bisect_right

_NON_WORD = re.compile(r"[^\w]+", re.UNICODE)
#: Parchaning boshi/oxiridan solishtiriladigan belgilar soni (normallangan).
KEY = 60


def _norm(text: str) -> str:
    return _NON_WORD.sub("", (text or "").lower())


def pdf_pages(content: bytes) -> list[str]:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(content))
    return [(page.extract_text() or "") for page in reader.pages]


def chunk_pages(pages: list[str], chunks: list[str]) -> list[tuple[int, int]]:
    """Har parcha uchun (birinchi sahifa, oxirgi sahifa), 1 dan; topilmasa (0, 0).

    Parchalar matndagi tartibda keladi — qidiruv oldingi topilgan joydan davom
    etadi (bir xil jumla kitobda ikki marta bo'lsa adashmasin).
    """
    normed = [_norm(p) for p in pages]
    starts: list[int] = []
    pos = 0
    for n in normed:
        starts.append(pos)
        pos += len(n)
    full = "".join(normed)

    def page_at(offset: int) -> int:
        return bisect_right(starts, offset)  # 1 dan

    out: list[tuple[int, int]] = []
    cursor = 0
    for chunk in chunks:
        body = _norm(chunk)
        if len(body) < 20:
            out.append((0, 0))
            continue
        head = body[:KEY]
        at = full.find(head, max(0, cursor - 4 * KEY))
        if at < 0:
            at = full.find(head)
        if at < 0:
            out.append((0, 0))
            continue
        tail = body[-KEY:]
        end_at = full.find(tail, at)
        last = page_at(end_at + len(tail) - 1) if end_at >= 0 else page_at(at)
        first = page_at(at)
        out.append((first, max(first, last)))
        cursor = at + 1
    return out
