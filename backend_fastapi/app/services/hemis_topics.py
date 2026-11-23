"""HEMIS mavzulari → iMentor sillabuslari (2026-11-23).

Rektorat qarori: o'qituvchilar mavzulari HEMIS bilan BIR XIL bo'lsin — o'zi yuklagan yoki avval
yuklangan sillabuslar emas. Har kecha:

  1. HEMIS dars jadvalidan (joriy o'quv yili) har o'qituvchining darslari: fan, semestr, guruh.
  2. Guruh → o'quv reja (`group-list._curriculum`).
  3. Har (o'quv reja, fan, semestr) uchun HEMIS mavzulari (`curriculum-subject-topic-list`).
  4. Shu uchlik uchun bitta iMentor sillabusi (`subject_code = hemis-<reja>-<fan>-<semestr>`),
     mavzulari HEMIS tartibida: ma'ruza L1.., amaliy/seminar A1.., laboratoriya B1.., klinik K1..,
     mustaqil I1... Faqat shu fanni o'qitadigan o'qituvchilarga ko'rinadi va ularning
     "Mening fanlarim" ro'yxatiga o'zi qo'shiladi.

Mavzu kodi barqaror: HEMIS mavzu id'si (`hemis_id`) bir marta olgan kodini saqlaydi — HEMIS'da
yangi mavzu qo'shilsa, oxirgi raqamdan keyin oladi; tayyorlangan materiallar boshqa mavzuga
"ko'chib" qolmaydi. Eski sillabuslarga tegilmaydi (o'qituvchi ro'yxatida pastda, "eski").
HEMIS'dan FAQAT o'qiydi.
"""
from __future__ import annotations

import datetime as dt
import logging
import re
from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.content import AcademicDepartment, CourseSyllabus, StaffCourseSelection
from app.services import hemis_client
from app.services.hemis_schedule import teacher_map

logger = logging.getLogger(__name__)

PREFIX = "hemis-"

#: HEMIS mashg'ulot turi → (iMentor bo'lim turi, kod harfi).
_TYPES = {
    "11": ("lecture", "L"),       # Ma'ruza
    "12": ("lab", "B"),           # Laboratoriya
    "13": ("practical", "A"),     # Amaliy
    "14": ("practical", "A"),     # Seminar
    "17": ("independent", "I"),   # Mustaqil ta'lim
    "18": ("clinical", "K"),      # Klinik mashg'ulot
}
_ORDER = {"L": 0, "A": 1, "K": 2, "B": 3, "I": 4}


def _type_of(code: str, name: str = "") -> tuple[str, str]:
    if code in _TYPES:
        return _TYPES[code]
    low = (name or "").lower()
    if "ma" in low and "ruza" in low:
        return _TYPES["11"]
    if "labor" in low:
        return _TYPES["12"]
    if "klinik" in low:
        return _TYPES["18"]
    if "mustaqil" in low:
        return _TYPES["17"]
    return _TYPES["13"]


def subject_code(curriculum: int | str, subject: int | str, semester: str) -> str:
    return f"{PREFIX}{curriculum}-{subject}-{semester}"


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()


def plan_courses(lessons: list[dict], group_curriculum: dict[str, str], teachers: dict) -> dict:
    """(reja, fan, semestr) → {name, semester_name, department_hemis_id, owners, lang}."""
    courses: dict[tuple[str, str, str], dict] = {}
    for les in lessons:
        subj = les.get("subject") or {}
        sem = les.get("semester") or {}
        grp = les.get("group") or {}
        curr = group_curriculum.get(str(grp.get("id") or ""))
        if not subj.get("id") or not sem.get("code") or not curr:
            continue
        key = (str(curr), str(subj["id"]), str(sem["code"]))
        c = courses.setdefault(key, {
            "name": _clean(subj.get("name")),
            "semester_name": _clean(sem.get("name")),
            "department_hemis_id": str((les.get("department") or {}).get("id") or ""),
            "owners": set(),
            "langs": defaultdict(int),
        })
        login = teachers.get((les.get("employee") or {}).get("id"))
        if login:
            c["owners"].add(login)
        lang = _clean(((grp.get("educationLang") or {}).get("name"))).lower()
        c["langs"]["ru" if lang.startswith("rus") else "en" if lang.startswith("ingliz") or lang.startswith("eng") else "uz"] += 1
    return courses


