"""
Tibbiy taqdimot — OpenAI multi-step pipeline:
  1) Tuzilma (outline + didaktik reja)
  2) Slayd matni + vizual bloklar (JSON)
  3) Rasm promptlari
"""
from __future__ import annotations

import json
import re
from typing import Any

from .openai_client import OPENAI_PRESENTATION_MODEL, OpenAIClientError, generate_openai_text

SYS_DESIGNER = (
    "Siz xalqaro tibbiy konferensiya darajasidagi taqdimot dizayneri va FJSTI professorisiz. "
    "Har bir slayd zamonaviy infografika, raqamli diagramma yoki klinik karta bilan — oddiy bullet-list emas. "
    "2020+ yil PowerPoint/Keynote estetikasi: qisqa matn, kuchli vizual, klinik aniqlik."
)

JSON_SCHEMA_HINT = """
Har bir slayd obyekti:
{
  "title": "string",
  "subtitle": "string (ixtiyoriy)",
  "slideKind": "title|section|content|diagram|clinical|summary|hook",
  "content": ["2-4 qisqa punkt — faqat asosiy matn"],
  "keyTakeaway": "1 jumla",
  "notes": "o'qituvchi uchun 3-5 gap",
  "visual": {
    "type": "flow|stats|compare|pyramid|timeline|cycle|table|icon-grid|clinical",
    "caption": "diagramma sarlavhasi",
    flow: "steps": [{"label":"", "detail":""}]
    stats: "stats": [{"label":"","value":"42","unit":"%"}]
    compare: "left": {"title":"","items":[]}, "right": {...}
    pyramid: "levels": [{"label":"","items":[]}]
    timeline: "events": [{"time":"1-hafta","text":""}]
    cycle: "nodes": [{"id":"a","label":""}], "links": [{"from":"a","to":"b"}]
    table: "rows": [["Ustun1","Ustun2"], ["",""]]
    icon-grid: "icons": [{"icon":"🫀","label":"","text":""}]
    clinical: "vignette": {"patient":"","findings":[],"question":""}
  },
  "imagePrompt": "English DALL-E style prompt for medical infographic",
  "mermaid": "optional Mermaid flowchart code for flow/cycle slides"
}
"""

PEDAGOGIC_PLAN = [
    "Mavzu — dolzarblik va global yuk",
    "O'quv maqsadlari (SMART)",
    "Asosiy tushunchalar va ta'riflar",
    "Epidemiologiya va statistika",
    "Etiologiya va xavf omillari",
    "Patogenez — bosqichma-bosqich",
    "Klinik belgilar va simptomlar",
    "Fizikal ko'rik algoritmi",
    "Laborator va instrumental diagnostika",
    "Differensial diagnostika",
    "Davolash strategiyasi",
    "Klinik vaziyat (case)",
    "Asoratlar va profilaktika",
    "Xulosa va checklist",
    "Savol–javob",
]


def _lang_name(code: str) -> str:
    if code == "ru":
        return "Russian"
    if code == "en":
        return "English"
    return "Uzbek"


def _parse_json_array(text: str) -> list[dict[str, Any]]:
    raw = text.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    parsed = json.loads(raw)
    if not isinstance(parsed, list):
        raise OpenAIClientError("AI javobi JSON massiv emas")
    return [x for x in parsed if isinstance(x, dict)]


def _build_plan(topic: str, count: int) -> list[str]:
    if count <= len(PEDAGOGIC_PLAN):
        return [f"{PEDAGOGIC_PLAN[i]} — {topic}" if i == 0 else PEDAGOGIC_PLAN[i] for i in range(count)]
    extra = [f"Amaliy mavzu {i + 1}" for i in range(count - len(PEDAGOGIC_PLAN))]
    return [f"{PEDAGOGIC_PLAN[0]} — {topic}", *PEDAGOGIC_PLAN[1:], *extra][:count]


def _structure_prompt(topic: str, context: str, count: int, lang: str) -> str:
    plan = _build_plan(topic, count)
    return f"""Mavzu: "{topic}"
Kontekst:
{context or "(kontekst yo'q — mavzu bo'yicha professional taqdimot)"}

Vazifa: {count} slaydli tibbiy taqdimot uchun didaktik TUZILMA (outline).
Til: {lang}.

Har bir slayd uchun JSON obyekt:
{{"index": 1, "planTitle": "...", "slideKind": "title|content|clinical|summary|...", "visualType": "flow|stats|compare|...", "focus": "1 jumla — nima o'rgatiladi"}}

Reja:
{chr(10).join(f"{i+1}. {p}" for i, p in enumerate(plan))}

Qoidalar:
- Kamida 3 clinical, 3 stats, 2 flow, 1 compare, 1 timeline.
- Birinchi slayd title, oxirgi summary.
- Faqat JSON massiv."""


def _slides_prompt(
    topic: str,
    context: str,
    count: int,
    lang: str,
    outline: list[dict[str, Any]],
    batch_start: int,
    batch_end: int,
    strict: bool,
) -> str:
    slice_outline = outline[batch_start:batch_end]
    return f"""Mavzu: "{topic}"
Kontekst:
{context or "(kontekst yo'q)"}

Vazifa: slayd {batch_start + 1} dan {batch_end} gacha — to'liq JSON slaydlar massivi.
Til: {lang}.
Jami taqdimot: {count} slayd.

Outline:
{json.dumps(slice_outline, ensure_ascii=False, indent=2)}

Qoidalar:
- Har slaydda to'liq "visual" blok (raqamli stats, klinik vignette, flow steps).
- "content" qisqa (6–14 so'z har punkt).
- stats.value — haqiqiy raqam (masalan "24", "85").
- flow/cycle slaydlar uchun "mermaid" maydoni (Mermaid sintaksis, flowchart TD).
- imagePrompt — inglizcha, professional medical vector infographic.
- Suvli matn taqiqlanadi.
{"- Yuqori sifat: xalqaro konferensiya darajasi." if strict else ""}
{JSON_SCHEMA_HINT}
Faqat JSON massiv qaytaring."""


