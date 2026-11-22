from __future__ import annotations

import os
import re
import uuid

from app.core.config import get_settings

# .svg yo'q (2026-10-23 auditi): SVG ichida skript bo'ladi, /media/ esa uni sayt manzilida ochadi —
# yuklangan "rasm" ochgan odamning tokenini o'g'irlashi mumkin edi.
_ALLOWED_EXTENSIONS = frozenset(
    {".pdf", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".heic", ".heif"}
)
_ALLOWED_PRESENTATION_EXTENSIONS = frozenset({".pdf", ".ppt", ".pptx"})
_ALLOWED_AVATAR_EXTENSIONS = frozenset({".jpg", ".jpeg", ".png", ".gif", ".webp"})
AVATAR_MAX_BYTES = 2 * 1024 * 1024


def avatar_relative_path(owner_key: str, filename: str) -> str:
    ext = os.path.splitext(filename or "")[1].lower()
    if ext not in _ALLOWED_AVATAR_EXTENSIONS:
        ext = ".jpg"
    return f"avatars/{owner_key}{ext}"


def verify_image_magic(head: bytes) -> bool:
    if len(head) < 3:
        return False
    if head[:3] == b"\xff\xd8\xff":
        return True
    if head[:8] == b"\x89PNG\r\n\x1a\n":
        return True
    if head[:6] in (b"GIF87a", b"GIF89a"):
        return True
    if len(head) >= 12 and head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return True
    return False


def validate_avatar_extension(filename: str) -> bool:
    ext = os.path.splitext(filename or "")[1].lower()
    return ext in _ALLOWED_AVATAR_EXTENSIONS


def media_root() -> str:
    settings = get_settings()
    return settings.django_media_root or "/app/media"


#: Fayl tizimi nomni 255 BAYT bilan cheklaydi, BELGI bilan emas. Kirill
#: harfi UTF-8 da ikki bayt, shuning uchun belgi bo'yicha qirqish yetmasdi:
#: 180 ta kirill harfi 360 bayt bo'lib, yuklash "File name too long" bilan
#: yiqilardi (2026-10-07). Qolgan joy prefiks uchun: `owner_key`, til, uuid.
NAME_MAX_BYTES = 190


def _fit_bytes(text: str, limit: int) -> str:
    """Matnni baytlar bo'yicha qirqadi, yarim harf qoldirmaydi."""
    return text.encode("utf-8")[:limit].decode("utf-8", "ignore")


def _safe_filename(filename: str, *, limit: int = NAME_MAX_BYTES) -> str:
    cleaned = re.sub(r"[^\w.\-]", "_", filename or "")
    stem, dot, ext = cleaned.rpartition(".")
    if not dot or not ext or len(ext) > 10:
        return _fit_bytes(cleaned, limit) or "file"
    # Kengaytma HAR DOIM saqlanadi: usiz fayl ochilmaydi.
    stem = _fit_bytes(stem, max(1, limit - len(ext.encode("utf-8")) - 1))
    return f"{stem}.{ext}" if stem else f"file.{ext}"


def _topic_dir(topic_norm: str) -> str:
    slug = re.sub(r"[^\w.\-]+", "_", (topic_norm or "").strip().lower())[:80]
    return slug.strip("_") or "topic"


def handout_relative_path(
    topic_norm: str,
    owner_key: str,
    filename: str,
    language: str = "",
) -> str:
    safe = _safe_filename(filename)
    lang = re.sub(r"[^a-z]", "", (language or "uz").lower())[:8] or "uz"
    uniq = uuid.uuid4().hex[:10]
    return f"handouts/{_topic_dir(topic_norm)}/{owner_key}_{lang}_{uniq}_{safe}"


def presentation_relative_path(topic_norm: str, owner_key: str, filename: str) -> str:
    # Noyob qism (2026-10-23): bir xil nomli fayl qayta yuklanganda birinchisi ustidan yozilar,
    # ikkala yozuv bitta faylga qarar va birini o'chirish ikkinchisini ham yo'qotardi.
    safe = _safe_filename(filename)
    uniq = uuid.uuid4().hex[:10]
    return f"presentations/{_topic_dir(topic_norm)}/{owner_key}_{uniq}_{safe}"


