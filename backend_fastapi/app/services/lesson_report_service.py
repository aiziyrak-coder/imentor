"""Dars jadvali bo'yicha nazorat hisoboti — har bir xodim kesimida (2026-09-25).

Ilgari hisobot MONITOR atrofida qurilgan edi: faqat monitorli xonalardagi
darslar ko'rinardi (13 800 darsdan 2 600 tasi) va faqat kafedra Excel yuborgan
o'qituvchilar hisobga olinardi. Ya'ni ko'pchilik nazoratdan chetda qolardi.

Endi manba — HEMIS jadvalining to'liq nusxasi (`core_hemislesson`). Har bir
dars uchun bitta savolga javob beriladi: o'qituvchi shu dars vaqtida iMentor'ni
ishlatdimi? "Ishlatdi" degani — o'sha oynada jonli test ochgani, QR bilan
kompyuterga kirgani YOKI platformada ishlagani (sahifa ochgani, material
ko'rgani, ekran ochiq turgani). Oxirgisi 2026-10-08 da qo'shildi: usiz
ma'ruzani iMentor'dan ko'rsatgan o'qituvchi "ishlatmagan" deb chiqardi.
"""

from __future__ import annotations

import datetime as dt
import logging
import os
import time
from bisect import bisect_left, bisect_right
from collections import defaultdict
from types import SimpleNamespace

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models.hemis_lesson import HemisLesson
from app.services import monitor_schedule_service as ms
from app.services import report_exclusion
from app.services.dean_access import in_groups

# Dars boshlanishidan oldin va tugagandan keyin qancha vaqt "shu darsniki" hisoblanadi.
BEFORE = dt.timedelta(minutes=15)
AFTER = dt.timedelta(minutes=5)

#: Dars "iMentor'da o'tilgan" deb hisoblanishi uchun kerak bo'lgan ENG KAM
#: ish vaqti (daqiqa). Institut talabi: dars to'liq iMentor'da o'tilsin —
#: ya'ni ~60 daqiqa, majburiy eng kami 50 (2026-10-08).
#:
#: Ilgari chegara umuman yo'q edi: bir sahifaga 3-4 daqiqa kirgan o'qituvchi
#: ham "ishlatdi" bo'lib chiqardi va hisobot aldardi.
#:
#: Talab 2026-10-09 da 50 dan 40 daqiqaga tushirildi: dars juftligi 80
#: daqiqa, tanaffus va davomat olishni hisobga olsa, 40 daqiqa "darsning
#: asosiy qismi iMentor'da o'tildi" degani uchun yetarli.
#:
#: `IMENTOR_MIN_LESSON_MINUTES` bilan o'zgartiriladi — talab o'zgarsa
#: yangi versiya chiqarish shart emas.
MIN_LESSON_MINUTES = int(os.environ.get("IMENTOR_MIN_LESSON_MINUTES") or 40)

#: Monitorsiz xonada iMentor bilan o'tilgan dars belgisi (control_report_service bilan bir xil).
TAUGHT_ELSEWHERE = "boshqa-xona"

#: IKKINCHI o'lchov: dars davomida qaydlar qanchalik teng tarqalgani.
#:
#: Birinchi o'lchov (sof ishlangan daqiqa) ma'ruzani kam ko'rsatadi: slaydni
#: ko'rsatib turgan o'qituvchi sichqonchaga tegmaydi, 5 daqiqadan keyin
#: hisoblagich to'xtaydi, boshqa oynaga o'tsa ham to'xtaydi. 2026-10-09 da
#: dars oynasida birinchi va oxirgi qaydi 50+ daqiqa uzoqlikda bo'lgan 217
#: darsdan 132 tasi shu sababli "o'tilmagan" bo'lib chiqdi.
#:
#: Shuning uchun dars BO'LAKLARGA bo'linadi va har bo'lakda qayd bormi
#: deb qaraladi. Dars bo'laklarining kamida `MIN_COVER` ulushi qoplangan
#: VA kamida `MIN_COVER_MINUTES` daqiqa sof ish bo'lsa — dars o'tilgan.
#: Ikkinchi shart muhim: ikki marta bosib qo'yish qoplama bermasligi kerak.
COVER_BUCKET = dt.timedelta(minutes=5)
MIN_COVER = 0.6
MIN_COVER_MINUTES = 15


def _merge_spans(spans: list[tuple[dt.datetime, dt.datetime]]) -> list[tuple[dt.datetime, dt.datetime]]:
    """Ish oraliqlarini birlashtiradi: kesishmaydigan, boshi va oxiri bo'yicha tartiblangan ro'yxat.

    `_worked_seconds` oxirlar ro'yxatida ikkilik qidiruv qiladi — bu faqat
    oxirlar ham tartiblangan bo'lsa to'g'ri. Heartbeat oraliqlari har xil
    uzunlikda (1-15 daqiqa) va bir-birini qoplaydi, shuning uchun boshi bo'yicha
    tartiblanganda oxirlari tartibsiz bo'lib qolardi va qidiruv kerakli
    oraliqlarni tashlab yuborardi. Jonli ma'lumotda (2026-10-03..09) 11 ta
    darsda ishlangan vaqt kam chiqqan, 4 tasi (50,1 daqiqa → 49,7) chegaradan
    noto'g'ri tushib qolgan edi.
    """
    out: list[tuple[dt.datetime, dt.datetime]] = []
    for a, b in sorted(x for x in spans if x[1] > x[0]):
        if out and a <= out[-1][1]:
            if b > out[-1][1]:
                out[-1] = (out[-1][0], b)
        else:
            out.append((a, b))
    return out


def lesson_key(lesson) -> tuple:
    """Bitta haqiqiy dars: o'qituvchi, sana, vaqt, xona.

    HEMIS har GURUH uchun alohida qator beradi: 4 guruhga bir vaqtda o'qilgan
    bitta ma'ruza 4 ta "dars" bo'lib sanalardi (2026-10-03..09: 2208 qator,
    haqiqiy darslar 1637). Hisobot DARSLARNI sanaydi, guruhlarni emas.
    """
    return (
        lesson.teacher_username or f"name:{lesson.teacher_name}",
        lesson.lesson_date,
        lesson.start_time or lesson.para,
        lesson.end_time or "",
        (lesson.auditorium_name or "").strip().casefold(),
        # Ehtiyot: monitor belgisi farq qilsa (HEMIS/inventar nomuvofiq) birlashtirilmaydi.
        lesson.monitor_id or "",
    )


def merge_group_rows(lessons: list) -> list:
    """Bir darsning guruh qatorlarini bittaga yig'adi.

    Vakil — eng kichik id'li qator; barcha guruhlar `merged_groups` da
    (ORM ustuni emas, oddiy atribut — bazaga yozilmaydi).
    """
    by_key: dict[tuple, list] = {}
    for lesson in sorted(lessons, key=lambda x: x.id):
        by_key.setdefault(lesson_key(lesson), []).append(lesson)
    out = []
    for rows in by_key.values():
        head = rows[0]
        head.merged_groups = tuple(sorted({x.group_name for x in rows if x.group_name}))
        out.append(head)
    return out


def lesson_groups(lesson) -> tuple[str, ...]:
    """Dars o'tilgan barcha guruhlar (yig'ilmagan qatorda — o'zining guruhi)."""
    merged = getattr(lesson, "merged_groups", None)
    if merged is not None:
        return merged
    return (lesson.group_name,) if lesson.group_name else ()


