"""Rektor hisobotidagi «Telegram bot» sahifasi (2026-11-18).

Foydalanuvchi: "bot ishlash tizimini rektor hisobotida ham chiqadigan qilib bering — hamma jarayonlar, telegram
bot degan sahifa, o'sha yerda ham nazorat qila olay, xulosalar, hisobotlar ham chiqsin, mukammal qilib".

Manba — botning o'z yozuvlari (`core_lessonbotpost`), boshqa hech narsa qayta hisoblanmaydi: guruhga nima ketgan
bo'lsa, hisobotda ham aynan o'sha.

* `t:…` — har o'qituvchiga post (+10): kim, qaysi para, keyin ochdimi (necha daqiqa kech), dars davomida
  ochmadimi, boshqa joyda (rasm bilan) qayd etdimi, mas'ul kim, «Bog'landim» kim va qachon, izohlar.
* `r:…` — "mas'ul hali bog'lanmadi" eslatmasi.
* Mas'ullar ro'yxati va botda tanilganlar — `lesson_watch_bot.department_contacts / responsible_ids`.
"""

from __future__ import annotations

import datetime as dt
import statistics
from collections import Counter, defaultdict

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models.lesson_bot import LessonBotPost
from app.services import dean_access
from app.services import lesson_watch_bot as bot

#: Lenta (oxirgi postlar) uzunligi — sahifa og'irlashmasin.
FEED_LIMIT = 300
#: "Takrorlanuvchi" — davrda shuncha marta ochmagan o'qituvchi xulosada alohida aytiladi.
REPEAT_MIN = 3


def _status(st: dict) -> str:
    """ochmadi-turi: opened/never/offsite/pending; chiqib ketdi: left/returned; to'liq o'tilmadi: short."""
    alert = st.get("alert") or ""
    if alert == "left":
        return "returned" if st.get("returned_at") else "left"
    if alert == "short":
        return "short"
    if alert == "misuse":
        return "misuse"
    if st.get("offsite"):
        return "offsite"
    if st.get("entered"):
        return "opened"
    if st.get("stage") == "final":
        return "never"
    return "pending"


def late_data(st: dict) -> bool:
    """O'qituvchi post ketishidan OLDIN ochgan, lekin faollik ma'lumoti internet tufayli kech yetgan (2026-11-18).

    Bot o'zi belgilaydi (`late_data`); eski postlarda — ochilish daqiqasi post ketgan daqiqadan (+10) oldin."""
    # Faqat «ochmadi» postlari (2026-11-19): «to'liq o'tilmadi» / «test-keys yo'q» postida ochilish daqiqasi bor,
    # lekin u «kech yetgan ma'lumot» emas — avval hisobot ularni ham noto'g'ri sanardi.
    if st.get("alert") == "left":
        return bool(st.get("late_data") and st.get("returned_at"))
    if st.get("alert"):
        return False
    if not st.get("entered") or st.get("late") is None:
        return False
    return bool(st.get("late_data")) or int(st.get("late") or 0) < int(st.get("posted_min") or bot.FIRST_ALERT)


