"""Telegram Bot API — ota-onalar boti uchun eng kichik mijoz (2026-10-22).

Token faqat serverdagi `.env` da (`TELEGRAM_BOT_TOKEN`). U so'rov manzilining
ichida yuradi, shuning uchun xato matnlariga manzil HECH QACHON qo'shilmaydi:
`requests` istisnosi o'rniga faqat uning turi yoziladi.
"""

from __future__ import annotations

import hashlib
import os

import requests

API = "https://api.telegram.org/bot{token}/{method}"


class TelegramError(Exception):
    def __init__(self, code: int, description: str, retry_after: int | None = None):
        super().__init__(f"{code} {description}")
        self.code = code
        self.description = description
        self.retry_after = retry_after

    @property
    def blocked(self) -> bool:
        """Foydalanuvchi botni bloklagan yoki hisobi o'chgan — qayta urinish befoyda."""
        text = self.description.lower()
        return self.code == 403 or "chat not found" in text or "user is deactivated" in text


def bot_token() -> str:
    return (os.environ.get("TELEGRAM_BOT_TOKEN") or "").strip()


def enabled() -> bool:
    return bool(bot_token())


def webhook_secret() -> str:
    """Telegram har so'rovda `X-Telegram-Bot-Api-Secret-Token` sarlavhasida qaytaradi.

    Alohida o'zgaruvchi berilmasa, tokendan olinadi (token o'zgarsa — u ham).
    """
    own = (os.environ.get("TELEGRAM_WEBHOOK_SECRET") or "").strip()
    if own:
        return own
    token = bot_token()
    return hashlib.sha256(f"imentor-parent-bot:{token}".encode()).hexdigest() if token else ""


def call(method: str, payload: dict | None = None, *, timeout: float = 15.0):
    token = bot_token()
    if not token:
        raise TelegramError(0, "TELEGRAM_BOT_TOKEN berilmagan")
    try:
        res = requests.post(API.format(token=token, method=method), json=payload or {}, timeout=timeout)
    except requests.RequestException as exc:
        raise TelegramError(0, type(exc).__name__) from None
    try:
        data = res.json()
    except ValueError:
        raise TelegramError(res.status_code, "javob JSON emas") from None
    if not data.get("ok"):
        params = data.get("parameters") or {}
        raise TelegramError(int(data.get("error_code") or res.status_code), str(data.get("description") or ""),
                            params.get("retry_after"))
    return data.get("result")


MAX_TEXT = 4096


def fit(text: str) -> str:
    """Telegram 4096 belgidan uzun xabarni qabul qilmaydi — qator chegarasida kesiladi
    (har bir qatorning HTML teglari o'zida yopiladi, shuning uchun belgilash buzilmaydi)."""
    if len(text) <= MAX_TEXT:
        return text
    cut = text.rfind("\n", 0, MAX_TEXT - 20)
    return text[:cut if cut > 0 else MAX_TEXT - 20].rstrip() + "\n…"


class Api:
    """Bot ishlatadigan usullar. Testlarda shu sinf o'rniga yozib oluvchi soxtasi beriladi."""

    def send(self, chat_id: int, text: str, markup: dict | None = None) -> dict:
        payload = {"chat_id": chat_id, "text": fit(text), "parse_mode": "HTML", "disable_web_page_preview": True}
        if markup:
            payload["reply_markup"] = markup
        return call("sendMessage", payload)

    def edit(self, chat_id: int, message_id: int, text: str, markup: dict | None = None) -> None:
        payload = {"chat_id": chat_id, "message_id": message_id, "text": fit(text), "parse_mode": "HTML",
                   "disable_web_page_preview": True}
        if markup:
            payload["reply_markup"] = markup
        try:
            call("editMessageText", payload)
        except TelegramError as exc:
            # Bir xil matn bilan qayta bosilgan tugma — xato emas.
            if "message is not modified" not in exc.description:
                raise

    def answer(self, callback_id: str, text: str = "") -> None:
        try:
            call("answerCallbackQuery", {"callback_query_id": callback_id, "text": text[:190]})
        except TelegramError:
            pass  # 15 soniyadan eski tugma — javob kutilmaydi, ekran baribir yangilanadi
