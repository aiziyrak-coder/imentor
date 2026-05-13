"""
Server-side Gemini calls via Generative Language REST API (API key never exposed to browsers).
"""
from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.request
from typing import Any

GEMINI_V1BETA = "https://generativelanguage.googleapis.com/v1beta/models"


class GeminiClientError(Exception):
    """Raised when the model returns no usable text or the request fails after retries."""


def _parse_retry_after_seconds(message: str) -> float:
    m = re.search(r"[Rr]etry in ([\d.]+)\s*s", message)
    if m:
        sec = float(m.group(1))
        return min(120.0, max(3.0, sec + 1.0))
    return 55.0


def _http_post(url: str, payload: dict[str, Any], *, timeout_sec: int = 180) -> dict[str, Any]:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
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
        raise GeminiClientError(f"HTTP {e.code}: {msg}") from e


def _candidate_text(resp: dict[str, Any]) -> str:
    fb = resp.get("promptFeedback")
    if isinstance(fb, dict):
        br = fb.get("blockReason")
        if br:
            raise GeminiClientError(f"Prompt blocked: {br}")
    cands = resp.get("candidates")
    if not isinstance(cands, list) or not cands:
        raise GeminiClientError("No candidates in Gemini response")
    c0 = cands[0] if isinstance(cands[0], dict) else {}
    content = c0.get("content") if isinstance(c0, dict) else None
    parts = (content or {}).get("parts") if isinstance(content, dict) else None
    if not isinstance(parts, list):
        raise GeminiClientError("No content parts in Gemini response")
    chunks: list[str] = []
    for p in parts:
        if isinstance(p, dict) and isinstance(p.get("text"), str):
            chunks.append(p["text"])
    if not chunks:
        raise GeminiClientError("Empty model text")
    return "".join(chunks)


def _should_try_next_model(message: str) -> bool:
    return bool(
        re.search(r"\b403\b|\b404\b|PERMISSION_DENIED|not found for API version", message, re.I)
    )


def _is_rate_limited(message: str) -> bool:
    return bool(
        re.search(r"\b429\b|RESOURCE_EXHAUSTED|quota exceeded|rate.?limit", message, re.I)
    )


def generate_content_with_model_fallback(
    api_key: str,
    *,
    models: list[str],
    user_text: str,
    system_instruction: str | None,
    generation_config: dict[str, Any],
    max_429_retries_per_model: int = 2,
    timeout_sec: int = 180,
) -> str:
    """
    Try models in order; on 403/404 skip to next; on 429 wait and retry then next model.
    """
    max429 = min(4, max(1, max_429_retries_per_model))
    last_err: str | None = None

    for model in models:
        url = f"{GEMINI_V1BETA}/{model}:generateContent?key={api_key}"
        for attempt in range(max429):
            body: dict[str, Any] = {
                "contents": [{"role": "user", "parts": [{"text": user_text}]}],
                "generationConfig": generation_config,
            }
            if system_instruction and system_instruction.strip():
                body["systemInstruction"] = {"parts": [{"text": system_instruction.strip()}]}
            try:
                resp = _http_post(url, body, timeout_sec=timeout_sec)
                return _candidate_text(resp)
            except GeminiClientError as e:
                msg = str(e)
                last_err = msg
                if _should_try_next_model(msg):
                    break
                if _is_rate_limited(msg):
                    if attempt + 1 < max429:
                        wait = _parse_retry_after_seconds(msg)
                        time.sleep(wait)
                        continue
                    break
                raise
        continue

    base = last_err or "Unknown Gemini error"
    hint = (
        "\n429 / kvota: bir necha daqiqa kutib qayta urining yoki Google AI Studio da billing / limitni tekshiring."
        if _is_rate_limited(base)
        else ""
    )
    hint403 = (
        "\n403/404: server GEMINI_API_KEY, Generative Language API va kalit cheklovlarini tekshiring."
        if _should_try_next_model(base) or "403" in base or "404" in base
        else ""
    )
    raise GeminiClientError(f"{base}{hint}{hint403}")
