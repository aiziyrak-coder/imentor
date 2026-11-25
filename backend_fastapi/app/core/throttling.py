"""Django `core/throttling.py` ekvivalenti — Redis orqali rate limit.

Redis ishlamasa jarayon ichidagi zaxira hisoblagichga o'tiladi. Ilgari bunday
holatda cheklov butunlay o'chib qolardi — ya'ni Redis yiqilgan payt login
endpointi cheksiz urinishga ochiq bo'lardi. Zaxira hisoblagich har bir
gunicorn worker'ida alohida, shuning uchun amaldagi chegara worker soniga
ko'payadi; bu aniq emas, lekin cheksizdan ko'ra ancha yaxshi.

Kalitlar Django scope nomlari bilan mos.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from functools import lru_cache

import redis
from fastapi import Depends, HTTPException, Request, status

from app.api.deps import AuthContext, get_current_auth
from app.core.config import get_settings

logger = logging.getLogger(__name__)

_PERIODS = {
    "s": 1,
    "sec": 1,
    "second": 1,
    "seconds": 1,
    "m": 60,
    "min": 60,
    "minute": 60,
    "minutes": 60,
    "h": 3600,
    "hour": 3600,
    "hours": 3600,
    "d": 86400,
    "day": 86400,
    "days": 86400,
}


@lru_cache
def _redis() -> redis.Redis:
    # Vaqt chegarasi SHART (2026-11-25): usiz Redis javobi kechiksa yoki ulanish yarim ochiq qolsa, oqim abadiy
    # kutardi. Cheklov har so'rovda chaqiriladi — bir ishchining 40 ta oqimi shu yerda osilib, u baza
    # ulanishlarini (25 ta "idle in transaction") egallab, umuman javob bermay qolardi. Xatoda `enforce`
    # jarayon ichidagi hisoblagichga o'tadi.
    return redis.Redis.from_url(get_settings().redis_url, decode_responses=True,
                                socket_connect_timeout=1.0, socket_timeout=1.5, health_check_interval=30)


def parse_rate(rate: str) -> tuple[int, int]:
    """`20/minute` → (20, 60). Noto'g'ri formatda cheklov o'tkazib yuboriladi."""
    raw = (rate or "").strip().lower()
    if "/" not in raw:
        return 0, 0
    num_s, unit = raw.split("/", 1)
    try:
        num = int(num_s)
    except ValueError:
        return 0, 0
    period = _PERIODS.get(unit.strip())
    if not period or num <= 0:
        return 0, 0
    return num, period


#: Backend oldidagi ishonchli proksilar: serverdagi umumiy nginx (haqiqiy mijoz IP'sini
#: qo'shadi) va imentor nginx konteyneri (umumiy nginx IP'sini qo'shadi).
TRUSTED_PROXY_HOPS = max(0, int(os.environ.get("IMENTOR_TRUSTED_PROXY_HOPS") or 2))


def client_ip(request: Request) -> str:
    """Mijozning haqiqiy IP'si.

    X-Forwarded-For ning CHAP qismini mijoz o'zi yozadi — ilgari birinchi qiymat olinardi
    va har so'rovda boshqa "IP" yozib, parol tanlash va ID terish cheklovlarini chetlab
    o'tish mumkin edi (2026-10-23 auditi). Ishonchli proksilar ro'yxatning O'NG tomoniga
    qo'shadi: haqiqiy mijoz — o'ngdan `TRUSTED_PROXY_HOPS`-qiymat.
    """
    forwarded = [p.strip() for p in (request.headers.get("x-forwarded-for") or "").split(",") if p.strip()]
    if forwarded and TRUSTED_PROXY_HOPS:
        return forwarded[-TRUSTED_PROXY_HOPS] if len(forwarded) >= TRUSTED_PROXY_HOPS else forwarded[0]
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


class _MemoryCounter:
    """Redis o'rniga ishlaydigan oddiy oyna hisoblagichi.

    Faqat zaxira sifatida ishlatiladi, shuning uchun aniqligi Redis darajasida
    emas: oyna qat'iy (sliding emas) va har worker o'zinikini yuritadi. Lug'at
    cheksiz o'smasin uchun muddati o'tgan kalitlar chaqiruv paytida tozalanadi.
    """

    _MAX_KEYS = 50_000

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._hits: dict[str, tuple[float, int]] = {}

    def incr(self, key: str, period: int) -> int:
        now = time.monotonic()
        with self._lock:
            if len(self._hits) > self._MAX_KEYS:
                self._hits = {k: v for k, v in self._hits.items() if v[0] > now}
            started, count = self._hits.get(key, (0.0, 0))
            if started <= now:
                started, count = now + period, 0
            count += 1
            self._hits[key] = (started, count)
            return count


_memory = _MemoryCounter()


def enforce(key: str, rate: str) -> None:
    num, period = parse_rate(rate)
    if num <= 0 or period <= 0:
        return
    try:
        r = _redis()
        n = int(r.incr(key))
        if n == 1:
            r.expire(key, period)
    except Exception:
        logger.warning(
            "Rate limit Redis ishlamadi — jarayon ichidagi zaxira ishlatildi (%s).",
            key,
            exc_info=True,
        )
        n = _memory.incr(key, period)
    if n > num:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Juda ko'p so'rov. Biroz kuting.",
        )