def _worked_seconds(spans: list[tuple[dt.datetime, dt.datetime]],
                    ends: list[dt.datetime], start: dt.datetime, end: dt.datetime) -> int:
    """Dars oynasi ichida HAQIQATAN ishlangan soniya.

    Bir vaqtda ikki oyna (telefon + monitor) ochiq bo'lsa, o'sha daqiqa ikki
    marta sanalmasin: oraliqlar birlashtiriladi.

    `spans` — `_merge_spans` natijasi (kesishmaydigan, tartiblangan), `ends` —
    o'sha oxirlar. Faqat shunda ikkilik qidiruv to'g'ri: har dars uchun butun
    ro'yxat emas, faqat kerakli bo'lagi ko'riladi.
    Bunisiz hisobot 19 soniyaga cho'zilgandi (2026-10-08).
    """
    # Soniyalar aniq (kasr bilan) yig'iladi va oxirida yaxlitlanadi: ilgari har
    # bo'lak alohida butunga qirqilardi va darsdan 10-20 soniya yo'qolardi —
    # chegaradagi darsda (49:59) bu natijani o'zgartiradi.
    total = 0.0
    reached = start
    for i in range(bisect_left(ends, start), len(spans)):
        a, b = spans[i]
        if a >= end:
            break
        a, b = max(a, start), min(b, end)
        if b <= a or b <= reached:
            continue
        total += (b - max(a, reached)).total_seconds()
        reached = max(reached, b)
    return int(round(total))


def _window(lesson: HemisLesson) -> tuple[dt.datetime, dt.datetime]:
    """Darsning vaqt oynasi. Vaqti yozilmagan bo'lsa — para jadvalidan."""
    start_hhmm, end_hhmm = lesson.start_time, lesson.end_time
    if not (start_hhmm and end_hhmm):
        start_hhmm, end_hhmm = ms.PERIOD_TIMES.get(lesson.para, ("08:00", "09:20"))
    try:
        sh, sm = (int(x) for x in start_hhmm.split(":")[:2])
        eh, em = (int(x) for x in end_hhmm.split(":")[:2])
    except ValueError:
        sh, sm, eh, em = 8, 0, 9, 20
    day = lesson.lesson_date
    start = dt.datetime.combine(day, dt.time(sh, sm), tzinfo=ms.TASHKENT) - BEFORE
    end = dt.datetime.combine(day, dt.time(eh, em), tzinfo=ms.TASHKENT) + AFTER
    return start, end


def clipped_windows(lessons: list[HemisLesson]) -> dict[int, tuple[dt.datetime, dt.datetime]]:
    """Har dars oynasi o'qituvchining shu kundagi QO'SHNI darsigacha bo'lgan oraliqning o'rtasida
    qirqiladi (2026-10-23 auditi).

    Paralar orasida 10 daqiqa, oyna esa 15 daqiqa oldin va 5 daqiqa keyin: N-para oynasining
    oxiri va N+1-para oynasining boshi 10 daqiqa ustma-ust tushardi. Dars oxirida (09:18) ochilgan
    test yoki 09:15–09:25 dagi ish IKKALA darsni ham "o'tilgan" qilardi. Bir vaqtdagi darslar
    (bitta slot, boshqa guruh) bir-birini qirqmaydi.
    """
    slots: dict[tuple[str, dt.date], list[tuple[dt.datetime, dt.datetime]]] = {}
    for x in lessons:
        s, e = _window(x)
        slots.setdefault((x.teacher_username or "", x.lesson_date), []).append((s + BEFORE, e - AFTER))
    out: dict[int, tuple[dt.datetime, dt.datetime]] = {}
    for x in lessons:
        s, e = _window(x)
        start, end = s + BEFORE, e - AFTER
        mine = slots.get((x.teacher_username or "", x.lesson_date), [])
        prev_end = max((b for a, b in mine if b <= start), default=None)
        next_start = min((a for a, b in mine if a >= end), default=None)
        if prev_end is not None:
            s = max(s, prev_end + (start - prev_end) / 2)
        if next_start is not None:
            e = min(e, end + (next_start - end) / 2)
        out[x.id] = (s, e)
    return out


def current_time() -> dt.datetime:
    """Hozirgi vaqt (Toshkent). Alohida funksiya — testda almashtirish uchun."""
    return dt.datetime.now(ms.TASHKENT)


def is_over(lesson: HemisLesson, now: dt.datetime) -> bool:
    """Dars jadval bo'yicha tugaganmi.

    Hali tugamagan darsni "ishlatilmagan" deb bo'lmaydi: bugungi kun ertalab
    ochilganda tushdan keyingi darslar ham maxrajga tushib, foizni sun'iy
    pasaytirardi (2026-10-09: soat 11:46 da 443 darsdan 77 tasi — 17%).
    """
    return _window(lesson)[1] - AFTER <= now


#: Hisobotda SANALMAYDIGAN dars turlari. Ma'ruza va laboratoriya iMentor
#: orqali o'tilmaydi (rektor, 2026-10-12), shuning uchun ular foizni
#: pasaytirib, o'qituvchini bekordan ayblardi. Dars jadvali bo'limida
#: ular o'z o'rnida turadi — chiqariladigani faqat BAHO.
#:
#: Hisobotda FAQAT amaliy mashg'ulotlar baholanadi (rektor, 2026-10-19):
#: "laboratoriya va ma'ruzalarni hisobga olmang, faqat amaliy mashg'ulotlarni
#: (seminarlarni) inobatga olishimiz kerak". Klinik mashg'ulot — klinik
#: kafedradagi amaliy dars, u ham qoladi.
#:
#: Ilgari bu TESKARI ro'yxat edi (ma'ruza va laboratoriya chiqarilardi) va
#: faqat HEMIS darslariga qo'llanardi: monitor xonalari, o'qituvchi profili
#: va AI tahlil boshqa jadvaldan (`MonitorScheduleEntry`) o'qib, ma'ruza va
#: laboratoriyani "ishlatilmagan dars" deb sanardi; "Mustaqil ta'lim" ham
#: sanalardi. Endi ruxsat etilganlar ro'yxati va hamma joyda bitta qaror —
#: `counts_lesson_type`. `IMENTOR_COUNTED_LESSON_TYPES` bilan o'zgartiriladi.
#: 2026-11-19 (foydalanuvchi: "faqat amaliy mashg'ulotlarni nazorat qilamiz"): "Klinik mashg'ulot" chiqarildi
#: (14 kunda monitorli xonada 84 dars; o'sha o'qituvchilarning hammasida amaliy darsi ham bor).
COUNTED_LESSON_TYPES = tuple(
    x.strip() for x in (os.environ.get("IMENTOR_COUNTED_LESSON_TYPES")
                        or "amaliy, seminar").split(",") if x.strip()
)


def _type_key(value: str) -> str:
    """Dars turi kaliti: kichik harf, apostrofsiz."""
    text_ = str(value or "").lower()
    for ch in "ʻ‘’`'":
        text_ = text_.replace(ch, "")
    return " ".join(text_.split())


#: Tayyorlangan kalitlar — har darsda qayta hisoblanmasin.
_COUNTED_KEYS = frozenset(_type_key(x) for x in COUNTED_LESSON_TYPES)


