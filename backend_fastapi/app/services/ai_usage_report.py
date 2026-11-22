"""AI (OpenAI) sarfi hisoboti — `/rector/ai-usage/` uchun.

`openai_client._log_usage` har chaqiruvni `core_aiusagelog` ga yozadi; bu yerda
funksiya × model bo'yicha token va taxminiy narx yig'iladi. Tejash o'lchovi shu
endpoint bilan oldin-keyin solishtiriladi. (2026-11-17 gacha `rector_admin_service`
ichida edi; qolgan admin-hisobotlari ishlatilmagani uchun o'chirildi.)
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.services.activity_report_service import range_bounds
from app.services.rector_report_service import _pct

# ============================ AI sarfi ============================

# Taxminiy ro'yxat narxi, AQSh dollari / 1 mln token: (kirish, keshdan, chiqish).
# Faqat solishtirish uchun — aniq summa OpenAI hisobida.
AI_PRICES: dict[str, tuple[float, float, float]] = {
    "gpt-4.1-nano": (0.10, 0.025, 0.40),
    "gpt-4.1-mini": (0.40, 0.10, 1.60),
    # 2026-10-19, developers.openai.com/api/docs/pricing (standard).
    "gpt-5.4-nano": (0.20, 0.02, 1.25),
    "gpt-5.4-mini": (0.75, 0.075, 4.50),
    "gpt-5-mini": (0.25, 0.025, 2.00),
    "gpt-5.4": (2.50, 0.25, 15.00),
    "gpt-5-nano": (0.05, 0.005, 0.40),
    "gpt-4o-mini": (0.15, 0.075, 0.60),
    "gpt-4o": (2.50, 1.25, 10.00),
    "text-embedding-3-small": (0.02, 0.02, 0.0),
}


def _price(model: str) -> tuple[float, float, float]:
    name = (model or "").lower()
    # Flex rejimi (2026-10-21): "gpt-5.4-nano@flex" — asosiy narxning yarmi.
    if name.endswith("@flex"):
        return tuple(x / 2 for x in _price(name[: -len("@flex")]))  # type: ignore[return-value]
    # Eng uzun mos prefiks: "gpt-4o-mini" "gpt-4o" dan oldin tekshirilsin.
    for key in sorted(AI_PRICES, key=len, reverse=True):
        if name.startswith(key):
            return AI_PRICES[key]
    # Noma'lum model — qimmatiga hisoblanadi (sarf kam ko'rsatilmasin). Ilgari
    # gpt-4.1-nano ro'yxatda yo'q edi va 25 barobar qimmat ko'rsatilardi.
    return AI_PRICES["gpt-4o"]


def _cost(model: str, prompt: int, cached: int, completion: int) -> float:
    p_in, p_cached, p_out = _price(model)
    fresh = max(0, prompt - cached)
    return (fresh * p_in + cached * p_cached + completion * p_out) / 1_000_000


def ai_usage(db: Session, *, start_day: dt.date, end_day: dt.date) -> dict:
    """Qaysi funksiya qancha token va taxminan qancha pul yeydi."""
    from app.models.ai_usage import AiUsageLog

    start, end = range_bounds(start_day, end_day)
    grouped = db.execute(
        select(
            AiUsageLog.kind,
            AiUsageLog.model,
            func.count().label("calls"),
            func.coalesce(func.sum(AiUsageLog.prompt_tokens), 0).label("prompt"),
            func.coalesce(func.sum(AiUsageLog.cached_tokens), 0).label("cached"),
            func.coalesce(func.sum(AiUsageLog.completion_tokens), 0).label("completion"),
            func.coalesce(func.sum(AiUsageLog.total_tokens), 0).label("total"),
        )
        .where(AiUsageLog.created_at >= start, AiUsageLog.created_at < end)
        .group_by(AiUsageLog.kind, AiUsageLog.model)
    ).all()

    rows = []
    for r in grouped:
        prompt, cached, completion = int(r.prompt), int(r.cached), int(r.completion)
        rows.append(
            {
                "kind": r.kind or "boshqa",
                "model": r.model,
                "calls": int(r.calls),
                "prompt_tokens": prompt,
                "cached_tokens": cached,
                "completion_tokens": completion,
                "total_tokens": int(r.total),
                "cached_pct": _pct(cached, prompt),
                "avg_tokens": round(int(r.total) / int(r.calls)) if r.calls else 0,
                "cost_usd": round(_cost(r.model, prompt, cached, completion), 4),
            }
        )
    rows.sort(key=lambda x: -x["cost_usd"])

    local_day = func.date(func.timezone("Asia/Tashkent", AiUsageLog.created_at))
    by_day = {
        str(r.day): r
        for r in db.execute(
            select(
                local_day.label("day"),
                func.count().label("calls"),
                func.coalesce(func.sum(AiUsageLog.total_tokens), 0).label("total"),
            )
            .where(AiUsageLog.created_at >= start, AiUsageLog.created_at < end)
            .group_by("day")
        ).all()
    }
    days = []
    cursor = start_day
    while cursor <= end_day:
        hit = by_day.get(cursor.isoformat())
        days.append(
            {
                "date": cursor.isoformat(),
                "calls": int(hit.calls) if hit else 0,
                "tokens": int(hit.total) if hit else 0,
            }
        )
        cursor += dt.timedelta(days=1)

    total_prompt = sum(x["prompt_tokens"] for x in rows)
    total_cached = sum(x["cached_tokens"] for x in rows)
    return {
        "from": start_day.isoformat(),
        "to": end_day.isoformat(),
        "calls": sum(x["calls"] for x in rows),
        "tokens": sum(x["total_tokens"] for x in rows),
        "cached_pct": _pct(total_cached, total_prompt),
        "cost_usd": round(sum(x["cost_usd"] for x in rows), 4),
        "prices_note": "Taxminiy ro'yxat narxi (USD / 1 mln token); aniq summa OpenAI hisobida.",
        "results": rows,
        "days": days,
    }
