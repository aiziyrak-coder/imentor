"""Nazoratdagi fan: KLINIK fanmi (2026-11-16, rektorat qarori).

Rektor hisoboti faqat klinik fanlarning amaliy mashg'ulotlarini, faqat
monitorli xonada, nazorat qiladi. Ilgari hisobotga hamma kafedra kirardi
(tillar, kimyo, ijtimoiy fanlar ham) va institutning ~700 o'qituvchisi bitta
o'lchov bilan baholanardi.

Qaror tartibi (birinchi mos kelgani):

1. Admin qarori — «Monitorli xonalar» sahifasidagi «Nazoratdagi fanlar»
   (`core_subjectscope`). Har qanday avtomatik qarordan kuchli.
2. Nazoratdagi klinik bo'lmagan kafedra (`CONTROLLED_DEPARTMENT_RE`, 2026-11-17 rektorat qarori) —
   kafedraning HAMMA fani nazoratda (faqat ma'rifat soati emas).
3. Klinik kafedra (institutning rasmiy 15 ta ro'yxati,
   `clinical_departments.json`) — fani klinik, agar nomi aniq klinik EMAS
   bo'lmasa ("Tibbiyot kasbiga kirish", "Tibbiy psixologiya", "Preklinik ...").
4. Klinik bo'lmagan kafedra — fan NOMIDA klinik belgi bo'lsa klinik
   ("Klinik farmakologiya", "Ichki kasalliklar", "Klinik kardiologiya").

Natija fan nomi + kafedra bo'yicha bir marta hisoblanadi (`lru_cache`),
admin qarorlari esa 60 soniyalik kesh bilan o'qiladi.
"""

from __future__ import annotations

import logging
import re
import threading
import time
from functools import lru_cache

from sqlalchemy import select
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

#: Fan nomida shu so'zlardan biri bo'lsa — bemor bilan ishlanadigan klinik fan.
CLINICAL_RE = re.compile(
    r"klini[kc]|kasalliklar|kasalligi|terapiya|xirurg|jarroh|pediatr|neonat|akusher|ginekolog|"
    r"nevrolog|kardiolog|onkolog|urolog|ftiziat|pulmonolog|dermatoven|stomatolog|endodont|parodont|"
    r"ortodont|protezlash|oftalmolog|otorinolar|otolarin|endokrinolog|gematolog|psixiatr|narkolog|"
    r"reanimat|anesteziol|tez tibbiy yordam|travmatolog|ortoped|reabilitolog|yuqumli|allergolog|"
    r"funksional diagnostika|hamshiralik ishi|birinchi yordam",
    re.I,
)

#: Klinik kafedrada bo'lsa ham klinik bo'lmagan fanlar: kirish, nazariya, tashkiliy.
NON_CLINICAL_RE = re.compile(
    r"preklini|kasbiga kirish|ga kirish$|^tibbiy psixologiya$|^tibbiy genetika$|ishini tashkil|"
    r"etikasi|kommunikats|menejment|iqtisod|tovarshunos|startap",
    re.I,
)

#: Klinik belgisi bor bo'lsa ham nazorat qilinmaydigan fanlar (sof tashkiliy).
ALWAYS_NON_CLINICAL_RE = re.compile(r"(?<![^\W\d_])ma\W?rifat|маъ?риф|jismoniy tarbiya", re.I)
#: Ma'naviyat-ma'rifat soati — dars emas; nazoratdagi kafedrada ham hisobga kirmaydi.
MARIFAT_RE = re.compile(r"(?<![^\W\d_])ma\W?rifat|маъ?риф", re.I)

#: Klinik bo'lmasa ham NAZORATDAGI kafedralar (2026-11-17, foydalanuvchi: "patfiziologiya, patanatomiya,
#: kommunal va mehnat gigiyenasi, ovqatlanish va bolalar gigiyenasi, preventiv tibbiyot asoslari, jamoat
#: salomatligi, jismoniy tarbiya va sport, epidemiologiya, yuqumli kasalliklar, hamshiralik ishi,
#: mikrobiologiya, virusologiya, immunologiya — shu kafedralar ham nazoratda, o'qituvchilari kirishi kerak").
#: Kafedra NOMI bo'yicha (HEMIS yozilishi o'zgarib turadi: gigiena/gigiyena, epidemiologiya/epidemiyologiya).
#: Monitorli xona va amaliy mashg'ulot sharti o'zgarmaydi.
#:
#: 2026-11-18: prorektor tasdiqlagan «iMentor'dan foydalanishni nazorat qiluvchi mas'ul xodimlar» ro'yxatidagi
#: 25 kafedraning HAMMASI (foydalanuvchi: "shu kafedradagilar barchasi nazoratga olinishi kerak") — klinik
#: kafedralar ham butunlay (kirish fanlari ham), qo'shimcha: fiziologiya, gistologiya va biologiya, normal
#: anatomiya, xalq tabobati va farmakologiya, tibbiy va biologik kimyo. Ro'yxatda YO'Q (nazoratdan tashqari):
#: biotibbiyot muhandisligi/biofizika/axborot texnologiyalari, «Terapiya yo'nalishidagi fanlar», o'zbek va
#: xorijiy tillar, lotin tili/pedagogika/psixologiya, ijtimoiy fanlar.
CONTROLLED_DEPARTMENT_RE = re.compile(
    r"patologik fiziologiya|patologik anatomiya|kommunal va mehnat gigi|ovqatlanish\W.{0,40}gigi|"
    r"preventiv tibbiyot|jamoat salomatligi|epidemi[yi]?ologiya|hamshiralik ishi|mikrobiologiya|"
    r"akusherlik|dermatovenerolog|endokrinolog|gospital jarrohlik|fiziologiya|gistologiya|gospital terapiya|"
    r"propedevtika|nevrologiya|normal anatomiya|pediatriya|anesteziolog|stomatologiya va oto|"
    r"fakultativ terapiya|travmatologiya|umumiy jarrohlik|urologiya|xalq tabobati|farmakologiya|biologik kimyo",
    re.I,
)

