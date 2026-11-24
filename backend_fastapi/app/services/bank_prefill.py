"""Test bankini OLDINDAN to'ldirish (2026-11-24, rektorat: "dars paytida test uchun vaqt o'tmasin").

Har kecha (va kerak bo'lsa kun davomida) ertangi HEMIS darslari bo'yicha har o'qituvchi + fanning KEYINGI mavzularini
aniqlaydi va mavzu bankida 10 tadan kam savol bo'lsa — yetishmaganini yozib, bankka (`core_preparedcontent`, egasi
`imentor-bank`) saqlaydi. Darsda `composeTest` testni shu bankdan AI'siz, bir necha soniyada yig'adi.

Sifat — darsdagi bilan bir xil manbadan: tizim prompti brauzer yuborgan REAL so'rovlardan olinadi
(`prompt_samples`, fan turi va til bo'yicha shablon), kitob parchalari server RAG'idan (`strict_fragments_message`),
har savol tayangan parchasi bilan (manba). Bankdan berishda brauzer variantlarni tenglaydi va sifat filtridan o'tkazadi.
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import re
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models.content import CourseSyllabus
from app.models.prepared_content import PreparedContent
from app.services import book_retrieval as rag
from app.services import openai_client as oai
from app.services import question_pool as qp

logger = logging.getLogger(__name__)

BANK_OWNER = "imentor-bank"
TARGET = 10
WORKERS = 4  # bir vaqtda nechta mavzu
SPARE = 3
PER_CALL = 4
WORKERS = 6
HANDS_ON = ("practical", "clinical", "lab")
TEMPLATE_DIR = Path("/app/media/bank_prompts")
SAMPLE_DIR = Path("/app/prompt_samples")
_EN_GLUE = re.compile(r"\b(of|the|per|and|is|are|with|for|which|that|from)\b", re.I)
_LANG_NAME = {"uz": "Uzbek", "ru": "Russian", "en": "English"}


# ------------------------------------------------------------------ shablonlar

def _lang_of(system: str) -> str:
    m = re.search(r"Til: (\w+)\.", system)
    name = (m.group(1) if m else "").lower()
    return {"uzbek": "uz", "russian": "ru", "english": "en"}.get(name, "")


def _domain_of(system: str) -> str:
    head = system[:400]
    if "BEMOR kartasi" in head or "TIBBIY-NAZARIY" in head:
        return "biomedical"
    if "klinik" in head.lower() or "KROK" in system[:3000]:
        return "clinical"
    return "academic"


def refresh_templates() -> dict[str, dict]:
    """Real `test_generate_brief` so'rovlaridan (domen, til) bo'yicha shablonlar; diskka saqlanadi (konteyner
    qayta yaratilsa ham qoladi). Qaytaradi: {"clinical-uz": {"system":..., "tail":..., "domain_line":...}}."""
    TEMPLATE_DIR.mkdir(parents=True, exist_ok=True)
    found: dict[str, dict] = {}
    for f in sorted(SAMPLE_DIR.glob("test_generate_brief-*.json")) if SAMPLE_DIR.is_dir() else []:
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        msgs = d.get("messages") or []
        system = next((m["content"] for m in msgs if m.get("role") == "system"), "")
        user = next((m["content"] for m in msgs if m.get("role") == "user"), "")
        lang, domain = _lang_of(system), _domain_of(system)
        # Stomatologiya/rentgen/morfologiya qoidalari bor shablon umumiy uchun yaramaydi.
        if not lang or not system or "STOMATOLOG" in user[:3000].upper():
            continue
        cut = user.find("ta NOYOB, ZICH savol.")
        tail = user[cut + len("ta NOYOB, ZICH savol."):] if cut >= 0 else ""
        tail = re.sub(r"Har savol uzunligi va chuqurligi o'z \"level\" iga mos \(TEST PLAN\)\.\s*", "", tail)
        dom = re.search(r"^DOMEN:.*$", user, re.M)
        found[f"{domain}-{lang}"] = {"system": system, "tail": tail.strip(), "domain_line": dom.group(0) if dom else "",
                                     "model": d.get("model") or "", "temperature": d.get("temperature") or 0.38}
    for key, tpl in found.items():
        (TEMPLATE_DIR / f"{key}.json").write_text(json.dumps(tpl, ensure_ascii=False), encoding="utf-8")
    out = {}
    for f in TEMPLATE_DIR.glob("*.json"):
        try:
            out[f.stem] = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
    return out


# ------------------------------------------------------------------ nishonlar

def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9а-я]", "", (s or "").lower().replace("‘", "").replace("'", "").replace("ʻ", ""))


def targets(db: Session, day: dt.date, per_course: int = 2) -> list[dict]:
    """O'sha kungi darslar bo'yicha (o'qituvchi, HEMIS fani) — keyingi `per_course` amaliy mavzu."""
    lessons = db.execute(text(
        "select distinct teacher_username, subject_name from core_hemislesson where lesson_date = :d "
        "and teacher_username <> '' and coalesce(hemis_status,'') <> 'missing_from_hemis'"), {"d": day}).all()
    sels = defaultdict(list)
    for owner, sid, name in db.execute(text(
            "select s.owner_key, c.id, c.subject_name from core_staffcourseselection s join core_coursesyllabus c "
            "on c.id = s.syllabus_id where c.subject_code like 'hemis-%' and c.is_active")).all():
        sels[owner].append((sid, name))
    out: dict[tuple[int, str], dict] = {}
    for owner, subject in lessons:
        key = _norm(subject)
        for sid, name in sels.get(owner, []):
            if not _norm(name).startswith(key):
                continue
            syl = db.get(CourseSyllabus, sid)
            topics = [t for t in (syl.topics or []) if isinstance(t, dict) and t.get("type") in HANDS_ON]
            if not topics:
                continue
            last = db.execute(text(
                "select topic_code from core_preparedcontent where owner_key = :o and syllabus_id = :s "
                "order by created_at desc limit 1"), {"o": owner, "s": sid}).scalar()
            codes = [str(t.get("id") or "").lower() for t in topics]
            start = codes.index(last.lower()) + 1 if last and last.lower() in codes else 0
            for t in topics[start:start + per_course]:
                out.setdefault((sid, str(t["id"]).lower()), {"syllabus": syl, "topic": t, "owners": set()})["owners"].add(owner)
    return list(out.values())


def targets_all(db: Session) -> list[dict]:
    """Barcha faol HEMIS fanlarining HAMMA amaliy/klinik/lab mavzulari (bazani to'liq to'ldirish uchun).
    Tartib: fanlar aralash — avval har fanning 1-mavzusi, keyin 2-si va h.k. (yaqin darslar birinchi)."""
    full = {(r[0], r[1]) for r in db.execute(text(
        "select syllabus_id, lower(topic_code) from core_preparedcontent where kind='test' and retired_reason='' "
        "group by 1, 2 having coalesce(sum(jsonb_array_length(payload->'questions')),0) >= :n"), {"n": TARGET}).all()}
    per_syl: list[list[dict]] = []
    for syl in db.execute(select(CourseSyllabus).where(
            CourseSyllabus.subject_code.like("hemis-%"), CourseSyllabus.is_active.is_(True))).scalars():
        items = [{"syllabus": syl, "topic": t, "owners": set()} for t in (syl.topics or [])
                 if isinstance(t, dict) and t.get("type") in HANDS_ON and t.get("id")
                 and (syl.id, str(t["id"]).lower()) not in full]
        if items:
            per_syl.append(items)
    out: list[dict] = []
    for i in range(max((len(x) for x in per_syl), default=0)):
        out.extend(x[i] for x in per_syl if i < len(x))
    return out


# ------------------------------------------------------------------ yozish

def _domain_for(db: Session, syl: CourseSyllabus) -> str:
    d = db.execute(text(
        "select payload->>'domain' from core_preparedcontent where kind='test' and syllabus_id = :s "
        "and payload ? 'domain' order by created_at desc limit 1"), {"s": syl.id}).scalar()
    if d:
        return d
    from app.services import clinical_subjects

    dep = syl.department.name if syl.department else ""
    return "clinical" if clinical_subjects.is_clinical(syl.subject_name, dep) else "biomedical"


def _usable(q: dict, lang: str) -> bool:
    opts = q.get("options")
    idx = q.get("correctOptionIndex")
    stem = str(q.get("question") or "").strip()
    if not stem or stem.count("?") > 1 or not isinstance(opts, list) or len(opts) != 5:
        return False
    if not isinstance(idx, int) or not 0 <= idx < 5 or len({str(o).strip().lower() for o in opts}) != 5:
        return False
    if lang != "en" and len(_EN_GLUE.findall(" ".join([stem, *map(str, opts)]))) >= 2:
        return False
    return True


def _call(api_key: str, tpl: dict, syl: CourseSyllabus, topic: str, n: int, part: str) -> tuple[list[dict], list[dict]]:
    from app.core.db import SessionLocal

    db = SessionLocal()
    try:
        candidates = rag.retrieve_book_context(db, syl.subject_code, topic, top_k=rag.STRICT_BOOK_TOP_K)
    finally:
        db.close()
    chunks = rag.relevant_chunks(api_key, topic, candidates) if candidates else []
    fragments: list[dict] = []
    messages = [{"role": "system", "content": tpl["system"]}]
    if len(chunks) >= rag.MIN_RELEVANT_FRAGMENTS:
        strict, fragments = rag.strict_fragments_message(chunks, [])
        if strict:
            messages.append({"role": "system", "content": strict})
    dep = syl.department.name if syl.department else ""
    user = (f"{part}\n\nKafedra: {dep}.\nFan: {syl.subject_name}.\n{tpl.get('domain_line', '')}\n"
            f"Mavzu: {topic}\n\n{n} ta NOYOB, ZICH savol. {tpl.get('tail', '')}")
    messages.append({"role": "user", "content": user})
    raw = oai.generate_openai_chat(api_key, messages=messages, model=tpl.get("model") or "gpt-5.4-nano",
                                   max_tokens=min(16000, n * 640 + 500), temperature=float(tpl.get("temperature") or 0.38),
                                   timeout_sec=oai.timeout_for("test_generate_brief"),
                                   response_format={"type": "json_object"}, usage_kind="bank_prefill")
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return [], fragments
    return [q for q in data.get("questions") or [] if isinstance(q, dict)], fragments




def _longest_correct(q: dict) -> bool:
    opts, ci = q["options"], q["correctOptionIndex"]
    others = [len(o) for i, o in enumerate(opts) if i != ci]
    return len(opts[ci]) >= max(others) * 0.95


def balance(api_key: str, questions: list[dict], lang: str) -> int:
    """Eng uzun javob doim to'g'ri bo'lmasin: to'g'ri javob eng uzun bo'lgan savollarda
    2 ta chalg'ituvchini to'g'ri javobdan uzunroq qilib qayta yozdiradi (bitta arzon chaqiruv)."""
    bad = [i for i, q in enumerate(questions) if _longest_correct(q)]
    # ~30% savolda to'g'ri javob eng uzun bo'lishi tabiiy — hammasini emas, ortig'ini tuzatamiz.
    keep = int(len(questions) * 0.25)
    bad = bad[keep:]
    if not bad:
        return 0
    lang_name = {"uz": "o'zbek (lotin)", "ru": "rus", "en": "ingliz"}.get(lang, lang)
    items = []
    for i in bad:
        q = questions[i]
        ci = q["correctOptionIndex"]
        items.append({"i": i, "question": q["question"], "correct": q["options"][ci],
                      "distractors": [o for j, o in enumerate(q["options"]) if j != ci]})
    prompt = (f"Quyidagi test savollarida to'g'ri javob eng uzun variant bo'lib qolgan — bu talabaga javobni oshkor qiladi. "
              f"Har bir savol uchun 4 ta noto'g'ri variantni qayta yoz: kamida 2 tasi to'g'ri javobdan UZUNROQ bo'lsin, "
              f"qolganlari unga yaqin uzunlikda. Ular aniq NOTO'G'RI bo'lib qolsin, lekin ishonarli, mavzuga oid, "
              f"to'g'ri javob bilan bir xil uslub va tuzilishda. Til: {lang_name}; boshqa tildagi so'z ishlatma. "
              f"To'g'ri javobni o'zgartirma. JSON qaytar: {{\"items\":[{{\"i\":<son>,\"distractors\":[4 ta matn]}}]}}\n\n"
              + json.dumps(items, ensure_ascii=False))
    raw = oai.generate_openai_chat(api_key, messages=[{"role": "user", "content": prompt}], model="gpt-5.4-nano",
                                   max_tokens=min(16000, len(items) * 700 + 300), temperature=0.3,
                                   timeout_sec=oai.timeout_for("test_generate_brief"),
                                   response_format={"type": "json_object"}, usage_kind="bank_prefill")
    try:
        out = json.loads(raw).get("items") or []
    except (TypeError, ValueError, AttributeError):
        return 0
    fixed = 0
    for it in out:
        try:
            i, ds = int(it["i"]), [str(d).strip() for d in it["distractors"]]
        except (KeyError, TypeError, ValueError):
            continue
        if i not in bad or len(ds) != 4 or not all(ds):
            continue
        q = questions[i]
        ci = q["correctOptionIndex"]
        new = list(ds)
        new.insert(ci, q["options"][ci])
        cand = {**q, "options": new}
        if _longest_correct(cand) or not _usable(cand, lang):
            continue
        q["options"] = new
        q.pop("optionExplanations", None)
        fixed += 1
    return fixed
PARTS = (
    "QISM 1/3: savollar mavzuning ASOSIY jihatlariga qaratilsin — ta’rif, mexanizm/usul, asosiy belgilar va tasnif.",
    "QISM 2/3: savollar mavzuning TALQIN jihatlariga qaratilsin — tekshiruv natijalari talqini, diagnostika, qiyosiy tashxis.",
    "QISM 3/3: savollar mavzuning AMALIY jihatlariga qaratilsin — asoratlar, davolash/taktika, profilaktika va xulosa.",
)


def fill_topic(db: Session, api_key: str, templates: dict, item: dict, *, dry_run: bool = False) -> dict:
    syl, t = item["syllabus"], item["topic"]
    code, title = str(t["id"]).lower(), str(t.get("title") or "").strip()
    lang = (syl.instruction_language or "uz").lower()
    # Tez yo'l: shu mavzuning o'zida 10+ savol bo'lsa — to'liq (o'xshash nomlar qidiruvi sekin).
    direct = db.execute(text(
        "select coalesce(sum(jsonb_array_length(payload->'questions')),0) from core_preparedcontent "
        "where kind='test' and retired_reason='' and syllabus_id=:s and lower(topic_code)=:c"),
        {"s": syl.id, "c": code}).scalar() or 0
    if direct >= TARGET:
        return {"topic": title[:60], "bank": int(direct), "written": 0, "status": "full"}
    have = qp.pool(db, syllabus_id=syl.id, variant="", topic_code=code, language=lang, owner_key=BANK_OWNER)
    bank = len(have.get("questions") or [])
    need = TARGET - bank
    res = {"topic": title[:60], "bank": bank, "written": 0, "status": "full"}
    if need <= 0:
        return res
    domain = _domain_for(db, syl)
    tpl = templates.get(f"{domain}-{lang}") or next(
        (templates[k] for k in sorted(templates) if k.endswith(f"-{lang}")), None)
    if tpl is None:
        res["status"] = f"shablon yo'q ({domain}-{lang})"
        return res
    if dry_run:
        res["status"] = f"yoziladi {need}"
        return res
    seen = {qp._key(str(q.get("question") or "")) for q in have.get("questions") or []}
    questions: list[dict] = []
    refs: dict[str, dict] = {}
    for _round in range(2):  # kam chiqsa — yana bir marta
        if len(questions) >= need:
            break
        total = need - len(questions) + SPARE
        sizes = [s for s in (total // 3 + (1 if i < total % 3 else 0) for i in range(3)) if s]
        with ThreadPoolExecutor(max_workers=len(sizes)) as pool:
            parts = list(pool.map(lambda a: _call(api_key, tpl, syl, title, a[0], PARTS[a[1]]),
                                  [(s, i) for i, s in enumerate(sizes)]))
        for qs, frags in parts:
            by_id = {f["id"]: f for f in frags}
            for q in qs:
                if not _usable(q, lang):
                    continue
                k = qp._key(str(q.get("question") or ""))
                if not k or k in seen:
                    continue
                seen.add(k)
                src = str(q.get("source") or "").strip()
                frag = by_id.get(src)
                item_q = {"question": str(q["question"]).strip(), "options": [str(o).strip() for o in q["options"]],
                          "correctOptionIndex": q["correctOptionIndex"], "explanation": str(q.get("explanation") or "").strip(),
                          "level": q.get("level") if q.get("level") in ("hard", "medium", "easy") else "medium"}
                if frag:
                    ref = {"kind": frag.get("kind") or "book", "title": frag.get("title") or "", "pages": frag.get("pages") or ""}
                    item_q["references"], item_q["grounded"] = [ref], True
                    refs[json.dumps(ref, ensure_ascii=False, sort_keys=True)] = ref
                questions.append(item_q)
    if not questions:
        res["status"] = "yozilmadi"
        return res
    try:
        balance(api_key, questions, lang)
    except Exception:  # noqa: BLE001 — muvozanat ixtiyoriy
        logger.exception("bank prefill balance")
    now = dt.datetime.now(dt.timezone.utc)
    db.add(PreparedContent(
        owner_key=BANK_OWNER, kind="test", topic=title[:255], topic_norm=f"{syl.id}::hemis::{code}"[:255],
        author_display_name="iMentor bank", subject_name=syl.subject_name[:255], subject_code=syl.subject_code[:64],
        variant_label="HEMIS", topic_code=code[:32], syllabus_id=syl.id,
        payload={"topic": title, "questions": questions[:TARGET + SPARE], "references": list(refs.values()),
                 "primaryLanguage": lang, "domain": domain, "difficulty": "hard", "appVersion": "bank-prefill"},
        created_at=now,
    ))
    db.commit()
    res.update(written=len(questions), status="yozildi")
    return res


def run(db: Session, api_key: str, day: dt.date | None, *, per_course: int = 2, limit: int = 0,
        dry_run: bool = False) -> dict:
    """`day=None` — barcha amaliy mavzular (targets_all)."""
    templates = refresh_templates()
    items = targets_all(db) if day is None else targets(db, day, per_course)
    if limit:
        items = items[:limit]
    stats: dict[str, int] = defaultdict(int)
    stats["mavzular"] = len(items)
    stats["shablonlar"] = len(templates)
    from app.core.db import SessionLocal

    def one(item: dict) -> dict:
        s = SessionLocal()  # har oqimga o'z sessiya
        try:
            return fill_topic(s, api_key, templates, item, dry_run=dry_run)
        except Exception:  # noqa: BLE001 — bitta mavzu yiqilsa qolganlari davom etadi
            logger.exception("bank prefill: %s", item["topic"].get("title"))
            s.rollback()
            return {"status": "xato", "written": 0}
        finally:
            s.close()

    with ThreadPoolExecutor(max_workers=1 if dry_run else WORKERS) as pool:
        for i, r in enumerate(pool.map(one, items), 1):
            stats[r["status"].split(" (")[0]] += 1
            stats["yozilgan_savol"] += r["written"]
            if not dry_run and r["written"]:
                print(f"[{i}/{len(items)}] {r.get('topic', '')} +{r['written']}", flush=True)
    return dict(stats)
