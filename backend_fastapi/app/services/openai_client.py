from __future__ import annotations

import json
import logging
import os
import re
import time
from typing import Any, Iterator

import requests

OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions"
OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings"
OPENAI_EMBEDDING_MODEL = "text-embedding-3-small"
OPENAI_EMBEDDING_DIMENSIONS = 1536


class OpenAiClientError(Exception):
    """Model javobi yoki HTTP xatosi."""


#: Sifat muhim bo'lgan YAGONA vazifa — test savollari (2026-10-16).
#:
#: Hamma narsa `gpt-4.1-nano` da yurardi (tejash qarori, 2026-09-16). Test
#: uchun bu yetmadi: 15–16 oktabrda yaratilgan 1437 savolning 35% ida bitta
#: savol ichida bir nechta savol bor edi, savol matni o'rtacha 26 so'z —
#: USMLE vignette emas. Faqat test yaratish va tuzatish `gpt-4.1-mini` da;
#: tarjima, izoh, keys, ma'ruza — avvalgidek eng arzon modelda. Narxi:
#: haftasiga taxminan $7 o'rniga $27 (2026-10-16 o'lchovi).
#:
#: 2026-10-19: `gpt-5.4-mini` ga o'tildi. Lokal o'lchovda (6 mavzu x 10 savol,
#: hakam `gpt-5.5`) imtihonga yaroqli savollar: eski prompt + 4.1-mini — 28%,
#: yangi prompt + 4.1-mini — 40%, yangi prompt + gpt-4.1 — 45%,
#: yangi prompt + gpt-5.4-mini — 78%; xato kalit 35 tadan 4 taga tushdi.
#: Radiologiya testlari 0/20 dan 16/20 ga chiqdi.
#:
#: Gibrid (2026-10-19): savolni yozish va tekshirish alohida modelda.
#: Yozish — eng ko'p output token (savol + izoh), shuning uchun arzonroq
#: modelda; tekshiruv — qisqa javob, lekin xato kalitni faqat kuchli model
#: ushlaydi (`gpt-4.1-mini` o'zini tekshirganda deyarli hammasiga "ok" dedi).
#: Ikkalasi ham `.env` dan almashtiriladi: OPENAI_TEST_GENERATE_MODEL,
#: OPENAI_TEST_REVIEW_MODEL.
#:
#: Yakuniy imtihon (2026-10-20): savol bir xil modelda yoziladi, lekin
#: tekshiruvchi kuchliroq — `gpt-5.4`. Zaif 14 fanda imtihonga yaroqli
#: savollar 5.4-mini tekshiruvchi bilan 64%, gpt-5.4 bilan 78% bo'ldi.
#: Narxi testga ~3 barobar qimmat, shuning uchun faqat imtihon yo'lida
#: (`exam_*` purpose). `.env`: OPENAI_EXAM_REVIEW_MODEL.
#:
#: XARAJAT (2026-10-21): yuqoridagi modellar bilan sarf kuniga ~$30 ga chiqdi
#: (sentabrda ~$1.3). Hammasi `gpt-5.4-nano` ga o'tdi: $0.20/$1.25 (1M token),
#: 5.4-mini dan ~3.5 barobar, gpt-5.4 dan ~12 barobar arzon. Bir xil test
#: so'rovida (arterial gipertenziya, 5 savol) 5.4-nano to'g'ri: bosqich,
#: nishon a'zo, USMLE vignette 52–61 so'z; 4.1-nano esa 160/100 ni "3-daraja"
#: deb noto'g'ri kalit berdi, gpt-5-nano o'zbekchani buzdi. Imtihon
#: tekshiruvi — 5.4-mini (gpt-5.4 dan 3.3 barobar arzon).
#: Kuchliroq model kerak bo'lsa — `.env` (OPENAI_*_MODEL), kod emas.
DEFAULT_TEST_GENERATE_MODEL = "gpt-5.4-nano"
DEFAULT_TEST_REVIEW_MODEL = "gpt-5.4-nano"
DEFAULT_EXAM_REVIEW_MODEL = "gpt-5.4-mini"
DEFAULT_PRESENTATION_MODEL = "gpt-5.4-nano"
#: Reasoning modellar uchun fikrlash darajasi: "low" sifat va tezlik o'rtasi.
QUALITY_REASONING_EFFORT = "low"
#: Fikrlashsiz ("none") yoziladigan vazifalar (2026-10-22, xarajat). Haqiqiy so'rovlarda
#: gpt-5.4 bahosi: test — sifat bir xil (xato 16% → 10%), 10% arzon va tezroq; keys —
#: 17% arzon, baho pasaymadi. Ma'ruza va taqdimotda foyda yo'q, ekspert tekshiruvida
#: fikrlash kerak — ular "low" da qoladi. `IMENTOR_NO_REASONING=0` — eski holat.
#: 2026-11-25: `presentation_continue` ham fikrlashsiz. gpt-5.4-nano "low" da 16 so'rovdan 3 tasida butun
#: 14000 tokenni fikrlashga sarflab, 80–205 soniyadan keyin BO'SH javob qaytardi (502) — o'qituvchi
#: darsda "taqdimot yaratilmoqda" ga 5 daqiqa qarab turdi. Shu vazifada fikrlash chiqishning 80% i edi,
#: `presentation_generate` da esa 3% — u "low" da qoladi.
NO_REASONING_PURPOSES = frozenset({"test_generate", "test_generate_brief", "case_generate", "presentation_continue"})
GENERATE_PURPOSES = frozenset({"test_generate", "test_generate_brief", "exam_generate"})
REVIEW_PURPOSES = frozenset({"test_repair", "test_balance"})
EXAM_REVIEW_PURPOSES = frozenset({"exam_review"})
#: Taqdimot mazmuni (2026-10-20, "kuchliroq taqdimot"): ~1200 ta/hafta,
#: nano'da ~$2.7, mini'da ~$11 haftasiga.
#:
#: 2026-10-20 (kech): test bilan bir xil model — `gpt-5.4-mini`. 4.1-mini
#: dagi 400 ta prod taqdimotda: punktlarning 98% i 12 so'zdan qisqa (prompt
#: 15–30 so'z so'raydi), 67% i 20 slayddan kam, ma'ruzadagi fan xatosi
#: (masalan "Brucella gram-musbat") slaydga ko'chadi.
#:
#: Harness (3 ta prod ma'ruzasi, ma'ruza matni bilan):
#:  - 4.1-mini: xatoni 3 marta ko'chirdi, "Bezgak" qismi yo'q, ~$0.01, 39–123 s;
#:  - 5.4-mini: gram xatosini tuzatdi, lekin ma'ruzadagi uydirma "проба Роттера"
#:    (igna bilan) ni ko'chirdi, ~$0.04, 27–34 s;
#:  - gpt-5.4: ikkalasini ham tuzatdi (Rotter — C vitamini sinamasi, Shiller–Pisarev
#:    — yod/glikogen), darslik darajasi (selektin/integrin, gipnozoit, G6FD),
#:    ~$0.16 (~$175 haftasiga), 119–157 s (backend chegarasi 280 s).
#: `.env`: OPENAI_PRESENTATION_MODEL=gpt-5.4-mini — arzonroq va tezroq zaxira.
#: Til tuzatish ham shu modelda — nano tarjimasi yana tekshiruvdan o'tmay
#: butun taqdimotni xato bilan yiqitardi.
PRESENTATION_PURPOSES = frozenset({
    "presentation_generate", "presentation_generate_fallback", "presentation_continue",
    "presentation_language_repair",
})
#: Keys (vaziyatli masala), 2026-10-20: nano'da prod keyslarining hech biri
#: o'qituvchi ishlata oladigan darajada emas edi (105 savol qo'lda baholandi,
#: o'rtacha ~2/10): takrorlanish halqalari, shablon qoldiqlari, dori/doza
#: xatolari. Test bilan bir xil modellar: yozish OPENAI_TEST_GENERATE_MODEL,
#: ekspert tekshiruv OPENAI_TEST_REVIEW_MODEL.
CASE_GENERATE_PURPOSES = frozenset({"case_generate"})
CASE_REVIEW_PURPOSES = frozenset({"case_review"})
#: Ma'ruza matni (2026-10-20): nano'da 1000-1400 so'z chiqar, tibbiy xatolar
#: bo'lardi (eklampsiyada magniy sulfat yo'q, rentgenda infiltrat "qorong'u").
#: Lokal sinov (6 mavzu): gpt-5.4-mini ~2000 so'z, tasnif, mezon va dozalar
#: to'g'ri. Test bilan bir xil model — OPENAI_TEST_GENERATE_MODEL.
#: Hajmi kichik: haftasiga ~30-50 ta ma'ruza, bittasi ~$0.03.
LECTURE_PURPOSES = frozenset({"lecture_generate", "lecture_plan"})
#: Brauzerdagi oxirgi (3-) qayta urinish: gpt-5.4 ketma-ket uzilgan bo'lsa,
#: tezkor modelda (~30 s) yakunlanadi — o'qituvchi bo'sh qo'l qaytmasin.
PRESENTATION_FAST_PURPOSES = frozenset({"presentation_generate_fast", "presentation_continue_fast"})
#: gpt-5.4 bitta taqdimotga 119–157 s sarflaydi (harness). 280 s zaxirasi
#: OpenAI sekinlashganda yetmasdi. Zanjir: OpenAI 540 s < brauzer 590 s <
#: nginx 600 s (konteyner va host nginx ikkalasida ham).
PRESENTATION_TIMEOUT_SEC = 540
DEFAULT_TIMEOUT_SEC = 280
QUALITY_PURPOSES = (
    GENERATE_PURPOSES | REVIEW_PURPOSES | EXAM_REVIEW_PURPOSES | PRESENTATION_PURPOSES | PRESENTATION_FAST_PURPOSES
    | CASE_GENERATE_PURPOSES | CASE_REVIEW_PURPOSES | LECTURE_PURPOSES
)
#: Ruxsat etilgan sifat modellari — `.env` dagi xato nom qimmat modelga
#: o'tib ketmasin (masalan "gpt-5.5-pro").
ALLOWED_QUALITY_MODELS = frozenset({"gpt-4.1-mini", "gpt-4.1", "gpt-5.4-nano", "gpt-5.4-mini", "gpt-5.4", "gpt-5-mini"})