def counts_lesson_type(value: str | None) -> bool:
    """Shu turdagi dars hisobotda baholanadimi.

    Turi yozilmagan qator (eski Excel jadvali) chiqarib yuborilmaydi —
    aks holda jadval yuklagan kafedra hisobotdan jimgina yo'qolardi.
    "Amaliy mashg'ulot" kabi kengroq yozuvlar ham taniladi.
    """
    key = _type_key(value or "")
    if not key:
        return True
    return any(k in key for k in _COUNTED_KEYS)


#: Magistratura (2026-11-19, foydalanuvchi: "dars magistratura mutaxassisliklariga bo'lsa hisobot yuritilmasin").
#: HEMIS yo'nalish kodi 70… — magistratura (60… bakalavriat, 80… ordinatura); nomida "Magistratura" bo'lsa ham.
#: 30 kunda monitorli xonadagi 714 dars (25 guruh, masalan "Kardiologiya-25 (Magistratura)", "Pediatriya-24").
_MAG_TTL = 600.0
_mag_cache: tuple[float, frozenset] = (0.0, frozenset())


def magistracy_groups(db: Session) -> frozenset:
    """Magistratura guruhlari (kontingentdan, 10 daqiqa keshda)."""
    global _mag_cache
    if _mag_cache[1] and time.monotonic() - _mag_cache[0] < _MAG_TTL:
        return _mag_cache[1]
    try:
        # 2026-11-19: faqat BAKALAVRIAT nazoratda — guruhning birorta talabasi ham 60… yo'nalishda bo'lmasa
        # (70… magistratura, 80… ordinatura) yoki nomida "magistr" bo'lsa, dars hisobotga kirmaydi.
        names = db.execute(text(
            "select group_name from core_studentcontingent group by group_name "
            "having not bool_or(direction_code like '60%') or bool_or(group_name ilike '%magistr%')")).scalars().all()
    except Exception:  # noqa: BLE001 — kontingent o'qilmasa avvalgi ro'yxat
        return _mag_cache[1]
    _mag_cache = (time.monotonic(), frozenset(str(n) for n in names if n))
    return _mag_cache[1]


def is_magistracy(lesson) -> bool:
    """Dars faqat magistratura guruh(lar)iga — hisobotga kirmaydi."""
    mag = _mag_cache[1]
    if not mag:
        return False
    groups = [g for g in (getattr(lesson, "merged_groups", None) or (getattr(lesson, "group_name", "") or "",)) if g]
    return bool(groups) and all(g in mag for g in groups)


def is_counted(lesson: HemisLesson) -> bool:
    """Bu dars hisobotda baholanadimi: KLINIK fanning AMALIY mashg'ulotlari.

    Rektorat (2026-11-16): "faqat klinik kafedralardagi klinik fanlarni (klinik bo'lmagan
    kafedradagi klinik fanlarni ham), faqat amaliy mashg'ulotlarni nazorat qilamiz".
    Fan klinikmi — `clinical_subjects.is_clinical` (admin qarori yoki avtomatik qoida).
    """
    if not counts_lesson_type(getattr(lesson, "lesson_type", "")):
        return False
    if is_magistracy(lesson):
        return False
    from app.services import clinical_subjects

    return clinical_subjects.is_clinical_lesson(lesson)


#: Dars qatorining maydonlari — bir marta hisoblanadi.
_LESSON_FIELDS = tuple(c.name for c in HemisLesson.__table__.columns)


def _plain(rows: list) -> list:
    """ORM qatorlarini baza sessiyasidan MUSTAQIL nusxaga aylantiradi.

    Hisobot natijasi keshda saqlanadi va orqa fonda boshqa sessiyada
    yangilanadi. ORM obyekti o'z sessiyasiga bog'langan: sessiya yopilsa
    yoki commit bo'lsa, u "detached"/"expired" bo'lib qoladi va keyingi
    o'qishda `DetachedInstanceError` beradi. Keshda ORM emas, oddiy
    nusxa turishi kerak (2026-10-13).
    """
    out = []
    for x in rows:
        data = {name: getattr(x, name, None) for name in _LESSON_FIELDS}
        extra = getattr(x, "merged_groups", None)
        if extra is not None:
            data["merged_groups"] = extra
        out.append(SimpleNamespace(**data))
    return out


def _substitutions(db: Session, start_day: dt.date, end_day: dt.date) -> dict:
    """Tasdiqlangan ta'til/kasallik arizasida "o'rnimga kim o'tyapti" belgilangan kunlar (2026-11-19); xatoda — bo'sh."""
    try:
        from app.services.staff_absence import substitutions

        return substitutions(db, start_day, end_day)
    except Exception:  # noqa: BLE001 — hisobot sababsiz yiqilmasin
        logging.getLogger(__name__).warning("absence substitutes load failed", exc_info=True)
        return {}


def _apply_substitutions(rows: list, subs: dict) -> None:
    """Asl o'qituvchining o'sha kunlardagi darsi o'rinbosar nomiga o'tadi: nazorat, hisobot va bot endi
    o'rinbosarni kuzatadi; asl o'qituvchi bu darslar uchun qizil bo'lmaydi. `substitute_for` — kimning o'rniga."""
    for r in rows:
        sub = subs.get(r.teacher_username or "", {}).get(r.lesson_date)
        if not sub:
            continue
        r.substitute_for = r.teacher_username
        r.substitute_for_name = r.teacher_name
        r.teacher_username = sub["key"]
        r.teacher_name = sub.get("name") or sub["key"]
        if sub.get("employee_id"):
            r.employee_id = sub["employee_id"]


def _lessons(db: Session, start_day: dt.date, end_day: dt.date, *, department: str = "",
             teacher: str = "", groups: tuple[str, ...] = (),
             pending: bool = False, all_types: bool = False) -> list[HemisLesson]:
    """Davrdagi darslar. `pending=False` — faqat TUGAGANLARI (baholanadiganlari).

    `all_types=True` — ma'ruza va laboratoriya ham kerak bo'lgan joy uchun
    (dars jadvali bo'limi): u hisobot emas, jadvalning o'zini ko'rsatadi.
    """
    q = select(HemisLesson).where(HemisLesson.lesson_date >= start_day, HemisLesson.lesson_date <= end_day)
    subs = _substitutions(db, start_day, end_day)
    if teacher:
        # O'rinbosar sifatida o'tadigan darslari ham (asl o'qituvchi nomida yozilgan).
        replaced = [orig for orig, days in subs.items() if any(v.get("key") == teacher for v in days.values())]
        q = q.where(HemisLesson.teacher_username.in_([teacher, *replaced]))
    # HEMIS'dan olib tashlangan dars (yozuvi dalil uchun saqlanadi) — hisobotda
    # yo'q. Ilgari u sanalib, o'qituvchi HEMIS'da yo'q dars uchun ayblanardi:
    # 30 kunda 197 ta, masalan boshqa kafedraga o'tgan o'qituvchining eski
    # kafedradagi darsi (2026-10-21).
    rows = [r for r in db.execute(q).scalars() if getattr(r, "hemis_status", "") != "missing_from_hemis"]
    magistracy_groups(db)  # `is_counted` uchun kesh yangilanadi
    excluded = report_exclusion.load(db)
    if excluded:
        # Admin hisobotdan chiqargan kafedra va fanlar (Kafedralar bo'limi).
        rows = [r for r in rows if not excluded.lesson_excluded(r)]
    if groups:
        # Xalqaro fakultet dekani: faqat o'z guruhlariga o'tilgan darslar.
        rows = [r for r in rows if in_groups(r.group_name, groups)]
    if not all_types:
        rows = [r for r in rows if is_counted(r)]
    # Guruh qatorlari bitta darsga yig'iladi — hisobot darslarni sanaydi.
    rows = merge_group_rows(rows)
    if department:
        from app.services.dean_access import department_filter

        mine = department_filter(db, department)
        rows = [r for r in rows if mine(r.department_name)]
    rows = _plain(rows)
    if subs:
        _apply_substitutions(rows, subs)
        if teacher:
            rows = [r for r in rows if r.teacher_username == teacher]
    if not pending and end_day >= current_time().date():
        now = current_time()
        today = now.date()
        rows = [r for r in rows if r.lesson_date < today or is_over(r, now)]
    return rows


