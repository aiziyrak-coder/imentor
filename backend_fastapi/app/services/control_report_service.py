"""Rektor nazorat hisoboti — bitta savolga javob (2026-09-25).

Savol: **monitorli xonada dars o'tadigan o'qituvchi shu darsda iMentor'ni
ishlatdimi?** Asosiy nazorat shu, chunki monitor aynan shuning uchun qo'yilgan.

Monitorsiz xonadagi dars ham ko'rsatiladi, lekin alohida: u yerda o'qituvchi
o'z noutbukidan kirishi mumkin, majburiy emas.

Toq/juft hafta (surat/maxraj) alohida hisoblanmaydi — HEMIS har darsni ANIQ
sana bilan beradi, ya'ni jadval qaysi haftada nima bo'lishini o'zi aytadi.

Hamma raqam bitta manbadan: `core_hemislesson` (HEMIS jadvalining nusxasi).
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import logging
import os
import threading
import time
from collections import Counter, defaultdict

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.hemis_lesson import HemisLesson
from app.services import lesson_report_service as lr
from app.services import monitor_room_service as mr
from app.services import monitor_schedule_service as ms
from app.services import teacher_activity_service as ta
from app.services import dean_access
from app.services import idle_reasons
from app.services.dean_access import in_groups

# Ishlatish darajasi shu chegaralardan qanday o'tgani rangni belgilaydi.
GOOD = 70
WARN = 40


#: "Kirgan, lekin yetmagan" darslar ikkiga bo'linadi: chegaraga YAQIN kelgan
#: (masalan 40 daqiqa — dars deyarli iMentor'da o'tgan) va shunchaki kirib
#: chiqqan. Rektor uchun ikkalasining ma'nosi har xil (2026-10-09).
NEAR_MINUTES = 30


#: Hisobot shu muddatga saqlanadi. Sahifa "Jonli" rejimda har 60 soniyada
#: qayta so'raydi, bir necha kishi (rektor, dekanlar, monitor) bir vaqtda ochadi,
#: raqam bosilganda esa butun hisob qaytadan yurardi. 30 kunlik davr 17-20
#: soniya hisoblanadi — brauzer kutib turolmay "so'rov vaqti tugadi" derdi
#: (2026-10-09). Testlarda 0 (qarang conftest).
#: Sahifa "Jonli" rejimda har 60 soniyada qayta so'raydi. 45 soniyalik
#: kesh bilan deyarli har so'rov qaytadan hisoblanardi — rektor har safar
#: kutib turardi. 5 daqiqa: takroriy ochish bir zumda, raqam esa yetarlicha
#: yangi (sahifada "oxirgi yangilanish" vaqti ko'rinadi) — 2026-10-13.
logger = logging.getLogger(__name__)

CACHE_SECONDS = 300
#: Redis'dagi umumiy o'qituvchi qatorlari (filtrlar shu ustidan) shu muddatgacha ishlatiladi.
ROWS_SHARED_MAX_AGE = 20 * 60
_cache: dict[tuple, tuple[float, object]] = {}
_locks: dict[tuple, threading.Lock] = {}


#: Eskirgan natija shu muddatgacha ko'rsatilaveradi, yangisi esa ORQADA
#: hisoblanadi. Shu sababli rektor faqat eng birinchi ochilishda kutadi:
#: keyingi safar raqam darhol chiqadi, orqada yangilanadi (2026-10-13).
STALE_SECONDS = 60 * 60
#: Ta'til holati (faqat hozirgisi ma'lum) shu muddatdan eski davrlarga qo'llanmaydi.
LEAVE_RECENT = dt.timedelta(days=14)
_refreshing: set[tuple] = set()


def _refresh_later(key: tuple, build) -> None:
    """Orqa fonda qayta hisoblash — bir kalit uchun bittadan ortiq emas.

    Ip O'ZINING baza sessiyasini ochadi. So'rovning sessiyasini ishlatish
    mumkin emas: SQLAlchemy sessiyasi bir vaqtda ikki ish bajarmaydi va
    ikkisi ham yiqilardi — rektorga HTTP 500 qaytardi (2026-10-13).
    """
    if key in _refreshing:
        return
    _refreshing.add(key)

    def run() -> None:
        from app.core.db import SessionLocal

        own = SessionLocal()
        try:
            value = build(own)
            _cache[key] = (time.monotonic(), value)
        except Exception:                                   # pragma: no cover
            logger.exception("hisobotni orqa fonda yangilash o'tmadi: %s", key)
        finally:
            own.close()
            _refreshing.discard(key)

    threading.Thread(target=run, name="control-report-refresh", daemon=True).start()


def _outdated(value) -> bool:
    """Saqlangan hisobot jadval bo'yicha eskirganmi (2026-11-16).

    Kesh 5 daqiqa yashaydi. Ertalab 09:18 da hisoblangan «biri ham tugamagan, birinchi dars 09:20 da
    tugaydi» natijasi 09:24 da ham ko'rsatilardi. Natijada eng yaqin dars tugash vaqti (`next_at`) bor:
    shu vaqt o'tgan bo'lsa, natija yoshidan qat'i nazar yangidan hisoblanadi.
    """
    try:
        if isinstance(value, tuple) and len(value) == 5:
            pending = value[4]
        elif isinstance(value, dict):
            pending = (value.get("headline") or {}).get("pending") or {}
        else:
            return False
        nxt = (pending or {}).get("next_at")
        if not nxt:
            return False
        return lr.current_time() >= dt.datetime.fromisoformat(nxt)
    except Exception:  # noqa: BLE001 — shubhada kesh ishlatilaveradi
        return False


def _cached(key: tuple, db: Session, build):
    """Bir xil so'rov bir vaqtda kelsa bittasi hisoblaydi, qolgani natijani kutadi.

    Eskirgan natija bo'lsa — u DARHOL qaytariladi va yangisi orqada
    hisoblanadi: 30 kunlik hisobot 25 soniya oladi, rektor esa uni har
    safar kutib o'tirmasligi kerak.

    `build` baza sessiyasini ARGUMENT sifatida oladi: oldinda so'rovning
    sessiyasi beriladi, orqa fonda esa ipning o'zi ochgani.
    """
    if CACHE_SECONDS <= 0:
        return build(db)
    hit = _cache.get(key)
    now = time.monotonic()
    if hit is not None and _outdated(hit[1]):
        hit = None
    if hit is not None:
        age = now - hit[0]
        if age < CACHE_SECONDS:
            return hit[1]
        if age < STALE_SECONDS:
            _refresh_later(key, build)
            return hit[1]
    with _locks.setdefault(key, threading.Lock()):
        hit = _cache.get(key)
        now = time.monotonic()
        if hit is not None and now - hit[0] < CACHE_SECONDS and not _outdated(hit[1]):
            return hit[1]
        value = build(db)
        now = time.monotonic()
        # list(): boshqa oqim (fon yangilash) shu payt kalit qo'shsa "dictionary changed size" 500 bo'lardi.
        for old in [k for k, (t, _) in list(_cache.items()) if now - t >= STALE_SECONDS]:
            _cache.pop(old, None)
            _locks.pop(old, None)
        _cache[key] = (now, value)
        return value


def clear_cache() -> None:
    _cache.clear()


def warm(db: Session, start_day: dt.date, end_day: dt.date) -> None:
    """Davr hisobotini YANGIDAN hisoblab keshga qo'yadi (orqa fon isitishi, 2026-11-15).

    Eski qiymat hisob tugaguncha joyida qoladi — shu payt bosgan rektor kutmaydi.
    """
    if CACHE_SECONDS <= 0:
        return
    rows_key = ("rows", start_day, end_day, "", "", ())
    built = _build_teacher_rows(db, start_day, end_day)
    _cache[rows_key] = (time.monotonic(), built)
    _rows_shared_put(_rows_shared_key(start_day, end_day, ()), built)
    # O'qituvchi oynasi uchun: davrning faollik xaritasi ham umumiy keshda (har jarayon qayta hisoblamasin).
    _shared_put(_shared_key(start_day, end_day, "engagement", "", ()), built[4].get("_engagement") or {})
    ov_key = ("overview", start_day, end_day, "", "", ())
    value = _build_overview(db, start_day, end_day)
    _cache[ov_key] = (time.monotonic(), value)
    _shared_put(_shared_key(start_day, end_day, "", "", ()), value)
    _locks.clear()


def _band(percent: int | None) -> str:
    if percent is None:
        return "none"
    if percent >= GOOD:
        return "good"
    if percent >= WARN:
        return "warn"
    return "bad"


def _pct(part: int, whole: int) -> int:
    return round(100 * part / whole) if whole else 0


#: HEMIS'da monitorsiz xonaga qo'yilgan, lekin iMentor bilan O'TILGAN dars
#: (2026-10-21). Xona band bo'lsa o'qituvchi boshqa xonaga o'tadi va u yerda
#: iMentor bilan dars o'tadi — HEMIS xonasi esa o'zgarmaydi. Ilgari bunday
#: dars foizga umuman kirmasdi (Epidemiologiya: 249 darsdan 234 tasi) va
#: o'qituvchi "o'tmagan" ko'rinardi. Endi o'tilgan bo'lsa — monitorli dars
#: qatoriga qo'shiladi; o'tilmagani esa ilgarigidek chetda (u yerda ekran
#: bo'lmagan bo'lishi mumkin, ayblanmaydi).
TAUGHT_ELSEWHERE = lr.TAUGHT_ELSEWHERE
#: Nechta qaydsiz o'qituvchiga sabab hisoblanadi (sahifada har ro'yxatdan 40 ta).
IDLE_EXPLAINED = 120
#: Ishlatmaganlar sababini hisoblash (og'ir). `IMENTOR_EXPLAIN_IDLE=1` bilan yoqiladi.
EXPLAIN_IDLE = os.environ.get("IMENTOR_EXPLAIN_IDLE", "0") == "1"


def _absence_days(db: Session, start_day: dt.date, end_day: dt.date) -> dict[str, dict[dt.date, str]]:
    """Tasdiqlangan kasallik varaqasi / ta'til / safar kunlari (2026-10-28); xatoda — bo'sh."""
    try:
        from app.services.staff_absence import approved_days

        return approved_days(db, start_day, end_day)
    except Exception:  # noqa: BLE001 — hisobot sababsiz yiqilmasin
        logging.getLogger(__name__).warning("staff absence load failed", exc_info=True)
        return {}


def _drop_absent(lessons: list, used: dict, touched: set, absent: dict) -> tuple[list, dict[str, int]]:
    """Tasdiqlangan kundagi O'TILMAGAN darslar chiqariladi (foizga kirmaydi, ayblanmaydi).

    Shu kuni baribir iMentor bilan o'tilgan dars qoladi — u haqiqatan o'tilgan.
    """
    if not absent:
        return lessons, {}
    kept, away = [], defaultdict(int)
    for lesson in lessons:
        days = absent.get(lesson.teacher_username or "")
        if days and lesson.lesson_date in days and lesson.id not in used and lesson.id not in touched:
            away[lesson.teacher_username] += 1
            continue
        kept.append(lesson)
    return kept, dict(away)


def _offsite_marks(db: Session, start_day: dt.date, end_day: dt.date) -> dict[str, dict[int, str]]:
    """O'qituvchi dars vaqtida "boshqa joyda o'tyapman" deb qayd etgan darslar (2026-11-12); xatoda — bo'sh."""
    try:
        # Bitta qayd butun darsni qamraydi: hamma guruh qatorlari va ketma-ket paralar (2026-11-16).
        from app.services.offsite_lesson import covered_marks

        return covered_marks(db, start_day, end_day)
    except Exception:  # noqa: BLE001 — hisobot sababsiz yiqilmasin
        logging.getLogger(__name__).warning("offsite lessons load failed", exc_info=True)
        return {}


def _drop_offsite(lessons: list, used: dict, touched: set, marks: dict) -> tuple[list, dict[str, int]]:
    """Sababli boshqa joyda o'tilgan deb qayd etilgan darslar (tasdiqsiz, foydalanuvchi qarori 2026-11-12)
    qizil bo'lmaydi: foizga kirmaydi. iMentor bilan o'tilgan bo'lsa — o'tilgan bo'lib qoladi."""
    if not marks:
        return lessons, {}
    kept, away = [], defaultdict(int)
    for lesson in lessons:
        ids = marks.get(lesson.teacher_username or "")
        if ids and lesson.id in ids and lesson.id not in used and lesson.id not in touched:
            away[lesson.teacher_username] += 1
            continue
        kept.append(lesson)
    return kept, dict(away)


