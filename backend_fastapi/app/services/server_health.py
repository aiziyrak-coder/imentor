"""Server yuki nazorati (2026-11-13 hodisasidan keyin).

O'sha kuni monitor so'rovlari baza ulanishlarini tugatdi: 40 daqiqada 2099 so'rov "QueuePool limit"
oldi, test yaratish ishlamadi — biz buni faqat o'qituvchilar shikoyatidan bildik. Endi:

* ulanish tugaganda so'rov 15 s kutib, keyin 500 emas — darhol 503 + `Retry-After` oladi (`main.py`);
* har daqiqada: rad etilgan so'rovlar soni va uzoq osilgan ("idle in transaction" > 2 daqiqa) ulanishlar
  tekshiriladi; chegara oshsa — admin panel «Sayt xatolari» ro'yxatiga "SERVER:" yozuvi tushadi
  (soatiga bitta yozuv, hisobi ortib boradi);
* tez-tez so'raladigan monitor holat so'rovlari bir ishchida bir vaqtda `POLL_LIMIT` tadan oshsa —
  ortig'i darhol 503 oladi (telefon 2 s dan keyin qayta so'raydi), qolgan sayt (test yaratish, javob
  yuborish) ishlashda davom etadi.
"""
from __future__ import annotations

import datetime as dt
import logging
import os
import random
import threading
import time

from fastapi import HTTPException
from sqlalchemy import func, select, text

log = logging.getLogger(__name__)

POLL_LIMIT = int(os.environ.get("IMENTOR_POLL_INFLIGHT_LIMIT", "16"))
CHECK_SECONDS = 60
STUCK_SECONDS = 120
STUCK_ALERT = 5

_lock = threading.Lock()
_pool_timeouts = 0
_shed = 0
_inflight = 0


def note_pool_timeout() -> None:
    global _pool_timeouts
    with _lock:
        _pool_timeouts += 1


async def poll_slot():
    """FastAPI bog'liqligi (async — threadpool kutmaydi): monitor holat so'rovlari uchun joy."""
    global _inflight, _shed
    with _lock:
        if _inflight >= POLL_LIMIT:
            _shed += 1
            busy = True
        else:
            _inflight += 1
            busy = False
    if busy:
        raise HTTPException(status_code=503, detail="Server band — bir soniyadan keyin qayta so'raladi.",
                            headers={"Retry-After": "2"})
    try:
        yield
    finally:
        with _lock:
            _inflight -= 1


async def pool_timeout_handler(_request, _exc):  # noqa: ANN001
    """`sqlalchemy.exc.TimeoutError` (pool tugadi) — 503 + Retry-After; nazorat hisobiga qo'shiladi."""
    from fastapi.responses import JSONResponse

    note_pool_timeout()
    return JSONResponse(status_code=503, content={"detail": "Server hozir band — bir necha soniyadan keyin qayta urinib ko'ring."},
                        headers={"Retry-After": "3"})


def _take_counters() -> tuple[int, int]:
    global _pool_timeouts, _shed
    with _lock:
        out = (_pool_timeouts, _shed)
        _pool_timeouts = _shed = 0
    return out


def _record(db, message: str) -> None:
    from app.models.client_error import ClientErrorLog

    now = dt.datetime.now(dt.timezone.utc)
    fp = "server-health-" + now.strftime("%Y%m%d%H")
    row = db.execute(select(ClientErrorLog).where(ClientErrorLog.fingerprint == fp)).scalar_one_or_none()
    if row is None:
        db.add(ClientErrorLog(fingerprint=fp, message=message[:500], source="server", stack="", page="server",
                              user_agent="", username="", app_version="", count=1, users="",
                              first_seen=now, last_seen=now))
    else:
        row.count = (row.count or 0) + 1
        row.message = message[:500]
        row.last_seen = now
        row.resolved_at = None
    db.commit()


def check_once() -> str | None:
    """Bir tekshiruv; ogohlantirish matni (yozilgan bo'lsa) yoki None."""
    from app.core.db import SessionLocal

    timeouts, shed = _take_counters()
    try:
        return _check(SessionLocal, timeouts, shed)
    except Exception:
        # Baza hozir javob bermadi — hisoblar yo'qolmasin, keyingi daqiqada yoziladi.
        global _pool_timeouts, _shed
        with _lock:
            _pool_timeouts += timeouts
            _shed += shed
        raise