def _scheduled(lesson: HemisLesson) -> tuple[dt.datetime, dt.datetime]:
    """Darsning JADVALDAGI vaqti — oldin/keyin qo'shilgan muhlatsiz.

    Qoplama aynan dars vaqtida o'lchanadi: darsdan 15 daqiqa oldin ishlagani
    qoplama bermasligi kerak.
    """
    start, end = _window(lesson)
    return start + BEFORE, end - AFTER


def _covered(moments: list[dt.datetime], start: dt.datetime, end: dt.datetime) -> tuple[int, int]:
    """(qoplangan bo'lak, jami bo'lak) — dars necha bo'lagida qayd bor."""
    total = max(1, int((end - start) / COVER_BUCKET))
    if not moments:
        return 0, total
    covered = 0
    edge = start
    first = bisect_left(moments, start)
    for i in range(total):
        nxt = edge + COVER_BUCKET
        j = bisect_left(moments, nxt, first)
        if j > first:
            covered += 1
            first = j
        edge = nxt
    return covered, total


#: Dars o'tilganini TALABALAR tomonidan tasdiqlash uchun kerak bo'lgan
#: eng kam faol talaba soni. Bitta talaba telefonida ochib qo'ygan bo'lishi
#: mumkin; guruhning uchdan ko'pi aynan o'sha slotda iMentor'da ishlagan
#: bo'lsa — dars iMentor'da o'tilgan.
MIN_ACTIVE_STUDENTS = 3


def _student_rows(db: Session, groups: list[str], lo: dt.datetime,
                  hi: dt.datetime) -> list[tuple]:
    """Talaba faolligi: (guruh, hisob, vaqt). Alohida funksiya — testda almashtirish uchun."""
    return db.execute(text(
        "select c.group_name, e.owner_key, e.occurred_at "
        "from core_useractivityevent e "
        "join core_studentcontingent c "
        "  on c.student_id = regexp_replace(e.owner_key, '^ot_', '') "
        "where e.role = 'student' and e.occurred_at >= :lo and e.occurred_at < :hi "
        "  and c.group_name = any(:groups)"
    ), {"lo": lo, "hi": hi, "groups": groups}).all()


def _student_proof(db: Session, lessons: list[HemisLesson]) -> set[int]:
    """Guruh TALABALARI dars vaqtida iMentor'da ishlagan darslar.

    Nega kerak: o'qituvchi hisobida qayd bo'lmasligi mumkin (doskadagi
    brauzer boshqa hisobda, yoki u o'z telefonidan kirmagan), lekin guruh
    talabalari aynan o'sha slotda iMentor'da ishlayotgan bo'lsa — dars
    iMentor'da o'tilgani shubhasiz. 2026-10-09 kuni shunday 14 dars bor
    edi: masalan 13 talabadan 10 tasi faol, o'qituvchida 0 daqiqa.
    """
    wanted: dict[str, list[HemisLesson]] = defaultdict(list)
    for lesson in lessons:
        names = getattr(lesson, "merged_groups", None)
        if not names:
            one = getattr(lesson, "group_name", "")
            names = [one] if one else []
        for group in names:
            if group:
                wanted[group].append(lesson)
    if not wanted:
        return set()
    days = [x.lesson_date for x in lessons]
    lo = dt.datetime.combine(min(days), dt.time(0, 0), tzinfo=ms.TASHKENT)
    hi = dt.datetime.combine(max(days) + dt.timedelta(days=1), dt.time(0, 0), tzinfo=ms.TASHKENT)
    rows = _student_rows(db, list(wanted), lo, hi)
    seen: dict[str, list[tuple[dt.datetime, str]]] = defaultdict(list)
    for group, owner, when in rows:
        if when.tzinfo is None:
            when = when.replace(tzinfo=dt.timezone.utc)
        seen[group].append((when, str(owner)))
    for values in seen.values():
        values.sort()

    out: set[int] = set()
    for group, group_lessons in wanted.items():
        values = seen.get(group)
        if not values:
            continue
        times = [w for w, _ in values]
        for lesson in group_lessons:
            if lesson.id in out:
                continue
            start, end = _scheduled(lesson)
            a = bisect_left(times, start)
            b = bisect_right(times, end)
            if len({owner for _, owner in values[a:b]}) >= MIN_ACTIVE_STUDENTS:
                out.add(lesson.id)
    return out


#: Bir mavzu ketma-ket paralarda (2026-10-21): orasidagi tanaffus shundan
#: oshmasa, paralar bitta dars sifatida baholanadi.
#:
#: Rektorat qarori (2026-11-03): bir guruhga bir kunda bitta fandan ketma-ket
#: 3 para bo'lsa va ulardan bittasida iMentor 40 daqiqadan ortiq ishlatilsa —
#: uchala para ham "yashil". Jadvalda 3- va 4-para orasida tushlik 40 daqiqa
#: (12:20–13:00), qolgan tanaffuslar 10 daqiqa. Ilgari chegara 30 daqiqa edi
#: va tushlikdan o'tgan uch para (2-3-4, 3-4-5) ikki blokka bo'linib qolardi
#: (26.10–01.11 da 35 ta shunday ulanish). Bitta para o'tkazib yuborilsa
#: (100+ daqiqa) — bu endi ketma-ket emas.
BLOCK_GAP = dt.timedelta(minutes=int(os.environ.get("IMENTOR_BLOCK_GAP_MINUTES") or 45))


#: TO'G'RI FOYDALANISH (2026-11-19, foydalanuvchi): 40 daqiqa ishlash yetmaydi — dars vaqtida TEST HAM, KEYS HAM
#: yaratilgan va har biriga kamida 10 daqiqa sarflangan bo'lsin. Aks holda dars yashil emas, SARIQ
#: «noto'g'ri foydalangan» (verdict `misuse`). Sikl (bir guruh, bir fan, ketma-ket paralar — `lesson_blocks`)
#: butunligicha tekshiriladi: 1–2-parada yaratmay 3-parada yaratsa ham hammasi yashil. Boshqa darsda — har para o'zi.
#: 7 kunlik o'lchov (12–18.11): 1086 yashil darsdan test+keys 371 tasida, ikkalasiga 10+ daqiqa — ~158 tasida.
MIN_TEST_MINUTES = int(os.environ.get("IMENTOR_MIN_TEST_MINUTES") or 10)
MIN_CASE_MINUTES = int(os.environ.get("IMENTOR_MIN_CASE_MINUTES") or 10)
#: Test bo'limi: yaratish (`tests`) va jonli testni o'tkazish (`my-tests`); keys — `cases`.
TEST_PAGES = ("tests", "my-tests")
CASE_PAGES = ("cases",)