def _count_lessons_taught_elsewhere(lessons: list, used: dict) -> None:
    """2026-11-16 dan O'CHIQ: nazorat faqat monitorli xonadagi darslar (rektorat qarori).

    Monitorsiz xonada iMentor bilan o'tilgan dars endi monitorli hisobga qo'shilmaydi — u faqat
    o'tilgan darslarni qo'shib, foizni bir tomonga surardi. Qaytarish: `IMENTOR_COUNT_TAUGHT_ELSEWHERE=1`.
    """
    if os.environ.get("IMENTOR_COUNT_TAUGHT_ELSEWHERE", "0") != "1":
        return
    for lesson in lessons:
        if not lesson.monitor_id and lesson.id in used:
            lesson.monitor_id = TAUGHT_ELSEWHERE
            lesson.taught_elsewhere = True


def _real_rooms(lessons: list) -> list:
    """Xona statistikasi uchun: "boshqa xona" haqiqiy monitor emas."""
    return [x for x in lessons if not getattr(x, "taught_elsewhere", False)]


def _teacher_stats(lessons: list[HemisLesson], used: dict[int, tuple[bool, int]],
                   rooms: dict[str, dict] | None = None) -> dict[str, dict]:
    """Har o'qituvchi: monitorli va monitorsiz darslari alohida.

    `rooms` berilsa, har darsning xonasi ishlayotgani ISBOTLANGANMI ham
    sanaladi (o'sha xonada kimdir ishlatgan). Shu raqam bahonani hal qiladi.
    """
    rooms = rooms or {}
    out: dict[str, dict] = {}
    for lesson in lessons:
        key = lesson.teacher_username or f"name:{lesson.teacher_name}"
        row = out.setdefault(key, {
            "teacher_key": lesson.teacher_username,
            "teacher_name": lesson.teacher_name,
            "employee_id": lesson.employee_id,
            "linked": bool(lesson.teacher_username),
            "departments": set(),
            "monitor_lessons": 0, "monitor_used": 0,
            "other_lessons": 0, "other_used": 0,
            "students": 0, "rooms": set(), "days": set(), "last_used": None,
            "other_account_active_lessons": 0,
        })
        row["departments"].add(lesson.department_name)
        row["days"].add(lesson.lesson_date)
        hit = used.get(lesson.id)
        if lesson.monitor_id:
            row["monitor_lessons"] += 1
            row["rooms"].add(lesson.auditorium_name)
            # Xonada BOSHQA o'qituvchi ishlaganmi: shu monitor ishlab turgani
            # isboti. Ilgari bu yerda darsning O'ZI xonaning faol darslari
            # ro'yxatida bormi deb qaralardi — u esa faqat o'qituvchining
            # o'zi ishlatgan darslarini o'z ichiga oladi, shuning uchun
            # ishlatmagan o'qituvchi uchun HAR DOIM nol chiqardi va ayblov
            # ro'yxati hech qachon to'lmasdi (2026-10-11).
            others = (rooms.get(lesson.monitor_id) or {}).get("used_teachers", set())
            if others - {lesson.teacher_username}:
                row["other_account_active_lessons"] += 1
            if hit:
                row["monitor_used"] += 1
        else:
            row["other_lessons"] += 1
            if hit:
                row["other_used"] += 1
        if hit:
            row["students"] += hit[1]
            if row["last_used"] is None or lesson.lesson_date > row["last_used"]:
                row["last_used"] = lesson.lesson_date
    return out


def _teacher_row(row: dict) -> dict:
    monitor_lessons = row["monitor_lessons"]
    percent = _pct(row["monitor_used"], monitor_lessons) if monitor_lessons else None
    return {
        "teacher_key": row["teacher_key"],
        "teacher_name": row["teacher_name"],
        "employee_id": row["employee_id"],
        "linked": row["linked"],
        "department": " / ".join(sorted(x for x in row["departments"] if x))[:200],
        "monitor_lessons": monitor_lessons,
        "monitor_used": row["monitor_used"],
        "monitor_percent": percent,
        "band": _band(percent) if row["linked"] else "none",
        "other_lessons": row["other_lessons"],
        "other_used": row["other_used"],
        "lessons": monitor_lessons + row["other_lessons"],
        "students": row["students"],
        "days": len(row["days"]),
        "rooms": sorted(x for x in row["rooms"] if x)[:6],
        "last_used": row["last_used"].isoformat() if row["last_used"] else None,
        # Compatibility name retained; this is context, not proof of guilt.
        "proven_lessons": row["other_account_active_lessons"],
        # Bahonasi bormi: shu o'qituvchining darslaridan birida XONADA
        # boshqa kimdir ishlagan bo'lsa, monitor o'sha paytda ishlab turgan
        # bo'ladi — ya'ni "monitor yo'q edi" degan bahona o'tmaydi.
        # Ilgari bu maydon DOIMO "check_room" edi, shuning uchun ayblov
        # ro'yxati hech qachon to'lmasdi va kun bo'yicha sahifa bilan
        # qarama-qarshi chiqardi (2026-10-11).
        "excuse": "blamed" if row["other_account_active_lessons"] else "check_room",
        "assessment": "usage_record_missing_review_required",
    }


def _attention_row(r: dict) -> dict:
    """Qizil ro'yxatdagi qator — dalili bilan."""
    out = {k: r[k] for k in ("teacher_key", "teacher_name", "department", "monitor_lessons", "days", "rooms",
                             "other_used", "other_lessons", "proven_lessons", "excuse", "employee_id")}
    out.update(reason=r.get("reason", ""), reason_label=r.get("reason_label", ""), reasons=r.get("reasons", []))
    return out


def _source(lessons: list[HemisLesson], rows: list[dict], db: Session | None = None) -> dict:
    """Ma'lumot qayerdan: HEMIS nusxasi qachon olingan va nimani qamragan.

    Rektor ham, o'qituvchi ham raqamning manbasini ko'rib turishi kerak —
    shunda bahs "hisobot noto'g'ri" emas, "HEMIS'da shunday yozilgan" bo'ladi.
    """
    synced = [x.synced_at for x in lessons if getattr(x, "synced_at", None)]
    if not synced and db is not None:
        # Filtrdan keyin dars qolmasa ham HEMIS nusxasi qachon olingani ko'rinsin:
        # aks holda "oxirgi yangilanish —" sinxron ishlamagandek ko'rinardi.
        last = db.execute(select(func.max(HemisLesson.synced_at))).scalar()
        if isinstance(last, dt.datetime):
            synced = [last]
    rooms_without_monitor = {x.auditorium_name for x in lessons if not x.monitor_id and x.auditorium_name}
    return {
        "synced_at": max(synced).isoformat() if synced else None,
        "lessons": len(lessons),
        "teachers": len(rows),
        "unlinked_teachers": sum(1 for r in rows if not r["linked"]),
        "rooms_without_monitor": len(rooms_without_monitor),
    }


def _attach(row: dict, engagement: dict, profiles: dict, materials: dict) -> None:
    """Qatorga iMentor'dagi haqiqiy ishini qo'shadi (daqiqa, yaratgani, profil)."""
    key = row["teacher_key"] or ""
    eng = engagement.get(key) or {}
    prof = profiles.get(key) or {}
    mat = materials.get(key) or {}
    created = eng.get("created") or {}
    row["minutes"] = int(eng.get("minutes", 0) or 0)
    row["active_days"] = int(eng.get("active_days", 0) or 0)
    row["created"] = created
    row["created_total"] = int(eng.get("created_total", 0) or 0)
    row["top_module"] = (eng.get("modules") or [{}])[0].get("label", "") if eng.get("modules") else ""
    # Har bo'limda (sahifada) qancha vaqt (kartada, 2026-11-19).
    row["modules"] = [{"page": m.get("page"), "label": m.get("label"), "minutes": int(m.get("minutes") or 0)}
                      for m in (eng.get("modules") or []) if int(m.get("minutes") or 0) > 0]
    row["depth"] = eng.get("depth", "none") if row["linked"] else "none"
    row["profile_percent"] = prof.get("percent")
    row["profile_missing"] = prof.get("missing", [])
    row["subjects_linked"] = int(prof.get("subjects", 0) or 0)
    row["material_percent"] = mat.get("percent")
    row["material_topics"] = int(mat.get("topics", 0) or 0)
    row["material_empty"] = int(mat.get("empty", 0) or 0)


#: Kafedra qatorida ko'rsatiladigan monitorsiz xonalar soni (monitor qayerda belgilanmagani).
SECTION_ROOMS = 4
#: Kesimda umuman ko'rsatilmaydigan kafedralar (rektor, 2026-11-16: "chet tili chiqmasin").
SECTIONS_HIDDEN = ("O‘zbek va xorijiy tillar",)


def _sections(db: Session, lessons: list, watched: list[dict]) -> list[dict]:
    """Fakultet → kafedra kesimi (2026-11-16): har birida nazoratdagi o'qituvchilar va toifalari.

    Toifa — o'qituvchining BUTUN davrdagi holati (`teacher_state`), ya'ni bosh sahifadagi to'rt
    karta bilan bir xil o'lchov. Ikki kafedrada darsi bor o'qituvchi ikkalasida ham ko'rinadi,
    fakultet jamida esa bir marta sanaladi.

    Klinik fanning amaliy darsi bor, lekin birorta darsi monitorli xonada bo'lmagan kafedra ham
    chiqadi (`teachers` = 0): rektor "18 ta klinik kafedra hammasi chiqishi kerak" dedi (2026-11-16) —
    bo'sh qolganida sababi (darslar qaysi monitorsiz xonalarda o'tgani) ko'rinadi.
    """
    state = {(r["teacher_key"] or f"name:{r['teacher_name']}"): r["state"] for r in watched}
    canon = dean_access.canonical_map(db)
    fac_of = {d["name"]: d["faculty"] for d in dean_access.OFFICIAL_DEPARTMENTS}
    by_dep: dict[str, set] = defaultdict(set)
    clinical: dict[str, dict] = defaultdict(lambda: {"lessons": 0, "monitor": 0, "teachers": set(), "rooms": Counter()})
    for lesson in lessons:
        dep = dean_access.canonical(lesson.department_name, canon) or (lesson.department_name or "—")
        key = lesson.teacher_username or f"name:{lesson.teacher_name}"
        c = clinical[dep]
        c["lessons"] += 1
        c["teachers"].add(key)
        if not lesson.monitor_id:
            place = " — ".join(x for x in (lesson.building_name, lesson.auditorium_name) if x) or "xona ko'rsatilmagan"
            c["rooms"][place] += 1
            continue
        c["monitor"] += 1
        if key in state:
            by_dep[dep].add(key)

    def summary(keys: set) -> dict:
        cnt = Counter(state[k] for k in keys)
        used = cnt["full"] + cnt["partial"]
        return {"teachers": len(keys), "used": used, "percent": _pct(used, len(keys)),
                "full": cnt["full"], "partial": cnt["partial"], "opened": cnt["opened"], "none": cnt["none"]}

    facs: dict[str, dict] = defaultdict(lambda: {"keys": set(), "departments": []})
    for dep in sorted(set(by_dep) | set(clinical)):
        keys = by_dep.get(dep, set())
        c = clinical.get(dep) or {"lessons": 0, "monitor": 0, "teachers": set(), "rooms": Counter()}
        fac = fac_of.get(dep, "Boshqa")
        facs[fac]["keys"] |= keys
        # O'qituvchilar ro'yxati (kalitlar) — kesimda kafedra ochilganda kimlar ekani ko'rinadi (2026-11-16).
        facs[fac]["departments"].append({
            "department": dep, **summary(keys), "teacher_keys": sorted(keys),
            "clinical_lessons": c["lessons"], "clinical_teachers": len(c["teachers"]),
            "monitor_lessons": c["monitor"],
            "rooms_without_monitor": [{"room": r, "lessons": n} for r, n in c["rooms"].most_common(SECTION_ROOMS)],
            # Klinik amaliy darsi bor HAMMA o'qituvchi (monitorsiz xonadagilar ham) — kafedra ochilganda ismlari.
            "clinical_teacher_keys": sorted(c["teachers"]),
        })
    # Kesimda HAMMA kafedra chiqadi, faqat chet tili yo'q (rektor, 2026-11-16: "hamma kafedralar chiqaversin,
    # chet tili chiqmasin"). Nazoratga kirmaydiganlari sababi bilan: klinik fan darsi yo'q yoki hisobotdan
    # chiqarilgan kafedra. Hisob qoidasi (klinik fan + amaliy + monitorli xona) o'zgarmaydi.
    from app.services import report_exclusion

    excluded = report_exclusion.load(db)
    shown = {d["department"] for v in facs.values() for d in v["departments"]}
    for dep in dean_access.OFFICIAL_DEPARTMENTS:
        if dep["name"] in shown or dep["name"] in SECTIONS_HIDDEN:
            continue
        facs[dep["faculty"]]["departments"].append({
            "department": dep["name"], **summary(set()), "teacher_keys": [],
            "clinical_lessons": 0, "clinical_teachers": 0, "monitor_lessons": 0, "rooms_without_monitor": [],
            "clinical_teacher_keys": [],
            "reason": "excluded" if excluded.department_excluded(dep["name"]) else "no_clinical",
        })
    order = dean_access.faculty_names()
    out = []
    for fac, v in sorted(facs.items(), key=lambda x: order.index(x[0]) if x[0] in order else len(order)):
        # Monitorli darsi yo'q kafedralar oxirida, nazoratga kirmaydiganlari undan keyin.
        v["departments"].sort(key=lambda d: (d["teachers"] == 0, d["clinical_lessons"] == 0, d["percent"],
                                             -d["teachers"], d["department"]))
        out.append({"faculty": fac, **summary(v["keys"]), "departments": v["departments"]})
    return out