def _env_model(name: str, default: str) -> str:
    import os

    value = (os.environ.get(name) or "").strip()
    return value if value in ALLOWED_QUALITY_MODELS else default


def test_generate_model() -> str:
    return _env_model("OPENAI_TEST_GENERATE_MODEL", DEFAULT_TEST_GENERATE_MODEL)


def test_review_model() -> str:
    return _env_model("OPENAI_TEST_REVIEW_MODEL", DEFAULT_TEST_REVIEW_MODEL)


def exam_review_model() -> str:
    return _env_model("OPENAI_EXAM_REVIEW_MODEL", DEFAULT_EXAM_REVIEW_MODEL)


def presentation_model() -> str:
    return _env_model("OPENAI_PRESENTATION_MODEL", DEFAULT_PRESENTATION_MODEL)


#: Test tarjimasi (2026-10-20): `gpt-4.1-nano` test tarjimasida kalitni
#: buzardi (inglizchada to'g'ri javob boshqa variantga ko'chdi), ma'noni
#: teskari qilardi ("dizuriyasiz" -> "dizuriya bilan") va atamani almashtirardi
#: ("ko'krak qafasi" -> "bo'yin", "АД" -> "bosh bosimi"). 30 savollik sinovda
#: nano 14 ta muammoli joyning hammasida xato qildi, `gpt-4.1-mini` deyarli
#: toza (~$0.04/test, 2 til). Tarjima OnlineTest yakuniy imtihoniga ru/en/uz
#: da beriladi. `.env`: OPENAI_TEST_TRANSLATE_MODEL (masalan "gpt-5.4-mini").
DEFAULT_TEST_TRANSLATE_MODEL = "gpt-4.1-mini"