def _module_raw(db: Session, lessons: list) -> dict[int, dict] | None:
    """Har dars oynasida (qo'shni para bilan qirqilgan): test/keys yaratildimi va sahifalarida necha soniya.

    Test — yangi test (`core_preparedcontent.kind='test'`) yoki jonli test ochilgani; keys — `kind='case'`.
    """
    from app.models.live_test import LiveTestSession
    from app.models.prepared_content import PreparedContent

    mine = [x for x in lessons if x.teacher_username]
    if not mine:
        return {}
    windows = clipped_windows(mine)
    owners = sorted({x.teacher_username for x in mine})
    lo = min(a for a, _ in windows.values())
    hi = max(b for _, b in windows.values())
    made: dict[str, list] = defaultdict(list)
    for owner, kind, when in db.execute(
            select(PreparedContent.owner_key, PreparedContent.kind, PreparedContent.created_at)
            .where(PreparedContent.owner_key.in_(owners), PreparedContent.kind.in_(("test", "case")),
                   PreparedContent.created_at >= lo, PreparedContent.created_at < hi)).all():
        made[owner].append((when, kind))
    for owner, when in db.execute(
            select(LiveTestSession.owner_key, LiveTestSession.created_at)
            .where(LiveTestSession.owner_key.in_(owners),
                   LiveTestSession.created_at >= lo, LiveTestSession.created_at < hi)).all():
        made[owner].append((when, "test"))
    # Keysdan FOYDALANILGANI (2026-11-19, "sahifada turishi emas, foydalanishi muhim"): savol javobi talabalarga
    # ochilgan — oldindan tayyorlangan keys ham hisobga kiradi. Faqat sahifada turish hisoblanmaydi.
    for owner, when in db.execute(text(
            "select owner_key, occurred_at from core_useractivityevent where owner_key = any(:o) "
            "and occurred_at >= :lo and occurred_at < :hi and event_type = 'content_view' "
            "and meta->>'kind' = 'case' and meta->>'action' = 'reveal'"),
            {"o": owners, "lo": lo, "hi": hi}).all():
        made[owner].append((when, "case_used"))
    ids = [x.id for x in mine]
    secs: dict[int, tuple[int, int]] = {}
    # Sahifa vaqti — har dars oynasi uchun SQL'da yig'iladi (heartbeat qatorlari ko'p, Python'ga olinmaydi).
    for lid, t_sec, c_sec in db.execute(text("""
        with w as (select * from unnest(cast(:ids as integer[]), cast(:owners as text[]),
                                        cast(:los as timestamptz[]), cast(:his as timestamptz[])) as t(id, owner, lo, hi))
        select w.id,
               coalesce(sum(e.duration_sec) filter (where e.meta->>'page' = any(:tp)), 0),
               coalesce(sum(e.duration_sec) filter (where e.meta->>'page' = any(:cp)), 0)
          from w join core_useractivityevent e
            on e.owner_key = w.owner and e.occurred_at >= w.lo and e.occurred_at < w.hi
         where e.event_type = 'heartbeat'
         group by w.id"""), {
            "ids": ids, "owners": [x.teacher_username for x in mine],
            "los": [windows[x.id][0] for x in mine], "his": [windows[x.id][1] for x in mine],
            "tp": list(TEST_PAGES), "cp": list(CASE_PAGES)}).all():
        secs[int(lid)] = (int(t_sec or 0), int(c_sec or 0))
    out: dict[int, dict] = {}
    for x in mine:
        a, b = windows[x.id]
        kinds = {k for when, k in made.get(x.teacher_username, ()) if a <= _aware_utc(when) < b}
        t_sec, c_sec = secs.get(x.id, (0, 0))
        out[x.id] = {"test": "test" in kinds, "case": "case" in kinds or "case_used" in kinds,
                     "case_used": "case_used" in kinds and "case" not in kinds, "test_sec": t_sec, "case_sec": c_sec}
    return out


def _aware_utc(when: dt.datetime) -> dt.datetime:
    return when if when.tzinfo is not None else when.replace(tzinfo=dt.timezone.utc)


def _attach_modules(lessons: list, raw: dict[int, dict], mods: dict[int, dict], schedule: list | None = None) -> None:
    """`raw[id]["modules"]` — shu dars (sikl bo'lsa — butun sikl) bo'yicha test/keys holati.

    `schedule` — o'sha kunlarning hali tugamagan darslari ham (2026-11-19): sikl davom etayotgan bo'lsa
    (keyingi parasi hali o'tilmagan) test/keys hali talab qilinmaydi — `open`, sikl oxirida baholanadi.
    Aks holda 2-parada keys yo'q dars sariq bo'lib, 4-parada yaratilgach yashilga o'tardi."""
    blank = {"test": False, "case": False, "test_sec": 0, "case_sec": 0}
    for x in lessons:
        if x.id in raw:
            raw[x.id]["modules"] = {**blank, **(mods.get(x.id) or {}), "cycle": 0}
    measured = {x.id for x in lessons}
    extra = [x for x in (schedule or []) if x.id not in measured]
    for chain in lesson_blocks([*lessons, *extra]):
        if len(chain) < 2:
            continue
        rows = [mods.get(x.id) or blank for x in chain]
        total = {"test": any(r["test"] for r in rows), "case": any(r["case"] for r in rows),
                 "test_sec": sum(r["test_sec"] for r in rows), "case_sec": sum(r["case_sec"] for r in rows),
                 "cycle": len(chain), "open": any(x.id not in measured for x in chain)}
        for x in chain:
            if x.id in raw:
                raw[x.id]["modules"] = dict(total)


def module_gaps(m: dict | None) -> list[str]:
    """Nima yetishmaydi: "test" / "case" (yaratilmagan), "test_time" / "case_time" (10 daqiqadan kam).
    `modules` yo'q bo'lsa (o'lchanmagan) — bo'sh."""
    md = (m or {}).get("modules")
    if not md or md.get("open"):
        return []
    out = []
    if not md.get("test"):
        out.append("test")
    elif int(md.get("test_sec") or 0) < MIN_TEST_MINUTES * 60:
        out.append("test_time")
    if not md.get("case"):
        out.append("case")
    elif int(md.get("case_sec") or 0) < MIN_CASE_MINUTES * 60:
        out.append("case_time")
    return out


def modules_ok(m: dict | None) -> bool:
    return not module_gaps(m)


def module_info(m: dict | None) -> dict | None:
    """Sahifa uchun: test/keys yaratildimi, necha daqiqa, sikl, nima yetishmaydi."""
    md = (m or {}).get("modules")
    if not md:
        return None
    return {"test": bool(md.get("test")), "case": bool(md.get("case")),
            "test_minutes": int(md.get("test_sec") or 0) // 60, "case_minutes": int(md.get("case_sec") or 0) // 60,
            "cycle": int(md.get("cycle") or 0), "gaps": module_gaps(m), "open": bool(md.get("open")),
            "need_test": MIN_TEST_MINUTES, "need_case": MIN_CASE_MINUTES}