def build_topics(items: list[dict], previous: list[dict] | None) -> list[dict]:
    """HEMIS mavzulari → iMentor mavzulari; avvalgi kodlar `hemis_id` bo'yicha saqlanadi."""
    old = {str(t.get("hemis_id")): str(t.get("id")) for t in (previous or []) if t.get("hemis_id")}
    used: dict[str, int] = defaultdict(int)
    for code in old.values():
        m = re.match(r"([A-Z])(\d+)$", code)
        if m:
            used[m.group(1)] = max(used[m.group(1)], int(m.group(2)))
    rows = []
    for it in items:
        if it.get("active") is False or not _clean(it.get("name")):
            continue
        kind, letter = _type_of(str(it.get("_training_type") or ""))
        rows.append((letter, int(it.get("position") or 0), int(it.get("id") or 0), kind, it))
    rows.sort(key=lambda r: (_ORDER.get(r[0], 9), r[1], r[2]))
    out = []
    for letter, _pos, hid, kind, it in rows:
        code = old.get(str(hid))
        if not code or not code.startswith(letter):
            used[letter] += 1
            code = f"{letter}{used[letter]}"
        out.append({"id": code, "title": _clean(it.get("name")), "type": kind, "hemis_id": str(hid),
                    "hours": it.get("topic_load")})
    return out


def sync(db: Session, *, education_year: int | str = "", dry_run: bool = False) -> dict:
    lessons = hemis_client.schedule(education_year)
    group_curriculum = {
        str(g.get("id")): str(g.get("_curriculum"))
        for g in hemis_client.iter_all("/data/group-list")
        if g.get("_curriculum")
    }
    teachers = teacher_map(db, hemis_client.teachers())
    courses = plan_courses(lessons, group_curriculum, teachers)
    deps = {
        d.hemis_id: d.id
        for d in db.execute(select(AcademicDepartment).where(AcademicDepartment.hemis_id != "")).scalars()
    }
    existing = {
        s.subject_code: s
        for s in db.execute(select(CourseSyllabus).where(CourseSyllabus.subject_code.like(f"{PREFIX}%"))).scalars()
    }
    stats = {"darslar": len(lessons), "fanlar": len(courses), "yangi": 0, "yangilandi": 0, "mavzusiz": 0,
             "tanlov_qoshildi": 0, "oqituvchisiz": 0}
    now = dt.datetime.now(dt.timezone.utc)
    for (curr, subj, sem), c in courses.items():
        items = list(hemis_client.iter_all(
            "/data/curriculum-subject-topic-list", _curriculum=curr, _subject=subj, _semester=sem,
        ))
        items = [i for i in items if str(i.get("_curriculum")) == curr and str((i.get("subject") or {}).get("id")) == subj
                 and str(i.get("_semester")) == sem]
        if not items:
            stats["mavzusiz"] += 1
            continue
        if not c["owners"]:
            stats["oqituvchisiz"] += 1
        code = subject_code(curr, subj, sem)
        syl = existing.get(code)
        topics = build_topics(items, syl.topics if syl else None)
        name = f"{c['name']} · {c['semester_name']}" if c["semester_name"] else c["name"]
        lang = max(c["langs"], key=c["langs"].get) if c["langs"] else "uz"
        owners = sorted(c["owners"])
        if dry_run:
            stats["yangi" if syl is None else "yangilandi"] += 1
            continue
        if syl is None:
            syl = CourseSyllabus(
                subject_name=name[:255], subject_code=code, description="HEMIS o'quv rejasi mavzulari.",
                file_name="HEMIS", topics=topics, variants=[], instruction_language=lang,
                department_id=deps.get(c["department_hemis_id"]), allowed_owner_keys=owners, created_by="",
                is_active=True, sort_order=0, name_i18n={}, topics_i18n={}, direction_code="",
                created_at=now, updated_at=now,
            )
            db.add(syl)
            db.flush()
            stats["yangi"] += 1
        else:
            changed = (syl.topics != topics or syl.subject_name != name[:255]
                       or sorted(syl.allowed_owner_keys or []) != owners)
            if syl.topics != topics:
                syl.topics_i18n = {}
            if syl.subject_name != name[:255]:
                syl.name_i18n = {}
            syl.topics, syl.subject_name, syl.allowed_owner_keys = topics, name[:255], owners
            syl.department_id = deps.get(c["department_hemis_id"]) or syl.department_id
            syl.is_active = True
            if changed:
                syl.updated_at = now
                stats["yangilandi"] += 1
        have = set(db.execute(
            select(StaffCourseSelection.owner_key).where(StaffCourseSelection.syllabus_id == syl.id)
        ).scalars())
        for owner in owners:
            if owner not in have:
                db.add(StaffCourseSelection(owner_key=owner, syllabus_id=syl.id, variant_label="", selected_at=now))
                stats["tanlov_qoshildi"] += 1
        db.commit()
    logger.info("HEMIS mavzulari: %s", stats)
    return stats