def scope_note(db: Session, start_day: dt.date, end_day: dt.date, department: str) -> dict:
    """Kafedra tanlangan, lekin nazoratda o'qituvchi yo'q — NIMA uchun (2026-11-16, "darslar bor-ku").

    Amaliy darslar, ulardan klinik fanlari, klinik darslardan monitorli xonadagilari va ular qaysi xonalarda
    o'tgani. Faqat bo'sh natija uchun hisoblanadi (bitta kafedra — tez).
    """
    from app.services import clinical_subjects

    rows = lr._lessons(db, start_day, end_day, department=department, pending=True, all_types=True)
    practical = [x for x in rows if lr.counts_lesson_type(x.lesson_type)]
    clin = [x for x in practical if clinical_subjects.is_clinical_lesson(x)]
    mon = [x for x in clin if x.monitor_id]
    rooms = Counter(" — ".join(v for v in (x.building_name, x.auditorium_name) if v) or "xona ko'rsatilmagan"
                    for x in clin if not x.monitor_id)
    subjects = Counter(x.subject_name for x in practical if not clinical_subjects.is_clinical_lesson(x))
    who = lambda xs: len({x.teacher_username or x.teacher_name for x in xs})  # noqa: E731
    return {
        "department": department,
        "lessons": len(rows), "practical": len(practical), "practical_teachers": who(practical),
        "clinical": len(clin), "clinical_teachers": who(clin), "monitor": len(mon),
        "rooms_without_monitor": [{"room": r, "lessons": n} for r, n in rooms.most_common(6)],
        "non_clinical_subjects": [{"subject": sname, "lessons": n} for sname, n in subjects.most_common(5)],
    }


def teacher_state(r: dict) -> str:
    """O'qituvchining davrdagi holati — har kishi FAQAT bitta toifada.

    Ilgari sahifadagi "kirgan, dars o'tmagan" (80) va "umuman ishlatmagan" (110)
    bir-birini qoplardi: kirib chiqqan, lekin birorta darsni to'liq o'tmagan
    o'qituvchi ikkalasida ham sanalardi va yig'indi nazoratdagilar sonidan
    (143) oshib ketardi (2026-10-09).
    """
    if not r["monitor_lessons"]:
        return "offsite"
    if not r["linked"]:
        return "unlinked"
    if r["monitor_used"] >= r["monitor_lessons"]:
        return "full"          # hamma darsini iMentor'da o'tgan
    if r["monitor_used"]:
        return "partial"       # ba'zi darsini o'tgan, qolganini o'tmagan
    if r.get("on_leave"):
        return "on_leave"
    if r.get("short_lessons") or r.get("misuse_lessons"):
        return "opened"        # kirgan, lekin birorta darsni to'liq o'tmagan
    return "none"              # dars vaqtida umuman ochmagan


#: Toifalar sahifada shu tartibda; yig'indisi = nazoratdagi o'qituvchilar.
TEACHER_STATES = ("full", "partial", "opened", "none", "on_leave", "unlinked")


def teacher_rows(db: Session, start_day: dt.date, end_day: dt.date, *, department: str = "",
                 query: str = "", groups: tuple[str, ...] = ()) -> tuple[list[dict], list, dict, dict]:
    """O'qituvchi qatorlari + ular qurilgan xom ma'lumot.

    `overview` ham, raqam ortidagi ro'yxatni beradigan `people` ham SHU
    funksiyadan foydalanadi — shunda modaldagi ro'yxat sahifadagi raqam bilan
    bir xil hisobdan chiqadi va ular hech qachon bir-biriga qarama-qarshi bo'lmaydi.
    """
    rows, lessons, used, rooms, _ = _teacher_rows(db, start_day, end_day, department=department,
                                                  query=query, groups=groups)
    return rows, lessons, used, rooms


def _teacher_rows(db: Session, start_day: dt.date, end_day: dt.date, *, department: str = "",
                  query: str = "", groups: tuple[str, ...] = ()) -> tuple[list[dict], list, dict, dict, dict]:
    """`teacher_rows` + hali tugamagan (baholanmaydigan) darslar haqida ma'lumot.

    Qidiruv (2026-10-23): og'ir hisob qidiruvsiz bir marta keshlanadi, qidiruv esa tayyor hisob
    ustidan — o'qituvchi qatorlari VA ularning darslari. Ilgari faqat qatorlar filtrlanardi:
    "Karimov" yozilsa tepadagi raqam uning 5 darsini, kunlik grafik va kafedralar esa butun
    institutni ko'rsatardi; har yangi so'z esa ~20 soniyalik hisobni qayta boshlardi.
    """
    key = ("rows", start_day, end_day, department, "", tuple(groups))

    def build(session: Session):
        # Umumiy (filtrsiz) hisob — og'ir qism — BARCHA ishchi jarayonlar uchun Redis'da (2026-11-16):
        # kafedra/fakultet filtri shu natija ustidan ishlaydi; u bo'lmasa boshqa jarayonga tushgan birinchi
        # filtr 30 soniya kutardi.
        # Kesh o'chiq bo'lsa (testlar) — umumiy kesh ham ishlatilmaydi.
        shared = _rows_shared_key(start_day, end_day, groups) if not department and CACHE_SECONDS > 0 else ""
        if shared:
            # Fon isitishi 30 kunlik davrni 15 daqiqada bir yangilaydi — oraliqda ham ishlatiladi;
            # jadval bo'yicha eskirgani (`_outdated`: navbatdagi dars tugadi) baribir qayta hisoblanadi.
            hit = _rows_shared_get(shared, ROWS_SHARED_MAX_AGE)
            if hit is not None and not _outdated(hit):
                return hit
        value = _build_teacher_rows(session, start_day, end_day, department=department, groups=groups)
        if shared:
            _rows_shared_put(shared, value)
        return value

    rows, lessons, used, rooms, pending = _cached(key, db, build)
    needle = (query or "").strip().casefold()
    if not needle:
        return rows, lessons, used, rooms, pending
    picked = [r for r in rows if needle in f"{r['teacher_name']} {r['teacher_key']}".casefold()]
    keys = {r["teacher_key"] or f"name:{r['teacher_name']}" for r in picked}
    mine = [x for x in lessons if (x.teacher_username or f"name:{x.teacher_name}") in keys]
    return picked, mine, used, rooms, pending


def _pending_info(waiting: list, now: dt.datetime) -> tuple[dict, dict[str, int]]:
    """Hali tugamagan darslar: nechta, kimniki va eng yaqini qachon tugaydi."""
    waiting_by: dict[str, int] = defaultdict(int)
    # Eng yaqin tugash vaqti: ertalab hisobot bo'sh bo'lsa, rektorga "raqamlar
    # qachon paydo bo'ladi" degan javob kerak (2026-10-13). `is_over` dars
    # jadvaldagi tugash vaqtida "tugagan" deb sanaydi, shuning uchun oyna
    # oxiridan muhlat ayiriladi.
    next_at = None
    for lesson in waiting:
        if lesson.monitor_id:
            waiting_by[lesson.teacher_username or f"name:{lesson.teacher_name}"] += 1
        ends = lr._window(lesson)[1] - lr.AFTER
        if next_at is None or ends < next_at:
            next_at = ends
    pending = {
        "lessons": len(waiting),
        "monitor_lessons": sum(waiting_by.values()),
        "teachers": len(waiting_by),
        "as_of": now.isoformat() if waiting else None,
        "next_at": next_at.isoformat() if next_at else None,
    }
    return pending, waiting_by


def _department_rows(db: Session, start_day: dt.date, end_day: dt.date, department: str,
                     groups: tuple[str, ...]) -> tuple[list[dict], list, dict, dict, dict]:
    """Kafedra yoki fakultet tanlanganda — UMUMIY hisob (keshda, fonda isitiladi) ustidan filtr (2026-11-16).

    Ilgari har filtr hamma darslar o'lchovini noldan hisoblardi: 30 kunda fakultet 32 s, kafedra 18 s —
    rektor filtrni almashtirganda sahifa "qotib" qolardi. O'lchov (dars o'tildimi, necha daqiqa) kafedraga
    bog'liq emas, shuning uchun umumiy natijadagi darslar shunchaki ajratiladi. Xona isboti (shu monitorda
    boshqalar ishlaganmi) butun institut bo'yicha qoladi — bu to'g'riroq.
    """
    from app.services.dean_access import department_filter

    _rows, all_lessons, used, all_rooms, full = _teacher_rows(db, start_day, end_day, groups=groups)
    mine = department_filter(db, department)
    lessons = [x for x in all_lessons if mine(x.department_name)]
    waiting = [x for x in full.get("_waiting", []) if mine(x.department_name)]
    ids = {x.id for x in lessons}
    pending, waiting_by = _pending_info(waiting, lr.current_time())
    pending.update({
        "_engagement": full.get("_engagement") or {},
        "_touched": {i for i in full.get("_touched", set()) if i in ids},
        "_absent": full.get("_absent", {}),
        "_offsite_marked": full.get("_offsite_marked", {}),
        "_waiting": waiting,
        "_work": full.get("_work", {}),
        "_group": {i for i in full.get("_group", set()) if i in ids},
        "_misuse": {i for i in full.get("_misuse", set()) if i in ids},
        "_modules": full.get("_modules") or {},
        "_room_used": full.get("_room_used") or {},
    })
    rows, rooms = _finish_rows(db, start_day, end_day, lessons, used, full.get("_work", {}), waiting_by, pending,
                               evidence_rooms=all_rooms)
    return rows, lessons, used, rooms, pending


def _build_teacher_rows(db: Session, start_day: dt.date, end_day: dt.date, *, department: str = "",
                        query: str = "", groups: tuple[str, ...] = ()) -> tuple[list[dict], list, dict, dict, dict]:
    if department:
        return _department_rows(db, start_day, end_day, department, groups)
    every = lr._lessons(db, start_day, end_day, groups=groups, pending=True)
    now = lr.current_time()
    today = now.date()
    lessons, waiting = [], []
    for x in every:
        # O'tgan kunlar darsi aniq tugagan — vaqtini hisoblab o'tirilmaydi.
        (lessons if x.lesson_date < today or lr.is_over(x, now) else waiting).append(x)
    pending, waiting_by = _pending_info(waiting, now)
    pending["_waiting"] = waiting
    # Faollik bir marta hisoblanadi va `overview` ga ham shu beriladi: ilgari
    # u ikki marta yurardi (30 kunlik davrda har biri ~4 soniya).
    engagement = ta.engagement_map(db, start_day, end_day)
    pending["_engagement"] = engagement
    # Xom o'lchov: har darsda qancha ishlangan. `used` shundan chegaradan
    # o'tganlarini oladi, qolgani "kirgan, lekin dars o'tilmagan" bo'ladi —
    # rektor aynan shu farqni ko'rishni so'radi (2026-10-08).
    # Qaror `lr.is_taught` da: sof vaqt YOKI dars qoplamasi YOKI aniq dalil
    # (jonli test / xona kompyuteriga QR bilan kirish). Faqat sof vaqtga
    # tayanish ma'ruzani kam ko'rsatardi — 2026-10-09 da dars boshidan
    # oxirigacha iMentor'da ko'ringan 132 dars "o'tilmagan" bo'lib chiqqandi.
    measures = lr.measure_map(db, lessons, schedule=every)
    work = {k: (m["seconds"], m["students"]) for k, m in measures.items()}
    pending["_work"] = work
    used = {k: (True, m["students"]) for k, m in measures.items() if lr.is_taught(m)}
    # Vaqt yetarli, lekin test/keys yo'q yoki ularga kam vaqt — «noto'g'ri foydalangan» (2026-11-19). Yashil emas,
    # lekin xona/monitor ishlayotgani isboti (xona hisobi shular bilan).
    pending["_misuse"] = {k for k, m in measures.items() if lr.time_taught(m) and not lr.is_taught(m)}
    # Kartadagi test/keys (2026-11-19): har darsda nima yaratilgani va necha daqiqa.
    pending["_modules"] = {k: info for k, m in measures.items() for info in [lr.module_info(m)] if info}
    pending["_room_used"] = {**used, **{k: (True, measures[k]["students"]) for k in pending["_misuse"]}}
    _count_lessons_taught_elsewhere(lessons, used)
    # "Ishlatilgan" dars — to'liq o'tilgan YOKI dars vaqtida qisqa bo'lsa ham
    # ishlangan. Asosiy foiz shu bo'yicha (2026-10-12); kunlik va haftalik
    # grafik ham shu ma'noda bo'lsin (2026-10-15).
    # Faqat guruh talabalari faol, o'qituvchida qayd yo'q — "chala" (2026-11-17): o'tilganga ham,
    # "umuman ochmagan" ga ham kirmaydi.
    pending["_group"] = {k for k, m in measures.items() if lr.group_only(m)}
    pending["_touched"] = {
        lesson.id for lesson in lessons
        if lesson.monitor_id and (lesson.id in used or work.get(lesson.id, (0, 0))[0] > 0
                                  or lesson.id in pending["_group"])
    }
    # Kasallik varaqasi / ta'til / safar (admin tasdiqlagan, 2026-10-28): o'sha kunlardagi
    # o'tilmagan darslar hisobotdan chiqadi — o'qituvchi "ishlatmadi" bo'lib qolmasin.
    lessons, absent_lessons = _drop_absent(lessons, used, pending["_touched"],
                                           _absence_days(db, start_day, end_day))
    pending["_absent"] = absent_lessons
    lessons, offsite_marked = _drop_offsite(lessons, used, pending["_touched"],
                                            _offsite_marks(db, start_day, end_day))
    pending["_offsite_marked"] = offsite_marked
    rows, rooms = _finish_rows(db, start_day, end_day, lessons, used, work, waiting_by, pending)
    return rows, lessons, used, rooms, pending