def _image_prompts_prompt(slides: list[dict[str, Any]], topic: str) -> str:
    titles = [{"i": i, "title": s.get("title", ""), "visualType": (s.get("visual") or {}).get("type", "")} for i, s in enumerate(slides)]
    return f"""Mavzu: {topic}

Quyidagi slaydlar uchun "imagePrompt" maydonlarini yozing (inglizcha, DALL-E uchun):
{json.dumps(titles, ensure_ascii=False)}

Har biri uchun JSON: {{"index": 0, "imagePrompt": "..."}}
Faqat JSON massiv. Har prompt: medical education, clean vector, no text in image, topic-specific."""


def _merge_image_prompts(slides: list[dict[str, Any]], prompts: list[dict[str, Any]]) -> None:
    by_idx = {int(p.get("index", -1)): str(p.get("imagePrompt") or "").strip() for p in prompts}
    for i, slide in enumerate(slides):
        p = by_idx.get(i, "").strip()
        if p:
            slide["imagePrompt"] = p


def _looks_weak(slides: list[dict[str, Any]], expected: int) -> bool:
    if len(slides) < max(6, int(expected * 0.65)):
        return True
    with_visual = sum(1 for s in slides if isinstance(s.get("visual"), dict) and s["visual"].get("type"))
    return with_visual < max(5, expected - 3)


def generate_presentation_deck(
    api_key: str,
    *,
    topic: str,
    context: str = "",
    count: int = 12,
    language: str = "uz",
    model: str = OPENAI_PRESENTATION_MODEL,
    on_phase: Any | None = None,
) -> list[dict[str, Any]]:
    """Multi-step OpenAI pipeline. on_phase(str) — progress callback."""
    safe_count = min(24, max(8, count))
    lang = _lang_name(language)

    def phase(name: str) -> None:
        if callable(on_phase):
            on_phase(name)

    phase("structure")
    outline_raw = generate_openai_text(
        api_key,
        system_instruction=f"{SYS_DESIGNER} Faqat JSON massiv — taqdimot tuzilmasi.",
        user_text=_structure_prompt(topic, context, safe_count, lang),
        model=model,
        max_tokens=4096,
        temperature=0.25,
        json_only=True,
        timeout_sec=120,
    )
    outline = _parse_json_array(outline_raw)
    while len(outline) < safe_count:
        plan = _build_plan(topic, safe_count)
        outline.append({
            "index": len(outline) + 1,
            "planTitle": plan[len(outline)] if len(outline) < len(plan) else f"Slayd {len(outline)+1}",
            "slideKind": "content",
            "visualType": "flow",
            "focus": "",
        })
    outline = outline[:safe_count]

    phase("content")
    batch_size = 10
    all_slides: list[dict[str, Any]] = []
    strict = False
    for start in range(0, safe_count, batch_size):
        end = min(start + batch_size, safe_count)
        user = _slides_prompt(topic, context, safe_count, lang, outline, start, end, strict)
        raw = generate_openai_text(
            api_key,
            system_instruction=f"{SYS_DESIGNER} JSON slaydlar massivi — har birida visual.",
            user_text=user,
            model=model,
            max_tokens=16384,
            temperature=0.32 if not strict else 0.22,
            json_only=True,
            timeout_sec=300,
        )
        batch = _parse_json_array(raw)
        all_slides.extend(batch)

    if _looks_weak(all_slides, safe_count):
        strict = True
        all_slides = []
        for start in range(0, safe_count, batch_size):
            end = min(start + batch_size, safe_count)
            user = _slides_prompt(topic, context, safe_count, lang, outline, start, end, strict)
            raw = generate_openai_text(
                api_key,
                system_instruction=f"{SYS_DESIGNER} JSON slaydlar — yuqori sifat.",
                user_text=user,
                model=model,
                max_tokens=16384,
                temperature=0.2,
                json_only=True,
                timeout_sec=300,
            )
            all_slides.extend(_parse_json_array(raw))

    all_slides = all_slides[:safe_count]
    while len(all_slides) < safe_count:
        plan = _build_plan(topic, safe_count)
        all_slides.append({
            "title": plan[len(all_slides)] if len(all_slides) < len(plan) else f"Slayd {len(all_slides)+1}",
            "content": ["Mavzu davomi"],
            "slideKind": "content",
        })

    phase("images")
    try:
        img_raw = generate_openai_text(
            api_key,
            system_instruction="Medical presentation image prompt writer. JSON only.",
            user_text=_image_prompts_prompt(all_slides, topic),
            model=model,
            max_tokens=4096,
            temperature=0.4,
            json_only=True,
            timeout_sec=90,
        )
        _merge_image_prompts(all_slides, _parse_json_array(img_raw))
    except OpenAIClientError:
        pass

    phase("done")
    return all_slides


def generate_presentation_from_text(
    api_key: str,
    *,
    source_text: str,
    topic_hint: str,
    count: int = 12,
    language: str = "uz",
    model: str = OPENAI_PRESENTATION_MODEL,
    on_phase: Any | None = None,
) -> list[dict[str, Any]]:
    context = source_text[:80_000].strip()
    topic = topic_hint.strip() or "Taqdimot"
    return generate_presentation_deck(
        api_key,
        topic=topic,
        context=context,
        count=count,
        language=language,
        model=model,
        on_phase=on_phase,
    )