def _call_minutes(post: LessonBotPost, call: dict) -> int | None:
    """Post yuborilganidan «Bog'landim» bosilguncha (daqiqa). Vaqt postdagi "HH:MM" (Toshkent)."""
    at = str(call.get("at") or "")
    if not post.created_at or len(at) != 5:
        return None
    try:
        hh, mm = int(at[:2]), int(at[3:])
    except ValueError:
        return None
    sent = post.created_at.astimezone(bot.TZ)
    when = sent.replace(hour=hh, minute=mm, second=0, microsecond=0)
    minutes = int((when - sent).total_seconds() // 60)
    return minutes if 0 <= minutes <= 12 * 60 else None


def _rate(part: int, whole: int) -> int:
    return round(100 * part / whole) if whole else 0


def _empty_person() -> dict:
    return {"posts": 0, "contacted": 0, "minutes": [], "comments": 0, "missed": [], "opened_alone": 0,
            "types": Counter(), "days": Counter(), "days_called": Counter()}


def report(db: Session, start: dt.date, end: dt.date, *, department: str = "",
           allowed: list[str] | None = None) -> dict:
    rows = db.execute(select(LessonBotPost).where(
        LessonBotPost.day >= start, LessonBotPost.day <= end,
        or_(LessonBotPost.kind.like(bot.TEACHER_LIKE), LessonBotPost.kind.like(f"{bot.REMINDER_KIND}%")),
        LessonBotPost.status.in_(("sent", "final")),
    ).order_by(LessonBotPost.day, LessonBotPost.slot, LessonBotPost.id)).scalars().all()

    pick = dean_access.department_filter(db, department) if department.strip() else None
    scope = [dean_access.department_filter(db, d) for d in (allowed or [])]

    def visible(dep: str) -> bool:
        if pick is not None and not pick(dep):
            return False
        return not scope or any(f(dep) for f in scope)

    contacts = bot.department_contacts(db)
    registered_phones = set(bot.responsible_ids(db).values())
    person_of = {dep: bot._contact_name(str(c.get("name") or "")) for dep, c in contacts.items()}
    person_registered: dict[str, bool] = {}
    person_deps: dict[str, list[str]] = defaultdict(list)
    for dep, c in sorted(contacts.items()):
        if not visible(dep):
            continue
        name = person_of[dep]
        person_deps[name].append(dep)
        phone = bot._phone_key(str(c.get("phone") or ""))
        person_registered[name] = person_registered.get(name, False) or bool(phone and phone in registered_phones)

    posts = [r for r in rows if str(r.kind).startswith("t") and visible(str((r.state or {}).get("dep") or ""))]
    reminders = [r for r in rows if str(r.kind).startswith(bot.REMINDER_KIND)
                 and str((r.state or {}).get("contact") or "") in person_deps]

    feed: list[dict] = []
    by_person: dict[str, dict] = {}
    by_dep: dict[str, dict] = {}
    by_teacher: dict[str, dict] = {}
    by_day: dict[str, Counter] = defaultdict(Counter)
    minutes_all: list[int] = []
    lates: list[int] = []
    status_count: Counter = Counter()
    late_data_count = 0
    comments_total = 0
    contactable = contacted = 0

    for p in posts:
        st = p.state or {}
        status = _status(st)
        status_count[status] += 1
        calls = list(st.get("calls") or [])
        comments = list(st.get("comments") or [])
        comments_total += len(comments)
        contact = str(st.get("contact") or "")
        mins = [m for m in (_call_minutes(p, c) for c in calls[:1]) if m is not None]
        delayed = late_data(st)
        late_data_count += delayed
        minutes_all += mins
        if status == "opened" and st.get("late") is not None and not delayed:
            lates.append(int(st.get("late") or 0))
        day = p.day.isoformat()
        by_day[day]["posts"] += 1
        by_day[day][status] += 1
        if calls:
            by_day[day]["contacted"] += 1
        if contact:
            contactable += 1
            contacted += bool(calls)

        dep = str(st.get("dep") or "—")
        d = by_dep.setdefault(dep, {"department": dep, "faculty": st.get("fac") or "", "contact": contact,
                                    "posts": 0, "teachers": set(), "never": 0, "opened": 0, "offsite": 0,
                                    "contacted": 0, "comments": 0})
        d["posts"] += 1
        d["teachers"].add(str(st.get("teacher") or st.get("name") or ""))
        d["never"] += status == "never"
        d["opened"] += status == "opened"
        d["offsite"] += status == "offsite"
        d["contacted"] += bool(calls)
        d["comments"] += len(comments)

        key = str(st.get("teacher") or st.get("name") or "")
        t = by_teacher.setdefault(key, {"teacher": key, "name": st.get("name") or "", "department": dep,
                                        "faculty": st.get("fac") or "", "posts": 0, "never": 0, "opened": 0,
                                        "late_total": 0, "contacted": 0, "days": set(), "last": ""})
        t["posts"] += 1
        t["never"] += status == "never"
        t["opened"] += status == "opened"
        t["late_total"] += int(st.get("late") or 0) if status == "opened" else 0
        t["contacted"] += bool(calls)
        t["days"].add(day)
        t["last"] = max(t["last"], f"{day} {st.get('slot') or ''}")

        if contact:
            pr = by_person.setdefault(contact, _empty_person())
            pr["posts"] += 1
            pr["types"][status] += 1
            pr["days"][day] += 1
            if calls:
                pr["days_called"][day] += 1
            pr["contacted"] += bool(calls)
            pr["minutes"] += mins
            pr["comments"] += len(comments)
            if not calls and status in ("never", "pending", "left", "short", "misuse"):
                pr["missed"].append({"day": day, "slot": st.get("slot") or "", "para": st.get("para") or "",
                                     "name": st.get("name") or "", "department": dep, "status": status})
            if not calls and status == "opened":
                pr["opened_alone"] += 1

        feed.append({
            "id": p.id, "day": day, "slot": st.get("slot") or p.slot, "para": st.get("para") or "",
            "name": st.get("name") or "", "department": dep, "faculty": st.get("fac") or "",
            "rooms": list(st.get("rooms") or [])[:3], "status": status, "late": st.get("late"),
            "offsite": str(st.get("offsite") or "")[:80], "contact": contact,
            "calls": [{"by": c.get("by") or "", "at": c.get("at") or ""} for c in calls],
            "comments": [{"by": c.get("by") or "", "at": c.get("at") or "", "text": c.get("text") or ""}
                         for c in comments[-bot.MAX_COMMENTS:]],
            "minutes_to_call": mins[0] if mins else None,
            "alert": st.get("alert") or "",
            "since": st.get("since_hm") or "",
            "returned_at": st.get("returned_at") or "",
            "minutes": st.get("minutes"),
            # «Noto'g'ri foydalanildi»: nima yetishmadi (test/case yaratilmagan, test_time/case_time — kam vaqt).
            "gaps": list(st.get("gaps") or []),
            "test_minutes": st.get("test_minutes"),
            "case_minutes": st.get("case_minutes"),
            "late_data": delayed,
            "private_copy": bool(st.get("dm")),
        })

    reminders_by_person: Counter = Counter(str((r.state or {}).get("contact") or "") for r in reminders)

    responsible = []
    for name in sorted(set(person_deps) | set(by_person)):
        pr = by_person.get(name) or _empty_person()
        # Unumdorlik: bog'lanish KERAK bo'lgan holatlar (o'qituvchi o'zi ochmagan/qaytmagan) ichida bog'langani.
        needed = pr["contacted"] + len(pr["missed"])
        responsible.append({
            "types": {k: pr["types"].get(k, 0) for k in ("never", "pending", "left", "returned", "short", "misuse", "opened", "offsite")},
            "needed": needed,
            "effective_rate": _rate(pr["contacted"], needed) if needed else None,
            "daily": [{"day": d, "posts": n, "contacted": pr["days_called"].get(d, 0)} for d, n in sorted(pr["days"].items())],
            "name": name, "departments": person_deps.get(name, []), "registered": person_registered.get(name, False),
            "posts": pr["posts"], "contacted": pr["contacted"], "rate": _rate(pr["contacted"], pr["posts"]),
            "median_minutes": round(statistics.median(pr["minutes"])) if pr["minutes"] else None,
            "comments": pr["comments"], "reminders": reminders_by_person.get(name, 0),
            "missed": pr["missed"][-30:], "missed_count": len(pr["missed"]), "opened_alone": pr["opened_alone"],
        })
    responsible.sort(key=lambda r: (-(r["missed_count"]), -r["posts"], r["name"]))

    departments = []
    for d in by_dep.values():
        departments.append({**d, "teachers": len(d["teachers"]), "contact_rate": _rate(d["contacted"], d["posts"]),
                            "never_rate": _rate(d["never"], d["posts"])})
    departments.sort(key=lambda d: (-d["never"], -d["posts"], d["department"]))

    teachers = []
    for t in by_teacher.values():
        teachers.append({**t, "days": len(t["days"]),
                         "avg_late": round(t["late_total"] / t["opened"]) if t["opened"] else None})
    for t in teachers:
        t.pop("late_total", None)
    teachers.sort(key=lambda t: (-t["never"], -t["posts"], t["name"]))

    days = [{"day": day, "posts": c["posts"], "never": c["never"], "opened": c["opened"], "offsite": c["offsite"],
             "pending": c["pending"], "contacted": c["contacted"]} for day, c in sorted(by_day.items())]

    total = len(posts)
    summary = {
        "posts": total,
        "teachers": len(by_teacher),
        "opened": status_count["opened"],
        "never": status_count["never"],
        "not_opened_posts": sum(1 for p in posts if not (p.state or {}).get("alert")),
        "offsite": status_count["offsite"],
        "pending": status_count["pending"],
        "avg_late": round(statistics.mean(lates)) if lates else None,
        "late_data": late_data_count,
        "left": status_count["left"] + status_count["returned"],
        "left_returned": status_count["returned"],
        "short": status_count["short"],
        "misuse": status_count["misuse"],
        "contactable": contactable,
        "contacted": contacted,
        "contact_rate": _rate(contacted, contactable),
        "median_minutes": round(statistics.median(minutes_all)) if minutes_all else None,
        "comments": comments_total,
        "reminders": len(reminders),
        "responsible_total": len(person_deps),
        "responsible_registered": sum(1 for n in person_deps if person_registered.get(n)),
    }
    return {
        "range": {"from": start.isoformat(), "to": end.isoformat()},
        "summary": summary,
        "conclusions": conclusions(summary, responsible, teachers, departments),
        "responsible": responsible,
        "departments": departments,
        "teachers": teachers[:200],
        "days": days,
        "feed": list(reversed(feed))[:FEED_LIMIT],
        "unregistered": [r["name"] for r in responsible if not r["registered"] and r["departments"]],
    }


def conclusions(summary: dict, responsible: list[dict], teachers: list[dict], departments: list[dict]) -> list[dict]:
    """Qisqa xulosalar — faqat raqamlardan (tone: xabar, ayblov emas). {kind: info|warn|good, text}."""
    out: list[dict] = []
    total = summary["posts"]
    if not total:
        out.append({"kind": "info", "text": "Tanlangan davrda bot hech qanday post yubormagan — yoki hamma o‘qituvchi "
                                              "iMentor’ni vaqtida ochgan, yoki bot hali ishga tushmagan."})
    else:
        decided = summary["opened"] + summary["never"]
        out.append({"kind": "info", "text": (
            f"Davrda {total} ta post ({summary['teachers']} o‘qituvchi): {summary['opened']} tasida o‘qituvchi keyin "
            f"ochdi" + (f" (o‘rtacha {summary['avg_late']} daqiqa kech)" if summary["avg_late"] is not None else "")
            + f", {summary['never']} tasida dars davomida ochmadi"
            + (f" ({_rate(summary['never'], decided)}%)" if decided else "") + ".")})
        if summary.get("late_data"):
            out.append({"kind": "info", "text": (
                f"{summary['late_data']} ta post noto‘g‘ri chiqqan: o‘qituvchi iMentor’ni o‘z vaqtida ochgan, lekin "
                "faollik ma’lumoti internet tufayli serverga kech yetgan.")})
        if summary["contactable"]:
            kind = "good" if summary["contact_rate"] >= 70 else "warn" if summary["contact_rate"] < 40 else "info"
            text = (f"Mas’ullar {summary['contactable']} ta postdan {summary['contacted']} tasida «Bog‘landim» bosdi "
                    f"({summary['contact_rate']}%)")
            if summary["median_minutes"] is not None:
                text += f", odatda post chiqqanidan {summary['median_minutes']} daqiqa o‘tib"
            out.append({"kind": kind, "text": text + "."})
        if summary.get("left") or summary.get("short"):
            out.append({"kind": "warn", "text": (
                f"iMentor’ni ochib, dars davomida chiqib ketganlar: {summary.get('left', 0)} ta "
                f"({summary.get('left_returned', 0)} tasi qaytdi); darsni iMentor’da to‘liq o‘tmaganlar "
                f"(40 daqiqadan kam): {summary.get('short', 0)} ta.")})
        if summary.get("misuse"):
            out.append({"kind": "warn", "text": (
                f"Vaqt yetarli, lekin test yoki keys yaratilmagan (yoki ularga 10 daqiqadan kam): "
                f"{summary['misuse']} ta dars.")})
        # Faqat o'qituvchi OCHMAGAN va «Bog'landim» bosilmagan holatlar — o'zi ochgan o'qituvchiga qo'ng'iroq shart emas.
        weak = [r for r in responsible if r["missed_count"] >= 2]
        for r in sorted(weak, key=lambda r: -r["missed_count"])[:3]:
            out.append({"kind": "warn", "text": f"{r['name']}: {r['missed_count']} ta holatda o‘qituvchi iMentor’ni "
                                                "ochmagan, «Bog‘landim» bosilmagan."})
        repeat = [t for t in teachers if t["never"] >= REPEAT_MIN]
        if repeat:
            names = ", ".join(f"{t['name']} ({t['never']} marta)" for t in repeat[:5])
            out.append({"kind": "warn", "text": f"Dars davomida bir necha marta ochmaganlar: {names}."})
        top = [d for d in departments if d["never"] >= 2][:1]
        for d in top:
            out.append({"kind": "warn", "text": f"Eng ko‘p «ochmadi» — {d['department']}: {d['never']} ta dars."})
    if summary["responsible_total"]:
        left = summary["responsible_total"] - summary["responsible_registered"]
        if left:
            unreg = [r["name"] for r in responsible if not r["registered"] and r["departments"]]
            out.append({"kind": "warn", "text": (
                f"Botda tanitilmagan mas’ullar: {left} / {summary['responsible_total']} ({', '.join(unreg[:8])}"
                + ("…" if len(unreg) > 8 else "") + "). Ular «Bog‘landim» bosa olmaydi va shaxsiy xabar olmaydi — "
                "@imentor_fermi_bot ga /start yozib, telefon raqamini yuborishi kerak.")})
        else:
            out.append({"kind": "good", "text": "Hamma mas’ullar botda tanitilgan."})
    return out