def test_translate_model() -> str:
    return _env_model("OPENAI_TEST_TRANSLATE_MODEL", DEFAULT_TEST_TRANSLATE_MODEL)


#: Eski nom: tashqi MCQ (OnlineTest) shu bilan yaratadi.
QUALITY_MODEL = DEFAULT_TEST_GENERATE_MODEL

#: Arzon vazifalar (variant izohi, ma'ruza/taqdimot/sillabus tarjimasi, infografika, chat).
#: 2026-10-26: `gpt-4.1-nano` OpenAI'da o'chirildi — 2026-10-23 15:39 dan beri har so'rov
#: "HTTP 404: model has been deprecated" bilan yiqilardi (test variant izohlari, tarjimalar,
#: tarqatma infografikasi va chat ishlamay qoldi). Endi `gpt-5.4-nano`, fikrlashsiz va flex'da:
#: chiqish ~$0.625/M (4.1-nano $0.40/M edi). `.env`: OPENAI_ECONOMY_MODEL.
DEFAULT_ECONOMY_MODEL = "gpt-5.4-nano"
#: Fikrlashsiz arzon vazifada javob uchun zaxira (fikrlash tokenlari yo'q — 8000 kerak emas,
#: model tiqilib qolsa ham chegara yaqin turadi).
ECONOMY_TOKEN_RESERVE = 1000
#: Sifat modelida yuradigan, lekin o'z nomi bilan yoziladigan backend vazifalari (fikrlash
#: saqlanadi): OnlineTest imtihon savollari `model_for("exam_generate")` bilan yaratiladi.
QUALITY_USAGE_KINDS = QUALITY_PURPOSES | {"external_mcq"}


def economy_model() -> str:
    return _env_model("OPENAI_ECONOMY_MODEL", DEFAULT_ECONOMY_MODEL)


#: Vazifa bo'yicha model yo'nalishi (2026-11-19): `.env` `OPENAI_ROUTE` = JSON {"purpose": "model"}.
#: Faqat haqiqiy so'rovlardagi A/B (gpt-5.4 hakam) sifat pasaymasligini ko'rsatgan vazifa yoziladi —
#: 22.10 dagi umumiy sinovda gpt-5-nano test xatosini 16% -> 24–29% ga oshirgan, ma'ruza tilini buzgan.
#: `ROUTE_ONLY_MODELS` dagi arzon modellar FAQAT shu yo'nalish orqali ishlatiladi.
ROUTE_ONLY_MODELS = frozenset({"gpt-5-nano"})


def route_table() -> dict[str, str]:
    raw = (os.environ.get("OPENAI_ROUTE") or "").strip()
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except ValueError:
        return {}
    allowed = ALLOWED_QUALITY_MODELS | ROUTE_ONLY_MODELS
    return {str(k): str(v) for k, v in (data or {}).items() if str(v) in allowed} if isinstance(data, dict) else {}


def model_for(purpose: str | None) -> str:
    """Vazifaga qarab model: test, keys, ma'ruza, imtihon tekshiruvi va taqdimot — sifat modeli, qolgani — eng arzoni."""
    p = purpose or ""
    routed = route_table().get(p)
    if routed:
        return routed
    if p in GENERATE_PURPOSES or p in CASE_GENERATE_PURPOSES or p in LECTURE_PURPOSES:
        return test_generate_model()
    if p in REVIEW_PURPOSES or p in CASE_REVIEW_PURPOSES:
        return test_review_model()
    if p in EXAM_REVIEW_PURPOSES:
        return exam_review_model()
    if p in PRESENTATION_PURPOSES:
        return presentation_model()
    if p in PRESENTATION_FAST_PURPOSES:
        return test_generate_model()
    return economy_model()


def timeout_for(purpose: str | None) -> int:
    """OpenAI so'rovi uchun vaqt chegarasi (soniya): taqdimot uzoqroq kutadi."""
    p = purpose or ""
    if p in PRESENTATION_PURPOSES or p in PRESENTATION_FAST_PURPOSES:
        return PRESENTATION_TIMEOUT_SEC
    return DEFAULT_TIMEOUT_SEC


def _economy_model_name(model: str) -> str:
    # Faqat sifat modellari (va `OPENAI_ROUTE` da yozilgan arzonlari) o'tkaziladi; qolgani eng arzoniga.
    if model in ALLOWED_QUALITY_MODELS:
        return model
    if model in ROUTE_ONLY_MODELS and model in route_table().values():
        return model
    return economy_model()