def save_upload(relative_path: str, content: bytes) -> None:
    abs_path = os.path.join(media_root(), relative_path)
    os.makedirs(os.path.dirname(abs_path), exist_ok=True)
    with open(abs_path, "wb") as f:
        f.write(content)


def delete_file(relative_path: str) -> None:
    abs_path = os.path.join(media_root(), relative_path)
    try:
        os.remove(abs_path)
    except OSError:
        pass


def absolute_path(relative_path: str) -> str:
    return os.path.join(media_root(), relative_path)


def detect_extension(filename: str, content: bytes = b"", content_type: str = "") -> str:
    """Haqiqiy rasm/PDF bo'lsa, nomdagi nuqtalar (masalan .translated.jpg) xalaqit bermasin."""
    name = (filename or "").lower()
    ctype = (content_type or "").split(";")[0].strip().lower()
    for ext in (".jpeg", ".jpg", ".png", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".heic", ".heif", ".pdf"):
        if name.endswith(ext):
            return ".jpg" if ext == ".jpeg" else ext
    if content[:3] == b"\xff\xd8\xff" or ctype in {"image/jpeg", "image/jpg"}:
        return ".jpg"
    if content[:8] == b"\x89PNG\r\n\x1a\n" or ctype == "image/png":
        return ".png"
    if content[:6] in (b"GIF87a", b"GIF89a") or ctype == "image/gif":
        return ".gif"
    if len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return ".webp"
    if content[:5] == b"%PDF-" or ctype == "application/pdf":
        return ".pdf"
    if ctype.startswith("image/"):
        return ".jpg"
    return ""


# ---------------- Yuklash: hajm chegarasi va mazmun tekshiruvi (2026-11-17 auditi, G10) ----------------
#
# Ilgari fayl `await file.read()` bilan BUTUNLAY xotiraga o'qilib, keyin hajmi
# tekshirilardi: 1 GB fayl avval xotirani to'ldirar, keyin rad etilardi. Turi
# esa nomdagi kengaytmadan olinardi — `.pdf` deb nomlangan istalgan fayl o'tardi.

#: Bir martada o'qiladigan bo'lak — chegara oshishi bilan o'qish to'xtaydi.
UPLOAD_CHUNK_BYTES = 1024 * 1024


def _mb(value: int) -> str:
    mb = value / (1024 * 1024)
    return f"{mb:.0f}" if mb >= 1 else f"{mb:.1f}"


async def read_upload_limited(file, max_bytes: int, *, too_large_detail: str = "") -> bytes:
    """Yuklangan faylni bo'laklab o'qiydi; chegara oshishi bilan 413 qaytaradi.

    Fayl butunlay xotiraga olinmaydi: chegaradan bitta bo'lak ortig'i o'qilgach
    to'xtaydi. O'qishda xato (uzilgan ulanish) — 400, 500 emas.
    """
    from fastapi import HTTPException

    parts: list[bytes] = []
    total = 0
    while True:
        try:
            chunk = await file.read(UPLOAD_CHUNK_BYTES)
        except Exception as exc:  # noqa: BLE001 — uzilgan yuklash 500 bermasin
            raise HTTPException(status_code=400, detail="Fayl o'qilmadi. Qayta tanlang.") from exc
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(
                status_code=413,
                detail=too_large_detail or f"Fayl juda katta. Chegara {_mb(max_bytes)} MB.",
            )
        parts.append(chunk)
    return b"".join(parts)


