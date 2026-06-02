"""
Server-side DeepSeek API (OpenAI-compatible). Kalit faqat server muhitida.
"""
from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.request
from typing import Any

DEEPSEEK_CHAT_URL = "https://api.deepseek.com/chat/completions"
DEEPSEEK_CHAT = "deepseek-chat"
DEEPSEEK_REASONER = "deepseek-reasoner"


class DeepseekClientError(Exception):
    """Model javobi yoki HTTP xatosi."""


def _parse_retry_after_seconds(message: str) -> float:
    m = re.search(r"[Rr]etry[- ]after[:\s]+(\d+)", message)
    if m:
        return min(120.0, max(3.0, float(m.group(1)) + 1.0))
    return 55.0


def _is_rate_limited(message: str) -> bool:
    return bool(re.search(r"\b429\b|rate.?limit|overloaded", message, re.I))


def _http_post(api_key: str, payload: dict[str, Any], *, timeout_sec: int = 180) -> dict[str, Any]:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        DEEPSEEK_CHAT_URL,
        data=data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        try:
            err_obj = json.loads(body)
            msg = str((err_obj.get("error") or {}).get("message") or body)
        except json.JSONDecodeError:
            msg = body or str(e)
        raise DeepseekClientError(f"HTTP {e.code}: {msg}") from e


def _extract_text(resp: dict[str, Any]) -> str:
    choices = resp.get("choices")
    if not isinstance(choices, list) or not choices:
        raise DeepseekClientError("No choices in DeepSeek response")
    msg = choices[0].get("message") if isinstance(choices[0], dict) else None
    if not isinstance(msg, dict):
        raise DeepseekClientError("No message in DeepSeek response")
    content = msg.get("content")
    if not isinstance(content, str) or not content.strip():
        raise DeepseekClientError("Empty model text")
    return content.strip()


def generate_deepseek_text(
    api_key: str,
    *,
    user_text: str,
    system_instruction: str | None = None,
    model: str = DEEPSEEK_CHAT,
    max_tokens: int = 8192,
    temperature: float = 0.35,
    json_only: bool = False,
    max_429_retries: int = 2,
    timeout_sec: int = 180,
) -> str:
    sys_text = (system_instruction or "").strip()
    if json_only:
        suffix = "\n\nReturn ONLY valid JSON (no markdown fences, no extra text)."
        sys_text = (sys_text + suffix).strip() if sys_text else suffix.strip()

    messages: list[dict[str, str]] = []
    if sys_text:
        messages.append({"role": "system", "content": sys_text})
    messages.append({"role": "user", "content": user_text})

    body: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "stream": False,
    }

    last_err: str | None = None
    for attempt in range(max(1, max_429_retries)):
        try:
            resp = _http_post(api_key, body, timeout_sec=timeout_sec)
            return _extract_text(resp)
        except DeepseekClientError as e:
            msg = str(e)
            last_err = msg
            if _is_rate_limited(msg) and attempt + 1 < max_429_retries:
                time.sleep(_parse_retry_after_seconds(msg))
                continue
            raise

    raise DeepseekClientError(last_err or "Unknown DeepSeek error")


generate_content_with_model_fallback = generate_deepseek_text
GeminiClientError = DeepseekClientError
AnthropicClientError = DeepseekClientError
generate_claude_text = generate_deepseek_text
