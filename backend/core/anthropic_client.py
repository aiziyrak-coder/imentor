"""
Server-side Anthropic Claude API (kalit brauzerda emas).
Asosiy model: Claude Sonnet 4.5; prompt caching tizim matnida.
"""
from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.request
from typing import Any

ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"
CLAUDE_SONNET = "claude-sonnet-4-5-20250929"


class AnthropicClientError(Exception):
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
        ANTHROPIC_MESSAGES_URL,
        data=data,
        headers={
            "Content-Type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": ANTHROPIC_VERSION,
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
        raise AnthropicClientError(f"HTTP {e.code}: {msg}") from e


def _extract_text(resp: dict[str, Any]) -> str:
    content = resp.get("content")
    if not isinstance(content, list):
        raise AnthropicClientError("No content in Claude response")
    chunks: list[str] = []
    for block in content:
        if isinstance(block, dict) and block.get("type") == "text" and isinstance(block.get("text"), str):
            chunks.append(block["text"])
    if not chunks:
        raise AnthropicClientError("Empty model text")
    return "".join(chunks)


def _system_blocks(system_instruction: str | None, *, cache: bool) -> list[dict[str, Any]]:
    t = (system_instruction or "").strip()
    if not t:
        return []
    block: dict[str, Any] = {"type": "text", "text": t}
    if cache:
        block["cache_control"] = {"type": "ephemeral"}
    return [block]


def generate_claude_text(
    api_key: str,
    *,
    user_text: str,
    system_instruction: str | None = None,
    model: str = CLAUDE_SONNET,
    max_tokens: int = 8192,
    temperature: float = 0.35,
    json_only: bool = False,
    max_429_retries: int = 2,
    timeout_sec: int = 180,
) -> str:
    """
    Claude Messages API — bitta user matn, ixtiyoriy tizim ko‘rsatmasi.
    json_only=True bo‘lsa tizimga JSON-only qoidasi qo‘shiladi.
    """
    sys_text = (system_instruction or "").strip()
    if json_only:
        suffix = "\n\nReturn ONLY valid JSON (no markdown fences, no extra text)."
        sys_text = (sys_text + suffix).strip() if sys_text else suffix.strip()

    body: dict[str, Any] = {
        "model": model,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "messages": [{"role": "user", "content": [{"type": "text", "text": user_text}]}],
    }
    if sys_text:
        body["system"] = _system_blocks(sys_text, cache=True)

    last_err: str | None = None
    for attempt in range(max(1, max_429_retries)):
        try:
            resp = _http_post(api_key, body, timeout_sec=timeout_sec)
            return _extract_text(resp)
        except AnthropicClientError as e:
            msg = str(e)
            last_err = msg
            if _is_rate_limited(msg) and attempt + 1 < max_429_retries:
                time.sleep(_parse_retry_after_seconds(msg))
                continue
            raise

    raise AnthropicClientError(last_err or "Unknown Anthropic error")


# Eski import nomi bilan moslik
generate_content_with_model_fallback = generate_claude_text
GeminiClientError = AnthropicClientError