#: Qotish sababini keyin aniqlash uchun (2026-11-17: 10:42 va 15:43 da 17–20 ulanish "idle in transaction"
#: holida qotdi, CPU bo'sh edi — qaysi kod kutayotgani noma'lum qoldi). Chegara oshganda: bazadagi uzoq
#: ulanishlarning oxirgi so'rovi va shu ishchidagi Python oqimlarining steki faylga yoziladi.
DIAG_DIR = os.environ.get("IMENTOR_DIAG_DIR", "/app/media/diag")
DIAG_EVERY = 300
_last_diag = 0.0
NL = "\n"


def _db_snapshot(db) -> str:
    rows = db.execute(text(
        "select state, coalesce(wait_event_type, '') wt, coalesce(wait_event, '') we, "
        "extract(epoch from now() - coalesce(xact_start, query_start))::int age, "
        "left(regexp_replace(query, '[[:space:]]+', ' ', 'g'), 200) q "
        "from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() "
        "and state <> 'idle' order by age desc nulls last limit 40"
    )).all()
    return NL.join(f"{r.age:>5}s {r.state:<20} {r.wt}/{r.we:<16} {r.q}" for r in rows)


def _thread_stacks() -> str:
    import sys
    import traceback

    names = {t.ident: t.name for t in threading.enumerate()}
    out = []
    for ident, frame in sys._current_frames().items():
        stack = traceback.extract_stack(frame)
        text_ = "".join(traceback.format_list(stack[-14:]))
        # Bo'sh kutayotgan threadpool oqimlari shovqin — faqat app kodi ichidagilar.
        if "/app/app/" not in text_:
            continue
        out.append(f"--- {names.get(ident, ident)}{NL}{text_}")
    return NL.join(out)


def _write_diag(db, msg: str) -> None:
    global _last_diag
    now = time.time()
    if now - _last_diag < DIAG_EVERY:
        return
    _last_diag = now
    try:
        os.makedirs(DIAG_DIR, exist_ok=True)
        stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d-%H%M%S")
        path = os.path.join(DIAG_DIR, f"stuck-{stamp}-{os.getpid()}.txt")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(f"{msg}{NL}{NL}== baza (eng uzoq 40){NL}{_db_snapshot(db)}{NL}{NL}== oqimlar{NL}{_thread_stacks()}")
        log.warning("server-health: tashxis yozildi %s", path)
    except Exception:  # noqa: BLE001 — tashxis ishni to'xtatmasin
        log.warning("server-health: tashxis yozilmadi", exc_info=True)


def _check(SessionLocal, timeouts: int, shed: int) -> str | None:
    with SessionLocal() as db:
        stuck = db.execute(text(
            "select count(*) from pg_stat_activity where datname = current_database() "
            "and state = 'idle in transaction' and now() - state_change > make_interval(secs => :s)"
        ), {"s": STUCK_SECONDS}).scalar() or 0
        if not timeouts and stuck < STUCK_ALERT and shed < 200:
            return None
        msg = (f"SERVER: baza ulanishlari yetmayapti — oxirgi daqiqada {timeouts} so'rov rad etildi, "
               f"{stuck} ulanish {STUCK_SECONDS // 60}+ daqiqa osilgan, {shed} monitor so'rovi kechiktirildi. "
               f"Ko'p sinf bir vaqtda testda bo'lishi mumkin; davom etsa — dasturchiga ayting.")
        _record(db, msg)
        log.warning(msg)
        _write_diag(db, msg)
        return msg


def _loop() -> None:
    time.sleep(random.uniform(20, 50))
    while True:
        try:
            check_once()
        except Exception:  # noqa: BLE001 — nazorat oqimi to'xtamasin
            log.warning("server-health: tekshiruv xatosi", exc_info=True)
        time.sleep(CHECK_SECONDS)


def start_background() -> None:
    if os.environ.get("IMENTOR_SERVER_HEALTH", "1") == "0":
        return
    threading.Thread(target=_loop, name="server-health", daemon=True).start()