def lesson_blocks(lessons: list) -> list[list]:
    """Bir o'qituvchining bir kunda, o'sha guruh(lar)ga, o'sha fandan ketma-ket
    paralari — bitta dars.

    Shikoyat (2026-10-21): bir mavzu 2–3 para davom etadi, test esa oxirgi
    parada o'tkaziladi. Har para alohida baholanib, "faqat bitta parasini
    o'tdi" chiqardi. 12–18 oktabrda baholangan amaliy darslarning 62% i
    shunday blokda edi (masalan 13:00–17:20, OHI 1324, uch para).
    """
    groups: dict[tuple, list] = defaultdict(list)
    for x in lessons:
        merged = getattr(x, "merged_groups", None)
        names = merged if merged is not None else (getattr(x, "group_name", "") or "",)
        if not any(names):
            continue  # guruhi noma'lum dars boshqasiga ulanmaydi
        key = (x.teacher_username or f"name:{getattr(x, 'teacher_name', '')}", x.lesson_date, tuple(names),
               " ".join((getattr(x, "subject_name", "") or "").lower().split()))
        groups[key].append(x)
    out: list[list] = []
    for rows in groups.values():
        rows.sort(key=lambda r: _scheduled(r)[0])
        chain = [rows[0]]
        for prev, nxt in zip(rows, rows[1:]):
            if _scheduled(nxt)[0] - _scheduled(prev)[1] <= BLOCK_GAP:
                chain.append(nxt)
            else:
                out.append(chain)
                chain = [nxt]
        out.append(chain)
    return out


def _apply_blocks(lessons: list, raw: dict[int, dict]) -> None:
    """Blok o'tilgan bo'lsa — uning har bir parasi o'tilgan.

    Blok BUTUNLIGICHA baholanadi: soniyalar, talabalar va qoplama qo'shiladi
    va oddiy darsdagi qoida (`is_taught`) qo'llanadi. Masalan uch para:
    16, 25 va 37 daqiqa + 11 talaba testda — hammasi o'tilgan. Bir para
    o'zi o'tilgan bo'lsa ham blok o'tilgan (u yerda test o'tkazilgan).
    """
    for chain in lesson_blocks(lessons):
        if len(chain) < 2:
            continue
        rows = [raw.get(x.id) for x in chain]
        total = {
            "seconds": sum(r["seconds"] for r in rows if r),
            "students": sum(r["students"] for r in rows if r),
            "signin": any(r.get("signin") for r in rows if r),
            "covered": sum(r["covered"] for r in rows if r),
            "buckets": sum(r["buckets"] for r in rows if r),
            "student_proof": any(r.get("student_proof") for r in rows if r),
        }
        if not (any(r and time_taught(r) for r in rows) or time_taught(total)):
            continue
        for x, r in zip(chain, rows):
            if r is not None and time_taught(r):
                continue
            row = raw.setdefault(x.id, {"seconds": 0, "students": 0, "signin": False,
                                        "covered": 0, "buckets": 0})
            row["block_proof"] = True
            row["block_size"] = len(chain)


def measure_map(db: Session, lessons: list[HemisLesson], *, schedule: list | None = None) -> dict[int, dict]:
    """Har dars uchun XOM o'lchovlar: soniya, talaba, qoplama, dalil.

    Qaror `is_taught` da — shunda o'lchov va qaror bir-biridan ajralgan
    bo'ladi va hisobot "nega" degan savolga javob berolsin.
    """
    raw = _work_map_raw(db, lessons)
    undecided = [x for x in lessons
                 if x.id not in raw or not time_taught(raw[x.id])]
    for lesson_id in _student_proof(db, undecided):
        row = raw.setdefault(lesson_id, {"seconds": 0, "students": 0, "signin": False,
                                         "covered": 0, "buckets": 0})
        row["student_proof"] = True
    _apply_blocks(lessons, raw)
    # Test va keys (2026-11-19): har qayd bor dars uchun — qaror faqat vaqt bo'yicha o'tilganlarda (`is_taught`),
    # lekin rektor kartasida "kirib chiqqan" darsda ham test/keys yaratilgani ko'rinadi.
    if raw:
        # Sikl butunligicha: o'tilgan darsning sikldagi qo'shnilari ham o'lchanadi.
        chained = {x.id for c in lesson_blocks(lessons) if any(y.id in raw for y in c) for x in c}
        mods = _module_raw(db, [x for x in lessons if x.id in chained or x.id in raw])
        if mods is not None:
            _attach_modules(lessons, raw, mods, schedule)
    return raw


def work_map(db: Session, lessons: list[HemisLesson]) -> dict[int, tuple[int, int]]:
    """Eski shakl: (ishlangan soniya, talaba soni)."""
    return {k: (m["seconds"], m["students"]) for k, m in measure_map(db, lessons).items()}


def is_taught(m: dict) -> bool:
    """Dars YASHIL: vaqt qoidasi (`time_taught`) VA test+keys qoidasi (`modules_ok`, 2026-11-19).
    `modules` o'lchanmagan bo'lsa (soxta o'lchov, testlar) — faqat vaqt."""
    return time_taught(m) and modules_ok(m)


def time_taught(m: dict) -> bool:
    """Dars vaqtida iMentor'da yetarli ishlanganmi (xona/monitor ishlashi isboti ham shu).

    Uch yo'ldan biri yetarli:
      1. aniq dalil — dars vaqtida jonli test ochilgan yoki xona
         kompyuteriga QR bilan kirilgan;
      2. sof ish vaqti chegaradan o'tgan;
      3. dars bo'laklarining kamida 60% ida qayd bor va sof ish kamida
         15 daqiqa — ma'ruza shunday ko'rinadi.
    """
    # O'qituvchining O'Z jonli testiga talabalar javob bergan — shartsiz dalil.
    if m.get("students"):
        return True
    # Faqat GURUH talabalari faol bo'lgani (`student_proof`) — o'zi yetarli EMAS (2026-11-17, rektorat):
    # o'qituvchi hisobida 0 daqiqa bo'lsa ham dars yashil "o'tilgan" bo'lib chiqardi, ichida hech narsa
    # yo'q edi — talabalar boshqa o'qituvchining testini yoki o'zlari ishlagan bo'lishi mumkin. Endi
    # bunday dars "chala" (`lesson_verdict` → "group").
    # Ketma-ket paralik darsning bir qismi, blok esa o'tilgan (`_apply_blocks`).
    if m.get("block_proof"):
        return True
    # XONA KOMPYUTERIGA QR bilan kirish yoki hech kim javob bermagan jonli
    # test O'ZI yetarli EMAS: u o'qituvchi xonada bo'lganini ko'rsatadi,
    # darsni iMentor'da o'tganini emas. 2026-10-09 da shu teshik sababli
    # 36 dars "to'liq o'tilgan" bo'lib chiqqandi — biri 0 daqiqa, beshtasi
    # 1 daqiqa ishlab. Bu rektor shikoyat qilgan "kirib chiqib ishlatyapman
    # deyish" ning aynan o'zi, shuning uchun qaror ishga qaraydi.
    if m["seconds"] >= MIN_LESSON_MINUTES * 60:
        return True
    return bool(m["buckets"] and m["covered"] / m["buckets"] >= MIN_COVER
                and m["seconds"] >= MIN_COVER_MINUTES * 60)


