"""Slayd rasmlarining odob tekshiruvi (2026-10-20).

O'qituvchilar taqdimotda odobsiz rasm chiqqanini aytdi. Rasmlar Wikimedia
Commons'dan qidiriladi, Commons'da esa yalang'och fotosuratlar ham bor
(masalan "Human body" maqolasining bosh rasmi). Nom va kategoriya bo'yicha
filtr brauzerda ishlaydi, lekin u rasmning O'ZINI ko'rmaydi — shuning uchun
slaydga tushadigan har rasm shu yerda OpenAI moderatsiyasidan o'tadi (bepul).

Chegara standartdan qattiqroq: `flagged` faqat ochiq-oydin rasmda yonadi,
klassik yalang'och rasm (Botticelli "Venera") 0.098 oladi va o'tib ketardi.
Sinov (2026-10-20): yalang'och foto 0.93, klassik yalang'och rasm 0.098,
klinik rasmlar (teri toshmasi, UZI, ko'krak bilan emizish) 0.07 dan past.

Mavzuga moslik (2026-10-21): "rasmlar mavzuga aloqasiz". Nom bo'yicha
saralash rasmni ko'rmaydi — maqola galereyasidan bino, xarita, tasodifiy
odam chiqardi. Odobdan o'tgan rasm eng arzon vision modelga (past aniqlik,
bitta so'z javob) "shu slayd mavzusini ko'rsatadimi?" deb beriladi.
Tekshirib bo'lmasa rasm QOLADI (odob allaqachon tekshirilgan).
"""

from __future__ import annotations

import logging
import os
from concurrent.futures import ThreadPoolExecutor

from app.services import openai_client as oai

logger = logging.getLogger("imentor.image_safety")

MODERATION_URL = "https://api.openai.com/v1/moderations"
MODERATION_MODEL = "omni-moderation-latest"
SEXUAL_LIMIT = float(os.environ.get("IMENTOR_IMAGE_SEXUAL_LIMIT") or 0.08)
MAX_IMAGES = 8
#: Sinov (2026-10-21, 12 rasm 256px da): gpt-4.1-mini 12/12, ~213 token (rasm boshiga
#: ~$0.00009); gpt-4.1-nano 11/12 — virus elektron mikrofotosini rad etdi. Qush
#: (Icterus) "sariqlik" slaydidan, bino, xarita, noutbuk — hammasi to'g'ri rad etildi.
RELEVANCE_MODEL = os.environ.get("IMENTOR_IMAGE_RELEVANCE_MODEL") or "gpt-4.1-mini"
RELEVANCE_PROMPT = (
    "You screen pictures for a slide in a university medical lecture. Answer only yes or no, in English. "
    "yes if the picture shows something related to the lecture topic or the slide: anatomy, histology, "
    "microscopy, the pathogen, a lesion or sign, an imaging study, a diagram or chart, equipment or a procedure, "
    "or the scientist the slide is about. no if it is unrelated or generic: buildings, maps, landscapes, "
    "unrelated people or animals, objects, logos, document scans, decorative art."
)


def verdict(result: dict) -> tuple[bool, float]:
    """(xavfsizmi, jinsiy baho) — moderatsiya javobining bitta natijasidan."""
    cats = result.get("categories") or {}
    scores = result.get("category_scores") or {}
    sexual = max(float(scores.get("sexual") or 0), float(scores.get("sexual/minors") or 0))
    unsafe = bool(cats.get("sexual") or cats.get("sexual/minors")) or sexual >= SEXUAL_LIMIT
    return not unsafe, sexual


def check_image(api_key: str, data_url: str) -> dict:
    """Bitta rasm. Tekshirib bo'lmasa — xavfsiz EMAS (rasm qo'yilmaydi)."""
    try:
        resp = oai._http_post(
            api_key,
            {
                "model": MODERATION_MODEL,
                "input": [{"type": "image_url", "image_url": {"url": data_url}}],
            },
            url=MODERATION_URL,
            timeout_sec=30,
        )
        result = (resp.get("results") or [None])[0]
        if not isinstance(result, dict):
            return {"safe": False, "sexual": None, "error": "javob bo'sh"}
        safe, sexual = verdict(result)
        return {"safe": safe, "sexual": round(sexual, 4)}
    except oai.OpenAiClientError as exc:
        logger.warning("image_safety: moderatsiya ishlamadi: %s", str(exc)[:200])
        return {"safe": False, "sexual": None, "error": "tekshirib bo'lmadi"}


def check_relevance(api_key: str, data_url: str, topic: str) -> bool | None:
    """Rasm slayd mavzusini ko'rsatadimi. None — tekshirib bo'lmadi."""
    body = {
        "model": RELEVANCE_MODEL,
        "messages": [
            {"role": "system", "content": RELEVANCE_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": topic[:300]},
                    {"type": "image_url", "image_url": {"url": data_url, "detail": "low"}},
                ],
            },
        ],
        "max_tokens": 2,
        "temperature": 0,
    }
    try:
        resp = oai._post_chat(api_key, body, timeout_sec=30)
        oai._log_usage(resp, oai._usage_model(resp, RELEVANCE_MODEL), "image_relevance")
        choice = ((resp.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
    except (oai.OpenAiClientError, AttributeError, IndexError) as exc:
        logger.warning("image_safety: moslik tekshirilmadi: %s", str(exc)[:200])
        return None
    answer = choice.strip().lower()
    if answer.startswith(("no", "yo", "нет")):
        return False
    # Model ba'zan slayd tilida javob beradi ("ha", "да").
    if answer.startswith(("yes", "ha", "да")):
        return True
    return None


def _check_one(api_key: str, data_url: str, topic: str, thumb: str) -> dict:
    out = check_image(api_key, data_url)
    if topic and out.get("safe"):
        # Moslik uchun kichik nusxa (256px, ~200 token); bo'lmasa asl rasm.
        out["relevant"] = check_relevance(api_key, thumb or data_url, topic)
    return out


def check_images(
    api_key: str, data_urls: list[str], topic: str = "", thumbs: list[str] | None = None,
) -> list[dict]:
    thumbs = thumbs or []
    pairs = [(u, thumbs[i] if i < len(thumbs) else "") for i, u in enumerate(data_urls)]
    if len(pairs) <= 1:
        return [_check_one(api_key, u, topic, t) for u, t in pairs]
    with ThreadPoolExecutor(max_workers=min(4, len(pairs))) as pool:
        return list(pool.map(lambda ut: _check_one(api_key, ut[0], topic, ut[1]), pairs))
