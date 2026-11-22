"""Fan nomidan yo'nalish, kurs, semestr, o'quv yili va sof nomni ajratish (fermi.uz, 2026-11-17).

Fan nomlari sillabusni yuklagan o'qituvchi yozganicha saqlanadi: "Davolash ishi 2023-2024 (Milliy)
5-semestr Patologik fiziologiya", "Farmakologiya Ped 3k 5s", "BIokimyo TPI 3s"... Sayt yo'nalish/kurs/
semestrni shu matndan o'zi ajratar edi va nom tarjima qilinishi yoki boshqacha yozilishi bilan buzilardi.

`CourseSyllabus.subject_name` va `AcademicDepartment.name` O'ZGARTIRILMAYDI — ular kalit va AI promptlari
uchun ishlatiladi. Bu yerda faqat tashqi API uchun KO'RSATISH ma'lumoti tuziladi:

* yo'nalish, kurs, semestr, o'quv yili — nomdan (va `direction_code` dan) ajratiladi;
* sof nom va uning uz/ru/en tarjimasi — `app/data/subject_titles.json` lug'atidan (imlo xatolari shu yerda
  tuzatilgan, tarjimalar qo'lda tekshirilgan). Lug'atda yo'q yangi fan uchun — ajratilgan nom asl tilda,
  tarjima bo'lsa `name_i18n` dan.
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

LANGS = ("uz", "ru", "en")
DATA_FILE = Path(__file__).resolve().parent.parent / "data" / "subject_titles.json"

#: Ta'lim yo'nalishlari (bakalavriat). Kod — saytga barqaror kalit.
PROGRAMMES: dict[str, dict[str, str]] = {
    "davolash": {"uz": "Davolash ishi", "ru": "Лечебное дело", "en": "General Medicine"},
    "pediatriya": {"uz": "Pediatriya ishi", "ru": "Педиатрическое дело", "en": "Pediatrics"},
    "stomatologiya": {"uz": "Stomatologiya", "ru": "Стоматология", "en": "Dentistry"},
    "tibbiy-profilaktika": {"uz": "Tibbiy profilaktika ishi", "ru": "Медико-профилактическое дело",
                            "en": "Preventive Medicine"},
    "oliy-hamshiralik": {"uz": "Oliy hamshiralik ishi", "ru": "Высшее сестринское дело", "en": "Higher Nursing"},
    "farmatsiya": {"uz": "Farmatsiya", "ru": "Фармация", "en": "Pharmacy"},
    "fundamental-tibbiyot": {"uz": "Fundamental tibbiyot", "ru": "Фундаментальная медицина",
                             "en": "Fundamental Medicine"},
    "tibbiy-biologik": {"uz": "Tibbiy biologik ish", "ru": "Медико-биологическое дело", "en": "Medical Biology"},
    "biotibbiyot-muhandisligi": {"uz": "Biotibbiyot muhandisligi", "ru": "Биомедицинская инженерия",
                                 "en": "Biomedical Engineering"},
}

#: Sillabusdagi `direction_code` (OnlineTest yo'nalishi) → yo'nalish kodi.
DIRECTIONS = {
    "DI": "davolash", "PI": "pediatriya", "S": "stomatologiya", "TPI": "tibbiy-profilaktika",
    "OHI": "oliy-hamshiralik", "F": "farmatsiya", "FT": "fundamental-tibbiyot", "TBI": "tibbiy-biologik",
    "BM": "biotibbiyot-muhandisligi", "FT+TBI": "fundamental-tibbiyot",
}

#: Ta'lim shakli (guruh turi) — nomdagi qavs ichidagi so'z.
TRACKS = {
    "milliy": {"uz": "Milliy", "ru": "Национальный", "en": "National"},
    "xorijiy": {"uz": "Xorijiy", "ru": "Иностранный", "en": "International students"},
    "xorijiy-gibrid": {"uz": "Xorijiy, gibrid", "ru": "Иностранный, гибрид", "en": "International students, hybrid"},
    "yevro": {"uz": "Yevro", "ru": "Евро", "en": "Euro"},
    "xalqaro": {"uz": "Xalqaro", "ru": "Международный", "en": "International"},
}

#: Nom boshidagi to'liq yo'nalish nomi. Stomatologiya/Farmatsiya fan nomi ham bo'lishi mumkin —
#: ular faqat orqasidan yil yoki semestr kelsa yo'nalish deb olinadi.
_PREFIXES = (
    (r"davolash\s+ishi", "davolash"),
    (r"pediatriya\s+ishi", "pediatriya"),
    (r"tibbiy\s+profilaktika\s+ishi", "tibbiy-profilaktika"),
    (r"oliy\s+hamshiralik\s+ishi", "oliy-hamshiralik"),
    (r"fundamental\s+tibbiyot", "fundamental-tibbiyot"),
    (r"tibbiy\s+biologik\s+ishi?", "tibbiy-biologik"),
    (r"farmatsiya(?=\s+\d)", "farmatsiya"),
    (r"stomatologiya(?=\s+\d)", "stomatologiya"),
)
#: Qisqartmalar (nomning boshida, oxirida yoki o'rtasida alohida so'z sifatida).
_ABBR = {
    "DI": "davolash", "PI": "pediatriya", "PED": "pediatriya", "TPI": "tibbiy-profilaktika",
    "OHI": "oliy-hamshiralik", "FT": "fundamental-tibbiyot", "TBI": "tibbiy-biologik", "FARM": "farmatsiya",
    "STOM": "stomatologiya", "BM": "biotibbiyot-muhandisligi",
}

_APOS = str.maketrans({c: "'" for c in "ʻʼ‘’`´"})


def norm_key(text: str) -> str:
    """Lug'at kaliti: kichik harf, tutuq belgisi bir xil, ortiqcha bo'shliq va tinish belgisisiz."""
    t = (text or "").translate(_APOS).lower()
    t = re.sub(r"[\s,.;:()\-–—]+", " ", t)
    return t.strip()


def _int(value: str | None) -> int | None:
    try:
        return int(value) if value is not None else None
    except ValueError:
        return None


def parse_subject_name(name: str, direction_code: str = "") -> dict:
    """Nomdan: programme_code, track, study_year, course, semester, semesters, title (asl tilda, tozalangan)."""
    text = " " + (name or "").replace("–", "-").replace("—", "-") + " "
    programme = ""
    track = ""
    study_year = ""
    course: int | None = None
    semesters: list[int] = []

    for pattern, code in _PREFIXES:
        m = re.match(r"\s*" + pattern + r"\b", text, flags=re.I)
        if m:
            programme = code
            text = " " + text[m.end():]
            break

    m = re.search(r"\b(20\d\d)\s*[- ]\s*(20\d\d)\b", text)
    if m:
        study_year = f"{m.group(1)}-{m.group(2)}"
        text = text[:m.start()] + " " + text[m.end():]
    text = re.sub(r"\b20\d\d\b", " ", text)  # yolg'iz yil — qabul yili, nomga kirmaydi

    m = re.search(r"\(\s*(milliy|xorijiy\s+gibrid|xorijiy|yevro|xalqaro)\s*\)", text, flags=re.I)
    if m:
        track = m.group(1).lower().replace(" ", "-")
        text = text[:m.start()] + " " + text[m.end():]
    elif re.search(r"\bmilliy\b", text, flags=re.I):
        track = "milliy"
        text = re.sub(r"\bmilliy\b", " ", text, flags=re.I)
    if re.search(r"\bgibrid\b", text, flags=re.I):
        track = "xorijiy-gibrid" if track in ("", "xorijiy") else track
        text = re.sub(r"\bgibrid\b", " ", text, flags=re.I)

    # "1k1s" — kurs va semestr bitta so'zda.
    m = re.search(r"\b(\d)\s*k\s*(\d{1,2})\s*s\b", text, flags=re.I)
    if m:
        course, semesters = int(m.group(1)), [int(m.group(2))]
        text = text[:m.start()] + " " + text[m.end():]
    m = re.search(r"\b(\d)\s*-?\s*(?:kurs|k)\b", text, flags=re.I)
    if m:
        course = int(m.group(1))
        text = text[:m.start()] + " " + text[m.end():]
    if not semesters:
        m = re.search(r"\b(\d{1,2})(?:\s*-\s*(\d{1,2}))?\s*-?\s*(?:semestr|sm|s)\b\.?", text, flags=re.I)
        if m:
            a, b = int(m.group(1)), _int(m.group(2))
            semesters = list(range(a, b + 1)) if b and b > a else [a]
            text = text[:m.start()] + " " + text[m.end():]

    # Nomga yopishib qolgan qisqartma: "Patologik fiziologiyaTPI".
    text = re.sub(r"(?<=[a-z'ʻ’])(TPI|OHI|DI|PI)\b", r" \1", text)
    # Guruh raqamlari ("231-2316") — nomga kirmaydi.
    text = re.sub(r"\b\d{3}\s*-\s*\d{3,4}\b", " ", text)
    # Qisqartmalar: "TPI", "(DI)", "Stom.", "FT+TBI", "Ped".
    text = re.sub(r"\(\s*(DI|PI|TPI|OHI|FT|BM)\s*\)", lambda m: " " + m.group(1) + " ", text)
    found = re.findall(r"(?<![\w+])(FT\+TBI|DI|PI|PED|Ped|TPI|OHI|FT|TBI|FARM|STOM|Stom|BM)(?![\w+])\.?", text)
    for token in found:
        code = "fundamental-tibbiyot" if token == "FT+TBI" else _ABBR.get(token.upper(), "")
        if code and not programme:
            programme = code
    text = re.sub(r"(?<![\w+])(FT\+TBI|DI|PI|PED|Ped|TPI|OHI|FT|TBI|FARM|STOM|Stom|BM)(?![\w+])\.?", " ", text)
    # "ODAM ANATOMIYASI, DAVOLASH 1-SEMESTR" — yo'nalish nomi oxirida.
    m = re.search(r"[,\s]+davolash\s*$", text, flags=re.I)
    if m:
        programme = programme or "davolash"
        text = text[:m.start()]

    if not programme and direction_code:
        programme = DIRECTIONS.get(direction_code.strip().upper(), "")
    if course is None and semesters:
        course = (semesters[0] + 1) // 2

    title = re.sub(r"\s+", " ", text).strip(" ,.;:-")
    title = re.sub(r"\s+([,.;:])", r"\1", title)
    if title.isupper():
        title = title.capitalize()
    elif title[:1].islower():
        title = title[:1].upper() + title[1:]
    return {
        "programme_code": programme,
        "track": track,
        "study_year": study_year,
        "course": course,
        "semester": semesters[0] if semesters else None,
        "semesters": semesters,
        "title": title,
    }


# ── Lug'at ─────────────────────────────────────────────────────────────────


@lru_cache(maxsize=1)
def _data() -> dict:
    try:
        raw = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raw = {}
    def index(entries: list) -> dict[str, dict[str, str]]:
        out: dict[str, dict[str, str]] = {}
        for entry in entries or []:
            names = {code: str(entry.get(code) or "").strip() for code in LANGS}
            for alias in [names["uz"], *(entry.get("aliases") or [])]:
                if alias:
                    out[norm_key(alias)] = names
        return out

    return {"titles": index(raw.get("titles")), "departments": index(raw.get("departments")),
            "subjects": raw.get("subjects") or {}}


def title_names(title: str) -> dict[str, str]:
    """Sof nom uz/ru/en da (lug'atdan). Lug'atda yo'q bo'lsa — bo'sh."""
    return dict(_data()["titles"].get(norm_key(title)) or {})


def department_names(name: str) -> dict[str, str]:
    """Kafedra nomi uz/ru/en (imlo tuzatilgan). Lug'atda yo'q bo'lsa — bo'sh."""
    return dict(_data()["departments"].get(norm_key(name)) or {})


def _clean(raw: object) -> dict[str, str]:
    if not isinstance(raw, dict):
        return {}
    return {code: str(raw.get(code) or "").strip() for code in LANGS if str(raw.get(code) or "").strip()}


@lru_cache(maxsize=2048)
def _subject_meta_cached(code: str, name: str, direction: str, instruction: str, i18n_json: str,
                         dept_name: str, dept_i18n_json: str) -> str:
    parsed = parse_subject_name(name, direction)
    override = (_data()["subjects"] or {}).get(code) or {}
    for key in ("programme_code", "track", "study_year", "course", "semester", "semesters", "title"):
        if key in override:
            parsed[key] = override[key]
    if "semester" in override and "semesters" not in override:
        parsed["semesters"] = [override["semester"]] if override["semester"] else []

    titles = title_names(parsed["title"])
    source_lang = instruction if instruction in LANGS else "uz"
    pure = dict(titles)
    if not pure:
        # Lug'atda yo'q (yangi fan): ajratilgan nom asl tilda; boshqa tillarda — nom tarjimasidan
        # xuddi shu qoidalar bilan ajratilgan qism (bo'lmasa — yo'q, sayt asl nomga qaytadi).
        pure = {source_lang: parsed["title"]}
        for lang, value in _clean(json.loads(i18n_json)).items():
            if lang != source_lang and lang not in pure:
                pure[lang] = parse_subject_name(value, "")["title"] or value

    if titles:
        full = {lang: compose_name(pure[lang], parsed, lang) for lang in LANGS if pure.get(lang)}
    else:
        full = {"uz": name}
        full.update({k: v for k, v in _clean(json.loads(i18n_json)).items() if k != "uz"})
    dept_full = department_names(dept_name)
    if not dept_full and dept_name:
        dept_full = {"uz": dept_name, **{k: v for k, v in _clean(json.loads(dept_i18n_json)).items() if k != "uz"}}
    programme = parsed["programme_code"]
    return json.dumps({
        "programme_code": programme,
        "programme_name_i18n": dict(PROGRAMMES.get(programme) or {}),
        "track": parsed["track"],
        "track_i18n": dict(TRACKS.get(parsed["track"]) or {}),
        "study_year": parsed["study_year"],
        "course": parsed["course"],
        "semester": parsed["semester"],
        "semesters": parsed["semesters"],
        "pure_title": pure.get("uz") or pure.get(source_lang) or parsed["title"],
        "pure_title_i18n": pure,
        "subject_name_i18n": full,
        "department_name_i18n": dept_full,
    }, ensure_ascii=False)


_WORDS = {
    "uz": ("{n}-kurs", "{n}-semestr"),
    "ru": ("{n} курс", "{n} семестр"),
    "en": ("year {n}", "semester {n}"),
}


def compose_name(title: str, parsed: dict, lang: str) -> str:
    """Bir xil ko'rinishdagi to'liq nom: "Patologik fiziologiya — Davolash ishi, 3-kurs, 5-semestr"."""
    parts = []
    programme = (PROGRAMMES.get(parsed.get("programme_code") or "") or {}).get(lang)
    track = parsed.get("track") or ""
    track_name = (TRACKS.get(track) or {}).get(lang) if track and track != "milliy" else ""
    if programme:
        parts.append(f"{programme} ({track_name})" if track_name else programme)
    elif track_name:
        parts.append(track_name)
    course_w, sem_w = _WORDS[lang]
    if parsed.get("course"):
        parts.append(course_w.format(n=parsed["course"]))
    sems = parsed.get("semesters") or ([parsed["semester"]] if parsed.get("semester") else [])
    if sems:
        parts.append(sem_w.format(n=str(sems[0]) if len(sems) == 1 else f"{sems[0]}-{sems[-1]}"))
    return f"{title} — {', '.join(parts)}" if parts else title


def subject_meta(code: str, name: str, *, direction_code: str = "", instruction_language: str = "uz",
                 name_i18n: dict | None = None, department_name: str = "",
                 department_i18n: dict | None = None) -> dict:
    """Bitta fan uchun tashqi API maydonlari (kesh bilan — ro'yxatlarda minglab qatorga chaqiriladi)."""
    return json.loads(_subject_meta_cached(
        code or "", name or "", (direction_code or "").strip().upper(), (instruction_language or "uz").lower(),
        json.dumps(name_i18n or {}, sort_keys=True, ensure_ascii=False), department_name or "",
        json.dumps(department_i18n or {}, sort_keys=True, ensure_ascii=False),
    ))


#: Fanlar ro'yxati kichik (~300) — 5 daqiqa xotirada.
LOOKUP_SECONDS = 300
_lookup_memo: dict[str, object] = {"at": 0.0, "data": {}}

#: `apply` qo'shadigan maydonlar (fermi.uz, A va B).
FIELDS = ("programme_code", "programme_name_i18n", "track", "track_i18n", "study_year", "course", "semester",
          "semesters", "pure_title", "pure_title_i18n", "subject_name_i18n", "department_name_i18n")


def lookup(db) -> dict[str, dict]:
    """subject_code → `subject_meta`."""
    import time

    from sqlalchemy import select

    from app.models.content import CourseSyllabus

    now = time.monotonic()
    if now - float(_lookup_memo["at"]) < LOOKUP_SECONDS and _lookup_memo["data"]:
        return _lookup_memo["data"]  # type: ignore[return-value]
    data: dict[str, dict] = {}
    for syl in db.execute(select(CourseSyllabus)).scalars().all():
        dept = syl.department
        data[syl.subject_code] = subject_meta(
            syl.subject_code, syl.subject_name, direction_code=syl.direction_code,
            instruction_language=syl.instruction_language, name_i18n=syl.name_i18n,
            department_name=dept.name if dept else "", department_i18n=dept.name_i18n if dept else None,
        )
    _lookup_memo.update(at=now, data=data)
    return data


def apply(row: dict, meta: dict | None, lang: str | None) -> dict:
    """Qatorga yangi maydonlarni qo'shadi; `lang` berilsa `subject_name`/`department_name` shu tilda.

    `lang` siz `subject_name`/`department_name` avvalgidek (bazadagi asl nom) — sayt ularni hozir o'qiydi.
    """
    if not meta:
        return row
    for key in FIELDS:
        row[key] = meta.get(key)
    code = "uz" if lang == "uz-cyrl" else lang
    programme_names = meta.get("programme_name_i18n") or {}
    row["programme_name"] = programme_names.get(code or "uz", "")
    if code:
        row["subject_name"] = (meta.get("subject_name_i18n") or {}).get(code) or row.get("subject_name", "")
        row["department_name"] = (meta.get("department_name_i18n") or {}).get(code) or row.get("department_name", "")
        row["pure_title"] = (meta.get("pure_title_i18n") or {}).get(code) or meta.get("pure_title")
    return row


def reset_cache() -> None:
    _data.cache_clear()
    _subject_meta_cached.cache_clear()
    _lookup_memo.update(at=0.0, data={})