def _apply_reasoning(body: dict[str, Any], usage_kind: str) -> dict[str, Any]:
    """Fikrlashsiz ("none") vazifalar: test/keys yozish va SIFAT VAZIFASI BO'LMAGAN hammasi.

    Arzon vazifalar ilgari fikrlamaydigan `gpt-4.1-nano` da edi; `gpt-5.4-nano` da ham fikrlash
    kerak emas va tokenni ikki barobar ko'paytirardi (2026-10-26).
    """
    if os.environ.get("IMENTOR_NO_REASONING", "1") == "0":
        return body
    if not _allows_no_reasoning(str(body.get("model") or "")):
        # gpt-5 / gpt-5-nano "none" ni bilmaydi (400) — sifat vazifasi bo'lmasa eng pasti "minimal".
        if str(body.get("model") or "") in ROUTE_ONLY_MODELS and usage_kind not in QUALITY_USAGE_KINDS:
            body["reasoning_effort"] = "minimal"
        return body
    if usage_kind in NO_REASONING_PURPOSES:
        body["reasoning_effort"] = "none"
    elif usage_kind not in QUALITY_USAGE_KINDS:
        body["reasoning_effort"] = "none"
        if "max_completion_tokens" in body:
            body["max_completion_tokens"] = max(256, int(body["max_completion_tokens"]) - 8000 + ECONOMY_TOKEN_RESERVE)
    return body


def _is_reasoning_model(model: str) -> bool:
    return bool(re.match(r"^(gpt-5|o\d)", model or ""))


def _allows_no_reasoning(model: str) -> bool:
    """`reasoning_effort: "none"` faqat gpt-5.1 va yangilarida bor; gpt-5, gpt-5-mini va
    o-seriyada 400 qaytaradi (2026-10-23: model .env da almashtirilsa test yaratilmay qolardi)."""
    return bool(re.match(r"^gpt-5\.[1-9]", model or ""))


def _adapt_body_for_model(body: dict[str, Any]) -> dict[str, Any]:
    """GPT-5 / o-seriya: `max_tokens` va `temperature` qabul qilinmaydi.

    Fikrlash tokenlari ham `max_completion_tokens` ga kiradi, shuning uchun
    javob uchun so'ralgan hajm ustiga zaxira qo'shiladi — aks holda uzun test
    JSON o'rtasida kesilib qoladi.
    """
    if not _is_reasoning_model(str(body.get("model") or "")):
        return body
    out = dict(body)
    out["max_completion_tokens"] = int(out.pop("max_tokens", 4096) or 4096) + 8000
    out.pop("temperature", None)
    out.setdefault("reasoning_effort", QUALITY_REASONING_EFFORT)
    return out


# Arzon model qoladi, lekin javob uzunligi so'ralganicha beriladi. Ilgari 1200
# token (~1,5 bet) bilan kesilardi: ma'ruzalarning 95% i o'rtasida uzilib
# qolar, JSON tarjimalar esa buzilib umuman saqlanmasdi.
ECONOMY_MAX_OUTPUT_TOKENS = 16384


def _economy_max_tokens(max_tokens: int) -> int:
    return max(256, min(int(max_tokens or 4096), ECONOMY_MAX_OUTPUT_TOKENS))


def _parse_retry_after_seconds(message: str) -> float:
    m = re.search(r"[Rr]etry[- ]after[:\s]+(\d+)", message)
    if m:
        return min(120.0, max(3.0, float(m.group(1)) + 1.0))
    return 55.0


#: OpenAI hisobida mablag' tugaganda ham 429 qaytadi, lekin bu vaqtinchalik emas: kutib qayta urinish
#: o'qituvchini daqiqalab kuttirib, oxirida baribir xato berardi (2026-09-17 da shunday bo'ldi).
QUOTA_EXHAUSTED_MESSAGE = (
    "AI xizmati vaqtincha ishlamayapti: OpenAI hisobidagi mablag' tugagan. "
    "Administratorga murojaat qiling — hisob to'ldirilgach generatsiya yana ishlaydi."
)


def _is_quota_exhausted(message: str) -> bool:
    return bool(re.search(r"no credits remaining|insufficient_quota|exceeded your current quota|billing", message, re.I))


def _is_rate_limited(message: str) -> bool:
    if _is_quota_exhausted(message):
        return False
    return bool(re.search(r"\b429\b|rate.?limit|overloaded", message, re.I))


def _is_transient_error(message: str) -> bool:
    return _is_rate_limited(message) or bool(re.search(r"\bHTTP 5\d\d\b", message))


def _clip_messages_for_cost(messages: list[dict]) -> list[dict]:
    from app.services.education_ai_utils import clip_education_messages
    try:
        return clip_education_messages(messages)
    except ValueError as exc:
        raise OpenAiClientError(str(exc)) from exc


#: Flex (2026-10-21, xarajat): gpt-5 oilasi yarim narxda. Sinovda tezligi
#: oddiy bilan bir xil (gpt-5.4-nano: 9–11 s, oddiy 12 s). OpenAI band bo'lsa
#: flex 429 qaytaradi — o'sha so'rov darhol oddiy rejimda qayta yuboriladi.
#: `.env`: IMENTOR_OPENAI_FLEX=0 — o'chirish.
_FLEX_MODELS = re.compile(r"^(gpt-5|o3|o4-mini)")