def _finish_rows(db: Session, start_day: dt.date, end_day: dt.date, lessons: list, used: dict, work: dict,
                 waiting_by: dict[str, int], pending: dict, *, evidence_rooms: dict | None = None) -> tuple[list[dict], dict]:
    """O'lchangan darslardan o'qituvchi qatorlari (yengil qism — kafedra filtri ham shu yerdan)."""
    need = lr.MIN_LESSON_MINUTES * 60
    today = lr.current_time().date()
    engagement = pending.get("_engagement") or {}
    absent_lessons = pending.get("_absent", {})
    offsite_marked = pending.get("_offsite_marked", {})
    # Avval XONALAR: qaysi monitor ishlayotgani isbotlangan, qaysi biri shubhali.
    rooms = mr.room_stats(_real_rooms(lessons), pending.get("_room_used") or used)
    stats = _teacher_stats(lessons, used, evidence_rooms if evidence_rooms is not None else rooms)
    rows = [_teacher_row(r) for r in stats.values()]

    # Dalil: har o'qituvchi monitorli darslarida qancha vaqt ishlagan va
    # nechta darsga shunchaki "kirib chiqqan".
    short: dict[str, int] = defaultdict(int)
    near: dict[str, int] = defaultdict(int)
    worked: dict[str, int] = defaultdict(int)
    short_seconds: dict[str, int] = defaultdict(int)
    near_need = min(NEAR_MINUTES * 60, need)
    group_only = pending.get("_group") or set()
    misuse_ids = pending.get("_misuse") or set()
    misuse: dict[str, int] = defaultdict(int)
    module_infos = pending.get("_modules") or {}
    lesson_modules: dict[str, list[dict]] = defaultdict(list)
    for lesson in lessons:
        if not lesson.monitor_id:
            continue
        key = lesson.teacher_username or f"name:{lesson.teacher_name}"
        seconds = work.get(lesson.id, (0, 0))[0]
        worked[key] += seconds
        info = module_infos.get(lesson.id) or {}
        lesson_modules[key].append({
            "date": lesson.lesson_date.isoformat(), "para": lesson.para or "", "start": lesson.start_time or "",
            "minutes": seconds // 60, "used": lesson.id in used, "misuse": lesson.id in misuse_ids,
            "test": bool(info.get("test")), "case": bool(info.get("case")),
            "test_minutes": int(info.get("test_minutes") or 0), "case_minutes": int(info.get("case_minutes") or 0),
            "cycle": int(info.get("cycle") or 0), "open": bool(info.get("open")),
        })
        if lesson.id in misuse_ids and lesson.id not in used:
            misuse[key] += 1
            continue
        if lesson.id not in used and (seconds > 0 or lesson.id in group_only):
            short[key] += 1
            short_seconds[key] += seconds
            if seconds >= near_need:
                near[key] += 1
    for r in rows:
        key = r["teacher_key"] or f"name:{r['teacher_name']}"
        r["short_lessons"] = short.get(key, 0)
        # 40 daqiqa ishlagan, lekin test/keys yaratmagan yoki ularga 10 daqiqadan kam (2026-11-19).
        r["misuse_lessons"] = misuse.get(key, 0)
        # Har darsda test/keys (kartada, 2026-11-19): eng yangisi birinchi, ko'pi bilan 12 ta.
        mine = sorted(lesson_modules.get(key, []), key=lambda x: (x["date"], x["start"]), reverse=True)
        r["lesson_modules"] = mine[:12]
        r["test_lessons"] = sum(1 for x in mine if x["test"])
        r["case_lessons"] = sum(1 for x in mine if x["case"])
        # Qisqa darslarning ichidan: chegaraga yaqin (30-49 daq) va juda qisqa (1-29 daq).
        r["short_near_lessons"] = near.get(key, 0)
        r["short_brief_lessons"] = short.get(key, 0) - near.get(key, 0)
        # Qisqa darslarda o'rtacha necha daqiqa ishlagan — "deyarli o'tgan"mi yoki "kirib chiqqan"mi.
        r["short_avg_minutes"] = round(short_seconds[key] / short[key] / 60) if short.get(key) else 0
        r["monitor_minutes"] = worked.get(key, 0) // 60
        # O'tilmagan darslar soni va bugun hali tugamagan darslari.
        r["monitor_missed"] = r["monitor_lessons"] - r["monitor_used"]
        r["pending_lessons"] = waiting_by.get(key, 0)
        r["absence_lessons"] = absent_lessons.get(r["teacher_key"] or "", 0)
        r["offsite_marked_lessons"] = offsite_marked.get(r["teacher_key"] or "", 0)

    # --- Ikkinchi qatlam: darsda ochgani kam, nima qilgani ham kerak.
    profiles = ta.profile_map(db)
    materials = ta.materials_map(db)
    for r in rows:
        _attach(r, engagement, profiles, materials)

    # HEMIS'da ta'tildagi o'qituvchi ayblanmaydi (2026-09-26) — u ro'yxatda
    # "ta'tilda" belgisi bilan qoladi, lekin qizil ro'yxatlarga tushmaydi.
    from app.services.hemis_staff import on_leave_logins

    # HEMIS faqat HOZIRGI ta'til holatini beradi (2026-10-23): o'tgan oy hisobotida bu haftadan
    # ta'tildagi o'qituvchi butun oy uchun oqlanardi. Faqat yaqin davrlarga qo'llanadi.
    leave = on_leave_logins(db) if end_day >= today - LEAVE_RECENT else set()
    for r in rows:
        r["on_leave"] = bool(r["teacher_key"]) and r["teacher_key"] in leave
        r["state"] = teacher_state(r)

    # Ishlatmaganlarning SABABI shu yerda, qatorlar bilan birga keshlanadi (2026-10-23): ilgari
    # `overview` ichida yozilardi — fon yangilanishidan keyin "kimni tekshirish kerak" ro'yxati
    # (drill) sabablarsiz qatorlarni olib, sahifadagi son bilan mos kelmasdi.
    idle = [r for r in rows if r["monitor_lessons"] > 0 and r["monitor_used"] == 0 and r["linked"]
            and not r["on_leave"]]
    idle.sort(key=lambda r: -r["monitor_lessons"])
    # Sabablar (xonaning 14 kunlik tarixi) 7 kunlik hisobotning ~18 soniyasini olardi, ular esa
    # faqat rektor sahifasidan olib tashlangan ogohlantirish ro'yxatlarida ko'rinardi (2026-11-15).
    # Standart holatda hisoblanmaydi; `excuse` oddiy qoidada qoladi (`_teacher_row`).
    if EXPLAIN_IDLE:
        idle_reasons.explain(db, idle[:IDLE_EXPLAINED], lessons, used, end_day,
                             period_rooms=rooms, period_days=(end_day - start_day).days + 1)
    for r in idle:
        if "system_side" in r:
            r["excuse"] = "check_room" if r["system_side"] else "blamed"
    return rows, rooms


def _rows_redis():
    """Ikkilik (pickle) qiymatlar uchun alohida Redis ulanishi — umumiy klient matn qaytaradi."""
    import redis

    from app.core.config import get_settings

    return redis.Redis.from_url(get_settings().redis_url, socket_connect_timeout=0.5, socket_timeout=5)


def _rows_shared_key(start_day: dt.date, end_day: dt.date, groups) -> str:
    raw = json.dumps([str(start_day), str(end_day), list(groups)], ensure_ascii=False)
    return "rx:rows:v1:" + hashlib.sha256(raw.encode()).hexdigest()[:32]


def _rows_shared_get(key: str, max_age: float):
    """Boshqa ishchi hisoblagan o'qituvchi qatorlari (+darslar, o'lchov). Xatoda — None."""
    try:
        import pickle
        import zlib

        raw = _rows_redis().get(key)
        if not raw:
            return None
        at, value = pickle.loads(zlib.decompress(raw))
        if time.time() - float(at) > max_age:
            return None
        return value
    except Exception:  # noqa: BLE001 — kesh ishlamasa oddiy hisob
        return None


def _rows_shared_put(key: str, value) -> None:
    try:
        import pickle
        import zlib

        _rows_redis().set(key, zlib.compress(pickle.dumps((time.time(), value), protocol=pickle.HIGHEST_PROTOCOL), 3),
                          ex=STALE_SECONDS)
    except Exception:  # noqa: BLE001
        logger.warning("teacher rows shared cache put failed", exc_info=True)


def _shared_key(start_day: dt.date, end_day: dt.date, department: str, query: str, groups) -> str:
    raw = json.dumps([str(start_day), str(end_day), department, query, list(groups)], ensure_ascii=False)
    return "rx:overview:v1:" + hashlib.sha256(raw.encode()).hexdigest()[:32]


def _shared_get(key: str, max_age: float) -> dict | None:
    """Redis'dagi tayyor hisobot (boshqa ishchi jarayon hisoblagan). Xatoda — None (jim)."""
    try:
        from app.services.ai_response_cache import _redis

        raw = _redis().get(key)
        if not raw:
            return None
        box = json.loads(raw)
        if time.time() - float(box.get("at", 0)) > max_age:
            return None
        return box.get("value")
    except Exception:  # noqa: BLE001 — kesh ishlamasa oddiy hisob
        return None


def _shared_put(key: str, value: dict) -> None:
    try:
        from app.services.ai_response_cache import _redis

        _redis().set(key, json.dumps({"at": time.time(), "value": value}, ensure_ascii=False, default=str),
                     ex=STALE_SECONDS)
    except Exception:  # noqa: BLE001
        pass


def overview(db: Session, start_day: dt.date, end_day: dt.date, *, department: str = "",
             query: str = "", groups: tuple[str, ...] = ()) -> dict:
    """Rektor sahifasining butun mazmuni — bitta so'rovda.

    Ikki qatlamli kesh (2026-11-15): jarayon ichidagi (`_cached`) va BARCHA ishchi jarayonlar uchun
    umumiy Redis. Ilgari 4 ta jarayonning har biri "Bu oy"ni (~30 s) o'zi qaytadan hisoblardi.
    """
    key = ("overview", start_day, end_day, department, query, tuple(groups))
    shared = _shared_key(start_day, end_day, department, query, groups)

    def build(session: Session) -> dict:
        hit = _shared_get(shared, CACHE_SECONDS)
        if hit is not None and not _outdated(hit):
            return hit
        value = _build_overview(session, start_day, end_day, department=department, query=query, groups=groups)
        _shared_put(shared, value)
        return value

    # Nusxa: yo'l (route) dekan uchun ro'yxatlarni almashtiradi — saqlangan
    # javobning o'zi o'zgarib, keyingi (rektor) so'roviga o'tib ketmasin.
    return dict(_cached(key, db, build))


