"""Dars nazorati boti: iMentor'ga kirmagan o'qituvchilar haqida guruhga xabar (2026-11-15).

Rektor talabi:
* har para boshlanganidan **10 daqiqa** o'tib — guruhga QISQA ro'yxat: monitorli xonada darsi bor,
  iMentor hisobi bog'langan, lekin hali kirmagan o'qituvchilar (❌ fakultet → kafedra — F.I.Sh.);
* xabar ochiq turadi va JONLI yangilanadi: o'qituvchi kirsa — ✅ va necha daqiqa kech kirgani;
* **15 daqiqada** — yangi xabar, faqat hali kirmaganlar (✅ bo'lganlar boshqa chiqmaydi);
* ketma-ket paralar (bir guruh, bir fan, tanaffus ≤45 daq) BITTA dars: o'qituvchi birinchi parada
  kirgan bo'lsa, tanaffusdan keyin qizil chiqmaydi (`lesson_report_service.lesson_blocks`);
* kun oxirida — kunlik hisobot: umuman kirmaganlar, kech kirganlar (necha daqiqa).

Qo'shimcha (rektor aytmagan, lekin kerak):
* tasdiqlangan kasallik varaqasi / ta'til va HEMIS'dagi ta'til — ro'yxatga tushmaydi;
* dars vaqtida "boshqa joyda o'tyapman" deb rasm bilan qayd etgan — 📍 bilan, qizil emas;
* ma'ruza va laboratoriya, monitorsiz xona, hisobi bog'lanmagan o'qituvchi — nazoratda emas
  (rektor hisobotidagi qoida bilan bir xil: `lesson_report_service._lessons`);
* bir vaqtda bir nechta guruhga dars — bitta qator; 4 ta ishchi jarayondan faqat bittasi yuboradi
  (Postgres advisory lock), xabar bazada qayd etiladi — ikki marta ketmaydi;
* server kech ishga tushsa eski ogohlantirish yuborilmaydi (`STALE_AFTER`);
* guruh chat_id ni bot O'ZI aniqlaydi (getUpdates) — `LESSON_BOT_CHAT_ID` bilan ham berish mumkin;
  guruh superguruhga aylansa (migrate_to_chat_id) — yangisiga o'tadi.

"Kirdi" — o'qituvchining iMentor'dagi istalgan harakati (kirish, sahifa, faollik) yoki jonli test
ochgani, dars boshlanishidan 15 daqiqa oldindan dars oxirigacha. Hammasi bazadagi faktlardan.
Token faqat serverdagi `.env` da (`LESSON_BOT_TOKEN`); manzil xato matnlariga hech qachon yozilmaydi.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import html
import json
import logging
import os
import random
import threading
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field

import requests
from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models.lesson_bot import LessonBotPost, LessonBotSetting
from app.services import dean_access
from app.services import lesson_report_service as lr
from app.services import monitor_schedule_service as ms

log = logging.getLogger("app.lesson_bot")

TZ = ms.TASHKENT
LOCK_KEY = 7_211_115
#: Tugma va izohlarni tinglovchi (getUpdates) — bir vaqtda faqat BITTA jarayonda (aks holda Telegram 409).
POLL_LOCK_KEY = 7_211_116
INTERVAL_SECONDS = 30
#: Ogohlantirishlar: dars boshlanganidan necha daqiqa o'tib.
FIRST_ALERT = 10
SECOND_ALERT = 15
#: Server kech ishga tushsa, shundan eski ogohlantirish yuborilmaydi (daqiqa, dars boshidan).
STALE_AFTER = {"alert10": 25, "alert15": 35}
#: Dars boshlanishidan oldin ham iMentor ochilgan bo'lsa — kirgan hisoblanadi.
EARLY = dt.timedelta(minutes=15)
#: Kunlik hisobot: oxirgi dars tugagach shuncha daqiqadan keyin, lekin shu soatdan kech emas.
DAILY_DELAY = dt.timedelta(minutes=15)
DAILY_UNTIL = dt.time(22, 30)
MAX_TEXT = 3900

API = "https://api.telegram.org/bot{token}/{method}"


# ------------------------------------------------------------------ Telegram

class BotError(Exception):
    def __init__(self, code: int, description: str, migrate_to: int | None = None, retry_after: int | None = None):
        super().__init__(f"{code} {description}")
        self.code = code
        self.description = description
        self.migrate_to = migrate_to
        self.retry_after = retry_after


def bot_token() -> str:
    return (os.environ.get("LESSON_BOT_TOKEN") or "").strip()


def enabled() -> bool:
    return bool(bot_token()) and os.environ.get("LESSON_BOT_ENABLED", "1") != "0"


#: Telegram guruhga daqiqasiga ~20 xabardan ko'pini qabul qilmaydi (429). Har o'qituvchi alohida post bo'lgani
#: uchun (2026-11-18) bir parada 30 ta post ham bo'lishi mumkin — yuborish shu chegaradan oshmaydi.
SEND_PER_MINUTE = 18
_rate_lock = threading.Lock()
_sent_at: deque = deque()


def _throttle() -> None:
    with _rate_lock:
        now = time.monotonic()
        while _sent_at and now - _sent_at[0] > 60:
            _sent_at.popleft()
        if len(_sent_at) >= SEND_PER_MINUTE:
            time.sleep(max(0.0, 60.5 - (now - _sent_at[0])))
            _sent_at.popleft()
        _sent_at.append(time.monotonic())


def call(method: str, payload: dict | None = None, *, timeout: float = 20.0, _retry: bool = True):
    if method == "sendMessage":
        _throttle()
    try:
        return _call(method, payload, timeout=timeout)
    except BotError as exc:
        if exc.code == 429 and _retry and exc.retry_after and exc.retry_after <= 90:
            time.sleep(exc.retry_after + 1)
            return _call(method, payload, timeout=timeout)
        raise


def _call(method: str, payload: dict | None = None, *, timeout: float = 20.0):
    token = bot_token()
    if not token:
        raise BotError(0, "LESSON_BOT_TOKEN berilmagan")
    try:
        res = requests.post(API.format(token=token, method=method), json=payload or {}, timeout=timeout)
    except requests.RequestException as exc:
        raise BotError(0, type(exc).__name__) from None  # manzilda token bor — matnga qo'shilmaydi
    try:
        data = res.json()
    except ValueError:
        raise BotError(res.status_code, "javob JSON emas") from None
    if not data.get("ok"):
        params = data.get("parameters") or {}
        raise BotError(int(data.get("error_code") or res.status_code), str(data.get("description") or ""),
                       params.get("migrate_to_chat_id"), params.get("retry_after"))
    return data.get("result")


# ------------------------------------------------------------------ sozlamalar

def _get(db: Session, key: str) -> str:
    row = db.get(LessonBotSetting, key)
    return row.value if row else ""


def _set(db: Session, key: str, value: str) -> None:
    db.execute(insert(LessonBotSetting).values(key=key, value=value)
               .on_conflict_do_update(index_elements=["key"], set_={"value": value, "updated_at": dt.datetime.now(dt.timezone.utc)}))
    db.commit()


#: Kafedra bo'yicha mas'ul (2026-11-18, prorektor tasdiqlagan «iMentor'dan foydalanishni nazorat qiluvchi mas'ul
#: xodimlar» ro'yxati): {rasmiy kafedra nomi: {"name", "position", "phone"}}. Ism va telefonlar REPOGA yozilmaydi
#: (repo ochiq) — faqat bazada (`core_lessonbotsetting`, shu kalit). Ro'yxatda yo'q kafedra — umumiy «Dekanlar».
CONTACTS_KEY = "department_contacts"


def department_contacts(db: Session | None) -> dict[str, dict]:
    if db is None:
        return {}
    try:
        data = json.loads(_get(db, CONTACTS_KEY) or "{}")
    except (ValueError, TypeError, AttributeError):
        log.warning("lesson-bot: %s JSON emas", CONTACTS_KEY)
        return {}
    return {str(k): v for k, v in data.items() if isinstance(v, dict) and str(v.get("name") or "").strip()} \
        if isinstance(data, dict) else {}


def _contact_name(full: str) -> str:
    """"Rasulova Mohidil Tursunaliyevna" -> "Rasulova Mohidil" (familiya + ism)."""
    return " ".join((full or "").split()[:2])


def contacts_block(rows: list[dict], contacts: dict[str, dict] | None) -> str:
    """Ochmaganlar kafedralarining mas'ullari — bir kishi bir necha kafedraga mas'ul bo'lsa bitta qatorda.

    2026-11-18 (foydalanuvchi): "dekanlar telefon qilib aloqaga chiqing emas, aynan kimning kafedrasiga
    tegishli bo'lsa o'sha mas'ulning ismi chiqishi kerak". Mas'uli topilmagan kafedra — eski umumiy so'z."""
    by_person: dict[str, dict] = {}
    unknown = False
    for v in rows:
        dep = str(v.get("dep") or "")
        c = (contacts or {}).get(dep)
        if not c:
            unknown = True
            continue
        key = _contact_name(str(c.get("name") or ""))
        p = by_person.setdefault(key, {"position": str(c.get("position") or ""), "deps": []})
        if dep not in p["deps"]:
            p["deps"].append(dep)
    lines = []
    # Faqat ism (foydalanuvchi: "o'sha mas'ulning ismi chiqishi kerak"); lavozim va telefon bazada saqlanadi.
    for name, p in sorted(by_person.items()):
        lines.append(f"• <b>{_esc(name)}</b> — {_esc(', '.join(p['deps']))}")
    if not lines:
        return "📞 Dekanlar, iltimos, bog‘laning."
    out = "📞 Mas’ullar, iltimos, bog‘laning:\n" + "\n".join(lines)
    if unknown:
        out += "\n• Boshqa kafedralar — dekanlar"
    return out


def chat_id(db: Session) -> int | None:
    """Guruh: `.env` dagi `LESSON_BOT_CHAT_ID`, bo'lmasa bot o'zi topgan (getUpdates)."""
    env = (os.environ.get("LESSON_BOT_CHAT_ID") or "").strip()
    if env:
        try:
            return int(env)
        except ValueError:
            pass
    saved = _get(db, "chat_id")
    if saved:
        return int(saved)
    return discover_chat(db)


def discover_chat(db: Session) -> int | None:
    """Bot qo'shilgan guruhni yangilanishlardan topadi (admin bo'lgani afzal) va eslab qoladi."""
    try:
        offset = int(_get(db, "updates_offset") or 0)
        updates = call("getUpdates", {"offset": offset, "timeout": 0, "allowed_updates":
                                      ["message", "my_chat_member", "chat_member"]}) or []
    except BotError as exc:
        log.warning("lesson-bot: getUpdates o'tmadi: %s", exc.description)
        return None
    best: tuple[int, int] | None = None  # (ustuvorlik, chat_id)
    last = offset
    for u in updates:
        last = max(last, int(u.get("update_id", 0)) + 1)
        for k in ("my_chat_member", "message", "chat_member"):
            m = u.get(k) or {}
            chat = m.get("chat") or {}
            if chat.get("type") not in ("group", "supergroup"):
                continue
            status = ((m.get("new_chat_member") or {}).get("status")) if k == "my_chat_member" else ""
            if status in ("left", "kicked"):
                continue
            rank = 2 if status == "administrator" else 1
            if m.get("migrate_to_chat_id"):
                best = (3, int(m["migrate_to_chat_id"]))
            elif best is None or rank >= best[0]:
                best = (rank, int(chat["id"]))
    if last != offset:
        _set(db, "updates_offset", str(last))
    if best:
        _set(db, "chat_id", str(best[1]))
        log.info("lesson-bot: guruh aniqlandi")
        return best[1]
    return None