#: 2026-11-12 (9ccbe95) test yozish va ekspert tekshiruvi flex'dan butunlay olingan edi ("ikki marta kutish"),
#: narxi "+$0.002/test" deb baholangan. Haqiqatda bu ikki vazifa aynan 2 barobar qimmatlashdi: test $0.011 →
#: $0.020, kuniga +$2.5–3 (2026-11-16 o'lchovi, `core_aiusagelog`). O'sha paytdagi o'lchov: flex 429 ~1 s da
#: qaytadi (navbat emas), 429 ulushi oddiy kunlarda 0–1%, band kunlarda (11-11…11-14) 30–50%; muvaffaqiyatli flex
#: tezligi oddiy bilan bir xil (3.9 s va 4.9 s, bir xil so'rov). Endi hamma vazifa flex'ni sinaydi; flex 429 ni
#: SEKIN qaytarsa (`FLEX_SLOW_FAIL_SEC`), o'qituvchi kutadigan chaqiruvlar `FLEX_COOLDOWN_SEC` davomida flex'siz
#: ketadi — ikki marta kutish faqat birinchi chaqiruvda bo'ladi.
FLEX_SLOW_FAIL_SEC = 3.0
FLEX_COOLDOWN_SEC = 600
_FLEX_COOL_KEY = "imentor:openai:flex_cooldown"
_flex_cool_until = 0.0
#: Fon vazifalari — o'qituvchi javobni kutmaydi (test saqlangandan keyin fonda yoziladi). Flex 429 bo'lsa oddiy
#: rejimga darhol o'tilmaydi: shu oraliqlardan keyin flex yana sinaladi. Band kunlarda variant izohlarining
#: 30–46% i oddiy narxda ketardi (2026-11-11…13).
BACKGROUND_KINDS = frozenset({"test_option_explanations"})
BACKGROUND_FLEX_RETRY_DELAYS = (8.0, 20.0)


def _flex_enabled(model: str, usage_kind: str = "") -> bool:
    import os

    if (os.environ.get("IMENTOR_OPENAI_FLEX") or "").strip() in ("0", "false", "no"):
        return False
    if usage_kind not in BACKGROUND_KINDS and _flex_cooling():
        return False
    return bool(_FLEX_MODELS.match(model or ""))


def _flex_cooling() -> bool:
    if time.monotonic() < _flex_cool_until:
        return True
    try:
        from app.services.ai_response_cache import _redis

        return bool(_redis().exists(_FLEX_COOL_KEY))
    except Exception:  # noqa: BLE001 — Redis yo'q bo'lsa faqat shu jarayon xotirasi
        return False


def _note_flex_failure(usage_kind: str, elapsed: float, message: str) -> None:
    """Flex 429 jurnali (necha soniyada qaytgani bilan); sekin bo'lsa kutiladigan chaqiruvlar uchun flex o'chadi."""
    global _flex_cool_until
    slow = elapsed >= FLEX_SLOW_FAIL_SEC
    logging.getLogger(__name__).warning(
        "OPENAI_FLEX_FALLBACK kind=%s elapsed=%.1fs%s %s", usage_kind, elapsed, " cooldown" if slow else "", message[:160],
    )
    if not slow:
        return
    _flex_cool_until = time.monotonic() + FLEX_COOLDOWN_SEC
    try:
        from app.services.ai_response_cache import _redis

        _redis().set(_FLEX_COOL_KEY, "1", ex=FLEX_COOLDOWN_SEC)
    except Exception:  # noqa: BLE001
        pass


def _usage_model(resp: dict, model: str) -> str:
    """Sarf jadvali uchun: flex javobi "@flex" belgisi bilan (narxi yarim)."""
    tier = resp.get("service_tier") if isinstance(resp, dict) else None
    return f"{model}@flex" if tier == "flex" else model


def _post_chat(api_key: str, body: dict, timeout_sec: int, usage_kind: str = "") -> dict:
    if _flex_enabled(str(body.get("model") or ""), usage_kind):
        delays = BACKGROUND_FLEX_RETRY_DELAYS if usage_kind in BACKGROUND_KINDS else ()
        for delay in (0.0, *delays):
            if delay:
                time.sleep(delay)
            started = time.monotonic()
            try:
                return _http_post(api_key, {**body, "service_tier": "flex"}, url=OPENAI_CHAT_URL,
                                  timeout_sec=timeout_sec)
            except OpenAiClientError as exc:
                if str(exc) == QUOTA_EXHAUSTED_MESSAGE or not _is_transient_error(str(exc)):
                    raise
                _note_flex_failure(usage_kind, time.monotonic() - started, str(exc))
    return _http_post(api_key, body, url=OPENAI_CHAT_URL, timeout_sec=timeout_sec)


def _complete_cached(api_key: str, body: dict, timeout_sec: int, usage_kind: str) -> str:
    from app.services.ai_response_cache import cache_key, reuse, transformation_validator
    validator = transformation_validator(usage_kind, body["messages"])
    def generate_fresh() -> str:
        resp = _post_chat(api_key, body, timeout_sec, usage_kind)
        _log_usage(resp, _usage_model(resp, body["model"]), usage_kind)
        return _extract_text(resp, json_mode=bool(body.get("response_format")), usage_kind=usage_kind)
    if validator is None:
        # Faqat aniq o'girish (tarjima, matn tuzatish) keshlanadi. Generatsiya har safar yangi:
        # ilgari "Qayta yaratish" bosilganda o'sha keys/test keshdan qaytib kelardi.
        return generate_fresh()
    def valid(text):
        if validator is not None:
            return validator(text)
        if body.get("response_format"):
            try:
                return isinstance(json.loads(text), (dict, list))
            except (ValueError, TypeError):
                return False
        return bool(text.strip())
    def generate():
        resp = _post_chat(api_key, body, timeout_sec, usage_kind)
        _log_usage(resp, _usage_model(resp, body["model"]), usage_kind)
        return _extract_text(resp, json_mode=bool(body.get("response_format")), usage_kind=usage_kind)
    value, hit = reuse(cache_key(api_key, body, usage_kind), generate, valid)
    if hit:
        logging.getLogger(__name__).info("AI_CACHE_HIT kind=%s", usage_kind)
    return value


