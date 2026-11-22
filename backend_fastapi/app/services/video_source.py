"""Mavzu videosi havolasi: YouTube'dan tashqari saytlar ham (2026-11-19).

O'qituvchi (Abdusalomov A., Kommunal va mehnat gigiyenasi): "boshqa link qo'sha olmayapman" — iMentor faqat
YouTube havolasini qabul qilardi. Endi Google Drive, Vimeo, Rutube, mover.uz, Telegram (ochiq kanal posti) va
to'g'ridan-to'g'ri video fayl (.mp4/.webm) havolalari ham qo'shiladi; boshqa https havola — "yangi oynada
ochish" tugmasi bilan.

Bazaga yangi ustun qo'shilmagan: havola `youtube_url` da, turi `youtube_id` da (`ext:<sayt>`); YouTube
videolari avvalgidek 11 belgili ID bilan. Iframe manzili FAQAT shu yerda, ma'lum saytlar uchun quriladi —
o'qituvchi yozgan ixtiyoriy manzil iframe'ga qo'yilmaydi.
"""

from __future__ import annotations

import re
from urllib.parse import parse_qs, urlparse

EXT_PREFIX = "ext:"

#: Ko'rsatish turi: iframe (sayt pleyeri), video (HTML5 <video>), link (faqat yangi oynada ochish).
_DIRECT = re.compile(r"\.(mp4|webm|ogg|ogv|mov|m4v)$", re.I)


def parse(url: str) -> dict | None:
    """{provider, kind, embed} yoki None (http/https emas, bo'sh). YouTube bu yerda emas (`extract_youtube_id`)."""
    raw = (url or "").strip()
    if not raw or len(raw) > 512:
        return None
    if not re.match(r"^https?://", raw, re.I):
        raw = "https://" + raw if re.match(r"^[\w.-]+\.[a-z]{2,}/", raw, re.I) else ""
    if not raw:
        return None
    try:
        u = urlparse(raw)
    except ValueError:
        return None
    host = (u.hostname or "").lower().removeprefix("www.").removeprefix("m.")
    if u.scheme not in ("http", "https") or "." not in host:
        return None
    path = u.path or ""
    if host in ("drive.google.com", "docs.google.com"):
        m = re.search(r"/file/d/([A-Za-z0-9_-]{10,})", path)
        fid = m.group(1) if m else (parse_qs(u.query).get("id") or [""])[0]
        if re.fullmatch(r"[A-Za-z0-9_-]{10,}", fid or ""):
            return {"provider": "gdrive", "kind": "iframe", "embed": f"https://drive.google.com/file/d/{fid}/preview"}
    if host in ("vimeo.com", "player.vimeo.com"):
        m = re.search(r"/(?:video/)?(\d{5,})", path)
        if m:
            return {"provider": "vimeo", "kind": "iframe", "embed": f"https://player.vimeo.com/video/{m.group(1)}"}
    if host == "rutube.ru":
        m = re.search(r"/(?:video|play/embed|shorts)/([0-9a-f]{20,})", path)
        if m:
            return {"provider": "rutube", "kind": "iframe", "embed": f"https://rutube.ru/play/embed/{m.group(1)}"}
    if host == "mover.uz":
        m = re.search(r"/(?:watch|video/embed)/([A-Za-z0-9]{4,})", path)
        if m:
            return {"provider": "mover", "kind": "iframe", "embed": f"https://mover.uz/video/embed/{m.group(1)}/"}
    if host in ("t.me", "telegram.me"):
        m = re.fullmatch(r"/(?:s/)?([A-Za-z0-9_]{4,})/(\d+)/?", path)
        if m:
            return {"provider": "telegram", "kind": "iframe", "embed": f"https://t.me/{m.group(1)}/{m.group(2)}?embed=1"}
    if _DIRECT.search(path) and u.scheme == "https":
        # http fayl https sahifada bloklanadi (mixed content) — u oddiy havola bo'lib qoladi.
        return {"provider": "file", "kind": "video", "embed": u.geturl()}
    return {"provider": "link", "kind": "link", "embed": ""}


def describe(youtube_id: str, url: str) -> dict:
    """Saqlangan video uchun: {provider, kind, embed} — YouTube yoki boshqa sayt."""
    if not (youtube_id or "").startswith(EXT_PREFIX):
        return {"provider": "youtube", "kind": "iframe", "embed": f"https://www.youtube.com/embed/{youtube_id}"}
    return parse(url) or {"provider": "link", "kind": "link", "embed": ""}