_ZIP_MAGIC = (b"PK\x03\x04",)
_OLE_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
#: HEIC/HEIF `ftyp` qutisidagi brendlar (iPhone rasmlari).
_HEIF_BRANDS = frozenset({b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis", b"mif1", b"msf1"})


def _is_pdf(data: bytes) -> bool:
    # Ba'zi dasturlar `%PDF` dan oldin bir necha bayt qo'yadi — spetsifikatsiya 1 KB gacha ruxsat beradi.
    return b"%PDF" in data[:1024]


def _is_tiff(data: bytes) -> bool:
    return data[:4] in (b"II*\x00", b"MM\x00*")


def _is_heif(data: bytes) -> bool:
    return len(data) >= 12 and data[4:8] == b"ftyp" and data[8:12] in _HEIF_BRANDS


def _is_text(data: bytes) -> bool:
    # Matn faylida NUL bayt bo'lmaydi; bo'lsa — bu `.txt` deb nomlangan ikkilik fayl.
    return b"\x00" not in data


_CONTENT_CHECKS = {
    ".pdf": _is_pdf,
    ".docx": lambda d: d[:4] in _ZIP_MAGIC,
    ".pptx": lambda d: d[:4] in _ZIP_MAGIC,
    ".xlsx": lambda d: d[:4] in _ZIP_MAGIC,
    ".odp": lambda d: d[:4] in _ZIP_MAGIC,
    ".doc": lambda d: d[:8] == _OLE_MAGIC,
    ".ppt": lambda d: d[:8] == _OLE_MAGIC,
    ".xls": lambda d: d[:8] == _OLE_MAGIC,
    ".jpg": lambda d: d[:3] == b"\xff\xd8\xff",
    ".jpeg": lambda d: d[:3] == b"\xff\xd8\xff",
    ".png": lambda d: d[:8] == b"\x89PNG\r\n\x1a\n",
    ".gif": lambda d: d[:6] in (b"GIF87a", b"GIF89a"),
    ".webp": lambda d: len(d) >= 12 and d[:4] == b"RIFF" and d[8:12] == b"WEBP",
    ".bmp": lambda d: d[:2] == b"BM",
    ".tif": _is_tiff,
    ".tiff": _is_tiff,
    ".heic": _is_heif,
    ".heif": _is_heif,
    ".txt": _is_text,
}

_KIND_NAMES = {
    ".pdf": "PDF", ".docx": "Word (.docx)", ".doc": "Word (.doc)", ".pptx": "PowerPoint (.pptx)",
    ".ppt": "PowerPoint (.ppt)", ".xlsx": "Excel (.xlsx)", ".xls": "Excel (.xls)", ".txt": "matn (.txt)",
}


def file_extension(filename: str) -> str:
    """Nomdagi oxirgi kengaytma, kichik harfda (`.pdf`); yo'q bo'lsa — bo'sh."""
    return os.path.splitext(filename or "")[1].lower()


def content_matches(ext: str, data: bytes) -> bool:
    """Fayl mazmuni kengaytmaga mos keladimi (magic bytes). Noma'lum kengaytma — mos emas."""
    check = _CONTENT_CHECKS.get((ext or "").lower())
    return bool(data) and check is not None and bool(check(data))


def ensure_content_matches(ext: str, data: bytes) -> None:
    """Mazmun kengaytmaga mos kelmasa — tushunarli 400.

    Masalan `.pdf` deb nomlangan, ichi esa boshqa narsa bo'lgan fayl: u keyin
    PDF ko'ruvchida ochilmaydi yoki zararli bo'lishi mumkin.
    """
    from fastapi import HTTPException

    if content_matches(ext, data):
        return
    ext = (ext or "").lower()
    if ext in _KIND_NAMES:
        name = _KIND_NAMES[ext]
    elif ext:
        name = f"rasm ({ext})"
    else:
        name = "ruxsat etilgan tur"
    raise HTTPException(
        status_code=400,
        detail=(
            f"Fayl mazmuni {name} emas — nomi o'zgartirilgan yoki fayl buzilgan. "
            "Faylni asl dasturida qayta saqlab, yana yuklang."
        ),
    )


def validate_extension(
    filename: str,
    *,
    presentation: bool = False,
    content: bytes = b"",
    content_type: str = "",
) -> bool:
    if presentation:
        ext = os.path.splitext(filename or "")[1].lower()
        return ext in _ALLOWED_PRESENTATION_EXTENSIONS
    return detect_extension(filename, content, content_type) in _ALLOWED_EXTENSIONS


def detect_handout_kind(name: str, content_type: str, content: bytes = b"") -> str:
    ext = detect_extension(name, content, content_type)
    if ext == ".pdf" or (content_type or "").split(";")[0].strip().lower() == "application/pdf":
        return "pdf"
    return "image"


def detect_presentation_kind(name: str) -> str:
    lower = (name or "").lower()
    if lower.endswith(".pdf"):
        return "pdf"
    if lower.endswith(".pptx"):
        return "pptx"
    return "ppt"
