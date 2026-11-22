from __future__ import annotations

import os
from collections.abc import AsyncGenerator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings

settings = get_settings()

# Pool o'lchami HAR BIR gunicorn worker uchun alohida hisoblanadi, shuning
# uchun jami ulanish = workers × (pool_size + max_overflow) bo'ladi va u
# Postgres `max_connections` dan past qolishi SHART. Serverda 200 ta:
#
#     FastAPI  6 worker × (10 + 15) = 150   (2026-11-17: 4 → 6 worker; Celery va Django olib tashlangan)
#     face_api, psql, migratsiya      ~ 15
#     ────────────────────────────────────
#     jami                           ~165  <  200
#
# Nega oshirildi: bitta worker ichida 48 tagacha ip ishlaydi
# (`APP_THREAD_LIMIT`), lekin ulanish 20 ta edi. Ko'p o'qituvchi bir vaqtda
# kirganda 21-ip 15 soniya kutib, so'ng xato qaytarardi — ish bo'lmagani
# uchun emas, ulanish yetmagani uchun.
#
# AI so'rovlari ulanishni ushlab turmaydi (`_release_db`). Worker sonini
# oshirsangiz, shu yerdagi qiymatlarni ham qayta hisoblang.
engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    pool_size=int(os.environ.get("DB_POOL_SIZE", "10")),
    max_overflow=int(os.environ.get("DB_MAX_OVERFLOW", "15")),
    # Uzoq turgan ulanish (NAT/pgbouncer timeout) jimgina uzilib qolmasin
    pool_recycle=1800,
    # 30s kutish o'rniga tezroq xato — foydalanuvchi 30 soniya osilib
    # qolgandan ko'ra darhol "qayta urinib ko'ring" ni ko'rgani yaxshi.
    pool_timeout=15,
    future=True,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncGenerator[Session, None]:
    """So'rov uchun sessiya. ATAYIN `async`: oddiy (`def`) generator bo'lsa, FastAPI uning
    kirish va CHIQISH qismini (`db.close()`) threadpool'da bajaradi. 2026-11-13: monitor rejimi
    (har telefon har soniya) yukida hamma oqim bo'sh ulanish kutib band bo'ldi, ulanishlar esa
    yopilish uchun bo'sh oqim kutdi — 33 ta ulanish 11 daqiqagacha "idle in transaction" osilib,
    40 daqiqada 2099 so'rov "QueuePool limit reached" oldi (test yaratish ham). Endi ulanish
    event loop'da darhol qaytariladi va oqimga bog'liq emas. `SessionLocal()` hech qanday I/O
    qilmaydi (ulanish birinchi so'rovda olinadi), `close()` esa faqat ulanishni pool'ga qaytaradi."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
