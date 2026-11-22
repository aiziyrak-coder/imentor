"""Ota-onalar Telegram boti: webhook (2026-10-22).

Telegram har bir yangilanishni shu manzilga yuboradi (`scripts/parent_bot_setup.py`
o'rnatadi). So'rov faqat to'g'ri `X-Telegram-Bot-Api-Secret-Token` bilan qabul
qilinadi. Ichkarida xato bo'lsa ham 200 qaytariladi — aks holda Telegram o'sha
yangilanishni to'xtovsiz qayta yuboradi.
"""

from __future__ import annotations

import hmac
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.services import parent_bot, telegram_api

router = APIRouter()
log = logging.getLogger("app.parent_bot")


@router.post("/telegram/parent-bot/webhook/")
def parent_bot_webhook(request: Request, update: dict, db: Session = Depends(get_db)) -> dict:
    expected = telegram_api.webhook_secret()
    got = request.headers.get("X-Telegram-Bot-Api-Secret-Token", "")
    if not expected or not hmac.compare_digest(got.encode(), expected.encode()):
        raise HTTPException(status_code=403, detail="forbidden")
    try:
        parent_bot.handle_update(db, update)
    except Exception:  # noqa: BLE001
        db.rollback()
        log.warning("parent-bot: yangilanishni bajarib bo'lmadi (update_id=%s)", update.get("update_id"), exc_info=True)
    return {"ok": True}
