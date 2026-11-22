from __future__ import annotations

import logging
import os
import threading
from contextlib import asynccontextmanager

from anyio import to_thread
from fastapi import FastAPI
from sqlalchemy.exc import TimeoutError as SqlPoolTimeout
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from app.admin import register_admin
from app.api.routes import (
    account_security,
    admin_reports,
    analytics,
    auth,
    client_errors,
    clinic_admin,
    clinical_group,
    content_catalog,
    department_admin,
    device_pairing,
    face_login,
    pinfl_login,
    education_ai,
    external_api,
    camera_davomat,
    health,
    legacy,
    live_monitor,
    live_test,
    monitor_rooms,
    offsite_lesson,
    malaka,
    online_admin,
    online_lesson,
    online_student,
    online_teacher,
    prepared_content,
    rector,
    staff_admin,
    staff_absence,
    staff_merge,
    staff_self,
    staff_location,
    student_contingent,
    subject_book,
    syllabus_catalog,
    telegram_bot,
    topic_content,
)
from app.core.compression import SmartGZipMiddleware
from app.core.config import get_settings
from app.services.file_storage import media_root

settings = get_settings()

@asynccontextmanager
def _warm_rector_report() -> None:
    """Rektor hisobotini oldindan hisoblab qo'yish (orqa fonda).

    Hisobot og'ir: 7 kunlik ~8 soniya, 30 kunlik ~24. Natija keshlanadi,
    lekin dastur qayta ishga tushganda kesh bo'sh bo'ladi va BIRINCHI
    ochgan odam o'sha vaqtni kutadi. Shu yerda eng ko'p so'raladigan ikki
    davr oldindan hisoblanadi, shuning uchun rektor kutmaydi (2026-10-13).

    Xato bo'lsa jim o'tiladi: bu faqat tezlik uchun, ilovaning ishlashiga
    daxli yo'q.
    """
    if os.environ.get("IMENTOR_WARM_REPORT", "1") != "1":
        return

    def run() -> None:
        import datetime as dt
        import time as _time

        # Rektor bosganda DARHOL ochilsin (2026-11-15): eng ko'p so'raladigan davrlar keshda doim yangi
        # turadi — kesh 5 daqiqa, isitish har 4 daqiqada. Har ishchi jarayonning o'z keshi bor.
        period = int(os.environ.get("IMENTOR_WARM_EVERY_SECONDS", "240"))
        last_heavy = 0.0
        while True:
            try:
                from sqlalchemy import text as _sql

                from app.core.db import SessionLocal, engine
                from app.services import control_report_service as control
                from app.services import lesson_report_service as lessons

                # Bitta jarayon hisoblaydi (natija umumiy Redis keshiga tushadi), qolganlari tayyorini oladi.
                with engine.connect() as conn:
                    got = conn.execute(_sql("SELECT pg_try_advisory_lock(7211116)")).scalar()
                    conn.commit()
                    if got:
                        try:
                            today = lessons.current_time().date()
                            ranges = [(today - dt.timedelta(days=6), today), (today, today),
                                      (today - dt.timedelta(days=1), today - dt.timedelta(days=1))]
                            # Og'ir davrlar (Bu oy, 30 kun, O'tgan oy) — har 15 daqiqada.
                            if _time.time() - last_heavy > 900:
                                first = today.replace(day=1)
                                prev_end = first - dt.timedelta(days=1)
                                ranges += [(first, today), (today - dt.timedelta(days=29), today),
                                           (prev_end.replace(day=1), prev_end)]
                                last_heavy = _time.time()
                            with SessionLocal() as db:
                                for start, end in ranges:
                                    control.warm(db, start, end)
                            logging.getLogger("app").info("rektor hisoboti oldindan hisoblandi (%d davr)", len(ranges))
                        finally:
                            conn.execute(_sql("SELECT pg_advisory_unlock(7211116)"))
                            conn.commit()
            except Exception:
                logging.getLogger("app").warning("hisobotni oldindan hisoblab bo'lmadi", exc_info=True)
            if period <= 0:
                return
            _time.sleep(period)

    threading.Thread(target=run, name="warm-rector-report", daemon=True).start()


async def lifespan(_app: FastAPI):
    """Sinxron (`def`) endpointlar uchun ishchi oqimlar (thread) chegarasi.

    FastAPI `def` bilan yozilgan endpointlarni threadpool'da bajaradi.
    AI generatsiyasi 1-5 daqiqa davom etadi va shu vaqt davomida bitta
    oqimni band qiladi — chegara juda past bo'lsa, AI so'rovlari login va
    sillabus kabi tez so'rovlarni ham bloklab qo'yadi.

    Anyio standarti 40; uni aniq belgilab qo'yamiz, shunda kutubxona
    versiyasi o'zgarganda sig'im jimgina o'zgarib ketmaydi.
    """
    limiter = to_thread.current_default_thread_limiter()
    limiter.total_tokens = int(os.environ.get("APP_THREAD_LIMIT", "48"))
    _warm_rector_report()
    # Ota-onalar boti: yangi test natijalari va kunlik hisobot (token bo'lmasa ishga tushmaydi).
    from app.services import parent_bot_notify

    parent_bot_notify.start_background()
    # Dars nazorati boti: kirmagan o'qituvchilar haqida guruhga xabar (2026-11-15; token bo'lmasa ishlamaydi).
    from app.services import lesson_watch_bot

    lesson_watch_bot.start_background()
    # «HEMIS'da baho bor, iMentor ochilmagan» darslar: kuniga ikki marta, HEMIS'dan faqat o'qish (2026-11-16).
    from app.services import graded_scan

    graded_scan.start_background()
    # Talabalar natijalari arxivi: yakunlangan testlar har 5 daqiqada (2026-10-23).
    from app.services import results_archive

    results_archive.start_background()
    # Server yuki nazorati (2026-11-13): ulanish tugasa admin «Sayt xatolari»da ogohlantirish.
    from app.services import server_health

    server_health.start_background()
    # Fan va mavzu nomlari tarjimasidagi bo'shliqlar har 2 soatda to'ldiriladi (2026-11-12).
    from app.services import syllabus_i18n_repair

    syllabus_i18n_repair.start_background()
    yield