def _build_overview(db: Session, start_day: dt.date, end_day: dt.date, *, department: str = "",
                    query: str = "", groups: tuple[str, ...] = ()) -> dict:
    rows, lessons, used, rooms, pending = _teacher_rows(db, start_day, end_day, department=department,
                                                        query=query, groups=groups)
    engagement = pending["_engagement"]
    touched_ids = pending.get("_touched", set())
    absent_lessons = pending.get("_absent", {})
    offsite_marked = pending.get("_offsite_marked", {})
    pending = {k: v for k, v in pending.items() if not k.startswith("_")}
    # Kesh bilan bo'lishilgan ro'yxat — tartiblash boshqa so'rovga ta'sir qilmasin.
    rows = list(rows)

    # --- Asosiy: monitorli darslar
    monitor_lessons = sum(r["monitor_lessons"] for r in rows)
    monitor_used = sum(r["monitor_used"] for r in rows)
    other_lessons = sum(r["other_lessons"] for r in rows)
    other_used = sum(r["other_used"] for r in rows)

    # Hisobotning asosiy qismi FAQAT monitorli xonada darsi borlar haqida:
    # klinikada yoki masofadan dars o'tadigan o'qituvchini monitor bo'yicha
    # baholab bo'lmaydi, uni bitta ro'yxatga qo'shish esa raqamlarni
    # chalkashtirardi (2026-10-06 shikoyati). Ular alohida bo'limda.
    watched = [r for r in rows if r["monitor_lessons"] > 0]
    idle = [r for r in watched if r["monitor_used"] == 0 and r["linked"] and not r["on_leave"]]
    idle.sort(key=lambda r: -r["monitor_lessons"])
    # Bahonasi yo'qlar va avval xonasi tekshirilishi kerak bo'lganlar — ALOHIDA.
    # Room activity by somebody else is never treated as an individual verdict.
    # "Qayd yo'q" faqat dars vaqtida UMUMAN ochmaganlarga tegishli: kirib,
    # lekin darsni to'liq o'tmaganlarda qayd bor — ular alohida toifada.
    # Har o'qituvchiga ANIQ sabab — umumiy "umuman ochilmagan" emas (2026-10-21).
    # Ro'yxat ham sabab bo'yicha: o'qituvchi tomonidagi sabab (hisobiga kirmagan,
    # o'sha kuni kirmagan, dars vaqtida emas, qisqa) — qizil; aybi isbotlanmagani
    # (xona monitori shubhali, HEMIS'da bir vaqtda ikki dars, ikki hisob) — sariq.
    # Sabablar `_build_teacher_rows` da yozilgan (keshdagi qatorlar bilan birga).
    blamed = [r for r in idle if r["excuse"] == "blamed"]
    check_room = [r for r in idle if r["excuse"] != "blamed"]
    states = {name: sum(1 for r in watched if r["state"] == name) for name in TEACHER_STATES}
    teachers_used = states["full"] + states["partial"]

    # --- Kunlik kesim (grafik uchun)
    per_day: dict[dt.date, dict] = defaultdict(lambda: {"monitor": 0, "used": 0, "touched": 0,
                                                       "teachers": set(), "active": set()})
    for lesson in lessons:
        if not lesson.monitor_id:
            continue
        day = per_day[lesson.lesson_date]
        day["monitor"] += 1
        if lesson.teacher_username:
            day["teachers"].add(lesson.teacher_username)
        if lesson.id in used:
            day["used"] += 1
            if lesson.teacher_username:
                day["active"].add(lesson.teacher_username)
        if lesson.id in touched_ids:
            day["touched"] += 1
    daily = [{
        "date": day.isoformat(),
        "weekday": ms.WEEKDAYS[day.weekday()] if day.weekday() < len(ms.WEEKDAYS) else "",
        "lessons": v["monitor"],
        "used": v["used"],
        "percent": _pct(v["used"], v["monitor"]),
        "touched": v["touched"],
        "touched_percent": _pct(v["touched"], v["monitor"]),
        # O'qituvchilar bo'yicha (2026-11-15, grafik): shu kuni monitorli darsi bo'lganlardan
        # kamida bitta darsini iMentor'da o'tganlar.
        "teachers": len(v["teachers"]),
        "teachers_used": len(v["active"]),
        "teacher_percent": _pct(len(v["active"]), len(v["teachers"])),
    } for day, v in sorted(per_day.items())]

    # --- Kafedralar
    dep_agg: dict[str, dict] = defaultdict(
        lambda: {"monitor": 0, "used": 0, "touched": 0, "teachers": set(), "active": set(),
                 "touching": set(), "other": 0, "other_used": 0})
    # Kafedra kesimi RASMIY nom bo'yicha: aks holda bitta kafedra bir necha
    # qator bo'lib ketardi ("Normal anatomiya" va "Yu. Nishonov nomidagi
    # Normal anatomiya" alohida chiqardi, 2026-10-12).
    canon = dean_access.canonical_map(db)
    for lesson in lessons:
        d = dep_agg[dean_access.canonical(lesson.department_name, canon)
                    or (lesson.department_name or "—")]
        if lesson.monitor_id:
            d["monitor"] += 1
            if lesson.teacher_username:
                d["teachers"].add(lesson.teacher_username)
            if lesson.id in used:
                d["used"] += 1
                if lesson.teacher_username:
                    d["active"].add(lesson.teacher_username)
            if lesson.id in touched_ids:
                d["touched"] += 1
                if lesson.teacher_username:
                    d["touching"].add(lesson.teacher_username)
        else:
            d["other"] += 1
            # Monitorsiz xonadagi darsda ham ishlatgani ko'rinsin (2026-10-19):
            # Epidemiologiya darslarining 234/249 tasi monitorsiz xonada, va
            # kafedra qatori "0" bo'lib, ishlatganlar ko'rinmay qolardi.
            if lesson.id in used:
                d["other_used"] += 1
    departments = [{
        "department": name,
        "monitor_lessons": v["monitor"],
        "monitor_used": v["used"],
        "percent": _pct(v["used"], v["monitor"]),
        "band": _band(_pct(v["used"], v["monitor"])) if v["monitor"] else "none",
        # "Ishlatilgan" — asosiy foiz bilan bir xil o'lchov (to'liq + qisqa).
        # Ilgari kafedra faqat TO'LIQ o'tilganlar bilan ko'rsatilardi: 19-oktabr
        # shikoyati — "Tibbiy va biologik kimyo" 44% bo'lib "ishlatilmagan"dek
        # ko'rinardi, aslida darslarining 75% ida iMentor ishlatilgan edi.
        "monitor_touched": v["touched"],
        "touched_percent": _pct(v["touched"], v["monitor"]),
        "touched_band": _band(_pct(v["touched"], v["monitor"])) if v["monitor"] else "none",
        "teachers": len(v["teachers"]),
        "active_teachers": len(v["active"]),
        "touching_teachers": len(v["touching"]),
        "other_lessons": v["other"],
        "other_used": v["other_used"],
    } for name, v in dep_agg.items() if v["monitor"] or v["other"]]
    # Monitorli darsi yo'q kafedra (hamma darsi monitorsiz xonada) — oxirida: ilgari "0%" bo'lib
    # eng yomonlar qatorida birinchi turardi va qizil "1, 2, 3" belgisini olardi (2026-10-23).
    departments.sort(key=lambda r: (r["monitor_lessons"] == 0, r["touched_percent"], r["percent"],
                                    -r["monitor_lessons"]))

    rows.sort(key=lambda r: (r["monitor_percent"] if r["monitor_percent"] is not None else 999,
                             -r["monitor_lessons"]))
    # Ro'yxatlar TARTIBLANGANDAN keyin bo'linadi: aks holda asosiy ro'yxat
    # "eng yomoni oldinda" tartibini yo'qotardi.
    monitored_rows = [r for r in rows if r["monitor_lessons"] > 0]
    offsite = [r for r in rows if not r["monitor_lessons"]]

    # --- Monitorsiz joylar: qaysi bino va xonada, necha dars, kim
    place_agg: dict[str, dict] = defaultdict(
        lambda: {"lessons": 0, "used": 0, "teachers": set()})
    for lesson in lessons:
        if lesson.monitor_id:
            continue
        name = " — ".join(x for x in (lesson.building_name, lesson.auditorium_name) if x) or "—"
        p = place_agg[name]
        p["lessons"] += 1
        if lesson.teacher_username:
            p["teachers"].add(lesson.teacher_username)
        if lesson.id in used:
            p["used"] += 1
    places = sorted(
        ({"place": name, "lessons": v["lessons"], "used": v["used"],
          "teachers": len(v["teachers"]), "percent": _pct(v["used"], v["lessons"])}
         for name, v in place_agg.items()),
        key=lambda r: -r["lessons"],
    )

    # --- Faollik sifati: kirgani emas, nima qilgani
    linked = [r for r in rows if r["linked"]]
    shown = {r["teacher_key"] for r in linked}
    quality = {
        "minutes": sum(r["minutes"] for r in linked),
        "worked": sum(1 for r in linked if r["depth"] == "worked"),
        "viewed": sum(1 for r in linked if r["depth"] == "viewed"),
        "visit": sum(1 for r in linked if r["depth"] == "visit"),
        "never": sum(1 for r in linked if r["depth"] == "none"),
        "no_subject": sum(1 for r in linked if not r["subjects_linked"]),
        "profile_incomplete": sum(1 for r in linked if (r["profile_percent"] or 0) < 100),
        "teachers": len(linked),
    }
    mine = {k: v for k, v in engagement.items() if k in shown}
    return {
        "from": start_day.isoformat(),
        "to": end_day.isoformat(),
        "headline": {
            "monitor_lessons": monitor_lessons,
            "monitor_used": monitor_used,
            "monitor_percent": _pct(monitor_used, monitor_lessons),
            "band": _band(_pct(monitor_used, monitor_lessons)) if monitor_lessons else "none",
            # Sahifadagi KATTA foiz: iMentor ishlatilgan darslar ulushi —
            # to'liq o'tilganlar va vaqti yetmaganlar birgalikda. Rektor
            # bitta foiz so'radi va "yashil + sariq yig'indisi" dedi
            # (2026-10-12). "To'liq o'tilgan" ulushi `monitor_percent` da
            # qoladi va pastdagi jumlada ko'rinadi.
            "monitor_touched": monitor_used + sum(r.get("short_lessons", 0) + r.get("misuse_lessons", 0) for r in rows),
            "monitor_touched_percent": _pct(
                monitor_used + sum(r.get("short_lessons", 0) + r.get("misuse_lessons", 0) for r in rows), monitor_lessons),
            "touch_band": _band(_pct(
                monitor_used + sum(r.get("short_lessons", 0) + r.get("misuse_lessons", 0) for r in rows), monitor_lessons)
            ) if monitor_lessons else "none",
            # Sariq: 40 daqiqa ishlagan, lekin test/keys yo'q yoki ularga 10 daqiqadan kam (2026-11-19).
            "monitor_misuse": sum(r.get("misuse_lessons", 0) for r in rows),
            "watched_teachers": len(watched),
            "idle_teachers": len(idle),
            # O'qituvchi kesimi: darsi borlardan nechtasi kamida bitta darsni
            # iMentor'da o'tgan. Toifalar bir-birini qoplamaydi, yig'indisi =
            # `watched_teachers`.
            "teachers_used": teachers_used,
            "teacher_percent": _pct(teachers_used, len(watched)),
            "teacher_buckets": states,
            # Qisman o'tganlarning o'tilmay qolgan darslari.
            "partial_missed_lessons": sum(r["monitor_missed"] for r in watched if r["state"] == "partial"),
            # Hali tugamagan darslar — hech bir raqamga kirmagan.
            "pending": pending,
            "other_lessons": other_lessons,
            "other_used": other_used,
            "other_percent": _pct(other_used, other_lessons),
            "unlinked_teachers": sum(1 for r in rows if not r["linked"]),
            "total_lessons": monitor_lessons + other_lessons,
            "blamed_teachers": len(blamed),
            "check_room_teachers": len(check_room),
            "on_leave_teachers": sum(1 for r in rows if r["on_leave"]),
            # Tasdiqlangan kasallik varaqasi / ta'til / safar kunlaridagi o'tilmagan darslar —
            # hech bir raqamga kirmagan (2026-10-28).
            "absence_lessons": sum(absent_lessons.values()),
            "absence_teachers": len(absent_lessons),
            # O'qituvchi dars vaqtida "boshqa joyda o'tyapman" deb rasm bilan qayd etgan darslar (2026-11-12).
            "offsite_marked_lessons": sum(offsite_marked.values()),
            "offsite_marked_teachers": len(offsite_marked),
            # Monitorli xonada umuman darsi yo'qlar — asosiy foizga kirmaydi.
            "offsite_teachers": len(offsite),
            # Kirgan, lekin darsni iMentor'da o'tmagan: chegaradan past.
            "short_lessons": sum(r.get("short_lessons", 0) for r in rows),
            "short_teachers": sum(1 for r in rows if r.get("short_lessons")),
            # Monitorli darslar ishlangan vaqt bo'yicha: to'liq (chegaradan o'tgan),
            # yaqin (30-49 daq), qisqa (1-29 daq), umuman ochilmagan. Yig'indisi =
            # `monitor_lessons` — sahifadagi taqsimot chizig'i shundan.
            "work_buckets": {
                "full": monitor_used,
                "near": sum(r.get("short_near_lessons", 0) for r in rows),
                "brief": sum(r.get("short_brief_lessons", 0) for r in rows),
                "none": monitor_lessons - monitor_used - sum(r.get("short_lessons", 0) for r in rows),
            },
            "short_near_teachers": sum(1 for r in rows if r.get("short_near_lessons")),
            "short_brief_teachers": sum(1 for r in rows if r.get("short_brief_lessons")),
            "near_minutes": NEAR_MINUTES,
            "min_lesson_minutes": lr.MIN_LESSON_MINUTES,
        },
        # Ro'yxat kesiladi (sahifa 700 qatorni ko'tarmaydi), shuning uchun
        # jami son ham yuboriladi: "raqam = ro'yxat" qoidasi buzilmasin.
        "attention": [_attention_row(r) for r in blamed[:60]],
        "attention_total": len(blamed),
        "check_room": [_attention_row(r) for r in check_room[:40]],
        "check_room_total": len(check_room),
        "rooms": mr.payload(rooms),
        "room_summary": mr.summary(rooms),
        "source": _source(lessons, rows, db),
        "daily": daily,
        "departments": departments,
        "sections": _sections(db, lessons, watched),
        # Kafedra tanlangan va nazoratda hech kim yo'q — sababi (sahifa "dars yo'q" demasin).
        "scope_note": scope_note(db, start_day, end_day, department) if department and not watched else None,
        "teachers": monitored_rows,
        "offsite": {
            "teachers": offsite,
            "count": len(offsite),
            "lessons": sum(r["other_lessons"] for r in offsite),
            "used": sum(r["other_used"] for r in offsite),
            "places": places[:60],
            "places_total": len(places),
        },
        "quality": quality,
        "modules": ta.module_totals(mine),
        "created": ta.created_totals(mine),
        "created_labels": ta.CREATED_LABEL,
    }


