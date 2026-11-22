"""«Surunkalilar» — doimiy muammo bo'layotgan o'qituvchilar (2026-11-19).

Rektor: "imentor ichida «surunkalilar» degan karta ham qo'ying — ichida doimiy muammo bo'layotgan o'qituvchilar
ro'yxati chiqsin, unga biriktirilgan mas'uli ham chiqsin".

Qoida (bir kunlik xato emas — takrorlanadigani):
* oyna — oxirgi `WINDOW_DAYS` kun (standart 30). Tanlangan davr yaqin kunlar bo'lsa — fonda isitilgan
  «30 kun» hisobi (tez); eski davr tanlansa — o'sha davr oxirigacha 30 kun;
* o'qituvchining har DARS KUNI (nazoratdagi, tugagan darslari bor kun) — yaxshi yoki muammoli. Kun muammoli,
  agar o'sha kungi darslardan birortasi yashil bo'lmasa: umuman ochmagan, kirib chiqqan (40 daqiqaga yetmagan)
  yoki test/keys sharti bajarilmagan («noto'g'ri foydalangan»);
* test/keys sharti 2026-11-19 dan kuchga kirgan — undan oldingi kunlarda 40 daqiqa ishlagan dars muammo
  sanalmaydi (qoida yo'q edi);
* surunkali = kamida `MIN_BAD_DAYS` (3) muammoli kun VA ular dars kunlarining kamida `MIN_SHARE` (50) foizi.

Raqamlar asosiy hisobot bilan BIR manbadan (`control_report_service._teacher_rows`): ta'til/kasallik kunlari,
«boshqa joyda dars» qaydlari, magistratura va hali tugamagan darslar u yerda allaqachon chiqarilgan.
Mas'ul — kafedra mas'ullari ro'yxatidan (`lesson_watch_bot.department_contacts`, faqat bazada; repoga
ism yozilmaydi). Telefon qaytarilmaydi — faqat ism va lavozim.
"""

from __future__ import annotations

import datetime as dt
import os
import time
from collections import defaultdict

from sqlalchemy.orm import Session

from app.services import dean_access
from app.services import lesson_report_service as lr

WINDOW_DAYS = int(os.environ.get("CHRONIC_WINDOW_DAYS", "30") or 30)
MIN_BAD_DAYS = int(os.environ.get("CHRONIC_MIN_BAD_DAYS", "3") or 3)
MIN_SHARE = int(os.environ.get("CHRONIC_MIN_SHARE", "50") or 50)
#: Tanlangan davr oxiri bugundan shuncha kun ichida bo'lsa — «bugungacha 30 kun» (fonda isitilgan) oynasi.
RECENT_DAYS = 6
#: Test/keys talabi kuchga kirgan kun.
MODULE_RULE_FROM = dt.date(2026, 11, 19)
#: Kartadagi kunlar tasmasi — oxirgi nechta dars kuni.
STRIP_DAYS = 14

#: Tayyor 30 kunlik hisob shu yoshgacha ishlatiladi (soniya). Asosiy hisobot har para tugagach «eskirgan»
#: bo'ladi va qayta hisoblanadi (~25 s); surunkalilik uchun bir soatlik kechikish ahamiyatsiz — karta har
#: ochilganda og'ir hisob boshlanmasin.
SOURCE_MAX_AGE = 60 * 60

#: Kun turi og'irligi: kunning holati — o'sha kungi eng yomon dars.
SEVERITY = {"ok": 0, "misuse": 1, "short": 2, "none": 3}


def window(end_day: dt.date, today: dt.date | None = None) -> tuple[dt.date, dt.date]:
    today = today or lr.current_time().date()
    end = today if end_day >= today - dt.timedelta(days=RECENT_DAYS) else min(end_day, today)
    return end - dt.timedelta(days=WINDOW_DAYS - 1), end


def lesson_kind(lesson, used: dict, work: dict, misuse: set, group: set) -> str:
    if lesson.id in used:
        return "ok"
    if lesson.id in misuse:
        return "ok" if lesson.lesson_date < MODULE_RULE_FROM else "misuse"
    if work.get(lesson.id, (0, 0))[0] > 0 or lesson.id in group:
        return "short"
    return "none"


def is_chronic(bad_days: int, lesson_days: int) -> bool:
    return bad_days >= MIN_BAD_DAYS and lesson_days > 0 and bad_days * 100 >= MIN_SHARE * lesson_days