# Gunicorn/uvicorn faqat o'zining loglarini sozlaydi, ilova loggerlari esa
# standart WARNING darajasida qolardi — ya'ni token sarfi va RAG hajmi kabi
# hisob qatorlari hech qayerga chiqmasdi. Shuni ochamiz (darajani `IMENTOR_LOG_LEVEL`
# bilan o'zgartirish mumkin).
_LEVEL = os.environ.get("IMENTOR_LOG_LEVEL", "INFO").upper()
_handler = logging.StreamHandler()
_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
for _name in ("app", "imentor"):
    _lg = logging.getLogger(_name)
    _lg.setLevel(_LEVEL)
    if not _lg.handlers:
        _lg.addHandler(_handler)
    _lg.propagate = False


app = FastAPI(title="iMentor API (FastAPI)", version="0.1.0", lifespan=lifespan)


# Baza ulanishi tugadi: 500 o'rniga 503 + Retry-After, hisob — nazoratga (`server_health`, 2026-11-13).
from app.services.server_health import pool_timeout_handler  # noqa: E402

app.add_exception_handler(SqlPoolTimeout, pool_timeout_handler)

# Sillabus katalogi ~1.5 MB JSON qaytaradi — gzip'siz har bir o'qituvchi
# kirganda shuncha trafik ketadi. SSE oqimi va siqilgan fayllar chetlab
# o'tiladi (app/core/compression.py).
app.add_middleware(SmartGZipMiddleware, minimum_size=1024, compresslevel=6)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(SessionMiddleware, secret_key=settings.django_secret_key)

register_admin(app)

app.include_router(health.router, prefix="/api", tags=["health"])
app.include_router(auth.router, prefix="/api/v1", tags=["auth"])
app.include_router(face_login.router, prefix="/api/v1", tags=["face-login"])
app.include_router(pinfl_login.router, prefix="/api/v1", tags=["pinfl-login"])
app.include_router(syllabus_catalog.router, prefix="/api/v1", tags=["syllabus"])
app.include_router(department_admin.router, prefix="/api/v1", tags=["departments"])
app.include_router(live_test.router, prefix="/api/v1", tags=["live-test"])
app.include_router(live_monitor.router, prefix="/api/v1", tags=["live-monitor"])
app.include_router(online_admin.router, prefix="/api/v1", tags=["online-admin"])
app.include_router(online_teacher.router, prefix="/api/v1", tags=["online-teacher"])
app.include_router(online_lesson.router, prefix="/api/v1", tags=["online-lesson"])
app.include_router(online_student.router, prefix="/api/v1", tags=["online-student"])
app.include_router(malaka.router, prefix="/api/v1", tags=["malaka"])
app.include_router(staff_location.router, prefix="/api/v1", tags=["staff-location"])
app.include_router(student_contingent.router, prefix="/api/v1", tags=["student-contingent"])
app.include_router(clinical_group.router, prefix="/api/v1", tags=["clinical-group"])
app.include_router(clinic_admin.router, prefix="/api/v1", tags=["clinic-admin"])
app.include_router(subject_book.router, prefix="/api/v1", tags=["subject-book"])
app.include_router(device_pairing.router, prefix="/api/v1", tags=["device-pairing"])
app.include_router(staff_admin.router, prefix="/api/v1", tags=["staff-admin"])
app.include_router(staff_merge.router, prefix="/api/v1", tags=["staff-merge"])
app.include_router(staff_self.router, prefix="/api/v1", tags=["staff-self"])
app.include_router(client_errors.router, prefix="/api/v1", tags=["client-errors"])
app.include_router(content_catalog.router, prefix="/api/v1", tags=["content-catalog"])
app.include_router(topic_content.router, prefix="/api/v1", tags=["topic-content"])
app.include_router(education_ai.router, prefix="/api/v1", tags=["education-ai"])
app.include_router(external_api.router, prefix="/api/v1", tags=["external-api"])
app.include_router(camera_davomat.router, prefix="/api/v1", tags=["camera-davomat"])
app.include_router(prepared_content.router, prefix="/api/v1", tags=["prepared-content"])
app.include_router(analytics.router, prefix="/api/v1", tags=["analytics"])
app.include_router(admin_reports.router, prefix="/api/v1", tags=["admin-reports"])
app.include_router(rector.router, prefix="/api/v1", tags=["rector"])
app.include_router(staff_absence.router, prefix="/api/v1", tags=["staff-absence"])
app.include_router(offsite_lesson.router, prefix="/api/v1", tags=["offsite-lesson"])
app.include_router(monitor_rooms.router, prefix="/api/v1", tags=["monitor-rooms"])
app.include_router(telegram_bot.router, prefix="/api/v1", tags=["telegram-bot"])
app.include_router(account_security.router, prefix="/api/v1", tags=["account-security"])
app.include_router(legacy.router, prefix="/api/v1", tags=["legacy"])
app.include_router(legacy.root_router, prefix="/api", tags=["legacy"])

_media_mount_path = "/" + settings.django_media_url.strip("/")
os.makedirs(media_root(), exist_ok=True)
app.mount(_media_mount_path, StaticFiles(directory=media_root()), name="media")