# ======================================================= raqam ortidagi odamlar


def _person(key: str, name: str, subtitle: str, value, label: str, *, kind: str = "teacher",
            note: str = "") -> dict:
    return {"key": key, "kind": kind, "name": name or key, "subtitle": subtitle,
            "value": value, "value_label": label, "note": note}


def _by_value(people: list[dict], *, reverse: bool = True) -> list[dict]:
    people.sort(key=lambda r: ((r["value"] if isinstance(r["value"], (int, float)) else 0), r["name"]),
                reverse=reverse)
    if not reverse:  # kam qiymat oldinda, lekin ism ichida A→Z qolsin
        people.sort(key=lambda r: (r["value"] if isinstance(r["value"], (int, float)) else 0, r["name"]))
    return people


def _teacher_person(row: dict, value, label: str) -> dict:
    note = "ta\u2019tilda" if row.get("on_leave") else ("hisobi yo\u2018q" if not row["linked"] else "")
    return _person(row["teacher_key"] or f"name:{row['teacher_name']}", row["teacher_name"],
                   row["department"], value, label, note=note)


#: Qaysi raqam qaysi ro'yxatni ochadi. Har biri sahifadagi ANIQ bir raqam.
TEACHER_METRICS: dict[str, str] = {
    "monitor_lessons": "Monitorli xonada darsi bor o\u2018qituvchilar",
    "monitor_used": "Monitorli darsda iMentor ochganlar",
    "watched": "Nazoratdagi o\u2018qituvchilar",
    "idle": "Monitorli darsda iMentor ochmaganlar",
    "blamed": "Monitorli darsda foydalanish qaydi topilmagan — tekshirish kerak",
    "check_room": "Avval xonasi tekshirilishi kerak",
    "on_leave": "HEMIS bo\u2018yicha ta\u2019tilda",
    "absent": "Kasallik varaqasi / ta\u2019til / safar (admin tasdiqlagan)",
    "unlinked": "HEMIS jadvalida bor, iMentor hisobi yo\u2018q",
    "other_lessons": "Monitorsiz xonada darsi bor",
    "offsite": "Monitorli xonada darsi YO‘Q — klinika yoki masofaviy",
    "short": "Kirgan, lekin darsni iMentor’da o‘tmagan",
    "t_used": "Kamida bitta darsini iMentor’da o‘tganlar",
    "t_full": "Hamma darsini iMentor’da o‘tganlar",
    "t_partial": "Ba’zi darslarini iMentor’da o‘tmaganlar",
    "t_opened": "Kirgan, lekin birorta darsni to‘liq o‘tmaganlar",
    "t_none": "Dars vaqtida iMentor’ni umuman ochmaganlar",
    "chronic": "Surunkalilar — doimiy muammo bo‘layotgan o‘qituvchilar",
    "no_material": "Nazoratdagi, shu davrda birorta material yaratmagan o‘qituvchilar",
    "suspect_rooms": "Tekshirish kerak bo‘lgan monitor xonalari",
    "short_near": (f"Ishlatgan, lekin {lr.MIN_LESSON_MINUTES} daqiqaga yetmagan "
                   f"({NEAR_MINUTES}–{lr.MIN_LESSON_MINUTES - 1} daqiqa)"),
    "short_brief": f"Kirib chiqqan ({NEAR_MINUTES} daqiqadan kam)",
    "other_used": "Monitorsiz darsda iMentor ochganlar",
    "total_lessons": "Jadvalda darsi bor barcha o\u2018qituvchilar",
    "minutes": "iMentor\u2019da ishlagan vaqt bo\u2018yicha",
    "worked": "Material yaratganlar",
    "viewed": "Ko\u2018rgan, lekin yaratmaganlar",
    "visit": "Kirib chiqqanlar (5 daqiqadan kam)",
    "never": "Bu davrda umuman kirmaganlar",
    "no_subject": "Fan biriktirmaganlar",
    "profile_incomplete": "Profili to\u2018liq emas",
    "teachers": "Nazoratdagi hisoblar",
    "material_gap": "Fanida materialsiz mavzu qolganlar",
}


#: Sahifadagi plitka va vidjetlar ochadigan ro'yxatlar — tayyor hisobot qatorlaridan (2026-11-15).
FAST_METRICS = ("watched", "t_used", "t_full", "t_partial", "t_opened", "t_none", "no_material", "minutes")


def _fast_people(db: Session, start_day: dt.date, end_day: dt.date, name: str, *, department: str = "",
                 groups: tuple[str, ...] = ()) -> dict | None:
    """Plitka/vidjet ro'yxati jarayon keshida qatorlar bo'lmasa ham DARHOL — umumiy hisobotdan.

    Shart sahifadagi raqam bilan aynan bir xil: hisobot `teachers` (monitorli darsi borlar) qatorlari.
    """
    if name not in FAST_METRICS:
        return None
    if ("rows", start_day, end_day, department, "", tuple(groups)) in _cache:
        return None  # jarayonda to'liq qatorlar bor — odatdagi yo'l
    ov = overview(db, start_day, end_day, department=department, groups=groups)
    rows = ov.get("teachers") or []
    out: list[dict] = []
    if name == "watched":
        for r in rows:
            out.append(_teacher_person(r, r["monitor_percent"] if r.get("monitor_percent") is not None else 0, "%"))
    elif name.startswith("t_"):
        want = ("full", "partial") if name == "t_used" else (name[2:],)
        for r in rows:
            if r.get("state") not in want:
                continue
            label = f"/ {r['monitor_lessons']} dars"
            if r.get("state") == "opened":
                label += f" · {r.get('short_lessons', 0)} tasiga kirgan"
            out.append(_teacher_person(r, r["monitor_used"], label))
    elif name == "no_material":
        for r in rows:
            if r.get("linked") and r["monitor_lessons"] > 0 and not r.get("created_total"):
                out.append(_teacher_person(r, r["monitor_lessons"], "dars"))
    elif name == "minutes":
        for r in rows:
            if r.get("linked") and r.get("minutes"):
                out.append(_teacher_person(r, r["minutes"], "daq"))
    _by_value(out)
    return {"metric": name, "title": TEACHER_METRICS.get(name, ""), "kind": "teacher",
            "total": len(out), "people": out[:400]}


def people(db: Session, start_day: dt.date, end_day: dt.date, *, metric: str, key: str = "",
           department: str = "", groups: tuple[str, ...] = ()) -> dict:
    """Sahifadagi bitta RAQAM ortidagi odamlar ro'yxati.

    Rektor raqamni bosadi — kim ekanini ko'radi. Ro'yxat hisobotning o'zi
    bilan bir manbadan (`teacher_rows`), shuning uchun soni har doim mos keladi.
    """
    name, _, arg = (metric or "").partition(":")
    arg = arg or key

    if name in ("students_tested", "students_attempts", "students_all", "group", "groups_active"):
        return _student_people(db, start_day, end_day, name, arg, groups=groups)

    if name == "chronic":
        # «Surunkalilar» (2026-11-19): o'z oynasi (oxirgi 30 kun), har biriga kafedra mas'uli.
        from app.services import chronic_teachers

        return chronic_teachers.build(db, end_day, department=department, groups=groups)

    fast = _fast_people(db, start_day, end_day, name, department=department, groups=groups)
    if fast is not None:
        return fast
    rows, lessons, used, rooms = teacher_rows(db, start_day, end_day, department=department, groups=groups)
    linked = [r for r in rows if r["linked"]]
    title = TEACHER_METRICS.get(name, "")
    out: list[dict] = []

    def add(filtered, value_of, label, *, rows_source=None):
        for r in (rows_source if rows_source is not None else filtered):
            out.append(_teacher_person(r, value_of(r), label))

    if name == "monitor_lessons":
        add([r for r in rows if r["monitor_lessons"]], lambda r: r["monitor_lessons"], "dars")
    elif name == "monitor_used":
        add([r for r in rows if r["monitor_used"]], lambda r: r["monitor_used"], "dars")
    elif name == "watched":
        add([r for r in rows if r["monitor_lessons"] > 0],
            lambda r: r["monitor_percent"] if r["monitor_percent"] is not None else 0, "%")
    elif name in ("idle", "blamed", "check_room"):
        idle = [r for r in rows if r["monitor_lessons"] > 0 and r["monitor_used"] == 0
                and r["linked"] and not r["on_leave"]]
        if name == "blamed":
            idle = [r for r in idle if r["excuse"] == "blamed"]
        elif name == "check_room":
            idle = [r for r in idle if r["excuse"] != "blamed"]
        add(idle, lambda r: r["monitor_lessons"], "dars")
    elif name in ("t_used", "t_full", "t_partial", "t_opened", "t_none"):
        want = ("full", "partial") if name == "t_used" else (name[2:],)
        for r in rows:
            if r["state"] not in want:
                continue
            # "2 / 4 dars" — nechta darsidan nechtasini o'tgani bir qarashda.
            label = f"/ {r['monitor_lessons']} dars"
            if r["state"] == "opened":
                label += f" · {r['short_lessons']} tasiga kirgan"
            out.append(_teacher_person(r, r["monitor_used"], label))
    elif name == "on_leave":
        add([r for r in rows if r.get("on_leave")], lambda r: r["monitor_lessons"], "dars")
    elif name == "absent":
        # Tasdiqlangan ishda bo'lmagan kunlar (2026-10-28) — darslari hisobotdan chiqarilganlar.
        from app.models.user import User
        from app.services.staff_absence import label as absence_label

        away = _absence_days(db, start_day, end_day)
        names = {u: f"{(ln or '').strip()} {(fn or '').strip()}".strip() for u, fn, ln in db.execute(
            select(User.username, User.first_name, User.last_name).where(User.username.in_(list(away)))
        ).all()} if away else {}
        for owner, days in away.items():
            kinds = sorted({absence_label(k) for k in days.values()})
            span = f"{min(days):%d.%m}\u2013{max(days):%d.%m}"
            out.append(_person(owner, names.get(owner, owner), f"{', '.join(kinds)} \u00b7 {span}", len(days), "kun"))
    elif name == "unlinked":
        add([r for r in rows if not r["linked"]], lambda r: r["lessons"], "dars")
    elif name == "short":
        # Qisqa kirib chiqqanlar: eng ko'p "aldagan" oldinda.
        add([r for r in rows if r.get("short_lessons")],
            lambda r: r.get("short_lessons", 0), "dars")
    elif name in ("short_near", "short_brief"):
        field = "short_near_lessons" if name == "short_near" else "short_brief_lessons"
        add([r for r in rows if r.get(field)], lambda r: r.get(field, 0), "dars")
    elif name == "offsite":
        # Monitor bo'yicha baholab bo'lmaydiganlar: butun darsi monitorsiz
        # joyda o'tadi (klinika bazasi, dispanser, masofaviy).
        add([r for r in rows if not r["monitor_lessons"]], lambda r: r["other_lessons"], "dars")
    elif name == "other_lessons":
        add([r for r in rows if r["other_lessons"]], lambda r: r["other_lessons"], "dars")
    elif name == "other_used":
        add([r for r in rows if r["other_used"]], lambda r: r["other_used"], "dars")
    elif name == "total_lessons":
        add([r for r in rows if r["lessons"]], lambda r: r["lessons"], "dars")
    elif name == "minutes":
        add([r for r in linked if r["minutes"]], lambda r: r["minutes"], "daq")
    elif name in ("worked", "viewed", "visit", "never"):
        # "never" — sahifadagi nom; ma'lumotdagi qiymat "none".
        want = "none" if name == "never" else name
        add([r for r in linked if r["depth"] == want], lambda r: r["created_total"], "material")
    elif name == "no_subject":
        add([r for r in linked if not r["subjects_linked"]], lambda r: r["lessons"], "dars")
    elif name == "profile_incomplete":
        add([r for r in linked if (r["profile_percent"] or 0) < 100],
            lambda r: r["profile_percent"] or 0, "%")
    elif name == "teachers":
        add(linked, lambda r: r["monitor_lessons"], "dars")
    elif name == "no_material":
        # Sahifadagi xulosa bilan BIR XIL shart (2026-11-15): hisobi bor, monitorli darsi bor, 0 material.
        add([r for r in linked if r["monitor_lessons"] > 0 and not r.get("created_total")],
            lambda r: r["monitor_lessons"], "dars")
    elif name == "suspect_rooms":
        # Xona — odam emas: ochilmaydi, lekin qaysi xona va kafedra ekanini ko'rsatadi.
        for r in mr.payload(rooms):
            if r["status"] == "suspect":
                out.append(_person(r["monitor_id"], f"{r['room'] or r['monitor_id']} · {r['monitor_id']}",
                                   r["department"], r["teachers"], "o‘qituvchi ochmagan", kind="room"))
    elif name == "material_gap":
        add([r for r in linked if r["material_empty"]], lambda r: r["material_empty"], "bo\u2018sh mavzu")
    elif name in ("department", "department_active"):
        # Kafedra qatoridagi "N/M o'qituvchi" AYNAN shunday sanaladi: shu
        # kafedrada MONITORLI darsi bor, hisobi bog'langan o'qituvchilar.
        # Ilgari bu yerda qator matni bo'yicha filtr edi \u2014 ikki kafedrada dars
        # o'tadigan o'qituvchida son mos kelmasdi (2026-09-28).
        out = _department_people(rows, lessons, used, arg, only_active=name == "department_active",
                                 canon=dean_access.canonical_map(db))
        title = (f"{arg} \u2014 monitorda ishlatganlar" if name == "department_active"
                 else f"{arg} \u2014 o\u2018qituvchilari")
    elif name in ("day", "day_used"):
        out = _day_people(rows, lessons, used, arg, only_used=name == "day_used")
        title = ("Shu kuni monitorli darsda ishlatganlar" if name == "day_used"
                 else "Shu kuni monitorli darsi bo\u2018lganlar") + f" \u2014 {arg}"
    elif name in ("room", "room_idle"):
        out = _room_people(rows, lessons, used, arg, only_idle=name == "room_idle")
        room = rooms.get(arg) or {}
        label = room.get("room") or arg
        title = (f"{label} \u2014 ochmaganlar" if name == "room_idle" else f"{label} \u2014 dars o\u2018tadiganlar")
    elif name in ("module", "created"):
        out, title = _activity_people(db, start_day, end_day, rows, name, arg)
    else:
        raise ValueError(f"noma'lum ko'rsatkich: {metric}")

    _by_value(out, reverse=name not in ("minutes_low",))
    return {"metric": metric, "title": title or metric, "kind": "teacher",
            "total": len(out), "people": out[:400]}


