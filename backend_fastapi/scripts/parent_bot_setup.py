"""Ota-onalar Telegram botini sozlash va holatini ko'rish (2026-10-22).

    python scripts/parent_bot_setup.py            # webhook, buyruqlar, tavsif o'rnatiladi
    python scripts/parent_bot_setup.py --status   # faqat holat: webhook va statistika

Token `TELEGRAM_BOT_TOKEN` dan olinadi va HECH QAYERGA chiqarilmaydi.
Manzil: `PARENT_BOT_PUBLIC_URL` (standart https://imentor.uz).
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import text  # noqa: E402

from app.core.db import SessionLocal  # noqa: E402
from app.services import telegram_api as tg  # noqa: E402

COMMANDS = {
    "uz": [("start", "Boshlash"), ("today", "Bugungi darslar va natijalar"), ("history", "Natijalar tarixi"),
           ("children", "Farzandlarim"), ("add", "Farzand qo‘shish"), ("settings", "Sozlamalar"),
           ("help", "Yordam")],
    "ru": [("start", "Начать"), ("today", "Занятия и результаты сегодня"), ("history", "История результатов"),
           ("children", "Мои дети"), ("add", "Добавить ребёнка"), ("settings", "Настройки"), ("help", "Помощь")],
    "en": [("start", "Start"), ("today", "Today's classes and results"), ("history", "Results history"),
           ("children", "My children"), ("add", "Add a child"), ("settings", "Settings"), ("help", "Help")],
}
DESCRIPTION = {
    "uz": ("FJSTI talabalarining ota-onalari uchun: farzandingizning har bir darsdagi test natijasi — "
           "kun, para, fan, mavzu va ball. Har bir natija o‘zi keladi, kechqurun kunlik hisobot."),
    "ru": ("Для родителей студентов ФМИОЗ: результат каждого теста ребёнка на занятиях — день, пара, "
           "предмет, тема и балл. Каждый результат приходит сам, вечером — отчёт за день."),
    "en": ("For parents of FMIPH students: your child's result in every class test — day, period, subject, "
           "topic and score. Every result arrives automatically, plus a daily evening report."),
}
SHORT = {
    "uz": "Farzandingizning dars va test natijalari — iMentor",
    "ru": "Занятия и результаты тестов вашего ребёнка — iMentor",
    "en": "Your child's classes and test results — iMentor",
}


def status() -> None:
    me = tg.call("getMe")
    print("bot:", "@" + str(me.get("username")))
    info = tg.call("getWebhookInfo")
    url = str(info.get("url") or "")
    print("webhook:", url or "(yo'q)", "| navbatda:", info.get("pending_update_count"),
          "| oxirgi xato:", info.get("last_error_message") or "-")
    with SessionLocal() as db:
        q = lambda sql: db.execute(text(sql)).all()  # noqa: E731
        print("suhbatlar:", q("SELECT count(*), count(*) FILTER (WHERE is_blocked) FROM core_parentbotchat"))
        print("ulangan farzandlar:", q("SELECT count(*), count(DISTINCT student_id) FROM core_parentbotlink WHERE is_active"))
        print("bugungi xabarlar:", q("""SELECT kind, status, count(*) FROM core_parentbotnotice
                                      WHERE created_at > current_date GROUP BY 1, 2 ORDER BY 1, 2"""))


def setup() -> None:
    base = (os.environ.get("PARENT_BOT_PUBLIC_URL") or "https://imentor.uz").rstrip("/")
    tg.call("setWebhook", {
        "url": f"{base}/api/v1/telegram/parent-bot/webhook/",
        "secret_token": tg.webhook_secret(),
        "allowed_updates": ["message", "callback_query", "my_chat_member"],
        "max_connections": 8,
    })
    for lang, items in COMMANDS.items():
        commands = [{"command": c, "description": d} for c, d in items]
        tg.call("setMyCommands", {"commands": commands, "language_code": lang})
        tg.call("setMyDescription", {"description": DESCRIPTION[lang], "language_code": lang})
        tg.call("setMyShortDescription", {"short_description": SHORT[lang], "language_code": lang})
    # Tili ko'rsatilmagan foydalanuvchilarga — o'zbekcha.
    tg.call("setMyCommands", {"commands": [{"command": c, "description": d} for c, d in COMMANDS["uz"]]})
    tg.call("setMyDescription", {"description": DESCRIPTION["uz"]})
    tg.call("setMyShortDescription", {"short_description": SHORT["uz"]})
    print("sozlandi")
    status()


if __name__ == "__main__":
    if not tg.enabled():
        raise SystemExit("TELEGRAM_BOT_TOKEN berilmagan")
    try:
        status() if "--status" in sys.argv else setup()
    except tg.TelegramError as exc:
        raise SystemExit(f"Telegram xatosi: {exc.code} {exc.description}") from None