CACHE_SECONDS = 60
_lock = threading.Lock()
_cache: tuple[float, dict[str, bool]] | None = None


def norm_subject(name: str | None) -> str:
    """Fan nomi kaliti: kichik harf, apostrof va tinish belgilarisiz."""
    text = (name or "").casefold()
    for ch in "‘’ʻʼ`'′":
        text = text.replace(ch, "")
    return " ".join(re.sub(r"[^\w]+", " ", text).split())


def _fold(name: str) -> str:
    text = (name or "").casefold()
    for ch in "‘’ʻʼ`'′":
        text = text.replace(ch, "")
    return " ".join(text.split())


@lru_cache(maxsize=512)
def department_is_clinical(department: str) -> bool:
    """Kafedra institutning rasmiy klinik kafedralar ro'yxatidami."""
    if not (department or "").strip():
        return False
    from app.services.clinical_departments import is_clinical_name

    return is_clinical_name(department)


@lru_cache(maxsize=512)
def department_is_controlled(department: str) -> bool:
    """Klinik bo'lmasa ham butunlay nazoratdagi kafedra (rektorat qarori, 2026-11-17)."""
    return bool(CONTROLLED_DEPARTMENT_RE.search(_fold(department)))


@lru_cache(maxsize=8192)
def auto_verdict(subject: str, department: str) -> tuple[bool, str]:
    """Avtomatik qaror va uning sababi (admin sahifasida ko'rsatiladi)."""
    folded = _fold(subject)
    if not folded:
        return False, "Fan nomi yo'q"
    if department_is_controlled(department):
        if MARIFAT_RE.search(folded):
            return False, "Tarbiyaviy soat"
        return True, "Nazoratdagi kafedra fani"
    if ALWAYS_NON_CLINICAL_RE.search(folded):
        return False, "Tarbiyaviy / sport fani"
    clinical_dep = department_is_clinical(department)
    if "preklini" in folded:
        return False, "Preklinik (fantom/laboratoriya) fan"
    if clinical_dep:
        if NON_CLINICAL_RE.search(folded) and not re.search(r"klini[kc]", folded):
            return False, "Klinik kafedra, lekin fan kirish/nazariy"
        return True, "Klinik kafedra fani"
    if CLINICAL_RE.search(folded) and not NON_CLINICAL_RE.search(folded):
        return True, "Fan nomida klinik belgi bor"
    return False, "Klinik bo'lmagan kafedra fani"


def overrides(db: Session | None = None, *, force: bool = False) -> dict[str, bool]:
    """Admin qarorlari: fan kaliti -> klinikmi. Xatoda — bo'sh (avtomatik qoida ishlaydi)."""
    global _cache
    now = time.monotonic()
    with _lock:
        if not force and _cache and now - _cache[0] < CACHE_SECONDS:
            return _cache[1]
    try:
        from app.models.subject_scope import SubjectScope

        def read(session: Session) -> dict[str, bool]:
            return {r.subject_key: bool(r.clinical) for r in session.execute(select(SubjectScope)).scalars()}

        if db is not None:
            data = read(db)
        else:
            from app.core.db import SessionLocal

            with SessionLocal() as session:
                data = read(session)
    except Exception:  # noqa: BLE001 — jadval hali yo'q (migratsiyadan oldin) yoki baza band
        logger.warning("subject scope overrides unavailable", exc_info=True)
        data = {}
    with _lock:
        _cache = (now, data)
    return data


def clear() -> None:
    global _cache
    with _lock:
        _cache = None


def verdict(subject: str | None, department: str | None, *, db: Session | None = None) -> dict:
    """To'liq qaror: klinikmi, manba (admin/auto) va sabab."""
    key = norm_subject(subject)
    auto, reason = auto_verdict(subject or "", department or "")
    manual = overrides(db).get(key)
    if manual is not None:
        return {"clinical": manual, "source": "admin", "auto": auto, "reason": reason}
    return {"clinical": auto, "source": "auto", "auto": auto, "reason": reason}


def is_clinical(subject: str | None, department: str | None) -> bool:
    """Shu fan nazoratdami (klinik fan)."""
    manual = overrides().get(norm_subject(subject))
    if manual is not None:
        return manual
    return auto_verdict(subject or "", department or "")[0]


def is_clinical_lesson(lesson) -> bool:
    return is_clinical(getattr(lesson, "subject_name", ""), getattr(lesson, "department_name", ""))