def _http_post(api_key: str, payload: dict[str, Any], *, url: str, timeout_sec: int = 180) -> dict[str, Any]:
    try:
        resp = requests.post(
            url,
            json=payload,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=timeout_sec,
        )
    except requests.RequestException as e:
        raise OpenAiClientError(str(e)) from e
    if resp.status_code >= 400:
        try:
            msg = str((resp.json().get("error") or {}).get("message") or resp.text)
        except ValueError:
            msg = resp.text
        if _is_quota_exhausted(msg):
            logging.getLogger(__name__).error("OPENAI_QUOTA_EXHAUSTED: %s", msg[:200])
            raise OpenAiClientError(QUOTA_EXHAUSTED_MESSAGE)
        raise OpenAiClientError(f"HTTP {resp.status_code}: {msg}")
    return resp.json() if resp.content else {}


usage_logger = logging.getLogger("imentor.openai.usage")


def _store_usage(kind: str, model: str, prompt: int, cached: int, completion: int, total: int) -> None:
    """Sarfni `core_aiusagelog` ga yozadi (rektor "AI sarfi" bo'limi shundan o'qiydi).

    Alohida qisqa sessiya: chaqiruvchining tranzaksiyasiga aralashmaydi.
    Yozib bo'lmasa jim o'tadi — hisob yuritish asosiy ishni to'xtatmasin.
    """
    try:
        from app.core.db import SessionLocal
        from app.models.ai_usage import AiUsageLog

        with SessionLocal() as db:
            db.add(
                AiUsageLog(
                    kind=(kind or "")[:64],
                    model=(model or "")[:64],
                    prompt_tokens=prompt,
                    cached_tokens=cached,
                    completion_tokens=completion,
                    total_tokens=total,
                )
            )
            db.commit()
    except Exception:  # noqa: BLE001
        pass


def _log_usage(resp: dict, model: str, kind: str) -> None:
    """Javobdagi `usage` ni log va bazaga yozadi. Hech qachon xato ko'tarmaydi."""
    try:
        u = resp.get("usage") if isinstance(resp, dict) else None
        if not isinstance(u, dict):
            return
        details = u.get("prompt_tokens_details")
        cached = int(details.get("cached_tokens") or 0) if isinstance(details, dict) else 0
        prompt = int(u.get("prompt_tokens") or 0)
        completion = int(u.get("completion_tokens") or 0)
        total = int(u.get("total_tokens") or 0)
        out_details = u.get("completion_tokens_details")
        # Fikrlash tokenlari — javob tokenlarining qanchasi ko'rinmaydigan o'ylashga ketgani (xarajat tahlili).
        reasoning = int(out_details.get("reasoning_tokens") or 0) if isinstance(out_details, dict) else 0
        usage_logger.info(
            "OPENAI_USAGE kind=%s model=%s in=%s cached=%s out=%s reasoning=%s total=%s",
            kind, model, prompt, cached, completion, reasoning, total,
        )
        _store_usage(kind, model, prompt, cached, completion, total)
    except Exception:  # noqa: BLE001
        pass


def _complete_json(text: str) -> str | None:
    """Kesilgan JSON-rejim javobida to'liq obyekt bormi (oxirida cheksiz bo'sh joy/takror)."""
    head = (text or "").strip()
    if not head:
        return None
    try:
        value, end = json.JSONDecoder().raw_decode(head)
    except ValueError:
        return None
    return head[:end] if isinstance(value, (dict, list)) else None


def _extract_text(resp: dict[str, Any], *, json_mode: bool = False, usage_kind: str = "") -> str:
    choices = resp.get("choices")
    if not isinstance(choices, list) or not choices:
        raise OpenAiClientError("No choices in OpenAI response")
    if isinstance(choices[0], dict) and choices[0].get("finish_reason") == "length":
        msg = choices[0].get("message") if isinstance(choices[0].get("message"), dict) else {}
        raw = str(msg.get("content") or "")
        # JSON rejimida model ba'zan obyektni to'liq yozib bo'lib, keyin bo'sh joy yoki
        # takrorni to'xtovsiz chiqaradi (2026-10-23: variant izohlarining 14% i — chiqish
        # tokenlarining 45% i — shunday kesilgan, javob butunlay tashlanardi). Boshidagi
        # to'liq obyekt yaroqli — o'shani olamiz.
        if json_mode:
            whole = _complete_json(raw)
            if whole is not None:
                usage_logger.warning("OPENAI_TRUNCATED_SALVAGED kind=%s tail=%r", usage_kind, raw[-60:])
                return whole
        # Chala javob muvaffaqiyat sifatida qaytmaydi: aks holda chala ma'ruza
        # saqlanadi, buzuq JSON keshga tushadi. Barcha chaqiruvchilar bu xatoni
        # ushlaydi (502/503 yoki zaxira qiymat).
        usage_logger.warning("OPENAI_TRUNCATED javob max_tokens chegarasida kesildi kind=%s tail=%r",
                             usage_kind, raw[-60:])
        raise OpenAiClientError("Model javobi uzunlik chegarasida kesildi")
    msg = choices[0].get("message") if isinstance(choices[0], dict) else None
    if not isinstance(msg, dict):
        raise OpenAiClientError("No message in OpenAI response")
    content = msg.get("content")
    if not isinstance(content, str) or not content.strip():
        raise OpenAiClientError("Empty model text")
    return content.strip()