def throttle_login(request: Request) -> None:
    enforce(f"throttle:login:{client_ip(request)}", get_settings().django_login_rate)


# Institut kompyuterlari bitta tashqi IP (NAT) orqali chiqadi. Faqat IP bo'yicha
# 20/minut butun binoni bloklardi — guruh bir vaqtda kirganda hamma "Juda ko'p
# so'rov" olardi. Parol tanlashni hisob+IP cheklaydi; IP uchun keng umumiy chegara.
LOGIN_IP_WIDE_RATE = "300/minute"
IMAGE_SAFETY_RATE = "1500/hour"


def throttle_login_account(request: Request, account: str) -> None:
    ip = client_ip(request)
    enforce(f"throttle:login_ip:{ip}", LOGIN_IP_WIDE_RATE)
    enforce(f"throttle:login:{ip}:{(account or '').strip().lower()}", get_settings().django_login_rate)


# ---- Parolsiz kirish (Xodim ID / Talaba ID / JSHSHIR / pasport), 2026-11-17 auditi (D2).
# ID'lar ketma-ket va taxmin qilinadi. Ikki qo'shimcha to'siq:
#   * bitta identifikator bilan soatiga 30 kirish — IP'dan qat'i nazar (begona ID'ni ko'p IP'dan sinash);
#   * bitta IP'dan 15 daqiqada 40 ta MUVAFFAQIYATSIZ urinish — keyin shu IP 15 daqiqa parolsiz kira olmaydi.
#     Faqat xatolar sanaladi: institut NAT'i ortidan yuzlab talaba to'g'ri ID bilan kirsa, cheklanmaydi.
PASSWORDLESS_ID_RATE = "30/hour"
PASSWORDLESS_FAIL_LIMIT = 40
PASSWORDLESS_FAIL_WINDOW = 15 * 60
PASSWORDLESS_BLOCKED = "Noto'g'ri urinishlar juda ko'p. 15 daqiqadan keyin qayta urining."


def _peek(key: str) -> int:
    try:
        return int(_redis().get(key) or 0)
    except Exception:
        started, count = _memory._hits.get(key, (0.0, 0))
        return count if started > time.monotonic() else 0


def passwordless_guard(request: Request, identifier: str) -> None:
    ip = client_ip(request)
    if _peek(f"throttle:pwless_fail:{ip}") >= PASSWORDLESS_FAIL_LIMIT:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=PASSWORDLESS_BLOCKED)
    ident = (identifier or "").strip().lower()
    if ident:
        enforce(f"throttle:pwless_id:{ident}", PASSWORDLESS_ID_RATE)


def passwordless_failed(request: Request) -> None:
    key = f"throttle:pwless_fail:{client_ip(request)}"
    try:
        r = _redis()
        if int(r.incr(key)) == 1:
            r.expire(key, PASSWORDLESS_FAIL_WINDOW)
    except Exception:
        _memory.incr(key, PASSWORDLESS_FAIL_WINDOW)


def throttle_live_test_anon(request: Request) -> None:
    enforce(f"throttle:live_test_anon:{client_ip(request)}", get_settings().django_live_test_anon_rate)


#: Kirgan talaba uchun (qoralama, topshirish, natija): HAR TALABAGA alohida. Ilgari IP bo'yicha
#: 120/minut edi — kampus Wi-Fi'ida (bitta NAT IP) 30 talaba har javobdan keyin qoralama
#: saqlaydi va hammasi birdan "Juda ko'p so'rov" olardi (2026-10-23 auditi).
LIVE_TEST_STUDENT_RATE = "240/minute"


def throttle_live_test_student(auth: AuthContext = Depends(get_current_auth)) -> None:
    enforce(f"throttle:live_test_student:{auth.user.id}", LIVE_TEST_STUDENT_RATE)


def throttle_staff_ping(auth: AuthContext = Depends(get_current_auth)) -> None:
    enforce(f"throttle:staff_ping:{auth.user.id}", get_settings().django_staff_ping_rate)


def throttle_education_ai(auth: AuthContext = Depends(get_current_auth)) -> None:
    enforce(f"throttle:education_ai:{auth.user.id}", get_settings().django_ai_education_rate)


def throttle_image_safety(auth: AuthContext = Depends(get_current_auth)) -> None:
    """Slayd rasmlari tekshiruvi — bitta taqdimot 20–40 rasm, AI limitini yemasin."""
    enforce(f"throttle:image_safety:{auth.user.id}", IMAGE_SAFETY_RATE)


def throttle_translate(auth: AuthContext = Depends(get_current_auth)) -> None:
    """Material tarjimasi — umumiy AI limitidan alohida (til almashtirish uni yeb qo'ymasin)."""
    enforce(f"throttle:translate:{auth.user.id}", get_settings().django_ai_translate_rate)