# ------------------------------------------------------------------ bugungi darslar

@dataclass
class Block:
    """Bir o'qituvchining bitta parasi (2026-11-19 dan ketma-ket paralar birlashtirilmaydi)."""
    teacher: str
    name: str
    department: str
    faculty: str
    para: str
    start: dt.datetime
    end: dt.datetime
    rooms: list[str] = field(default_factory=list)
    groups: list[str] = field(default_factory=list)
    lesson_ids: list[int] = field(default_factory=list)
    #: Blokning birinchi parasi ("3-para") — slot sarlavhasi uchun.
    first_para: str = ""
    #: Sikl: kirish shu vaqtdan (1-para boshi) qidiriladi; `start` — oxirgi para boshi (ogohlantirish vaqti).
    window_start: dt.datetime | None = None

    @property
    def slot(self) -> str:
        return self.start.strftime("%H:%M")


def _faculty_of() -> dict[str, str]:
    return {d["name"]: d["faculty"] for d in dean_access.OFFICIAL_DEPARTMENTS}


def _short_name(full: str) -> str:
    return " ".join((full or "").split()).strip()


def day_blocks(db: Session, day: dt.date) -> list[Block]:
    """Nazoratdagi darslar: baholanadigan tur, monitorli xona, bog'langan hisob; ta'til/kasallik yo'q."""
    from app.services import control_report_service as crs
    from app.services.hemis_staff import on_leave_logins

    lessons = [x for x in lr._lessons(db, day, day, pending=True) if x.monitor_id and x.teacher_username]
    absent = crs._absence_days(db, day, day)
    leave = on_leave_logins(db)
    lessons = [x for x in lessons
               if x.teacher_username not in leave and day not in (absent.get(x.teacher_username) or {})]
    # Sikl (2026-11-20, kafedralar: "1-para amaliy, keyingi 2 tasi bemor yonida — 3 parada ham iMentor'da ishlash
    # kerakmi?"): bir guruhga bir fandan ketma-ket paralarda bot faqat BIRINCHI parani kuzatadi. Hisobotda sikl
    # butunligicha baholanadi (`lr._apply_blocks`, test+keys qoidasi) — bitta parada to'liq ishlash yetadi.
    canon = dean_access.canonical_map(db)
    fac = _faculty_of()
    # HAR PARA ALOHIDA (2026-11-19, foydalanuvchi: "har bir para uchun alohida ma'lumot kerak — 1-para qancha kech
    # kirdi, chiqib ketdimi, 40 daqiqaga bordimi; keyingi paraga qo'shilib ketmasin"). Avval ketma-ket paralar bitta
    # blok edi: 2-paradagi «qaytdi (10:24)» 1-para (08:00) postiga yozilardi. Rektor hisobotidagi «o'tilgan» bahosi
    # (`lr.lesson_blocks`) bunga tegmaydi — bot faqat har paraning o'z holatini xabar qiladi.
    # SIKL (2026-11-20, foydalanuvchi): bir guruhga bir fandan ketma-ket paralar — kun bo'yi bitta mavzu, test/keys
    # istalgan parada. Sikl BITTA dars: kirish butun sikl davomida (1-para boshidan) qidiriladi, ogohlantirish esa
    # faqat OXIRGI para boshlangach (shu paytgacha hech qaysi parada ochilmagan bo'lsa) yuboriladi.
    out: list[Block] = []
    for chain in lr.lesson_blocks(lessons) + [[x] for x in lessons
                                              if not any(getattr(x, "merged_groups", None) or (x.group_name or "",))]:
        first, last = chain[0], chain[-1]
        s0, _ = lr._scheduled(first)
        s, e = lr._scheduled(last)
        dep = dean_access.canonical(first.department_name, canon) or (first.department_name or "—")
        para = first.para or "" if len(chain) == 1 else f"{(first.para or '').split('-')[0]}–{last.para or ''}"
        rooms = sorted({x.auditorium_name for x in chain if x.auditorium_name})
        out.append(Block(first.teacher_username, _short_name(first.teacher_name), dep, fac.get(dep, "Boshqa bo‘limlar"),
                         para, s, e, rooms, sorted({g for x in chain for g in lr.lesson_groups(x) if g}),
                         [x.id for x in chain], first.para or "", window_start=s0))
    return out


def activity_times(db: Session, owners: set[str], day: dt.date,
                   groups: set[str] | None = None) -> dict[str, list]:
    """Kirganlik dalillari — rektor hisoboti bilan BIR XIL manbalar (2026-11-15):

    * o'qituvchining iMentor'dagi har qanday harakati (`core_useractivityevent`);
    * u ochgan jonli test (`core_livetestsession`);
    * xona kompyuteriga QR bilan kirgani (`core_devicepairingsession`);
    * guruh TALABALARI dars vaqtida iMentor'da ishlagani (`lesson_report_service._student_rows`) —
      o'qituvchi hisobida qayd bo'lmasa ham dars iMentor'da o'tilgan (hisobot ham shuni sanaydi).

    Qaytaradi: {o'qituvchi: [vaqt...]} va {"grp:<guruh>": [(vaqt, talaba)...]}, tartiblangan.
    """
    out: dict[str, list] = defaultdict(list)
    lo = dt.datetime.combine(day, dt.time(0, 0), tzinfo=TZ)
    hi = lo + dt.timedelta(days=1)
    if owners:
        rows = db.execute(text("""
            select owner_key, occurred_at from core_useractivityevent
             where owner_key = any(:o) and occurred_at >= :lo and occurred_at < :hi
            union all
            select owner_key, created_at from core_livetestsession
             where owner_key = any(:o) and created_at >= :lo and created_at < :hi
            union all
            select owner_key, picked_up_at from core_devicepairingsession
             where owner_key = any(:o) and picked_up_at >= :lo and picked_up_at < :hi
        """), {"o": list(owners), "lo": lo, "hi": hi}).all()
        for owner, when in rows:
            out[owner].append(_aware(when))
    if groups:
        for group, owner, when in lr._student_rows(db, sorted(groups), lo, hi):
            out[f"grp:{group}"].append((_aware(when), str(owner)))
    # «iMentor ekranda ochiq» (2026-11-19): «chiqib ketdi» (`_evidence`) va «kirdi» (`entered_at`) tekshiruvlari uchun.
    from app.services import page_presence

    for owner, times in page_presence.times(set(owners or ()), day).items():
        out[f"pres:{owner}"] = times
    for v in out.values():
        v.sort()
    return out


def _aware(when: dt.datetime) -> dt.datetime:
    return when if when.tzinfo is not None else when.replace(tzinfo=dt.timezone.utc)


def entered_at(block: Block, acts: dict[str, list], until: dt.datetime) -> dt.datetime | None:
    """Darsga "kirgan" vaqt — eng erta dalil:

    * o'qituvchining birinchi harakati [boshlanish − 15 daq, min(tugash, hozir)] oralig'ida;
    * yoki guruh talabalaridan kamida `MIN_ACTIVE_STUDENTS` nafari dars vaqtida faol bo'lgan payt.
    """
    hi = min(block.end, until)
    found: dt.datetime | None = None
    # «Ekranda ochiq» belgisi ham (2026-11-19): har para alohida baholanadi, oldingi paradan beri ochiq turgan,
    # lekin tegilmagan sahifa keyingi parada «ochmadi» bo'lib chiqmasin.
    own = sorted([*acts.get(block.teacher, ()), *acts.get(f"pres:{block.teacher}", ())])
    lo = block.window_start or block.start
    for when in own:
        if when < lo - EARLY:
            continue
        if when <= hi:
            found = when
        break
    need = lr.MIN_ACTIVE_STUDENTS
    for group in block.groups:
        seen: set[str] = set()
        for when, owner in acts.get(f"grp:{group}", ()):
            if when < lo:
                continue
            if when > hi or (found is not None and when >= found):
                break
            seen.add(owner)
            if len(seen) >= need:
                found = when
                break
    return found


def offsite_reason(db: Session, day: dt.date) -> dict[str, dict[int, str]]:
    from app.services import control_report_service as crs

    return crs._offsite_marks(db, day, day)


# ------------------------------------------------------------------ xabar matni

def _esc(s: str) -> str:
    return html.escape(s or "", quote=False)