def _day_people(rows: list[dict], lessons, used, day_iso: str, *, only_used: bool) -> list[dict]:
    by_key = {r["teacher_key"] or f"name:{r['teacher_name']}": r for r in rows}
    per: dict[str, dict] = {}
    for lesson in lessons:
        if not lesson.monitor_id or lesson.lesson_date.isoformat() != day_iso:
            continue
        k = lesson.teacher_username or f"name:{lesson.teacher_name}"
        slot = per.setdefault(k, {"lessons": 0, "used": 0})
        slot["lessons"] += 1
        if lesson.id in used:
            slot["used"] += 1
    out = []
    for k, v in per.items():
        if only_used and not v["used"]:
            continue
        row = by_key.get(k)
        if row is None:
            continue
        out.append(_teacher_person(row, v["used"] if only_used else v["lessons"],
                                   "dars" if only_used else f"darsdan {v['used']} tasi"))
    return out


def _room_people(rows: list[dict], lessons, used, monitor_id: str, *, only_idle: bool) -> list[dict]:
    by_key = {r["teacher_key"] or f"name:{r['teacher_name']}": r for r in rows}
    per: dict[str, dict] = {}
    for lesson in lessons:
        if lesson.monitor_id != monitor_id:
            continue
        k = lesson.teacher_username or f"name:{lesson.teacher_name}"
        slot = per.setdefault(k, {"lessons": 0, "used": 0})
        slot["lessons"] += 1
        if lesson.id in used:
            slot["used"] += 1
    out = []
    for k, v in per.items():
        if only_idle and v["used"]:
            continue
        row = by_key.get(k)
        if row is None:
            continue
        out.append(_teacher_person(row, v["lessons"], f"darsdan {v['used']} tasida ochgan"))
    return out


def _department_people(rows: list[dict], lessons, used, department: str, *, only_active: bool,
                       canon: dict[str, str] | None = None) -> list[dict]:
    by_key = {r["teacher_key"]: r for r in rows if r["teacher_key"]}
    per: dict[str, dict] = {}
    canon = canon or {}
    for lesson in lessons:
        # Kafedra qatori RASMIY nom bilan (yuqoridagi `dep_agg`); HEMIS esa boshqacha yozadi
        # ("Yu. Nishonov nomidagi ...", ikki bo'sh joy) — xom nom bilan solishtirilganda qator
        # "12/15 o'qituvchi" deb turib, bosilganda bo'sh ro'yxat chiqardi (2026-10-23).
        name = dean_access.canonical(lesson.department_name, canon) or (lesson.department_name or "—")
        if name != department or not lesson.monitor_id or not lesson.teacher_username:
            continue
        slot = per.setdefault(lesson.teacher_username, {"lessons": 0, "used": 0})
        slot["lessons"] += 1
        if lesson.id in used:
            slot["used"] += 1
    out = []
    for key, v in per.items():
        if only_active and not v["used"]:
            continue
        row = by_key.get(key)
        if row is None:
            continue
        out.append(_teacher_person(row, v["used"] if only_active else v["lessons"],
                                   "dars" if only_active else f"darsdan {v['used']} tasida ochgan"))
    return out


def _activity_people(db: Session, start_day: dt.date, end_day: dt.date, rows: list[dict],
                     kind: str, arg: str) -> tuple[list[dict], str]:
    """Bo'lim (modul) yoki yaratilgan material turi ortidagi o'qituvchilar.

    Sahifadagi "N kishi" faqat JADVALDA darsi bor, hisobi bog'langan
    o'qituvchilarni sanaydi — ro'yxat ham aynan shularni ko'rsatadi.
    """
    engagement = ta.engagement_map(db, start_day, end_day)
    by_key = {r["teacher_key"]: r for r in rows if r["teacher_key"] and r["linked"]}
    engagement = {k: v for k, v in engagement.items() if k in by_key}
    from app.services.rector_report_service import staff_directory

    directory = staff_directory(db)
    out: list[dict] = []
    title = ""
    for owner, eng in engagement.items():
        row = by_key.get(owner)
        info = directory.get(owner) or {}
        name = (row or {}).get("teacher_name") or info.get("display_name") or owner
        subtitle = (row or {}).get("department") or info.get("department", "")
        if kind == "module":
            # Sahifadagi "N kishi" bo'limni OCHGAN hammani sanaydi — 0 daqiqa
            # turgan (kirib darhol chiqqan) ham kiradi. Ro'yxat ham shunday.
            hit = next((m for m in eng.get("modules", []) if m["page"] == arg), None)
            if not hit:
                continue
            title = f"{hit['label']} \u2014 shu bo\u2018limda ishlaganlar"
            out.append(_person(owner, name, subtitle, hit["minutes"], "daq",
                               note=f"{hit['opens']} marta ochgan"))
        else:
            n = int((eng.get("created") or {}).get(arg, 0) or 0)
            if not n:
                continue
            title = f"{ta.CREATED_LABEL.get(arg, arg)} \u2014 yaratganlar"
            out.append(_person(owner, name, subtitle, n, "ta"))
    if not title:
        title = ta.MODULE_LABEL.get(arg, ta.CREATED_LABEL.get(arg, arg))
    return out, title


def _student_people(db: Session, start_day: dt.date, end_day: dt.date, name: str, arg: str, *,
                    groups: tuple[str, ...] = ()) -> dict:
    # Dekan guruhlari (2026-10-23): ilgari drill butun institut talabalarini ko'rsatardi.
    data = students(db, start_day, end_day, only_groups=groups)
    rows = data["students"]
    title = "Test topshirgan talabalar"
    if name == "group":
        rows = [r for r in rows if (r["group"] or "\u2014") == arg]
        title = f"{arg} \u2014 test topshirgan talabalar"
    elif name == "students_attempts":
        title = "Urinishlar bo\u2018yicha talabalar"
    elif name == "groups_active":
        title = "Faol guruhlar (kamida bitta talaba topshirgan)"
        groups = [_person(g["group"], g["group"], f"{g['tested_students']}/{g['group_size']} talaba",
                          g["attempts"], "urinish", kind="group",
                          note=f"o\u2018rtacha {g['avg_score']}%") for g in data["groups"]]
        _by_value(groups)
        return {"metric": name, "title": title, "kind": "group", "total": len(groups), "people": groups}

    out = [_person(
        r["student_key"], r["name"],
        (r["group"] or "kontingentda yo‘q") + (f" · {r['course']}-kurs" if r.get("course") else ""),
        r["attempts"], "urinish", kind="student", note=f"o‘rtacha {r['avg_score']}%",
    ) for r in rows]
    _by_value(out)
    return {"metric": name, "title": title, "kind": "student", "total": len(out), "people": out[:400]}


def students(db: Session, start_day: dt.date, end_day: dt.date, *,
             only_groups: tuple[str, ...] = ()) -> dict:
    """Talabalar nazorati: kim test topshirgan, qaysi guruh faol."""
    from app.models.analytics import StudentTestAttempt
    from app.models.student_contingent import StudentContingent
    from app.services.rector_report_service import student_key_expr

    key = student_key_expr()
    attempts = db.execute(
        select(
            key.label("student_id"),
            func.count(StudentTestAttempt.id).label("attempts"),
            func.coalesce(func.sum(StudentTestAttempt.score), 0).label("score"),
            func.coalesce(func.sum(StudentTestAttempt.total), 0).label("total"),
        )
        # `submitted_date` — mahalliy kun, ya'ni hisobot kunlari server UTC'siga surilmaydi.
        .where(StudentTestAttempt.submitted_date >= start_day, StudentTestAttempt.submitted_date <= end_day)
        .group_by(key)
    ).all()

    contingent = {
        c.student_id: c
        for c in db.execute(select(StudentContingent).where(StudentContingent.status == "active")).scalars()
        # Xalqaro fakultet dekani faqat o'z guruhlari talabalarini ko'radi.
        if in_groups(c.group_name, only_groups)
    }
    total_students = len(contingent)

    by_group: dict[str, dict] = defaultdict(lambda: {"students": set(), "attempts": 0, "score": 0, "total": 0})
    matched = 0
    score_sum = total_sum = 0
    for row in attempts:
        sid = str(row.student_id or "").strip()
        score_sum += int(row.score or 0)
        total_sum += int(row.total or 0)
        student = contingent.get(sid) or contingent.get(sid.replace("ot_", ""))
        if student is None:
            continue
        matched += 1
        g = by_group[student.group_name or "—"]
        g["students"].add(sid)
        g["attempts"] += int(row.attempts or 0)
        g["score"] += int(row.score or 0)
        g["total"] += int(row.total or 0)

    # Guruhdagi jami talaba soni — qamrovni ko'rsatish uchun.
    group_size: dict[str, int] = defaultdict(int)
    for student in contingent.values():
        group_size[student.group_name or "—"] += 1

    groups = [{
        "group": name,
        "tested_students": len(v["students"]),
        "group_size": group_size.get(name, 0),
        "coverage": _pct(len(v["students"]), group_size.get(name, 0)),
        "attempts": v["attempts"],
        "avg_score": _pct(v["score"], v["total"]),
    } for name, v in by_group.items()]
    groups.sort(key=lambda r: -r["attempts"])

    # Talabalar ro'yxati — ismga bosib batafsilini ochish uchun.
    rows = []
    for row in attempts:
        sid = str(row.student_id or "").strip()
        student = contingent.get(sid) or contingent.get(sid.replace("ot_", ""))
        rows.append({
            "student_key": sid,
            "name": (" ".join(x for x in (student.last_name, student.first_name) if x) if student
                     else sid.replace("name:", "").title()),
            "group": student.group_name if student else "",
            "course": student.course if student else None,
            "faculty": student.faculty_name if student else "",
            "in_contingent": student is not None,
            "attempts": int(row.attempts or 0),
            "avg_score": _pct(int(row.score or 0), int(row.total or 0)),
        })
    rows.sort(key=lambda r: -r["attempts"])

    return {
        "students": rows[:400],
        "from": start_day.isoformat(),
        "to": end_day.isoformat(),
        "totals": {
            "contingent": total_students,
            "tested": len(attempts),
            "matched_to_contingent": matched,
            "attempts": sum(int(r.attempts or 0) for r in attempts),
            "avg_score": _pct(score_sum, total_sum),
            "coverage": _pct(matched, total_students),
            "groups_active": len(groups),
            "groups_total": len(group_size),
        },
        "groups": groups[:60],
    }


