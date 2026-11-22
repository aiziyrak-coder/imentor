"""«iMentor ekranda ochiq turibdi» belgisi (2026-11-19).

Shikoyat: dars boti «chiqib ketdi» deb yozdi, o'qituvchi esa ertalabdan beri iMentor'dan chiqmagan edi —
tarqatma ekranda ochiq, 50 daqiqa sichqonchaga tegilmagan. Brauzer dars bo'limlarida 20 daqiqa harakatsizlikdan
keyin faollik (`heartbeat`) yozmaydi, shuning uchun ochiq turgan sahifa bilan yopilgan sahifani ajratib bo'lmasdi.

Endi harakatsiz, lekin ko'rinib turgan va fokusdagi varaq har 5 daqiqada `presence` yuboradi. U ATAYLAB
`core_useractivityevent` ga yozilmaydi: o'sha jadvaldan 15+ hisobot (daqiqa, qoplama, dalil, «birinchi qayd»)
o'qiydi va ular ochiq turgan sahifani «ishlagan» deb sanab qo'yardi. Belgi faqat dars botining «chiqib ketdi»
tekshiruvi uchun — Redis'da, kun bo'yicha. Talabalarniki yozilmaydi.

2026-11-19 (rektor: "hamma narsa asosi, dalili bilan tursin"): belgi DALIL sifatida ham ishlatiladi — dars
oynasidagi daqiqama-daqiqa chiziqda «ekranda ochiq, harakatsiz» bo'lib ko'rinadi. Shuning uchun 35 kun
saqlanadi (30 kunlik hisobot va bahslar uchun) va qaysi bo'lim ochiq turgani bilan.
"""

from __future__ import annotations

import datetime as dt
import logging

log = logging.getLogger(__name__)

TTL_SECONDS = 35 * 24 * 3600
TZ = dt.timezone(dt.timedelta(hours=5))


def _key(owner: str, day: dt.date) -> str:
    return f"rx:presence:v1:{day.isoformat()}:{owner}"


def record(owner: str, when: dt.datetime, page: str = "") -> None:
    try:
        from app.services.ai_response_cache import _redis

        r = _redis()
        key = _key(owner, when.astimezone(TZ).date())
        r.zadd(key, {f"{when.isoformat()}|{(page or '')[:40]}": when.timestamp()})
        r.expire(key, TTL_SECONDS)
    except Exception as exc:  # noqa: BLE001 — belgi yo'qolsa ham sahifa ishlashda davom etadi
        log.warning("presence yozilmadi: %s", exc)


def marks(owner: str, lo: dt.datetime, hi: dt.datetime) -> list[tuple[dt.datetime, str]]:
    """[(vaqt, bo'lim)] — [lo, hi) oralig'ida (bir necha kunni ham qamraydi). Redis ishlamasa — bo'sh."""
    if not owner:
        return []
    out: list[tuple[dt.datetime, str]] = []
    try:
        from app.services.ai_response_cache import _redis

        r = _redis()
        day = lo.astimezone(TZ).date()
        while day <= hi.astimezone(TZ).date():
            for member, score in r.zrangebyscore(_key(owner, day), lo.timestamp(), hi.timestamp(), withscores=True):
                page = str(member).split("|", 1)[1] if "|" in str(member) else ""
                out.append((dt.datetime.fromtimestamp(float(score), dt.timezone.utc), page))
            day += dt.timedelta(days=1)
    except Exception as exc:  # noqa: BLE001
        log.warning("presence o'qilmadi: %s", exc)
    return sorted(out)


def times(owners: set[str], day: dt.date) -> dict[str, list[dt.datetime]]:
    """{o'qituvchi: [vaqt...]} — shu kun, tartiblangan. Redis ishlamasa — bo'sh."""
    out: dict[str, list[dt.datetime]] = {}
    if not owners:
        return out
    try:
        from app.services.ai_response_cache import _redis

        r = _redis()
        pipe = r.pipeline()
        names = sorted(owners)
        for o in names:
            pipe.zrange(_key(o, day), 0, -1, withscores=True)
        for o, rows in zip(names, pipe.execute()):
            if rows:
                out[o] = sorted(dt.datetime.fromtimestamp(float(score), dt.timezone.utc) for _m, score in rows)
    except Exception as exc:  # noqa: BLE001
        log.warning("presence o'qilmadi: %s", exc)
    return out