def cache_key_for(usage_kind: str) -> str:
    """OpenAI prompt keshi (2026-10-22): bir xil vazifadagi so'rovlar bitta kesh mashinasiga
    yo'naltiriladi — system qoidalari (va takrorlangan mavzu parchasi) keshdan 10 barobar
    arzon olinadi. Serverdagi sinov: 4529 tokenlik promptning 3840 tasi keshdan."""
    return f"imentor-{(usage_kind or 'chat')}"[:64]


def generate_openai_chat(
    api_key: str,
    *,
    messages: list[dict],
    model: str = "",
    max_tokens: int = 4096,
    temperature: float = 0.35,
    timeout_sec: int = 280,
    response_format: dict | None = None,
    usage_kind: str = "chat",
) -> str:
    """Tayyor `messages` ro'yxati (system/user/assistant) bilan chat completion."""
    body: dict[str, Any] = {
        "model": _economy_model_name(model),
        "messages": _clip_messages_for_cost(messages),
        "max_tokens": _economy_max_tokens(max_tokens),
        "temperature": temperature,
        "stream": False,
    }
    body = _apply_reasoning(_adapt_body_for_model(body), usage_kind)
    if response_format:
        body["response_format"] = response_format
    body["prompt_cache_key"] = cache_key_for(usage_kind)
    return _complete_cached(api_key, body, timeout_sec, usage_kind)


#: Oqim (ma'ruza) uchun: birinchi bo'lakkacha bo'lgan vaqtinchalik xatoda
#: necha marta urinish va oraliqlar. Ulanish uchun alohida qisqa timeout.
STREAM_ATTEMPTS = 3
STREAM_RETRY_DELAYS = (2.0, 5.0)
STREAM_CONNECT_TIMEOUT = 15


class _TransientOpenAiError(OpenAiClientError):
    """Qayta urinsa o'tishi mumkin bo'lgan xato: uzilish, timeout, 429, 5xx."""


def stream_openai_chat(
    api_key: str,
    *,
    messages: list[dict],
    model: str = "",
    max_tokens: int = 4096,
    temperature: float = 0.35,
    timeout_sec: int = 120,
    usage_kind: str = "chat_stream",
    attempts: int = STREAM_ATTEMPTS,
) -> Iterator[str]:
    """OpenAI chat completion'ni SSE orqali oqim (stream) sifatida o'qib,
    har bir matn bo'lagini (`delta.content`) navbat bilan qaytaradi.
    Foydalanuvchi generatsiya jarayonida darhol matnni ko'rib turishi uchun —
    umumiy vaqt bir xil, lekin sezilgan tezlik ancha yaxshilanadi.

    Birinchi matn bo'lagi kelguncha vaqtinchalik xato (uzilish, timeout, 429,
    5xx) bo'lsa `attempts` martagacha qayta uriniladi. Matn yuborila boshlangach
    qayta urinilmaydi — mijoz yarim matnni olgan bo'ladi, uni frontend
    butunlay qaytadan so'raydi. `timeout_sec` — ikki bo'lak orasidagi kutish."""
    body = {
        "model": _economy_model_name(model),
        "messages": _clip_messages_for_cost(messages),
        "max_tokens": _economy_max_tokens(max_tokens),
        "temperature": temperature,
        "stream": True,
        # Oqimda `usage` faqat so'ralsa keladi — oxirgi, `choices` bo'sh bo'lakda.
        "stream_options": {"include_usage": True},
        "prompt_cache_key": cache_key_for(usage_kind),
    }
    body = _apply_reasoning(_adapt_body_for_model(body), usage_kind)
    flex = _flex_enabled(str(body.get("model") or ""), usage_kind)
    for attempt in range(1, max(1, attempts) + 1):
        started = False
        # Birinchi urinish flex (yarim narx); band bo'lsa (429) qayta urinish oddiy rejimda.
        on_flex = flex and attempt == 1
        tier_body = {**body, "service_tier": "flex"} if on_flex else body
        sent_at = time.monotonic()
        try:
            for text in _stream_once(api_key, tier_body, timeout_sec, usage_kind):
                started = True
                yield text
            return
        except _TransientOpenAiError as exc:
            if started or attempt >= attempts:
                raise
            if on_flex:
                # Flex band — oddiy rejimga kutmasdan o'tiladi (2 s kutish faqat haqiqiy uzilishda).
                _note_flex_failure(usage_kind, time.monotonic() - sent_at, str(exc))
                continue
            delay = STREAM_RETRY_DELAYS[min(attempt - 1, len(STREAM_RETRY_DELAYS) - 1)]
            logging.getLogger(__name__).warning(
                "OPENAI_STREAM_RETRY kind=%s urinish=%s/%s %.0fs dan keyin: %s",
                usage_kind, attempt, attempts, delay, str(exc)[:160],
            )
            time.sleep(delay)