# ============================================================ batafsil ko'rinish


def _with_absence(item: dict, absent_days: dict) -> dict:
    """Dars qatoriga "kasallik varaqasida" belgisi — faqat o'tilmagan bo'lsa."""
    try:
        day = dt.date.fromisoformat(str(item.get("date") or "")[:10])
    except ValueError:
        return item
    kind = absent_days.get(day)
    if kind and not item.get("used"):
        from app.services.staff_absence import label

        item["absence"] = {"kind": kind, "label": label(kind)}
    return item


def _with_offsite(item: dict, marks: dict[int, str]) -> dict:
    """Dars qatoriga "boshqa joyda: <sabab>" belgisi (kulrang) — qayd etilgan va iMentor'da o'tilmagan bo'lsa."""
    reason = marks.get(item.get("id"))
    if reason and not item.get("used") and not item.get("absence"):
        item["absence"] = {"kind": "offsite", "label": f"Boshqa joyda: {reason}"}
    return item


def teacher_detail(db: Session, owner_key: str, start_day: dt.date, end_day: dt.date,
                   *, groups: tuple[str, ...] = ()) -> dict:
    """Bitta o'qituvchi: har bir darsi, materiallari va iMentor'dagi faolligi.

    Ro'yxatdagi qator bilan BIR MANBA — o'sha darslar va o'sha "ishlatildi" o'lchovi.
    """
    from app.services import lesson_report_service as lrs
    from app.services.rector_report_service import created_materials, range_bounds, staff_directory, teaching_counts

    # Xona holati BUTUN muassasa bo'yicha hisoblanadi: bitta o'qituvchining
    # darslariga qarab "monitor ishlamayapti" deb bo'lmaydi.
    # Faqat SHU o'qituvchining darslari (2026-11-15): o'lchov (blok, qoplama, talaba dalili) o'qituvchi
    # va kun bo'yicha, shuning uchun natija butun institut hisobidagi bilan bir xil — lekin bir zumda.
    # Ilgari butun muassasa qayta hisoblanardi (14 s) yoki jarayon keshi kerak edi (sovuq bo'lsa 30–55 s).
    everything = lrs._lessons(db, start_day, end_day, teacher=owner_key)
    # Davom etayotgan sikl (2026-11-19): bugungi hali tugamagan paralar ham — test/keys sikl oxirida baholanadi.
    everything_raw = lrs.measure_map(db, everything,
                                     schedule=lrs._lessons(db, start_day, end_day, teacher=owner_key, pending=True))
    everything_used = {k: (True, m["students"]) for k, m in everything_raw.items() if lrs.is_taught(m)}
    _count_lessons_taught_elsewhere(everything, everything_used)
    # Xona ishlayotgani — vaqt bo'yicha (test/keys qoidasi emas, 2026-11-19).
    room_used = {**everything_used, **{k: (True, m["students"]) for k, m in everything_raw.items()
                                       if lrs.time_taught(m)}}
    rooms = mr.room_stats(_real_rooms(everything), room_used)
    cached_rows = _cache.get(("rows", start_day, end_day, "", "", ()))
    _pending = cached_rows[1][4] if cached_rows else {}
    # Xalqaro fakultet dekani o'qituvchining FAQAT o'z guruhlaridagi darsini
    # ko'radi; xona holati esa yuqorida butun muassasa bo'yicha hisoblandi.
    lessons = [x for x in everything if x.teacher_username == owner_key
               and any(in_groups(g, groups) for g in (lrs.lesson_groups(x) or ("",)))]
    used = {k: v for k, v in everything_used.items() if k in {x.id for x in lessons}}
    # Ro'yxatdagi qator bilan bir xil: tasdiqlangan ishda bo'lmagan kunlardagi o'tilmagan darslar
    # xulosaga kirmaydi; darslar ro'yxatida esa kulrang belgi bilan ko'rinadi (2026-10-28).
    absent_days = _absence_days(db, start_day, end_day).get(owner_key, {})
    lessons, _away = _drop_absent(lessons, used, set(), {owner_key: absent_days} if absent_days else {})
    offsite_marks = _offsite_marks(db, start_day, end_day).get(owner_key, {})
    lessons, _off = _drop_offsite(lessons, used, set(), {owner_key: offsite_marks} if offsite_marks else {})
    stats = _teacher_stats(lessons, used, rooms)
    row = _teacher_row(next(iter(stats.values()))) if stats else None

    info = staff_directory(db).get(owner_key) or {}
    start, end = range_bounds(start_day, end_day)
    mat = created_materials(db, start, end).get(owner_key, {})
    # Institut bo'yicha xarita (~0,7 s) — 5 daqiqa, ishchilar orasida umumiy (2026-11-16).
    teach = ta._cached(f"teaching:{start_day}:{end_day}",
                       lambda: teaching_counts(db, start, end, start_day, end_day)).get(owner_key, {})

    # Nima qilgani: bo'lim kesimida vaqt, yaratgan materiali, kunma-kun izi.
    from app.services.activity_report_service import teacher_daily_activity

    # Faollik ham keshdagi hisobdan (butun institut uchun qayta hisoblanmaydi).
    # Faollik: jarayon keshi -> umumiy (Redis) kesh -> oxirgi chora, butun institut bo'yicha hisob.
    eng_map = _pending.get("_engagement") or _shared_get(_shared_key(start_day, end_day, "engagement", "", ()),
                                                          STALE_SECONDS)
    if eng_map is None:
        eng_map = ta.engagement_map(db, start_day, end_day)
    eng = (eng_map or {}).get(owner_key) or {}
    prof = ta.profile_map(db).get(owner_key) or {}
    subj = ta.materials_map(db).get(owner_key) or {}
    daily_activity = teacher_daily_activity(db, owner_key=owner_key, start_day=start_day, end_day=end_day)
    from app.services.lesson_evidence import for_lessons
    evidence = for_lessons(db, lessons, lrs.clipped_windows(lessons))

    # Tanlangan davrdagi OXIRGI FAOLLIK. Ilgari faqat `User.last_login` ko'rsatilardi —
    # rektor kechagi kunni ochsa ham "oxirgi kirish: bugun" chiqib, hisobot davri bilan
    # ziddiyat hosil qilardi (2026-09-29). Endi ikkalasi alohida ko'rsatiladi.
    day_rows = daily_activity.get("days", [])
    active_days_in_range = [
        d["date"] for d in day_rows
        if d["minutes"] or d["tests_created"] or d["cases_created"] or d["live_sessions"]
    ]
    last_active = max(active_days_in_range) if active_days_in_range else None

    by_subject: dict[str, dict] = defaultdict(lambda: {"lessons": 0, "used": 0, "monitor": 0})
    for lesson in lessons:
        s = by_subject[lesson.subject_name or "—"]
        s["lessons"] += 1
        if lesson.monitor_id:
            s["monitor"] += 1
            if lesson.id in used:
                s["used"] += 1

    return {
        "teacher_key": owner_key,
        "profile": {
            "display_name": info.get("display_name") or (row or {}).get("teacher_name", ""),
            "job_title": info.get("job_title", ""),
            "department": (row or {}).get("department", "") or info.get("department", ""),
            "last_login": info.get("last_login").isoformat() if info.get("last_login") else None,
            # Faqat shu davr ichida: hisobotning qolgan raqamlari bilan bir xil oyna.
            "last_active": str(last_active) if last_active else None,
        },
        "summary": row,
        "engagement": {
            "minutes": int(eng.get("minutes", 0) or 0),
            "active_days": int(eng.get("active_days", 0) or 0),
            "depth": eng.get("depth", "none"),
            "depth_label": ta.DEPTH_LABEL.get(eng.get("depth", "none"), ""),
            "modules": eng.get("modules", []),
            "created": eng.get("created", {}),
            "created_total": int(eng.get("created_total", 0) or 0),
            "created_labels": ta.CREATED_LABEL,
            "viewed": eng.get("viewed", {"videos": 0, "handouts": 0}),
            "days": [
                {"date": d["date"], "minutes": d["minutes"],
                 "tests": d["tests_created"], "cases": d["cases_created"],
                 "live_sessions": d["live_sessions"]}
                for d in daily_activity.get("days", [])
            ],
        },
        "profile_check": {
            "percent": prof.get("percent", 0),
            "missing": prof.get("missing", list(label for _, label in ta.PROFILE_CHECKS)),
            "have": prof.get("have", {}),
            "subjects": int(prof.get("subjects", 0) or 0),
        },
        "subject_materials": {
            "percent": subj.get("percent", 0),
            "topics": int(subj.get("topics", 0) or 0),
            "empty": int(subj.get("empty", 0) or 0),
            "handout": int(subj.get("handout", 0) or 0),
            "presentation": int(subj.get("presentation", 0) or 0),
            "video": int(subj.get("video", 0) or 0),
            "rows": subj.get("subjects", []),
        },
        "materials": {
            "handouts": int(mat.get("handouts_created", 0) or 0),
            "videos": int(mat.get("videos_created", 0) or 0),
            "presentations": int(mat.get("presentations_created", 0) or 0),
            "live_sessions": int(teach.get("live_sessions", 0) or 0),
            "students_taught": int(teach.get("students_taught", 0) or 0),
            "student_attempts": int(teach.get("student_attempts", 0) or 0),
        },
        "rooms": [r for r in mr.payload(rooms)
                  if r["monitor_id"] in {x.monitor_id for x in lessons if x.monitor_id}],
        "subjects": sorted(
            ({"subject": name, **v, "percent": _pct(v["used"], v["monitor"])} for name, v in by_subject.items()),
            key=lambda r: -r["lessons"],
        ),
        "lessons": [_with_offsite(_with_absence({**item, "evidence": evidence.get(item["id"])}, absent_days), offsite_marks)
                    for item in lrs.lesson_rows(db, start_day, end_day, teacher=owner_key, groups=groups,
                                                measured=({x.id for x in everything}, everything_raw))],
    }


def student_detail(db: Session, student_key: str, start_day: dt.date, end_day: dt.date,
                   *, groups: tuple[str, ...] = ()) -> dict:
    """Bitta talaba: kontingent ma'lumoti va har bir test urinishi."""
    from app.models.student_contingent import StudentContingent
    from app.services.rector_report_service import student_detail as base_detail

    sid = student_key.replace("ot_", "")
    row = db.execute(
        select(StudentContingent).where(StudentContingent.student_id == sid)
    ).scalars().first()
    # Guruh bilan cheklangan dekan boshqa fakultet talabasini ocholmaydi.
    if groups and (row is None or not in_groups(row.group_name, groups)):
        raise PermissionError("Bu talaba sizning fakultetingizga tegishli emas.")
    detail = base_detail(db, student_key, start_day=start_day, end_day=end_day)
    detail["contingent"] = None if row is None else {
        "student_id": row.student_id,
        "full_name": " ".join(x for x in (row.last_name, row.first_name, row.middle_name) if x),
        "group_name": row.group_name,
        "course": row.course,
        "faculty": row.faculty_name,
        "direction": row.direction_name,
        "education_form": row.education_form,
        "education_language": row.education_language,
        "status": row.status,
    }
    return detail