def _work_map_raw(db: Session, lessons: list[HemisLesson]) -> dict[int, dict]:
    usernames = {x.teacher_username for x in lessons if x.teacher_username}
    if not usernames or not lessons:
        return {}
    days = [x.lesson_date for x in lessons]
    lo_day = dt.datetime.combine(min(days), dt.time(0, 0), tzinfo=ms.TASHKENT)
    hi_day = dt.datetime.combine(max(days) + dt.timedelta(days=1), dt.time(0, 0), tzinfo=ms.TASHKENT)
    spans = {k: _merge_spans(v) for k, v in ms._work_spans(db, usernames, lo_day, hi_day).items()}
    span_ends = {k: [b for _, b in v] for k, v in spans.items()}
    events = ms._usage_events(db, usernames, lo_day, hi_day)
    beats = ms._activity_moments(db, usernames, lo_day, hi_day)

    ordered = {k: sorted(v) for k, v in events.items() if v}
    moments = {k: [w for w, _ in v] for k, v in ordered.items()}

    out: dict[int, dict] = {}
    windows = clipped_windows(lessons)
    for lesson in lessons:
        owner = lesson.teacher_username or ""
        if not owner:
            continue
        start, end = windows.get(lesson.id) or _window(lesson)
        seconds = _worked_seconds(spans.get(owner, []), span_ends.get(owner, []), start, end)
        students = 0
        signin = False
        rows = ordered.get(owner)
        if rows:
            times = moments[owner]
            a = bisect_left(times, start)
            b = bisect_right(times, end)
            if b > a:
                students = sum(count for _, count in rows[a:b])
                # Talaba soni yo'q qayd — xona kompyuteriga QR bilan kirish
                # yoki hech kim javob bermagan jonli test. Dalil sifatida
                # ko'rsatiladi, lekin o'zi darsni "o'tilgan" qilmaydi.
                signin = students == 0
        lo, hi = _scheduled(lesson)
        covered, buckets = _covered(beats.get(owner, []), lo, hi)
        if seconds or students or signin or covered:
            out[lesson.id] = {"seconds": seconds, "students": students, "signin": signin,
                              "covered": covered, "buckets": buckets}
    return out


def _used_map(db: Session, lessons: list[HemisLesson]) -> dict[int, tuple[bool, int]]:
    """Har dars uchun (ishlatildimi, talaba soni).

    "Ishlatildi" — dars vaqtida kamida `MIN_LESSON_MINUTES` daqiqa ishlangan.
    Qisqa kirib chiqish hisoblanmaydi: maqsad darsni iMentor'da O'TISH.
    """
    return {k: (True, m["students"]) for k, m in measure_map(db, lessons).items()
            if is_taught(m)}


def lesson_verdict(m: dict, *, waiting: bool = False) -> str:
    """Bitta dars qanday baholangani — sahifa sababni so'z bilan aytishi uchun.

    full — o'zi o'tilgan (daqiqa yoki qoplama); students — talabalar jonli testda ishlagan;
    block — ketma-ket paralarning boshqasida o'tilgan; short — kirgan, lekin yetmagan;
    none — dars vaqtida hech qanday ish yo'q; pending — dars hali tugamagan.
    """
    if waiting:
        return "pending"
    if not m:
        return "none"
    own = {"seconds": 0, "students": 0, "covered": 0, "buckets": 0,
           **{k: v for k, v in m.items() if k not in ("block_proof", "modules")}}
    if m.get("students") or time_taught(own) or m.get("block_proof"):
        # Vaqt yetarli, lekin test/keys yo'q yoki ularga kam vaqt — sariq «noto'g'ri foydalangan» (2026-11-19).
        if not modules_ok(m):
            return "misuse"
    if m.get("students"):
        return "students"
    if time_taught(own):
        return "full"
    if m.get("block_proof"):
        return "block"
    if m.get("seconds") or m.get("covered") or m.get("signin"):
        return "short"
    # O'qituvchi o'zi kirmagan, lekin guruh talabalari dars vaqtida iMentor'da ishlagan — chala (2026-11-17).
    return "group" if m.get("student_proof") else "none"


def group_only(m: dict | None) -> bool:
    """Dars faqat guruh talabalarining faolligi bilan ko'ringan (o'qituvchida qayd yo'q) — "chala"."""
    return bool(m) and bool(m.get("student_proof")) and not time_taught(m)


def _lesson_topics(db: Session, lessons: list) -> dict[int, list[str]]:
    """Har dars oynasida (−15/+5 daq) o'qituvchi ochgan jonli test mavzulari."""
    from app.models.live_test import LiveTestSession

    owners = {x.teacher_username for x in lessons if x.teacher_username}
    if not owners or not lessons:
        return {}
    windows = {x.id: _window(x) for x in lessons if x.teacher_username}
    lo = min(a for a, _ in windows.values())
    hi = max(b for _, b in windows.values())
    rows = db.execute(
        select(LiveTestSession.owner_key, LiveTestSession.created_at, LiveTestSession.payload)
        .where(LiveTestSession.owner_key.in_(owners),
               LiveTestSession.created_at >= lo, LiveTestSession.created_at < hi)
    ).all()
    by_owner: dict[str, list] = defaultdict(list)
    for owner, created, payload in rows:
        topic = str((payload or {}).get("topic") or "").strip()
        if topic:
            by_owner[owner].append((created, topic))
    out: dict[int, list[str]] = {}
    for x in lessons:
        if x.id not in windows:
            continue
        a, b = windows[x.id]
        found = [t for when, t in sorted(by_owner.get(x.teacher_username, [])) if a <= when <= b]
        if found:
            out[x.id] = list(dict.fromkeys(found))[:3]
    return out