def _stream_once(api_key: str, body: dict, timeout_sec: int, usage_kind: str) -> Iterator[str]:
    try:
        resp = requests.post(
            OPENAI_CHAT_URL,
            json=body,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=(STREAM_CONNECT_TIMEOUT, timeout_sec),
            stream=True,
        )
    except requests.RequestException as e:
        raise _TransientOpenAiError(str(e)) from e

    completed = False
    try:
        if resp.status_code >= 400:
            try:
                msg = str((resp.json().get("error") or {}).get("message") or resp.text)
            except ValueError:
                msg = resp.text
            if _is_quota_exhausted(msg):
                raise OpenAiClientError(QUOTA_EXHAUSTED_MESSAGE)
            err = _TransientOpenAiError if resp.status_code == 429 or resp.status_code >= 500 else OpenAiClientError
            raise err(f"HTTP {resp.status_code}: {msg}")
        for raw_line in resp.iter_lines(decode_unicode=True):
            if not raw_line or not raw_line.startswith("data:"):
                continue
            data = raw_line[len("data:"):].strip()
            if data == "[DONE]":
                break
            try:
                chunk = json.loads(data)
            except ValueError:
                continue
            if chunk.get("usage"):
                _log_usage(chunk, _usage_model(chunk, body["model"]), usage_kind)
            choices = chunk.get("choices") or []
            if not choices:
                continue
            reason = choices[0].get("finish_reason")
            if reason == "stop":
                completed = True
            elif reason in ("length", "content_filter"):
                raise OpenAiClientError("AI response was incomplete. Please retry with a smaller section.")
            text = (choices[0].get("delta") or {}).get("content")
            if text:
                yield text
        if not completed:
            raise _TransientOpenAiError("AI stream ended before completion. Please retry.")
    except requests.RequestException as exc:
        raise _TransientOpenAiError(str(exc)) from exc
    finally:
        resp.close()


def generate_openai_text(
    api_key: str,
    *,
    user_text: str,
    system_instruction: str | None = None,
    model: str = "",
    max_tokens: int = 8192,
    temperature: float = 0.35,
    json_only: bool = False,
    max_429_retries: int = 2,
    timeout_sec: int = 180,
    usage_kind: str = "text",
) -> str:
    sys_text = (system_instruction or "").strip()
    if json_only:
        suffix = "\n\nReturn ONLY valid JSON (no markdown fences, no extra text)."
        sys_text = (sys_text + suffix).strip() if sys_text else suffix.strip()

    messages: list[dict[str, str]] = []
    if sys_text:
        messages.append({"role": "system", "content": sys_text})
    messages.append({"role": "user", "content": user_text})

    body = {
        "model": _economy_model_name(model),
        "messages": _clip_messages_for_cost(messages),
        "max_tokens": _economy_max_tokens(max_tokens),
        "temperature": temperature,
        "stream": False,
    }
    body = _apply_reasoning(_adapt_body_for_model(body), usage_kind)

    last_err: str | None = None
    for attempt in range(max(1, max_429_retries)):
        try:
            return _complete_cached(api_key, body, timeout_sec, usage_kind)
        except OpenAiClientError as e:
            msg = str(e)
            last_err = msg
            if _is_rate_limited(msg) and attempt + 1 < max_429_retries:
                time.sleep(_parse_retry_after_seconds(msg))
                continue
            raise
    raise OpenAiClientError(last_err or "Unknown OpenAI error")


_EMBED_CACHE: dict[tuple[str, str], list[float]] = {}
_EMBED_CACHE_MAX = 2000


def create_embeddings(
    api_key: str,
    texts: list[str],
    *,
    model: str = OPENAI_EMBEDDING_MODEL,
    batch_size: int = 96,
    timeout_sec: int = 120,
    max_429_retries: int = 6,
    cache: bool = False,
) -> list[list[float]]:
    """Matnlar embeddingi. `cache=True` — bir xil so'rov qayta pul to'lamasin.

    Kitob qidiruvi (RAG) har generatsiyada mavzu nomini qayta embed qiladi;
    xotiradagi kesh shu takrorni oladi. Kesh jarayon ichida, hajmi cheklangan.
    """
    if cache:
        missing = [t for t in dict.fromkeys(texts) if (model, t) not in _EMBED_CACHE]
        if missing:
            fresh = create_embeddings(
                api_key, missing, model=model, batch_size=batch_size,
                timeout_sec=timeout_sec, max_429_retries=max_429_retries,
            )
            if len(_EMBED_CACHE) + len(missing) > _EMBED_CACHE_MAX:
                _EMBED_CACHE.clear()
            for text, vec in zip(missing, fresh):
                _EMBED_CACHE[(model, text)] = vec
        return [_EMBED_CACHE[(model, t)] for t in texts]

    out: list[list[float]] = []
    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        resp: dict[str, Any] | None = None
        for attempt in range(max(1, max_429_retries)):
            try:
                resp = _http_post(
                    api_key,
                    {"model": model, "input": batch},
                    url=OPENAI_EMBEDDINGS_URL,
                    timeout_sec=timeout_sec,
                )
                _log_usage(resp, model, "embedding")
                break
            except OpenAiClientError as e:
                msg = str(e)
                if _is_transient_error(msg) and attempt + 1 < max_429_retries:
                    time.sleep(_parse_retry_after_seconds(msg))
                    continue
                raise
        assert resp is not None
        data = resp.get("data")
        if not isinstance(data, list) or len(data) != len(batch):
            raise OpenAiClientError("Embedding javobi noto'g'ri formatda")
        ordered = sorted(data, key=lambda item: item.get("index", 0))
        for item in ordered:
            embedding = item.get("embedding")
            if not isinstance(embedding, list):
                raise OpenAiClientError("Embedding qiymati topilmadi")
            out.append(embedding)
    return out