def _late(block: Block, when: dt.datetime) -> int:
    return max(0, int((when - block.start).total_seconds() // 60))


LINE = "━━━━━━━━━━━━━━━"
INDENT = "      "


def _paras(items: list[str]) -> str:
    """["1-para", "3-para", "4-para"] -> "1, 3, 4-para"; "1–3-para" o'z holicha."""
    nums = [str(x).replace("-para", "") for x in items if x]
    return (", ".join(nums) + "-para") if nums else ""


def _fac_short(faculty: str) -> str:
    return (faculty or "").replace(" fakulteti", " fak.").strip() or "—"


def _numbered(items: list[dict]) -> list[str]:
    """Raqamlangan ro'yxat (rektor tanlagan ko'rinish, 2026-11-15):

        1. <b>F.I.Sh.</b>
            Kafedra · Fakultet · qo'shimcha

    Fakultet, kafedra, ism bo'yicha tartiblangan — bir fakultet odamlari yonma-yon turadi.
    """
    rows = sorted(items, key=lambda v: (str(v.get("fac") or "").startswith("Boshqa"), v.get("fac") or "",
                                        v.get("dep") or "", v.get("name") or ""))
    out: list[str] = []
    for i, v in enumerate(rows, 1):
        meta = " · ".join(x for x in (_esc(v.get("dep") or ""), _esc(_fac_short(v.get("fac") or "")),
                                      v.get("extra") or "") if x)
        out.append(f"{i}. <b>{_esc(v.get('name') or '')}</b>\n{INDENT}{meta}")
    return out


def alert_text(kind: str, slot: str, para: str, total: int, state: dict, *, final: bool = False,
               contacts: dict[str, dict] | None = None) -> str:
    """Para xabari. 2026-11-16 (rektor: "xabarlar o'chib ketmoqda, o'chmasin; kim necha daqiqa kech qolgani ham"):
    ro'yxatdagi o'qituvchi iMentor'ni ochsa — O'CHMAYDI, «✅ N daqiqa kech» bo'lib pastga o'tadi; dars tugagach
    xabar «yakuni» bo'ladi (`final=True`) va guruhda qoladi.

    `state` — {teacher: {name, dep, fac, rooms, entered, late, offsite}}.
    """
    minutes = FIRST_ALERT if kind == "alert10" else SECOND_ALERT
    missing = [v for v in state.values() if not v.get("entered") and not v.get("offsite")]
    opened = [v for v in state.values() if v.get("entered") and not v.get("offsite")]
    away = [v for v in state.values() if v.get("offsite")]

    def late_items(rows: list[dict]) -> list[dict]:
        return [{**v, "extra": f"<b>{int(v.get('late') or 0)} daqiqa kech</b>"} for v in rows]

    parts: list[str] = []
    if final:
        parts.append(f"🏁 <b>{_esc(para)} ({slot}) — yakuni</b>")
        if missing:
            parts.append(f"❌ Dars davomida iMentor’ni <b>OCHMADI</b> ({len(missing)}):\n"
                         + "\n".join(_numbered([{**v, "extra": _esc(", ".join(v.get("rooms") or [])[:40])} for v in missing])))
        if opened:
            parts.append(f"⏱ <b>Kech ochdi</b> ({len(opened)}):\n" + "\n".join(_numbered(late_items(opened))))
        if not missing and not opened:
            parts.append("✅ Ro‘yxatdagi hamma o‘qituvchi iMentor’ni ochdi.")
    else:
        if missing:
            still = "hali ham" if kind == "alert15" else "hali"
            parts.append(f"⚠️ <b>{_esc(para)} ({slot})</b> boshlanganiga <b>{minutes} daqiqa</b> bo‘ldi\n\n"
                         f"Quyidagi <b>{len(missing)}</b> o‘qituvchi {still} iMentor’ni <b>OCHMADI</b>:\n\n"
                         + "\n".join(_numbered([{**v, "extra": _esc(", ".join(v.get("rooms") or [])[:40])} for v in missing])))
        else:
            parts.append(f"✅ <b>{_esc(para)} ({slot})</b>: ro‘yxatdagi hamma o‘qituvchi iMentor’ni ochdi.")
        if opened:
            parts.append(f"✅ <b>Keyin ochdi</b> ({len(opened)}):\n" + "\n".join(_numbered(late_items(opened))))
    if away:
        parts.append("📍 <b>Boshqa joyda</b> (rasm bilan qayd etgan):\n"
                     + "\n".join(_numbered([{**v, "extra": _esc(str(v.get("offsite") or ""))[:40]} for v in away])))
    if missing and not final:
        parts.append(contacts_block(missing, contacts))
    return "\n\n".join(parts)


def block_measures(db: Session, day: dt.date, blocks: list[Block]) -> dict[tuple, tuple[bool, int]]:
    """Har blok: (iMentor'da TO'LIQ o'tilganmi, iMentor'da ishlangan daqiqa).

    Qoida rektor hisobotidagi bilan BIR XIL (`lesson_report_service.measure_map` + `is_taught`):
    kamida 40 daqiqa ish, dars qoplamasi yoki talabalar jonli testda — o'tilgan; ketma-ket paralar
    bloki birga baholanadi.
    """
    ids = {i for b in blocks for i in b.lesson_ids}
    lessons = [x for x in lr._lessons(db, day, day, pending=True) if x.id in ids]
    raw = lr.measure_map(db, lessons)
    out: dict[tuple, tuple[bool, int]] = {}
    for b in blocks:
        ms_ = [raw.get(i) for i in b.lesson_ids]
        # Vaqt qoidasi (40 daqiqa); test/keys alohida — `module_check`.
        taught = any(m is not None and lr.time_taught(m) for m in ms_)
        minutes = sum(int((m or {}).get("seconds", 0) or 0) for m in ms_) // 60
        out[tuple(b.lesson_ids)] = (taught, minutes)
    return out


def module_check(db: Session, day: dt.date, block: Block, now: dt.datetime) -> dict | None:
    """Test va keys (2026-11-19, rektor hisobotidagi qoida `lr.modules_ok`): vaqt yetarli, lekin test/keys
    yaratilmagan yoki ularga 10 daqiqadan kam — {gaps, test_minutes, case_minutes, cycle, para}.

    Sikl (bir guruh, bir fan, ketma-ket paralar) BUTUNLIGICHA tekshiriladi: oxirgi parasi tugamaguncha
    `{"defer": True}` — 1–2-parada yaratmay 3-parada yaratsa ham to'g'ri. Muammo yo'q bo'lsa — None.
    """
    teacher_lessons = [x for x in lr._lessons(db, day, day, pending=True) if x.teacher_username == block.teacher]
    # Sikl BARCHA dars turlari bilan yig'iladi (2026-11-23 shikoyati: "siklda test va keys 1 marta, nega 1-parada
    # ogohlantirish?"). HEMIS siklning 1-parasini "Amaliy", qolganlarini "Klinik mashg'ulot" deb yozadi — faqat
    # baholanadigan turlar olinganda sikl uzilib, 1-para yakka dars bo'lib baholanardi (4 kunda 26 ta noto'g'ri post).
    every = [x for x in lr._lessons(db, day, day, pending=True, all_types=True) if x.teacher_username == block.teacher]
    chain = next((c for c in lr.lesson_blocks(every) if any(x.id in block.lesson_ids for x in c)), None)
    if chain and len(chain) > 1:
        last = max(chain, key=lambda x: lr._scheduled(x)[1])
        if last.id not in block.lesson_ids:
            return {"defer": True}
    done = [x for x in teacher_lessons if lr._scheduled(x)[1] <= now]
    raw = lr.measure_map(db, done)
    m = next((raw[i] for i in block.lesson_ids if i in raw and lr.time_taught(raw[i])), None)
    info = lr.module_info(m) if m else None
    if not info or not info["gaps"]:
        return None
    cycle = len(chain) if chain and len(chain) > 1 else 0
    nums = [str(x.para or "").split("-")[0] for x in sorted(chain, key=lambda x: lr._scheduled(x)[0])] if cycle else []
    return {**info, "cycle": cycle, "cycle_para": f"{nums[0]}–{nums[-1]}-para" if cycle else ""}


PAGE_NAMES = {"presentation": "Taqdimot", "tests": "Test", "my-tests": "Test (o'tkazish)", "lectures": "Ma'ruza",
              "cases": "Keys", "handouts": "Tarqatma", "videos": "Video", "syllabus": "Sillabus", "profile": "Profil"}


def proof_line(db: Session, blocks_t: list[Block], acts, *, worked: bool) -> str:
    """Postdagi DALIL qatori (2026-11-19, rektor: "mas'ullar «kirib ko'rdik, o'tyapti» deb nolishyapti — hamma narsa
    fakt va izohi bilan"). Faqat bazadagi qaydlardan: qachon kirgan/chiqqan, qaysi bo'limda qancha, talabalar va
    boshqa hisob testi. Xato bo'lsa — bo'sh (post baribir ketadi)."""
    try:
        b0 = min(blocks_t, key=lambda b: b.start)
        start, end = b0.start, max(b.end for b in blocks_t)
        teacher = b0.teacher
        own = [t for t in acts.get(teacher, []) if start - EARLY <= t <= end]
        parts: list[str] = []
        if worked and own:
            parts.append(f"iMentor’da {own[0].astimezone(TZ):%H:%M}–{own[-1].astimezone(TZ):%H:%M}")
            rows = db.execute(text("""
                select meta->>'page', sum(duration_sec) from core_useractivityevent
                 where owner_key = :o and occurred_at >= :lo and occurred_at < :hi and event_type = 'heartbeat'
                 group by 1 order by 2 desc limit 3"""), {"o": teacher, "lo": start - EARLY, "hi": end}).all()
            pages = [f"{PAGE_NAMES.get(p or '', p or 'boshqa')} {int(s or 0) // 60} daq" for p, s in rows if int(s or 0) >= 60]
            if pages:
                parts.append("bo‘limlar: " + ", ".join(pages))
        elif not own:
            before = [t for t in acts.get(teacher, []) if t < start - EARLY]
            parts.append(f"dars vaqtida ({start:%H:%M}–{end:%H:%M}) hisobida birorta qayd yo‘q"
                         + (f"; oxirgi qayd {before[-1].astimezone(TZ):%H:%M}" if before else "; bugun iMentor’ga kirmagan"))
        students = {o for b in blocks_t for g in b.groups for t, o in acts.get(f"grp:{g}", []) if start <= t <= end}
        if students:
            parts.append(f"guruhdan {len(students)} talaba iMentor’da faol")
        roster = sorted(students)
        if roster:
            other = db.execute(text("""
                select max(h.teacher_name), count(distinct a.student_id) from core_studenttestattempt a
                  join core_livetestsession s on s.id = a.session_id
                  left join core_hemislesson h on h.teacher_username = s.owner_key
                 where a.submitted_at >= :lo and a.submitted_at < :hi and s.owner_key <> :o
                   and a.student_id = any(:ids) group by s.owner_key order by 2 desc limit 1"""),
                {"lo": start, "hi": end, "o": teacher, "ids": [str(x).removeprefix("ot_") for x in roster]}).first()
            if other and other[1]:
                parts.append(f"⚠️ talabalar {other[0] or 'boshqa hisob'} jonli testida qatnashgan ({other[1]} nafar)")
        return "📋 Dalil: " + "; ".join(parts) if parts else ""
    except Exception:  # noqa: BLE001
        log.exception("lesson-bot: dalil qatori yozilmadi")
        db.rollback()
        return ""


def module_lines(info: dict) -> list[str]:
    out = []
    gaps = info.get("gaps") or []
    # Real foydalanish qoidasi (2026-11-27): talabalar test yechdimi, keys tahlili ochildimi.
    if "no_answers" in gaps:
        out.append("❌ Talabalar test yechmadi")
    if "no_reveal" in gaps:
        out.append(f"❌ Keys tahlili ochilmadi (keysda {int(info.get('case_minutes') or 0)} daqiqa)")
    if "case_time" in gaps and "case" not in gaps:
        out.append(f"⏱ Keysda atigi <b>{int(info.get('case_minutes') or 0)} daqiqa</b> (kamida {info.get('need_case', 10)})")
    if "no_answers" in gaps or "no_reveal" in gaps or ("case_time" in gaps and "case" not in gaps and "test" not in gaps
                                                       and "test_time" not in gaps):
        return out
    if "test" in gaps:
        out.append("❌ Test yaratilmadi")
    elif "test_time" in gaps:
        out.append(f"⏱ Testga atigi <b>{int(info.get('test_minutes') or 0)} daqiqa</b> (kamida {info.get('need_test', 10)})")
    if "case" in gaps:
        out.append("❌ Keys yaratilmadi")
    elif "case_time" in gaps:
        out.append(f"⏱ Keysga atigi <b>{int(info.get('case_minutes') or 0)} daqiqa</b> (kamida {info.get('need_case', 10)})")
    return out


def entered_text(slot: str, para: str, rows: list[dict]) -> str:
    """Ro'yxatdagi o'qituvchi iMentor'ni ochdi — har biri bir qatorda."""
    return "\n".join(f"✅ <b>{_esc(v['name'])}</b> iMentor’ni ochdi ({v.get('late') or 0} daqiqa kech)" for v in rows)


def daily_text(day: dt.date, blocks: list[Block], acts: dict[str, list[dt.datetime]], offsite: dict,
               measures: dict[tuple, tuple[bool, int]] | None = None) -> str:
    """Kunlik hisobot: umuman kirmagan, ba'zi darsiga kirmagan, kirib chiqqan / to'liq o'tmagan (daqiqa)."""
    months = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"]
    weekdays = ["dushanba", "seshanba", "chorshanba", "payshanba", "juma", "shanba", "yakshanba"]
    per: dict[str, dict] = {}
    for b in sorted(blocks, key=lambda x: x.start):
        p = per.setdefault(b.teacher, {"name": b.name, "dep": b.department, "fac": b.faculty,
                                       "missed": [], "late": [], "ok": 0, "offsite": 0, "short": []})
        if any(lid in (offsite.get(b.teacher) or {}) for lid in b.lesson_ids):
            p["offsite"] += 1
            continue
        when = entered_at(b, acts, b.end)
        if when is None:
            p["missed"].append(b.para)
            continue
        # Kirgan, lekin darsni iMentor'da TO'LIQ o'tmagan (rektor, 2026-11-15) — necha daqiqa ishlagani bilan.
        taught, minutes = (measures or {}).get(tuple(b.lesson_ids), (True, 0))
        if not taught:
            p["short"].append((b.para, minutes))
        if _late(b, when) > FIRST_ALERT:
            p["late"].append((b.para, _late(b, when)))
        else:
            p["ok"] += 1
    total = len(per)
    never = {k: v for k, v in per.items() if v["missed"] and not v["ok"] and not v["late"]}
    some = {k: v for k, v in per.items() if v["missed"] and k not in never}
    short = {k: v for k, v in per.items() if v["short"]}
    # Faqat ochmaganlar va to'liq o'tmaganlar (2026-11-15), raqamlangan ro'yxat.
    head = (f"📊 <b>Kunlik hisobot — {day.day}-{months[day.month - 1]}, {weekdays[day.weekday()]}</b>\n\n"
            f"Bugun monitorli xonada <b>{total}</b> o‘qituvchining darsi bo‘ldi.")
    parts = [head]
    if never:
        parts.append(f"\n❌ <b>Birorta darsida iMentor’ni ochmagan — {len(never)} kishi:</b>\n")
        parts += _numbered([{**v, "extra": _paras(v["missed"])} for v in never.values()])
    if some:
        parts.append(f"\n⚠️ <b>Ba’zi darslarida ochmagan — {len(some)} kishi:</b>\n")
        parts += _numbered([{**v, "extra": _paras(v["missed"])} for v in some.values()])
    if short:
        parts.append(f"\n⏱ <b>Ochgan, lekin darsni to‘liq o‘tmagan ({lr.MIN_LESSON_MINUTES} daqiqadan kam) — "
                     f"{len(short)} kishi:</b>\n")
        parts += _numbered([{**v, "extra": ", ".join(f"{para}: {m if m else '&lt;1'} daq" for para, m in v["short"])}
                            for v in short.values()])
    if not never and not some and not short and total:
        parts.append("\n✅ Bugun hamma o‘qituvchi darslarini iMentor’da to‘liq o‘tdi.")
    return "\n".join(parts)


def chunks(text_: str, limit: int = MAX_TEXT) -> list[str]:
    """Uzun matnni qator chegarasida bo'laklarga bo'ladi (HTML teglari har qatorda yopiq)."""
    out, cur = [], ""
    for line in text_.split("\n"):
        if len(cur) + len(line) + 1 > limit and cur:
            out.append(cur.rstrip("\n"))
            cur = ""
        cur += line + "\n"
    if cur.strip():
        out.append(cur.rstrip("\n"))
    return out or [""]


# ------------------------------------------------------------------ yuborish / tahrirlash

def _hash(t: str) -> str:
    return hashlib.sha256(t.encode()).hexdigest()


def _send(db: Session, chat: int, body: str, reply_to: int | None = None,
          markup: dict | None = None) -> tuple[int, list[int]]:
    ids = []
    for part in chunks(body):
        payload = {"chat_id": chat, "text": part, "parse_mode": "HTML", "disable_web_page_preview": True}
        if markup is not None:
            payload["reply_markup"] = markup
        if reply_to:
            # Asl xabar o'chgan bo'lsa ham yuborilaversin.
            payload["reply_parameters"] = {"message_id": reply_to, "allow_sending_without_reply": True}
        try:
            res = call("sendMessage", payload)
        except BotError as exc:
            if exc.migrate_to:
                _set(db, "chat_id", str(exc.migrate_to))
                chat = int(exc.migrate_to)
                res = call("sendMessage", {**payload, "chat_id": chat})
            else:
                raise
        ids.append(int(res["message_id"]))
        time.sleep(0.2)
    return chat, ids


def _edit(chat: int, ids: list[int], body: str, markup: dict | None = None) -> None:
    parts = chunks(body)
    for mid, part in zip(ids, parts):
        payload = {"chat_id": chat, "message_id": mid, "text": part, "parse_mode": "HTML",
                   "disable_web_page_preview": True}
        if markup is not None:
            payload["reply_markup"] = markup
        try:
            call("editMessageText", payload)
        except BotError as exc:
            if "not modified" not in exc.description.lower():
                raise
        time.sleep(0.2)


# Xabar O'CHIRISH yo'q (2026-11-16, rektor: "xabarlar o'chmasin"): `_delete`/`_retire` olib tashlangan.


def _find(db: Session, day: dt.date, kind: str, slot: str) -> LessonBotPost | None:
    return db.execute(select(LessonBotPost).where(LessonBotPost.day == day, LessonBotPost.kind == kind,
                                                  LessonBotPost.slot == slot)).scalar_one_or_none()


def _open_posts(db: Session, day: dt.date, slot: str) -> list[LessonBotPost]:
    """Shu dars (slot) uchun hali «yakuni»ga o'tmagan ro'yxat xabarlari."""
    rows = db.execute(select(LessonBotPost).where(
        LessonBotPost.day == day, LessonBotPost.slot == slot,
        LessonBotPost.kind.in_(("alert10", "alert15")))).scalars().all()
    return [r for r in rows if r.status == "sent" or (r.state or {}).get("notices")]


def _claim(db: Session, day: dt.date, kind: str, slot: str) -> LessonBotPost | None:
    """Kun + tur + slot uchun yozuv ochadi; allaqachon bo'lsa — None (ikki marta yuborilmaydi)."""
    res = db.execute(insert(LessonBotPost).values(day=day, kind=kind, slot=slot, status="claimed", state={},
                                                  message_ids=[])
                     .on_conflict_do_nothing(constraint="uq_lessonbotpost_day_kind_slot")
                     .returning(LessonBotPost.id)).first()
    db.commit()
    return db.get(LessonBotPost, res[0]) if res else None


# ------------------------------------------------------------------ har o'qituvchiga alohida post

#: 2026-11-18 (foydalanuvchi): "har bir xodim alohida post bo'lib kelsin, ro'yxat emas; tagida «Bog'landim»
#: tugmasi, bosib izoh yozsa bo'lsin — tartibli bo'ladi". +10 da iMentor'ni ochmagan HAR o'qituvchiga bitta
#: post; u O'CHMAYDI, holati shu postning o'zida yangilanadi: +15 «hali ham ochmadi», ochsa «✅ N daqiqa
#: kech», dars tugagach «yakuni» (tugma olinadi). «📞 Bog'landim» bosilsa — kim va qachon postga yoziladi;
#: postga javob (Reply) qilib yozilgan matn — izoh sifatida postning tagiga qo'shiladi.
TEACHER_KIND = "t:"
CALL_DATA = "call:"
MAX_COMMENTS = 10
COMMENT_CHARS = 300


#: 2026-11-18 (foydalanuvchi): "faqat kirmaganlar emas — kirib chiqib ketganlar va 40 minutga yetmaganlar haqida ham
#: xuddi shunday kelsin". Uch tur post, hammasi «t» bilan boshlanadi (bir xil tugma, izoh, eslatma, hisobot):
#:   "t:" — iMentor'ni ochmadi (+10);  "tl" — ochgan, keyin LEFT_GAP daqiqa faollik yo'q (chiqib ketdi);
#:   "tu" — dars tugadi, iMentor'da to'liq o'tilmagan (rektor hisoboti qoidasi: `lr.time_taught`, 40 daqiqa)
#:          YOKI vaqt yetarli, lekin test/keys yaratilmagan yoki ularga 10 daqiqadan kam (alert "misuse", 2026-11-19).
LEFT_KIND = "tl"
SHORT_KIND = "tu"
TEACHER_LIKE = "t%"
#: Shuncha daqiqa na o'qituvchidan, na guruh talabalaridan faollik bo'lmasa — «chiqib ketdi». Brauzer 20 daqiqa
#: harakatsizlikdan keyin faollik yozmaydi (slayd ko'rsatib gapirayotgan o'qituvchi ham shunday ko'rinadi), shuning
#: uchun 30: 17–18 noyabr ma'lumotida 15 daqiqada darslarning 33–37% i, 30 da 12–14% i (kuniga ~25 ta).
LEFT_GAP = 30
#: «To'liq o'tilmadi» — dars tugaganidan shuncha daqiqa keyin: internet uzilib navbatda qolgan faollik ham yetib
#: kelsin (2026-11-18: navbatdagi ma'lumot kech yetgani uchun «0 daqiqa kech» kabi noto'g'ri postlar bo'lgan).
SHORT_AFTER = 10
SHORT_STALE = 90


def _tkind(teacher: str, prefix: str = TEACHER_KIND) -> str:
    """Post turi: prefiks + login xeshi (ustun 16 belgi; kun + tur + slot bo'yicha yagona)."""
    return prefix + hashlib.sha1((teacher or "").encode()).hexdigest()[:12]


def teacher_text(st: dict) -> str:
    """Bitta o'qituvchi posti — faqat `state` dan (bot aylanishi ham, tugma/izoh ham shu bilan chizadi)."""
    name = _esc(st.get("name") or "")
    head = f"<b>{_esc(st.get('para') or '')} ({_esc(st.get('slot') or '')})</b>"
    final = st.get("stage") == "final"
    alert = st.get("alert") or ""
    if alert == "left":
        lines = _left_lines(st, name, head, final)
    elif alert == "misuse":
        cyc = f" · sikl {_esc(st.get('cycle_para') or '')}" if st.get("cycle") else ""
        lines = [f"⚠️ {head}{cyc} — iMentor’dan noto‘g‘ri foydalanildi",
                 f"❗️ <b>{name}</b> iMentor’da ishladi, lekin dars talabi bajarilmadi:",
                 *module_lines(st)]
    elif alert == "short":
        lines = [f"⏱ {head} — dars iMentor’da to‘liq o‘tilmadi",
                 f"❌ <b>{name}</b> iMentor’da atigi <b>{int(st.get('minutes') or 0)} daqiqa</b> ishladi "
                 "(to‘liq dars uchun kamida 40 daqiqa kerak)"]
    elif st.get("offsite"):
        lines = [f"📍 {head}", f"<b>{name}</b> — boshqa joyda: {_esc(str(st['offsite'])[:60])}"]
    elif st.get("entered") and st.get("late_data"):
        # O'qituvchi aslida post yuborilishidan OLDIN ochgan — faollik ma'lumoti internet tufayli kech yetdi
        # (2026-11-18: «ochdi — 0 daqiqa kech» ziddiyati). Ogohlantirish noto'g'ri chiqqanini ochiq yozamiz.
        late = int(st.get("late") or 0)
        when = "o‘z vaqtida" if late <= 0 else f"{late} daqiqa kech"
        lines = [f"{'🏁' if final else '✅'} {head}" + (" — yakuni" if final else ""),
                 f"✅ <b>{name}</b> iMentor’ni <b>{when}</b> ochgan",
                 "ℹ️ Ma’lumot internet tufayli serverga kech yetdi — ogohlantirish noto‘g‘ri chiqqan."]
    elif st.get("entered"):
        late = int(st.get("late") or 0)
        lines = [f"{'🏁' if final else '✅'} {head}" + (" — yakuni" if final else ""),
                 f"✅ <b>{name}</b> iMentor’ni ochdi — <b>{late} daqiqa kech</b>"]
    elif final:
        lines = [f"🏁 {head} — yakuni", f"❌ <b>{name}</b> dars davomida iMentor’ni <b>OCHMADI</b>"]
    elif st.get("stage") == "15":
        lines = [f"⏰ {head} · {SECOND_ALERT} daqiqa o‘tdi", f"❌ <b>{name}</b> hali ham iMentor’ni <b>OCHMADI</b>"]
    else:
        lines = [f"⚠️ {head} · {FIRST_ALERT} daqiqa o‘tdi", f"❌ <b>{name}</b> iMentor’ni <b>OCHMADI</b>"]
    if st.get("proof"):
        lines.append(_esc(st["proof"]))
    where = " · ".join(x for x in (_esc(st.get("dep") or ""), _esc(_fac_short(st.get("fac") or ""))) if x)
    rooms = _esc(", ".join(st.get("rooms") or [])[:40])
    lines.append(f"📚 {where}" + (f" · 🚪 {rooms}" if rooms else ""))
    if st.get("contact"):
        lines.append(f"👤 Mas’ul: <b>{_esc(st['contact'])}</b>")
    calls = st.get("calls") or []
    if calls:
        lines.append("📞 Bog‘landi: " + ", ".join(f"<b>{_esc(c.get('by') or '')}</b> ({_esc(c.get('at') or '')})"
                                                  for c in calls))
    for c in (st.get("comments") or [])[-MAX_COMMENTS:]:
        lines.append(f"💬 <b>{_esc(c.get('by') or '')}</b> ({_esc(c.get('at') or '')}): {_esc(c.get('text') or '')}")
    if calls and not st.get("comments") and not final:
        lines.append("<i>Izoh qoldirish: shu xabarga javob (Reply) qilib yozing.</i>")
    return "\n".join(lines)


def _left_lines(st: dict, name: str, head: str, final: bool) -> list[str]:
    since = _esc(st.get("since_hm") or "")
    if st.get("returned_at") and st.get("late_data"):
        return [f"✅ {head}" + (" — yakuni" if final else ""), f"✅ <b>{name}</b> iMentor’dan chiqmagan",
                "ℹ️ Ma’lumot internet tufayli serverga kech yetdi — ogohlantirish noto‘g‘ri chiqqan."]
    if st.get("returned_at"):
        return [f"{'🏁' if final else '✅'} {head}" + (" — yakuni" if final else ""),
                f"✅ <b>{name}</b> iMentor’ga qaytdi ({_esc(st['returned_at'])}) — {since} dan "
                f"{int(st.get('away') or 0)} daqiqa faollik yo‘q edi"]
    if final:
        return [f"🏁 {head} — yakuni", f"❌ <b>{name}</b> {since} da iMentor’dan chiqib ketdi va dars oxirigacha qaytmadi"]
    return [f"🚪 {head} · iMentor’dan chiqib ketdi",
            f"❌ <b>{name}</b> iMentor’ni ochgan, lekin <b>{since}</b> dan beri faollik yo‘q ({LEFT_GAP}+ daqiqa)"]


def _keyboard(post_id: int, st: dict) -> dict:
    if st.get("stage") == "final":
        return {"inline_keyboard": []}
    return {"inline_keyboard": [[{"text": "📞 Bog‘landim", "callback_data": f"{CALL_DATA}{post_id}"}]]}


def _teacher_posts(db: Session, day: dt.date, slot: str) -> list[LessonBotPost]:
    return list(db.execute(select(LessonBotPost).where(
        LessonBotPost.day == day, LessonBotPost.slot == slot, LessonBotPost.status == "sent",
        LessonBotPost.kind.like(TEACHER_LIKE))).scalars().all())


def _legacy_posts(db: Session, day: dt.date, slot: str) -> list[LessonBotPost]:
    """Deploydan oldingi ro'yxat xabarlari (shu slotda bo'lsa — yangi postlar yuborilmaydi, eski yakunlanadi)."""
    return list(db.execute(select(LessonBotPost).where(
        LessonBotPost.day == day, LessonBotPost.slot == slot,
        LessonBotPost.kind.in_(("alert10", "alert15")))).scalars().all())


def _lock_post(db: Session, post_id: int) -> LessonBotPost | None:
    return db.execute(select(LessonBotPost).where(LessonBotPost.id == post_id).with_for_update()).scalar_one_or_none()


def _post_by_message(db: Session, message_id: int) -> LessonBotPost | None:
    since = dt.datetime.now(TZ).date() - dt.timedelta(days=2)
    row = db.execute(select(LessonBotPost).where(
        LessonBotPost.day >= since, LessonBotPost.kind.like(TEACHER_LIKE),
        LessonBotPost.message_ids.contains([message_id])).with_for_update()).scalars().first()
    if row is not None:
        return row
    # Eslatmaga javob: unda bitta o'qituvchi bo'lsa — izoh o'sha o'qituvchi postiga.
    rem = db.execute(select(LessonBotPost).where(
        LessonBotPost.day >= since, LessonBotPost.kind.like(f"{REMINDER_KIND}%"),
        LessonBotPost.message_ids.contains([message_id]))).scalars().first()
    posts = list(((rem.state or {}).get("posts") or [])) if rem is not None else []
    return _lock_post(db, int(posts[0])) if len(posts) == 1 else None


def _redraw(db: Session, row: LessonBotPost, st: dict) -> None:
    body = teacher_text(st)
    if _hash(body) != row.text_hash and row.chat_id and row.message_ids:
        _edit(int(row.chat_id), list(row.message_ids)[:1], body, markup=_keyboard(row.id, st))
        _edit_dm(st.get("dm"), body, markup=_keyboard(row.id, st))
    row.state = st
    row.text_hash = _hash(body)
    db.commit()


def _who(user: dict) -> str:
    name = " ".join(x for x in (user.get("first_name"), user.get("last_name")) if x).strip()
    return (name or (f"@{user['username']}" if user.get("username") else "?"))[:40]


#: Faqat kafedra mas'uli bosadi va izoh yozadi (2026-11-18, foydalanuvchi: "«Bog'landim»ni hamma bosa olyapti — faqat
#: mas'ul shaxsning o'zi bosib izoh yozadigan qilib bering"). Telegram tugmani bosganning telefonini bermaydi — mas'ul
#: botga shaxsiy xabarda bir marta telefonini yuboradi (`request_contact`, faqat O'Z raqami), u `department_contacts`
#: dagi telefon bilan solishtiriladi va Telegram ID'si shu yerda saqlanadi: {"<tg_user_id>": "<raqamning oxirgi 9 xonasi>"}.
RESPONSIBLE_TG_KEY = "responsible_telegram"
_bot_username: str = ""


def _phone_key(phone: str) -> str:
    digits = "".join(ch for ch in str(phone or "") if ch.isdigit())
    return digits[-9:] if len(digits) >= 9 else ""


def responsible_ids(db: Session) -> dict[str, str]:
    try:
        data = json.loads(_get(db, RESPONSIBLE_TG_KEY) or "{}")
    except (ValueError, TypeError, AttributeError):
        return {}
    return {str(k): str(v) for k, v in data.items()} if isinstance(data, dict) else {}


def is_responsible(db: Session, department: str, user_id) -> bool:
    phone = _phone_key(str((department_contacts(db).get(department or "") or {}).get("phone") or ""))
    return bool(phone) and responsible_ids(db).get(str(user_id or "")) == phone


def bot_username() -> str:
    global _bot_username
    if not _bot_username:
        try:
            _bot_username = str((call("getMe") or {}).get("username") or "")
        except BotError:
            return ""
    return _bot_username


def not_responsible_text() -> str:
    name = bot_username()
    where = f"@{name} botiga" if name else "botga"
    return ("Bu tugma faqat shu kafedraning mas’uli uchun. Agar mas’ul bo‘lsangiz, "
            f"{where} shaxsiy xabarda /start yozib, telefon raqamingizni yuboring.")[:200]


def register_responsible(db: Session, message: dict) -> str:
    """Shaxsiy chat: /start — telefon so'raladi; kontakt kelsa — mas'ullar ro'yxati bilan solishtiriladi."""
    sender = message.get("from") or {}
    contact = message.get("contact") or {}
    if not contact:
        return "ask"
    if str(contact.get("user_id") or "") != str(sender.get("id") or ""):
        return "Faqat o‘zingizning raqamingizni yuboring (pastdagi tugma orqali)."
    key = _phone_key(str(contact.get("phone_number") or ""))
    deps = sorted(d for d, c in department_contacts(db).items() if key and _phone_key(str(c.get("phone") or "")) == key)
    if not deps:
        return "Bu raqam kafedra mas’ullari ro‘yxatida yo‘q. Ro‘yxat bo‘yicha savol bo‘lsa — administratorga murojaat qiling."
    ids = responsible_ids(db)
    ids[str(sender.get("id"))] = key
    _set(db, RESPONSIBLE_TG_KEY, json.dumps(ids))
    name = _contact_name(str((department_contacts(db).get(deps[0]) or {}).get("name") or ""))
    return (f"✅ {name}, siz quyidagi kafedra(lar) mas’uli sifatida tasdiqlandingiz:\n• " + "\n• ".join(deps)
            + "\n\nEndi guruhdagi postlarda «📞 Bog‘landim» tugmasini bosib, postga javob qilib izoh yoza olasiz.")


def _private_reply(chat_id, text_: str, ask_phone: bool = False) -> None:
    payload: dict = {"chat_id": chat_id, "text": text_}
    if ask_phone:
        payload["reply_markup"] = {"keyboard": [[{"text": "📱 Telefon raqamni yuborish", "request_contact": True}]],
                                   "resize_keyboard": True, "one_time_keyboard": True}
    else:
        payload["reply_markup"] = {"remove_keyboard": True}
    try:
        call("sendMessage", payload)
    except BotError as exc:
        log.warning("lesson-bot: shaxsiy javob yuborilmadi: %s", exc.description)


def on_call(db: Session, cq: dict) -> str:
    """«📞 Bog'landim» bosildi: kim va qachon — postga. Qaytaradi: foydalanuvchiga ko'rsatiladigan javob."""
    data = str(cq.get("data") or "")
    try:
        post_id = int(data[len(CALL_DATA):]) if data.startswith(CALL_DATA) else 0
    except ValueError:
        post_id = 0
    row = _lock_post(db, post_id) if post_id else None
    if row is None or not str(row.kind).startswith("t"):
        db.rollback()
        return "Bu xabar eskirgan."
    st = dict(row.state or {})
    if not is_responsible(db, str(st.get("dep") or ""), (cq.get("from") or {}).get("id")):
        db.rollback()
        return not_responsible_text()
    who = _who(cq.get("from") or {})
    calls = list(st.get("calls") or [])
    if not any(c.get("by") == who for c in calls):
        calls.append({"by": who, "at": dt.datetime.now(TZ).strftime("%H:%M")})
    st["calls"] = calls
    _redraw(db, row, st)
    return "✅ «Bog‘landim» belgilandi. Izoh qoldirish uchun shu xabarga javob (Reply) qilib yozing."


def on_comment(db: Session, message: dict) -> bool:
    """Postga javob (Reply) — izoh sifatida postning tagiga. Bot yozuvi yoki boshqa xabarga javob — e'tiborsiz."""
    reply = message.get("reply_to_message") or {}
    sender = message.get("from") or {}
    body = str(message.get("text") or message.get("caption") or "").strip()
    if not reply.get("message_id") or sender.get("is_bot") or not body:
        return False
    private = (message.get("chat") or {}).get("type") == "private"
    row = (_post_by_dm(db, int((message.get("chat") or {}).get("id") or 0), int(reply["message_id"])) if private
           else _post_by_message(db, int(reply["message_id"])))
    if row is None:
        db.rollback()
        return False
    st = dict(row.state or {})
    if not is_responsible(db, str(st.get("dep") or ""), sender.get("id")):
        db.rollback()  # boshqa odamning javobi postga yozilmaydi (bot xabar o'chirmaydi — guruhda o'zi qoladi)
        return False
    comments = list(st.get("comments") or [])
    comments.append({"by": _who(sender), "at": dt.datetime.now(TZ).strftime("%H:%M"),
                     "text": " ".join(body.split())[:COMMENT_CHARS]})
    st["comments"] = comments[-MAX_COMMENTS * 2:]
    _redraw(db, row, st)
    return True


def handle_update(db: Session, update: dict, chat: int | None) -> None:
    cq = update.get("callback_query")
    if cq:
        msg = (cq.get("message") or {}).get("chat") or {}
        # Guruhdagi post yoki mas'ulga shaxsiy nusxa (2026-11-18) — ikkalasida ham tugma ishlaydi.
        allowed = chat is None or msg.get("id") == chat or msg.get("type") == "private"
        answer = on_call(db, cq) if allowed else "Bu guruh uchun emas."
        try:
            call("answerCallbackQuery", {"callback_query_id": cq.get("id"), "text": answer, "show_alert": True})
        except BotError as exc:
            log.warning("lesson-bot: tugma javobi yuborilmadi: %s", exc.description)
        return
    m = update.get("message") or {}
    if m and (m.get("chat") or {}).get("type") == "private":
        if m.get("reply_to_message") and not m.get("contact"):
            # Telefon (kontakt) bot xabariga javob qilib yuborilsa ham — ro'yxatdan o'tish (2026-11-20).
            # Shaxsiy nusxaga javob — izoh sifatida guruhdagi postga ham qo'shiladi.
            done = on_comment(db, m)
            _private_reply(m["chat"]["id"], "✅ Izoh postga qo‘shildi." if done else
                           "Izoh qo‘shilmadi: o‘qituvchi postiga javob (Reply) qilib yozing.")
            return
        # Ro'yxatdan o'tgan mas'ul oddiy matn yozsa (Reply'siz) — unga yuborilgan OXIRGI postga izoh (2026-11-20).
        if m.get("text") and not m.get("contact") and not str(m["text"]).startswith("/")                 and str((m.get("from") or {}).get("id")) in responsible_ids(db):
            last = _last_dm_post(db, int(m["chat"]["id"]))
            if last is not None:
                done = on_comment(db, {**m, "reply_to_message": {"message_id": last}})
                _private_reply(m["chat"]["id"], "✅ Izoh oxirgi postga qo‘shildi (guruhda ham ko‘rinadi)." if done else
                               "Izoh qo‘shilmadi: bu post boshqa kafedraga tegishli.")
                return
        answer = register_responsible(db, m)
        if answer == "ask":
            _private_reply(m["chat"]["id"], "Assalomu alaykum! Kafedra mas’uli ekaningizni tasdiqlash uchun pastdagi "
                           "tugma orqali telefon raqamingizni yuboring.", ask_phone=True)
        else:
            _private_reply(m["chat"]["id"], answer)
        return
    if m and (chat is None or (m.get("chat") or {}).get("id") == chat):
        on_comment(db, m)


def poll_once(session_factory) -> int:
    """getUpdates (uzun so'rov, 25 s): tugmalar va izohlar darhol qayta ishlanadi."""
    with session_factory() as db:
        offset = int(_get(db, "updates_offset") or 0)
        env = (os.environ.get("LESSON_BOT_CHAT_ID") or "").strip()
        saved = env or _get(db, "chat_id")
        chat = int(saved) if saved.lstrip("-").isdigit() else None
    try:
        updates = call("getUpdates", {"offset": offset, "timeout": 25,
                                      "allowed_updates": ["message", "callback_query", "my_chat_member"]},
                       timeout=40) or []
    except BotError as exc:
        log.warning("lesson-bot: getUpdates: %s", exc.description)
        time.sleep(30 if exc.code == 409 else 5)
        return 0
    if not updates:
        return 0
    with session_factory() as db:
        for u in updates:
            try:
                handle_update(db, u, chat)
            except Exception:  # noqa: BLE001 — bitta yangilanish butun navbatni to'xtatmasin
                db.rollback()
                log.warning("lesson-bot: yangilanish qayta ishlanmadi", exc_info=True)
        _set(db, "updates_offset", str(max(int(u.get("update_id", 0)) for u in updates) + 1))
    return len(updates)


def _poll_loop() -> None:
    from app.core.db import SessionLocal, engine

    time.sleep(random.uniform(3, 10))
    while True:
        try:
            with engine.connect() as conn:
                got = conn.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": POLL_LOCK_KEY}).scalar()
                conn.commit()
                if got:
                    try:
                        while True:
                            poll_once(SessionLocal)
                    finally:
                        conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": POLL_LOCK_KEY})
                        conn.commit()
        except Exception:  # noqa: BLE001
            log.warning("lesson-bot: tinglovchi xato", exc_info=True)
        time.sleep(60)


# ------------------------------------------------------------------ mas'ul bog'lanmadi — eslatma

#: 2026-11-18 (foydalanuvchi): "bog'lanmay qolib ketsa, «bog'lanmadi shu mas'ul» deb ham xabar yuborsin — qaysi
#: o'qituvchiga bog'lanishi kerak edi, lekin haligacha bog'lanmadi". O'qituvchi posti (+10) dan shuncha daqiqa
#: o'tib ham «Bog'landim» bosilmagan va o'qituvchi hali ochmagan bo'lsa — mas'ulga BITTA eslatma (shu paradagi
#: hamma o'qituvchilari bilan). Xabar O'CHMAYDI: mas'ul bog'lansa yoki o'qituvchi ochsa — qator ✅ bo'ladi.
CONTACT_DEADLINE = 20
REMINDER_KIND = "r:"


def _rkind(name: str) -> str:
    return REMINDER_KIND + hashlib.sha1((name or "").encode()).hexdigest()[:12]


def _slot_teacher_posts(db: Session, day: dt.date, slot: str) -> list[LessonBotPost]:
    return list(db.execute(select(LessonBotPost).where(
        LessonBotPost.day == day, LessonBotPost.slot == slot, LessonBotPost.status.in_(("sent", "final")),
        LessonBotPost.kind.like(TEACHER_LIKE))).scalars().all())


#: 2026-11-18 (foydalanuvchi): "guruhga ham, o'sha mas'ulga ham borsin — o'ziga tegishlisini bot unga alohida
#: yuborsin; guruhga kirmay qolsa ham bot unga xabar yuborgan bo'ladi". Mas'ul botda tanilgan (/start + telefon)
#: bo'lsa, uning kafedrasi o'qituvchisi posti va eslatma unga shaxsiy xabarda ham boradi (tugmasi bilan); shaxsiy
#: nusxa ham guruhdagi bilan birga yangilanadi, unga javob (Reply) — izoh sifatida postga qo'shiladi.
def responsible_tg(db: Session, contact_name: str, contacts: dict) -> str:
    phone = next((_phone_key(str(c.get("phone") or "")) for c in contacts.values()
                  if _contact_name(str(c.get("name") or "")) == contact_name and c.get("phone")), "")
    return next((k for k, v in responsible_ids(db).items() if phone and v == phone and k.isdigit()), "")


def _send_dm(db: Session, tg: str, body: str, markup: dict | None = None) -> dict | None:
    """Shaxsiy nusxa: {"chat", "msg"} yoki None (mas'ul botni to'xtatgan / hali yozmagan)."""
    if not tg:
        return None
    try:
        _c, ids = _send(db, int(tg), body, markup=markup)
        return {"chat": int(tg), "msg": int(ids[0])}
    except BotError as exc:
        log.warning("lesson-bot: mas'ulga shaxsiy xabar yuborilmadi: %s", exc.description)
        return None


def _edit_dm(dm: dict | None, body: str, markup: dict | None = None) -> None:
    if not dm or not dm.get("chat") or not dm.get("msg"):
        return
    try:
        _edit(int(dm["chat"]), [int(dm["msg"])], body, markup=markup)
    except BotError as exc:
        log.warning("lesson-bot: shaxsiy nusxa tahrirlanmadi: %s", exc.description)


def _last_dm_post(db: Session, chat_id: int) -> int | None:
    """Shu mas'ulga shaxsiy yuborilgan eng oxirgi o'qituvchi postining xabar raqami (bugun)."""
    row = db.execute(select(LessonBotPost).where(
        LessonBotPost.day >= dt.datetime.now(TZ).date(), LessonBotPost.kind.like(TEACHER_LIKE),
        LessonBotPost.state["dm"]["chat"].as_integer() == int(chat_id)).order_by(LessonBotPost.id.desc())).scalars().first()
    db.rollback()
    try:
        return int(((row.state or {}).get("dm") or {}).get("msg")) if row is not None else None
    except (TypeError, ValueError):
        return None


def _post_by_dm(db: Session, chat_id: int, message_id: int) -> LessonBotPost | None:
    since = dt.datetime.now(TZ).date() - dt.timedelta(days=2)
    return db.execute(select(LessonBotPost).where(
        LessonBotPost.day >= since, LessonBotPost.kind.like(TEACHER_LIKE),
        LessonBotPost.state["dm"]["chat"].as_integer() == int(chat_id),
        LessonBotPost.state["dm"]["msg"].as_integer() == int(message_id)).with_for_update()).scalars().first()


def _mention(db: Session, contact_name: str, contacts: dict) -> str:
    """Mas'ul botda tanilgan bo'lsa — Telegram bildirishnomasi boradigan havola, aks holda qalin ism."""
    phone = next((_phone_key(str(c.get("phone") or "")) for c in contacts.values()
                  if _contact_name(str(c.get("name") or "")) == contact_name and c.get("phone")), "")
    tg = next((k for k, v in responsible_ids(db).items() if phone and v == phone), "")
    name = _esc(contact_name)
    return f'<a href="tg://user?id={int(tg)}"><b>{name}</b></a>' if tg.isdigit() else f"<b>{name}</b>"


def reminder_text(para: str, slot: str, mention: str, rows: list[dict], final: bool = False) -> str:
    """`rows` — [{name, dep, rooms, state: "wait"|"called"|"opened", at, late}]."""
    waiting = [r for r in rows if r["state"] == "wait"]
    if not waiting:
        head = f"✅ <b>{_esc(para)} ({_esc(slot)})</b> — mas’ul bog‘landi"
    elif final:
        head = f"🏁 <b>{_esc(para)} ({_esc(slot)})</b> — mas’ul dars davomida bog‘lanmadi"
    else:
        head = f"⏰ <b>{_esc(para)} ({_esc(slot)})</b> — mas’ul hali bog‘lanmadi"
    lines = [head, f"👤 {mention}"]
    if waiting:
        lines.append("Quyidagi o‘qituvchi(lar) bilan bog‘lanish kerak, «Bog‘landim» bosilmagan:")
    for i, r in enumerate(rows, 1):
        where = " · ".join(x for x in (_esc(r.get("dep") or ""), _esc(", ".join(r.get("rooms") or [])[:30])) if x)
        if r["state"] == "called":
            mark = f"✅ <b>{_esc(r['name'])}</b> — bog‘landi ({_esc(r.get('at') or '')})"
        elif r["state"] == "opened" and r.get("back"):
            # «Chiqib ketdi» posti: o'qituvchi qaytgan (2026-11-19: bu yerda «o'zi ochdi (0 daqiqa kech)» chiqardi).
            mark = f"✅ <b>{_esc(r['name'])}</b> — o‘zi qaytdi ({_esc(r['back'])})"
        elif r["state"] == "opened":
            late = int(r.get("late") or 0)
            mark = f"✅ <b>{_esc(r['name'])}</b> — o‘zi ochdi ({'o‘z vaqtida' if late <= 0 else f'{late} daqiqa kech'})"
        else:
            mark = f"❌ <b>{_esc(r['name'])}</b>" + (f" — {_esc(r['why'])}" if r.get("why") else "")
        lines.append(f"{i}. {mark}" + (f"\n{INDENT}{where}" if where else ""))
    return "\n".join(lines)


def _reminder_keyboard(rows: list[dict], final: bool = False) -> dict:
    """Eslatmada har kutilayotgan o'qituvchi uchun «📞 Bog'landim — ISM» (2026-11-18: "eslatmada tugma chiqmayapti").
    Tugma o'qituvchi postining o'zini belgilaydi (`call:<post_id>`); eslatma keyingi aylanishda ✅ bo'ladi."""
    if final:
        return {"inline_keyboard": []}
    return {"inline_keyboard": [[{"text": f"📞 Bog‘landim — {r['name']}"[:60], "callback_data": f"{CALL_DATA}{r['post']}"}]
                                for r in rows if r["state"] == "wait"]}


def _contact_reminders(db: Session, day: dt.date, now: dt.datetime, slot: str, start: dt.datetime, end: dt.datetime,
                       para: str, contacts: dict, chat: int, stats: dict) -> int:
    deadline = start + dt.timedelta(minutes=FIRST_ALERT + CONTACT_DEADLINE)
    if now < deadline:
        return chat
    posts = _slot_teacher_posts(db, day, slot)
    by_contact: dict[str, list[LessonBotPost]] = defaultdict(list)
    for p in posts:
        st = p.state or {}
        if st.get("contact") and not st.get("offsite") and st.get("alert") not in ("short", "misuse"):
            by_contact[str(st["contact"])].append(p)
    for name, plist in sorted(by_contact.items()):
        def row_of(p: LessonBotPost) -> dict:
            st = p.state or {}
            calls = st.get("calls") or []
            if st.get("alert") == "left":
                state = "called" if calls else ("opened" if st.get("returned_at") else "wait")
                why = f"chiqib ketgan ({st.get('since_hm') or ''})"
            else:
                state = "called" if calls else ("opened" if st.get("entered") else "wait")
                why = "ochmagan"
            return {"post": p.id, "name": st.get("name") or "", "dep": st.get("dep") or "", "rooms": st.get("rooms") or [],
                    "state": state, "at": (calls[0].get("at") if calls else ""), "late": st.get("late"), "why": why,
                    "back": st.get("returned_at") if st.get("alert") == "left" else ""}

        kind = _rkind(name)
        existing = _find(db, day, kind, slot)
        if existing is None:
            # Yangi eslatma faqat dars davomida va kamida bitta o'qituvchi hali kutilayotgan bo'lsa.
            # Faqat darsi hali davom etayotganlar: yakunlangan post uchun eslatma kech va ma'nosiz
            # (2026-11-18: 13:00 va 14:30 dagi darslar uchun eslatma 16:15 da kelgan).
            pending = [row_of(p) for p in plist if p.status == "sent" and row_of(p)["state"] == "wait"]
            if not pending or now > end:
                continue
            claimed = _claim(db, day, kind, slot)
            if claimed is None:
                continue
            body = reminder_text(para, slot, _mention(db, name, contacts), pending)
            try:
                chat, ids = _send(db, chat, body, markup=_reminder_keyboard(pending))
            except BotError as exc:
                claimed.status, claimed.error = "failed", exc.description[:500]
                db.commit()
                log.warning("lesson-bot: eslatma yuborilmadi: %s", exc.description)
                continue
            claimed.chat_id, claimed.message_ids, claimed.status = chat, ids, "sent"
            claimed.state = {"contact": name, "posts": [r["post"] for r in pending], "para": para,
                             "dm": _send_dm(db, responsible_tg(db, name, contacts), body,
                                            markup=_reminder_keyboard(pending))}
            claimed.text_hash = _hash(body + json.dumps(_reminder_keyboard(pending), ensure_ascii=False))
            db.commit()
            stats["posted"] += 1
            continue
        if existing.status != "sent":
            continue
        wanted = set((existing.state or {}).get("posts") or [])
        mine = [p for p in plist if p.id in wanted]
        rows = [row_of(p) for p in mine]
        # Hamma o'qituvchisining darsi tugagan bo'lsa — yakuni (slotdagi eng uzun blokni kutmasdan).
        final = now > end or (bool(mine) and all(p.status == "final" for p in mine))
        body = reminder_text((existing.state or {}).get("para", para), slot, _mention(db, name, contacts), rows, final=final)
        # Xesh tugmalarni ham o'z ichiga oladi: tugmasiz yuborilgan eski eslatmalarga tugma bir marta qo'shiladi.
        digest = _hash(body + json.dumps(_reminder_keyboard(rows, final=final), ensure_ascii=False))
        if digest != existing.text_hash:
            try:
                _edit(int(existing.chat_id), list(existing.message_ids or []), body,
                      markup=_reminder_keyboard(rows, final=final))
            except BotError as exc:
                log.warning("lesson-bot: eslatma tahrirlanmadi: %s", exc.description)
                continue
            _edit_dm((existing.state or {}).get("dm"), body, markup=_reminder_keyboard(rows, final=final))
            existing.text_hash = digest
            stats["edited"] += 1
        if final:
            existing.status = "final"
        db.commit()
    return chat


def _evidence(blocks_t: list[Block], acts, until: dt.datetime) -> list[dt.datetime]:
    """O'qituvchi va uning guruhi talabalarining faollik vaqtlari (`until` gacha), tartiblangan."""
    teacher = blocks_t[0].teacher
    out = [t for t in acts.get(teacher, []) if t <= until]
    # Harakatsiz, lekin ekranda ochiq turgan iMentor — chiqib ketmagan (2026-11-19).
    out += [t for t in acts.get(f"pres:{teacher}", []) if t <= until]
    for b in blocks_t:
        for g in b.groups:
            out += [t for t, _owner in acts.get(f"grp:{g}", []) if t <= until]
    return sorted(out)


def _publish(db: Session, claimed: LessonBotPost, st: dict, contacts: dict, chat: int, stats: dict,
             status: str = "sent") -> int:
    body = teacher_text(st)
    try:
        chat, ids = _send(db, chat, body, markup=_keyboard(claimed.id, st))
    except BotError as exc:
        claimed.status, claimed.error = "failed", exc.description[:500]
        db.commit()
        log.warning("lesson-bot: post yuborilmadi: %s", exc.description)
        return chat
    claimed.chat_id, claimed.message_ids, claimed.status = chat, ids, status
    dm = _send_dm(db, responsible_tg(db, st.get("contact") or "", contacts), body, markup=_keyboard(claimed.id, st))
    if dm:
        st["dm"] = dm
    claimed.state, claimed.text_hash = st, _hash(body)
    db.commit()
    stats["posted"] += 1
    return chat


def _extra_alerts(db: Session, day: dt.date, now: dt.datetime, slot: str, start: dt.datetime, sblocks: list[Block],
                  acts, offsite, contacts: dict, chat: int, stats: dict, para: str) -> int:
    """«Chiqib ketdi» (dars davomida) va «to'liq o'tilmadi» (dars tugagach) postlari."""
    by_teacher: dict[str, list[Block]] = defaultdict(list)
    for b in sblocks:
        by_teacher[b.teacher].append(b)
    state = _slot_state(sblocks, acts, now, offsite)
    for teacher, blocks_t in sorted(by_teacher.items()):
        v = state.get(teacher) or {}
        if v.get("offsite"):
            continue
        own_end = max(b.end for b in blocks_t)
        c = contacts.get(str(v.get("dep") or "")) or {}
        base = {**v, "teacher": teacher, "para": para, "slot": slot,
                "contact": _contact_name(str(c.get("name") or "")), "calls": [], "comments": []}
        # 1) Chiqib ketdi: ochgan, lekin LEFT_GAP daqiqa hech qanday faollik yo'q (dars oxiriga 10 daqiqadan ko'p qolgan).
        # Faqat «ekranda ochiq» belgisini yuboradigan (yangi versiyadagi) brauzer uchun (2026-11-19): eski brauzerda
        # 20 daqiqa harakatsizlikdan keyin qayd to'xtaydi — ekranda ochiq taqdimot ham «chiqib ketdi» bo'lib chiqardi.
        capable = bool(acts.get(f"pres:{teacher}"))
        if capable and v.get("entered") and start + dt.timedelta(minutes=LEFT_GAP) <= now <= own_end - dt.timedelta(minutes=10):
            kind = _tkind(teacher, LEFT_KIND)
            if _find(db, day, kind, slot) is None:
                ev = _evidence(blocks_t, acts, now)
                last = ev[-1] if ev else None
                if last is not None and now - last >= dt.timedelta(minutes=LEFT_GAP):
                    claimed = _claim(db, day, kind, slot)
                    if claimed is not None:
                        st = {**base, "alert": "left", "stage": "10", "since": last.isoformat(),
                              "since_hm": last.astimezone(TZ).strftime("%H:%M"), "posted_at": now.isoformat()}
                        chat = _publish(db, claimed, st, contacts, chat, stats)
        # 2) To'liq o'tilmadi: dars tugagach, ochgan bo'lsa ham iMentor'da yetarli ishlamagan.
        if own_end + dt.timedelta(minutes=SHORT_AFTER) <= now <= own_end + dt.timedelta(minutes=SHORT_STALE):
            kind = _tkind(teacher, SHORT_KIND)
            if _find(db, day, kind, slot) is None:
                at_end = _slot_state(blocks_t, acts, own_end, offsite).get(teacher) or {}
                left_row = _find(db, day, _tkind(teacher, LEFT_KIND), slot)
                claimed = _claim(db, day, kind, slot)
                if claimed is None:
                    continue
                if left_row is not None and not (left_row.state or {}).get("returned_at"):
                    claimed.status = "empty"  # chiqib ketib qaytmagan — bu allaqachon «chiqib ketdi» postida
                    db.commit()
                    continue
                measures = block_measures(db, day, blocks_t) if at_end.get("entered") and not at_end.get("offsite") else {}
                short = [(m, b) for b in blocks_t for m in [measures.get(tuple(b.lesson_ids))] if m and not m[0]]
                if short:
                    st = {**base, **{k: at_end.get(k) for k in ("entered", "late")}, "alert": "short", "stage": "short",
                          "minutes": sum(m[1] for m, _b in short),
                          "proof": proof_line(db, blocks_t, acts, worked=True)}
                    chat = _publish(db, claimed, st, contacts, chat, stats, status="final")
                    continue
                # Vaqt yetarli — test va keys (sikl bo'lsa, uning oxirgi parasida butun sikl uchun).
                taught = [b for b in blocks_t if (measures.get(tuple(b.lesson_ids)) or (False,))[0]]
                misuse = next((r for b in taught for r in [module_check(db, day, b, now)] if r and not r.get("defer")),
                              None)
                if misuse is None:
                    claimed.status = "empty"  # ochmagan (u «ochmadi» postida), to'liq o'tilgan yoki sikl davom etmoqda
                    db.commit()
                    continue
                st = {**base, **{k: at_end.get(k) for k in ("entered", "late")}, "alert": "misuse", "stage": "short",
                      **{k: misuse[k] for k in ("gaps", "test_minutes", "case_minutes", "need_test", "need_case",
                                                "cycle", "cycle_para")},
                      "proof": proof_line(db, blocks_t, acts, worked=True)}
                chat = _publish(db, claimed, st, contacts, chat, stats, status="final")
    # «Chiqib ketdi» postlarini yangilash: qaytdimi, dars tugadimi.
    for row in _teacher_posts(db, day, slot):
        if (row.state or {}).get("alert") != "left":
            continue
        locked = _lock_post(db, row.id)
        if locked is None or locked.status != "sent":
            db.rollback()
            continue
        st = dict(locked.state or {})
        blocks_t = by_teacher.get(str(st.get("teacher") or ""))
        if not blocks_t:
            db.rollback()
            continue
        own_end = max(b.end for b in blocks_t)
        try:
            since = dt.datetime.fromisoformat(str(st.get("since")))
            posted = dt.datetime.fromisoformat(str(st.get("posted_at")))
        except ValueError:
            db.rollback()
            continue
        after = [t for t in _evidence(blocks_t, acts, min(now, own_end)) if t > since]
        if after and not st.get("returned_at"):
            st["returned_at"] = after[0].astimezone(TZ).strftime("%H:%M")
            st["away"] = int((after[0] - since).total_seconds() // 60)
            if after[0] <= posted:  # bo'shliq ichidagi dalil keyin keldi — ma'lumot kech yetgan
                st["late_data"] = True
        if now > own_end:
            st["stage"] = "final"
        before = locked.text_hash
        try:
            _redraw(db, locked, st)
        except BotError as exc:
            db.rollback()
            log.warning("lesson-bot: post tahrirlanmadi: %s", exc.description)
            continue
        if st.get("stage") == "final":
            locked.status = "final"
            db.commit()
        elif locked.text_hash != before:
            stats["edited"] += 1
    return chat


def _teacher_alerts(db: Session, day: dt.date, now: dt.datetime, slot: str, sblocks: list[Block], acts, offsite,
                    contacts: dict, chat: int, stats: dict) -> int:
    """Yangi postlar (+10…+25 daqiqa oralig'ida) va mavjudlarini yangilash. Qaytaradi: guruh chat_id."""
    start = min(b.start for b in sblocks)
    end = max(b.end for b in sblocks)
    para = sblocks[0].first_para or sblocks[0].para
    if start + dt.timedelta(minutes=FIRST_ALERT) <= now <= start + dt.timedelta(minutes=STALE_AFTER["alert10"]):
        state = _slot_state(sblocks, acts, now, offsite)
        order = sorted(state.items(), key=lambda kv: (str(kv[1].get("fac") or "").startswith("Boshqa"),
                                                      kv[1].get("fac") or "", kv[1].get("dep") or "", kv[1].get("name") or ""))
        for teacher, v in order:
            if v["entered"] or v["offsite"]:
                continue
            kind = _tkind(teacher)
            if _find(db, day, kind, slot) is not None:
                continue
            claimed = _claim(db, day, kind, slot)
            if claimed is None:
                continue
            c = contacts.get(str(v.get("dep") or "")) or {}
            st = {**v, "teacher": teacher, "para": para, "slot": slot,
                  "stage": "15" if now >= start + dt.timedelta(minutes=SECOND_ALERT) else "10",
                  "contact": _contact_name(str(c.get("name") or "")), "calls": [], "comments": [],
                  # Post qaysi daqiqada ketgani: dalil undan oldingi vaqtni ko'rsatsa — ma'lumot kech yetgan.
                  "posted_min": int((now - start).total_seconds() // 60)}
            body = teacher_text(st)
            try:
                chat, ids = _send(db, chat, body, markup=_keyboard(claimed.id, st))
            except BotError as exc:
                claimed.status, claimed.error = "failed", exc.description[:500]
                db.commit()
                log.warning("lesson-bot: post yuborilmadi: %s", exc.description)
                continue
            claimed.chat_id, claimed.message_ids, claimed.status = chat, ids, "sent"
            dm = _send_dm(db, responsible_tg(db, st["contact"], contacts), body, markup=_keyboard(claimed.id, st))
            if dm:
                st["dm"] = dm
            claimed.state, claimed.text_hash = st, _hash(body)
            db.commit()
            stats["posted"] += 1
    for row in _teacher_posts(db, day, slot):
        locked = _lock_post(db, row.id)
        if locked is None or locked.status != "sent":
            db.rollback()
            continue
        st = dict(locked.state or {})
        if st.get("alert"):  # «chiqib ketdi» / «to'liq o'tilmadi» — `_extra_alerts` yangilaydi
            db.rollback()
            continue
        teacher = str(st.get("teacher") or "")
        # O'qituvchining O'Z darsi tugashi (2026-11-18): slotdagi eng uzun blok (ketma-ket 3 para) bo'yicha emas —
        # aks holda 13:00 dagi bir paralik darsning posti 17:20 gacha «davom etmoqda» bo'lib turardi.
        own_end = max((b.end for b in sblocks if b.teacher == teacher), default=end)
        f = _slot_state(sblocks, acts, min(now, own_end), offsite, {teacher}).get(teacher)
        if f:
            if f["entered"] and not st.get("entered"):
                st["entered"], st["late"] = True, f["late"]
                if f["late"] is not None and int(f["late"]) < int(st.get("posted_min") or FIRST_ALERT):
                    st["late_data"] = True
            if f["offsite"] and not st.get("offsite"):
                st["offsite"] = f["offsite"]
        if now >= start + dt.timedelta(minutes=SECOND_ALERT) and st.get("stage") == "10":
            st["stage"] = "15"
        if now > own_end:
            st["stage"] = "final"
            if not st.get("entered") and not st.get("offsite") and "proof" not in st:
                st["proof"] = proof_line(db, [b for b in sblocks if b.teacher == teacher], acts, worked=False)
        before = locked.text_hash
        try:
            _redraw(db, locked, st)
        except BotError as exc:
            db.rollback()
            log.warning("lesson-bot: post tahrirlanmadi: %s", exc.description)
            continue
        if st.get("stage") == "final":
            locked.status = "final"
            db.commit()
            stats["closed"] = stats.get("closed", 0) + 1
        elif locked.text_hash != before:
            stats["edited"] += 1
    chat = _extra_alerts(db, day, now, slot, start, sblocks, acts, offsite, contacts, chat, stats, para)
    return _contact_reminders(db, day, now, slot, start, end, para, contacts, chat, stats)


# ------------------------------------------------------------------ bir aylanish

def _slot_state(blocks: list[Block], acts, now, offsite, only: set[str] | None = None) -> dict:
    """Slot o'qituvchilari holati. Bir o'qituvchining shu slotdagi bir nechta bloki — bitta qator."""
    state: dict[str, dict] = {}
    for b in blocks:
        if only is not None and b.teacher not in only:
            continue
        v = state.setdefault(b.teacher, {"name": b.name, "dep": b.department, "fac": b.faculty, "rooms": [],
                                         "entered": False, "late": None, "offsite": ""})
        v["rooms"] = sorted(set(v["rooms"]) | set(b.rooms))[:3]
        mark = next((offsite[b.teacher][i] for i in b.lesson_ids if i in (offsite.get(b.teacher) or {})), "")
        if mark:
            v["offsite"] = mark
        when = entered_at(b, acts, now)
        if when is not None and not v["entered"]:
            v["entered"] = True
            v["late"] = _late(b, when)
    return state


def slot_para(sblocks: list[Block]) -> str:
    """Slot sarlavhasidagi para — shu vaqtda BOSHLANADIGAN para (2026-11-25).

    Ilgari birinchi blokning birinchi parasi olinardi: u sikl bo'lsa (2–3-para, sloti — oxirgi para boshi 11:00),
    11:00 dagi hamma o'qituvchi posti «2-para (11:00)» bo'lib chiqardi. Sikl blokida — oxirgi parasi."""
    names = [(b.para or "").split("–")[-1].strip() for b in sblocks]
    names = [n for n in names if n]
    if not names:
        return sblocks[0].first_para or sblocks[0].para
    return max(sorted(set(names)), key=names.count)


def run_once(db: Session, now: dt.datetime | None = None, *, dry: bool = False) -> dict:
    """Bitta aylanish: yangi ogohlantirishlar, ochiq xabarlarni yangilash, kunlik hisobot.

    `dry=True` — hech narsa yuborilmaydi va yozilmaydi, faqat matnlar qaytariladi (tekshirish uchun).
    """
    now = now or dt.datetime.now(TZ)
    day = now.date()
    stats: dict = {"posted": 0, "edited": 0, "daily": 0, "texts": []}
    blocks = day_blocks(db, day)
    if not blocks:
        return stats
    chat = None if dry else chat_id(db)
    if chat is None and not dry:
        stats["no_chat"] = True
        return stats
    acts = activity_times(db, {b.teacher for b in blocks}, day, {g for b in blocks for g in b.groups})
    offsite = offsite_reason(db, day)
    contacts = department_contacts(db)
    by_slot: dict[str, list[Block]] = defaultdict(list)
    for b in blocks:
        by_slot[b.slot].append(b)

    # Har para — o'z sloti (ketma-ket paralar birlashtirilmaydi).
    for slot, sblocks in sorted(by_slot.items()):
        start = min(b.start for b in sblocks)
        end = max(b.end for b in sblocks)
        para = slot_para(sblocks)
        total = len({b.teacher for b in sblocks})
        if dry:
            if start + dt.timedelta(minutes=FIRST_ALERT) <= now <= start + dt.timedelta(minutes=STALE_AFTER["alert10"]):
                stage = "15" if now >= start + dt.timedelta(minutes=SECOND_ALERT) else "10"
                for teacher, v in sorted(_slot_state(sblocks, acts, now, offsite).items()):
                    if v["entered"] or v["offsite"]:
                        continue
                    c = contacts.get(str(v.get("dep") or "")) or {}
                    stats["texts"].append(teacher_text({**v, "teacher": teacher, "para": para, "slot": slot,
                                                        "stage": stage, "contact": _contact_name(str(c.get("name") or ""))}))
            continue
        legacy = _legacy_posts(db, day, slot)
        if legacy:
            # Deploydan oldin yuborilgan ro'yxat (bitta xabar) — shu slotda yangi postlar yo'q, faqat «yakuni».
            if now > end:
                for row in legacy:
                    if row.status != "sent":
                        continue
                    teachers = dict((row.state or {}).get("teachers") or {})
                    fresh = _slot_state(sblocks, acts, end, offsite, set(teachers))
                    for k, v in teachers.items():
                        f = fresh.get(k)
                        if f:
                            v.update(entered=f["entered"], late=f["late"], offsite=f["offsite"])
                    body = alert_text(row.kind, slot, (row.state or {}).get("para", para),
                                      (row.state or {}).get("total", total), teachers, final=True, contacts=contacts)
                    try:
                        if _hash(body) != row.text_hash:
                            _edit(int(row.chat_id), list(row.message_ids or []), body)
                    except BotError as exc:
                        log.warning("lesson-bot: yakuni tahrirlanmadi: %s", exc.description)
                        continue
                    row.state = {**(row.state or {}), "teachers": teachers}
                    row.text_hash = _hash(body)
                    row.status = "final"
                    db.commit()
                    stats["closed"] = stats.get("closed", 0) + 1
            continue
        chat = _teacher_alerts(db, day, now, slot, sblocks, acts, offsite, contacts, chat, stats)

    # Kunlik hisobot — oxirgi dars tugagach.
    last_end = max(b.end for b in blocks)
    if now >= last_end + DAILY_DELAY and now.time() <= DAILY_UNTIL:
        body = daily_text(day, blocks, acts, offsite, block_measures(db, day, blocks))
        if dry:
            stats["texts"].append(body)
        else:
            claimed = _claim(db, day, "daily", "")
            if claimed is not None:
                try:
                    chat, ids = _send(db, chat, body)
                    claimed.chat_id, claimed.message_ids, claimed.status = chat, ids, "sent"
                    claimed.text_hash = _hash(body)
                    stats["daily"] += 1
                except BotError as exc:
                    claimed.status, claimed.error = "failed", exc.description[:500]
                    log.warning("lesson-bot: kunlik hisobot yuborilmadi: %s", exc.description)
                db.commit()
    return stats


def run_once_locked() -> dict | None:
    from app.core.db import SessionLocal, engine

    with engine.connect() as conn:
        got = conn.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": LOCK_KEY}).scalar()
        conn.commit()
        if not got:
            return None
        try:
            with SessionLocal() as db:
                return run_once(db)
        finally:
            conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": LOCK_KEY})
            conn.commit()


def _loop() -> None:
    time.sleep(random.uniform(5, 20))
    while True:
        try:
            stats = run_once_locked()
            if stats and any(stats.get(k) for k in ("posted", "edited", "daily", "closed", "entered")):
                log.info("lesson-bot: %s", {k: v for k, v in stats.items() if k != "texts"})
        except Exception:  # noqa: BLE001 — oqim to'xtab qolmasin
            log.warning("lesson-bot: aylanishda xato", exc_info=True)
        time.sleep(INTERVAL_SECONDS)


def start_background() -> None:
    if not enabled():
        return
    threading.Thread(target=_loop, name="lesson-watch-bot", daemon=True).start()
    threading.Thread(target=_poll_loop, name="lesson-watch-bot-updates", daemon=True).start()