def lesson_rows(db: Session, start_day: dt.date, end_day: dt.date, *, teacher: str = "",
                groups: tuple[str, ...] = (),
                department: str = "", only_missed: bool = False, limit: int = 2000,
                measured: tuple[set, dict] | None = None) -> list[dict]:
    """Darslar ro'yxati — kim, qachon, qaysi fan, ishlatildimi.

    `measured` — (dars id'lari, `measure_map` natijasi): chaqiruvchi o'sha baholanadigan darslarni
    allaqachon o'lchagan bo'lsa, qayta o'lchanmaydi (o'qituvchi oynasi, 2026-11-16: ~1 s tejaladi).
    """
    # Tugamagan darslar ham ko'rsatiladi, lekin belgi bilan — ular hali baholanmaydi.
    # Ma'ruza va laboratoriya ham KO'RINADI (jadvalning o'zi shunday), lekin
    # `counted: false` bilan: ular foizga kirmaydi (2026-10-12).
    lessons = _lessons(db, start_day, end_day, department=department, teacher=teacher, groups=groups,
                       pending=True, all_types=True)
    now = current_time()
    # Sanaladigan va tugagan darslar xulosadagidek ALOHIDA o'lchanadi (2026-10-23): ilgari ma'ruza
    # yoki hali tugamagan para ham ketma-ket bloklarga qo'shilib, uning dalili amaliy darsga o'tardi —
    # ro'yxat "ishlatgan" desa, xulosa o'sha darsni ishlatilmagan deb sanardi.
    scored = [x for x in lessons if is_counted(x) and is_over(x, now)]
    scored_ids = {x.id for x in scored}
    # Xom o'lchov ham kerak: rektor har darsda NECHA DAQIQA ishlangani va nega
    # "o'tilmagan" ekanini ko'rishi uchun (2026-11-14). Qaror o'sha `is_taught`.
    if measured is not None and measured[0] == scored_ids:
        scored_raw = measured[1]
    else:
        scored_raw = measure_map(db, scored, schedule=[x for x in lessons if is_counted(x)])
    raw = {**measure_map(db, [x for x in lessons if x.id not in scored_ids]), **scored_raw}
    used = {k: (True, m["students"]) for k, m in raw.items() if is_taught(m)}
    topics = _lesson_topics(db, lessons)
    lessons.sort(key=lambda x: (x.lesson_date, x.para, x.teacher_name))
    out = []
    for lesson in lessons:
        hit = used.get(lesson.id)
        m = raw.get(lesson.id) or {}
        waiting = not is_over(lesson, now)
        counted = is_counted(lesson)
        if only_missed and (hit or waiting or not counted):
            continue
        out.append({
            "id": lesson.id,
            "date": lesson.lesson_date.isoformat(),
            "weekday": lesson.weekday,
            "para": lesson.para,
            "start_time": lesson.start_time,
            "end_time": lesson.end_time,
            "teacher_name": lesson.teacher_name,
            "teacher_key": lesson.teacher_username,
            "department": lesson.department_name,
            "subject": lesson.subject_name,
            "group": ", ".join(lesson_groups(lesson)),
            "lesson_type": lesson.lesson_type,
            "room": lesson.auditorium_name,
            "building": lesson.building_name,
            # Faqat haqiqiy monitorli xona (2026-11-16): monitorsiz xonadagi dars nazoratga kirmaydi.
            "monitor_id": lesson.monitor_id or "",
            "used": bool(hit),
            # Ma'ruza/laboratoriya hisobotda baholanmaydi — sahifa shuni
            # belgilab qo'yadi, aks holda "o'tilmagan" bo'lib ko'rinardi.
            "counted": counted,
            # Dars hali tugamagan — "qayd yo'q" deb hukm qilinmaydi.
            "pending": waiting and not hit,
            "students": hit[1] if hit else 0,
            # Shu darsning o'zida iMentor'da sof ishlangan daqiqa (blokdagi boshqa paralar qo'shilmagan).
            "minutes": int(m.get("seconds", 0) or 0) // 60,
            "verdict": lesson_verdict(m, waiting=waiting and not hit),
            # Test/keys holati (2026-11-19): nima yaratilgan, necha daqiqa, nima yetishmaydi.
            "modules": module_info(m),
            "block_size": int(m.get("block_size", 0) or 0),
            # Dars vaqtida ochilgan jonli test mavzusi — HEMIS jadvalida mavzu yo'q.
            "topics": topics.get(lesson.id, []),
            # Dalil: bu qator qaysi HEMIS yozuvidan va qaysi inventar xonasidan
            # kelgani — «menda dars yo'q edi», «xonada monitor yo'q» degan
            # gaplarni shu yerda tekshirish mumkin.
            "hemis_id": lesson.hemis_id,
            "auditorium_code": getattr(lesson, "auditorium_code", ""),
            "monitor_room": getattr(lesson, "monitor_room", ""),
            "monitor_department": getattr(lesson, "monitor_department", ""),
            "synced_at": (lambda t: t.isoformat() if t else None)(getattr(lesson, "synced_at", None)),
            "hemis_status": getattr(lesson, "hemis_status", "active"),
            "hemis_missing_at": (lambda t: t.isoformat() if t else None)(getattr(lesson, "hemis_missing_at", None)),
        })
        if len(out) >= limit:
            break
    return out


#: Xona "o'lik" deb belgilanishi uchun shart: shu muddatda hech bir dars
#: iMentor'da o'tilmagan, lekin dars ham, o'qituvchi ham yetarlicha bo'lgan.
#: Bitta o'qituvchining ikki darsi yetmaydi — bu uning o'z ishi bo'lishi
#: mumkin; to'rt o'qituvchi 18 darsda ham ochmagan bo'lsa, muammo xonada.
#: 7 kun: 14 kun bilan natija bir xil chiqdi (2026-10-09 da ikkisi ham
#: bitta xona topdi), lekin o'lchov ikki barobar arzon (5,1s / 8,6s) va
#: yaqinda tuzatilgan doska "o'lik" bo'lib qolmaydi.
DEAD_ROOM_DAYS = 7
DEAD_ROOM_LESSONS = 8
DEAD_ROOM_TEACHERS = 3

#: Natija 30 daqiqa saqlanadi: 14 kunlik o'lchov og'ir, sahifa esa har
#: daqiqada qayta so'raydi.
_DEAD_TTL = 30 * 60
_dead_cache: dict[tuple, tuple[float, dict]] = {}


def dead_room_details(db: Session, end_day: dt.date, *,
                      back_days: int = DEAD_ROOM_DAYS) -> dict[str, dict]:
    """Doskasi ishlamayotgani KO'RINIB turgan xonalar — DALILI bilan.

    Bunday xonadagi dars uchun o'qituvchini ayblash mumkin emas: texnik
    muammo. 2026-10-09 da shunday 7 xona bor edi (eng og'iri: 22 darsda
    3 o'qituvchi, birortasi ham ochmagan).

    Dalil (nechta dars, nechta o'qituvchi, necha kun) QAYTARILADI va
    sahifada ko'rsatiladi. Bu shart: istisno ko'rinmasa, u sekin-asta
    foizni chiroyli ko'rsatadigan yashirin chiqarib tashlashga aylanadi —
    haqiqatan ishlayotgan, lekin hech kim ishlatmayotgan xona ham
    "buzuq" bo'lib o'lchovdan butunlay chiqib ketardi.
    """
    rooms = room_usage(db, end_day, back_days=back_days)
    return {
        monitor: {"monitor_id": monitor, "lessons": row["lessons"],
                  "teachers": len(row["teachers"]), "days": back_days}
        for monitor, row in rooms.items()
        if row["used"] == 0 and row["lessons"] >= DEAD_ROOM_LESSONS
        and len(row["teachers"]) >= DEAD_ROOM_TEACHERS
    }


def room_usage(db: Session, end_day: dt.date, *, back_days: int = DEAD_ROOM_DAYS) -> dict[str, dict]:
    """Har monitor: oxirgi `back_days` kundagi darslar, o'qituvchilar va iMentor bilan
    o'tilganlari. Og'ir o'lchov — 30 daqiqa saqlanadi (o'lik xonalar va qaydsiz
    o'qituvchi sababi bir natijadan foydalanadi)."""
    key = (end_day, back_days)
    hit = _dead_cache.get(key)
    now = time.monotonic()
    if hit and now - hit[0] < _DEAD_TTL:
        return hit[1]
    lessons = [x for x in _lessons(db, end_day - dt.timedelta(days=back_days - 1), end_day)
               if x.monitor_id]
    measures = measure_map(db, lessons)
    rooms: dict[str, dict] = defaultdict(lambda: {"lessons": 0, "teachers": set(), "used": 0})
    for x in lessons:
        row = rooms[x.monitor_id]
        row["lessons"] += 1
        row["teachers"].add(x.teacher_username or x.teacher_name)
        if x.id in measures and time_taught(measures[x.id]):
            row["used"] += 1
    out = dict(rooms)
    _dead_cache[key] = (now, out)
    for old in [k for k, (t, _) in list(_dead_cache.items()) if now - t >= _DEAD_TTL]:
        _dead_cache.pop(old, None)
    return out


def dead_rooms(db: Session, end_day: dt.date, *,
               back_days: int = DEAD_ROOM_DAYS) -> frozenset[str]:
    """Faqat ID lar — dalili `dead_room_details` da."""
    return frozenset(dead_room_details(db, end_day, back_days=back_days))