def summarize(days: dict[dt.date, str]) -> dict:
    """{kun: tur} -> surunkalilik ko'rsatkichlari."""
    order = sorted(days)
    bad = [d for d in order if days[d] != "ok"]
    streak = 0
    for d in reversed(order):
        if days[d] == "ok":
            break
        streak += 1
    ok_days = [d for d in order if days[d] == "ok"]
    return {
        "lesson_days": len(order),
        "bad_days": len(bad),
        "share": round(100 * len(bad) / len(order)) if order else 0,
        "streak": streak,
        "none_days": sum(1 for d in bad if days[d] == "none"),
        "short_days": sum(1 for d in bad if days[d] == "short"),
        "misuse_days": sum(1 for d in bad if days[d] == "misuse"),
        "last_ok": ok_days[-1].isoformat() if ok_days else None,
        "first_bad": bad[0].isoformat() if bad else None,
        "last_bad": bad[-1].isoformat() if bad else None,
        "strip": [{"date": d.isoformat(), "kind": days[d]} for d in order[-STRIP_DAYS:]],
    }


def responsible_for(departments: list[str], contacts: dict[str, dict]) -> list[dict]:
    from app.services.lesson_watch_bot import _contact_name

    out: dict[str, dict] = {}
    for dep in departments:
        c = contacts.get(dep)
        if not c:
            continue
        name = _contact_name(str(c.get("name") or ""))
        p = out.setdefault(name, {"name": name, "position": str(c.get("position") or ""), "departments": []})
        if dep not in p["departments"]:
            p["departments"].append(dep)
    return list(out.values())


def _source(db: Session, start: dt.date, end: dt.date, groups: tuple[str, ...]):
    """Filtrsiz (butun institut) qatorlar + darslar: jarayon keshi yoki umumiy Redis keshidan (eskirgan bo'lsa
    ham, `SOURCE_MAX_AGE` gacha); yo'q bo'lsa — odatdagi hisob."""
    from app.services import control_report_service as control

    if control.CACHE_SECONDS > 0:
        hit = control._cache.get(("rows", start, end, "", "", tuple(groups)))
        if hit is not None and time.monotonic() - hit[0] < SOURCE_MAX_AGE:
            return hit[1]
        shared = control._rows_shared_get(control._rows_shared_key(start, end, groups), SOURCE_MAX_AGE)
        if shared is not None:
            return shared
    return control._teacher_rows(db, start, end, groups=groups)


def build(db: Session, end_day: dt.date, *, department: str = "", groups: tuple[str, ...] = ()) -> dict:
    from app.services.lesson_watch_bot import department_contacts

    start, end = window(end_day)
    rows, lessons, used, _rooms, pending = _source(db, start, end, tuple(groups))
    if department.strip():
        mine = dean_access.department_filter(db, department)
        lessons = [x for x in lessons if mine(x.department_name)]
    work = pending.get("_work") or {}
    misuse = pending.get("_misuse") or set()
    group = pending.get("_group") or set()
    canon = dean_access.canonical_map(db)
    per_day: dict[str, dict[dt.date, str]] = defaultdict(dict)
    deps: dict[str, list[str]] = defaultdict(list)
    for lesson in lessons:
        if not lesson.monitor_id or not lesson.teacher_username:
            continue
        key = lesson.teacher_username
        kind = lesson_kind(lesson, used, work, misuse, group)
        prev = per_day[key].get(lesson.lesson_date, "ok")
        per_day[key][lesson.lesson_date] = kind if SEVERITY[kind] > SEVERITY[prev] else prev
        dep = dean_access.canonical(lesson.department_name, canon) or (lesson.department_name or "")
        if dep and dep not in deps[key]:
            deps[key].append(dep)

    contacts = department_contacts(db)
    by_key = {r["teacher_key"]: r for r in rows if r.get("teacher_key")}
    people: list[dict] = []
    for key, days in per_day.items():
        row = by_key.get(key)
        if row is None or row.get("on_leave") or not row.get("linked"):
            continue
        info = summarize(days)
        if not is_chronic(info["bad_days"], info["lesson_days"]):
            continue
        resp = responsible_for(deps[key], contacts)
        info["responsible"] = resp
        info["departments"] = deps[key]
        people.append({
            "key": key, "kind": "teacher", "name": row["teacher_name"] or key,
            "subtitle": " / ".join(deps[key]) or row["department"],
            "value": info["bad_days"], "value_label": f"/ {info['lesson_days']} dars kunida muammo",
            "note": ("Mas’ul: " + ", ".join(r["name"] for r in resp)) if resp else "Mas’ul biriktirilmagan",
            "chronic": info,
        })
    people.sort(key=lambda p: (-p["chronic"]["share"], -p["chronic"]["bad_days"], -p["chronic"]["streak"], p["name"]))
    return {
        "metric": "chronic",
        "title": "Surunkalilar — doimiy muammo bo‘layotgan o‘qituvchilar",
        "kind": "teacher",
        "total": len(people),
        "people": people[:400],
        "window": {"from": start.isoformat(), "to": end.isoformat(), "days": WINDOW_DAYS,
                   "min_bad_days": MIN_BAD_DAYS, "min_share": MIN_SHARE,
                   "module_rule_from": MODULE_RULE_FROM.isoformat()},
    }
