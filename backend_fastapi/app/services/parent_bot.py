"""Ota-onalar Telegram boti: suhbat (2026-10-22).

Foydalanuvchi talabi: ota-ona /start bosadi, farzandining fakulteti, kursi va
guruhini tanlaydi, chiqqan ro'yxatdan o'z farzandini tanlaydi (bir nechta farzand
bo'lishi mumkin). Shundan keyin har kuni darsdagi har bir test — nechanchi para,
qaysi fan, qaysi mavzu, necha ball — ota-onaga o'zi boradi, tarixni ham ko'radi.

Qo'shimcha (so'ralmagan, lekin kerak):
* farzand tug'ilgan sanasi bilan tasdiqlanadi — aks holda istalgan odam
  ro'yxatdan istalgan talabani tanlab, uning baholarini kuzatib yurardi;
* kunning to'liq ko'rinishi: guruhning HEMIS'dagi barcha paralari, har birida
  natija, «guruhda test bo'ldi, farzandingiz natijasi yo'q» belgisi; ◀️ ▶️ bilan
  istalgan kun;
* fanlar bo'yicha o'rtacha, so'nggi 30 kun; kechqurun kunlik hisobot (o'chirsa bo'ladi);
* o'zbek, rus, ingliz tillari.

Tugmalarda (`callback_data`, 64 bayt) faqat qisqa kod va tartib raqami yuradi,
ro'yxatlarning o'zi suhbat holatida (`state_data`) saqlanadi.
"""

from __future__ import annotations

import datetime as dt
import html
import logging
import re
import zlib

from sqlalchemy import func, select
from sqlalchemy import text as sql_text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models.parent_bot import ParentBotChat, ParentBotLink
from app.services import parent_bot_data as data
from app.services.parent_bot_text import LANG_NAMES, LANGS, lang_of, menu_buttons, tr, weekday
from app.services.telegram_api import Api, TelegramError

log = logging.getLogger("app.parent_bot")

MAX_CHILDREN = 6
MAX_PARENTS = 5
MAX_FAILED = 5
#: Bitta talaba uchun kuniga barcha suhbatlardan jami noto'g'ri urinish (2026-10-23).
MAX_FAILED_PER_STUDENT = 10
GROUPS_PER_PAGE = 24
GROUPS_PER_ROW = 3
STUDENTS_PER_PAGE = 15
HISTORY_PER_PAGE = 8
DAILY_AT = dt.time(19, 0)

_DATE = re.compile(r"^\s*(\d{1,2})[.\-/ ,](\d{1,2})[.\-/ ,](\d{4})\s*$")
_ISO = re.compile(r"^\s*(\d{4})-(\d{1,2})-(\d{1,2})\s*$")


def esc(text) -> str:
    return html.escape(str(text or ""), quote=False)


def now_local() -> dt.datetime:
    return dt.datetime.now(data.TZ)


def fmt_date(day: dt.date) -> str:
    return day.strftime("%d.%m.%Y")


def para_label(lang: str, para: str) -> str:
    m = re.match(r"\s*(\d+)", para or "")
    return tr(lang, "para", n=m.group(1)) if m else esc(para)


def parse_birth(text: str) -> dt.date | None:
    m = _DATE.match(text or "")
    if m:
        d, mo, y = (int(x) for x in m.groups())
    else:
        m = _ISO.match(text or "")
        if not m:
            return None
        y, mo, d = (int(x) for x in m.groups())
    try:
        return dt.date(y, mo, d)
    except ValueError:
        return None


# ------------------------------------------------------------------ klaviaturalar

def kb(rows: list[list[tuple[str, str]]]) -> dict:
    return {"inline_keyboard": [[{"text": t, "callback_data": c} for t, c in row] for row in rows if row]}


def main_menu(lang: str) -> dict:
    return {
        "keyboard": [
            [{"text": tr(lang, "btn_today")}, {"text": tr(lang, "btn_history")}],
            [{"text": tr(lang, "btn_children")}, {"text": tr(lang, "btn_add")}],
            [{"text": tr(lang, "btn_settings")}, {"text": tr(lang, "btn_help")}],
        ],
        "resize_keyboard": True,
        "is_persistent": True,
    }


def tag(value: str) -> str:
    """Tugmadagi element belgisi: ro'yxat almashgan bo'lsa eski xabardagi tugma rad etiladi."""
    return str(zlib.crc32(str(value).encode("utf-8")) % 1000)


def pick(items: list, rest: str):
    """`"3:417"` → items[3] (belgi mos bo'lsa); belgisiz eski tugma ham qabul qilinadi."""
    idx_text, _, mark = rest.partition(":")
    idx = int(idx_text) if idx_text.isdigit() else -1
    if not 0 <= idx < len(items):
        return -1, None
    item = items[idx]
    key = item[0] if isinstance(item, (list, tuple)) else item
    if mark and mark != tag(key):
        return -1, None
    return idx, item


def language_kb() -> dict:
    return kb([[(LANG_NAMES[code], f"L:{code}")] for code in LANGS])


def pager(lang: str, page: int, pages: int, code: str) -> list[tuple[str, str]]:
    if pages <= 1:
        return []
    row = []
    if page > 0:
        row.append((tr(lang, "btn_prev"), f"{code}:{page - 1}"))
    row.append((tr(lang, "page", page=page + 1, pages=pages), "noop"))
    if page < pages - 1:
        row.append((tr(lang, "btn_next"), f"{code}:{page + 1}"))
    return row


# ------------------------------------------------------------------ ekranlar (matn + tugmalar)

def faculty_screen(lang: str, faculties: list[str]) -> tuple[str, dict]:
    rows = [[(name, f"F:{i}:{tag(name)}")] for i, name in enumerate(faculties)]
    rows.append([(tr(lang, "btn_cancel"), "X")])
    return tr(lang, "pick_faculty"), kb(rows)


def course_screen(lang: str, faculty: str, courses: list[int]) -> tuple[str, dict]:
    labels = [(tr(lang, "course", n=c), f"C:{c}") for c in courses]
    rows = [labels[i:i + 3] for i in range(0, len(labels), 3)]
    rows.append([(tr(lang, "btn_back"), "F"), (tr(lang, "btn_cancel"), "X")])
    return tr(lang, "pick_course", faculty=esc(faculty)), kb(rows)


def group_screen(lang: str, faculty: str, course: int, groups: list[str], page: int) -> tuple[str, dict]:
    pages = max(1, -(-len(groups) // GROUPS_PER_PAGE))
    page = min(max(page, 0), pages - 1)
    start = page * GROUPS_PER_PAGE
    chunk = [(g, f"g:{start + i}:{tag(g)}") for i, g in enumerate(groups[start:start + GROUPS_PER_PAGE])]
    rows = [chunk[i:i + GROUPS_PER_ROW] for i in range(0, len(chunk), GROUPS_PER_ROW)]
    rows.append(pager(lang, page, pages, "G"))
    rows.append([(tr(lang, "btn_back"), "Fc"), (tr(lang, "btn_cancel"), "X")])
    return tr(lang, "pick_group", faculty=esc(faculty), course=course), kb(rows)


def student_screen(lang: str, group: str, students: list[list[str]], page: int, linked: set[str]) -> tuple[str, dict]:
    pages = max(1, -(-len(students) // STUDENTS_PER_PAGE))
    page = min(max(page, 0), pages - 1)
    start = page * STUDENTS_PER_PAGE
    rows = []
    for i, (sid, name) in enumerate(students[start:start + STUDENTS_PER_PAGE]):
        mark = "✅ " if sid in linked else ""
        rows.append([(f"{mark}{data.masked_name(name)}", f"s:{start + i}:{tag(sid)}")])
    rows.append(pager(lang, page, pages, "S"))
    rows.append([(tr(lang, "btn_back"), "Cg"), (tr(lang, "btn_cancel"), "X")])
    return tr(lang, "pick_student", group=esc(group)), kb(rows)


def lesson_head(lang: str, lesson: data.Lesson) -> str:
    kind = tr(lang, "lesson_kind", kind=esc(lesson.kind)) if lesson.kind else ""
    return tr(lang, "lesson", para=para_label(lang, lesson.para), start=esc(lesson.start), end=esc(lesson.end),
              subject=esc(lesson.subject), kind=kind)


def short(text: str, limit: int = 160) -> str:
    text = " ".join(str(text or "").split())
    return text if len(text) <= limit else text[:limit - 1].rstrip() + "…"


def result_lines(lang: str, a: data.Attempt) -> list[str]:
    out = [tr(lang, "test_result", score=a.score, total=a.total, pct=a.pct, grade=data.grade(a.score, a.total))]
    if a.topic:
        out.append(tr(lang, "topic", topic=esc(short(a.topic))))
    return out


def day_text(lang: str, name: str, group: str, day: dt.date, entries: list[data.DayEntry],
             extras: list[data.Attempt], names: dict[str, str], now: dt.datetime) -> str:
    lines = [tr(lang, "day_title", date=fmt_date(day), weekday=weekday(lang, day), name=esc(name), group=esc(group))]
    if not entries:
        lines += ["", tr(lang, "no_lessons")]
    done: list[data.Attempt] = []
    for e in entries:
        lines += ["", lesson_head(lang, e.lesson)]
        for a in e.results:
            lines += result_lines(lang, a)
            done.append(a)
        if e.pending:
            lines.append(tr(lang, "test_pending"))
        elif e.missed and not e.results:
            lines.append(tr(lang, "test_missed", n=e.missed))
        elif not e.results and e.lesson.ends is not None and now >= e.lesson.ends:
            lines.append(tr(lang, "no_test"))
    if extras:
        lines += ["", tr(lang, "outside_lessons")]
        for a in extras:
            subject = data.clean_subject(names.get(a.subject_code) or a.subject_code)
            lines.append(f"{a.local.strftime('%H:%M')} · {esc(subject)}")
            lines += result_lines(lang, a)
            done.append(a)
    if done:
        avg = round(sum(a.pct for a in done) / len(done))
        lines += ["", tr(lang, "day_total", n=len(done), pct=avg)]
    return "\n".join(lines)


def notice_text(lang: str, name: str, group: str, a: data.Attempt, lesson: data.Lesson | None,
                subject: str, avg: float | None) -> str:
    local = a.local
    when = (f"{para_label(lang, lesson.para)} ({esc(lesson.start)}–{esc(lesson.end)})" if lesson
            else tr(lang, "para_outside", time=local.strftime("%H:%M")))
    g = data.grade(a.score, a.total)
    lines = [
        tr(lang, "notice_title"), "",
        tr(lang, "notice_student", name=esc(name), group=esc(group)),
        tr(lang, "notice_when", date=fmt_date(local.date()), weekday=weekday(lang, local.date()), para=when),
        tr(lang, "notice_subject", subject=esc(subject)),
    ]
    if a.topic:
        lines.append(tr(lang, "notice_topic", topic=esc(short(a.topic, 300))))
    lines.append(tr(lang, "notice_score", score=a.score, total=a.total, pct=a.pct, grade=g,
                    grade_name=tr(lang, f"grade_{g}")))
    if avg is not None:
        lines.append(tr(lang, "notice_avg", avg=f"{avg:.1f}".rstrip("0").rstrip("."), total=a.total))
    return "\n".join(lines)


def notice_many_text(lang: str, name: str, group: str,
                     items: list[tuple[data.Attempt, data.Lesson | None, str]]) -> str:
    """Bir vaqtda chiqqan bir nechta natija — bitta xabarda (kuniga 10+ test yechadiganlar ham bor)."""
    days = {a.local.date() for a, _l, _s in items}
    lines = [tr(lang, "notice_many_title", n=len(items)), "",
             tr(lang, "notice_student", name=esc(name), group=esc(group))]
    if len(days) == 1:
        day = next(iter(days))
        lines.append(f"📅 {fmt_date(day)}, {weekday(lang, day)}")
    for a, lesson, subject in items:
        when = para_label(lang, lesson.para) if lesson else a.local.strftime("%H:%M")
        if len(days) > 1:
            when = f"{a.local.strftime('%d.%m')} · {when}"
        lines += ["", f"<b>{when}</b> · {esc(subject)}"]
        lines += result_lines(lang, a)
    return "\n".join(lines)


# ------------------------------------------------------------------ ma'lumotdan ekranga

def render_day(db: Session, lang: str, link: ParentBotLink, day: dt.date, now: dt.datetime,
               *, nav: bool = True) -> tuple[str, dict | None, bool]:
    """(matn, tugmalar, shu kuni ko'rsatadigan narsa bormi)."""
    st = data.student(db, link.student_id)
    group = st.group_name if st else ""
    name = data.full_name(st) if st else link.student_id
    lessons = data.lessons_on(db, group, day)
    mine = data.attempts_on(db, [link.student_id], day)
    mates: list[data.Attempt] = []
    if lessons and any(lesson.ends and now >= lesson.ends for lesson in lessons):
        mates = data.attempts_on(db, data.group_mates(db, group, link.student_id), day)
    entries, extras = data.day_view(lessons, mine, mates, now)
    names = data.subject_names(db, {a.subject_code for a in extras})
    text = day_text(lang, name, group, day, entries, extras, names, now)
    has = bool(lessons or extras)
    if not nav:
        return text, kb([[(tr(lang, "btn_results"), f"!H:{link.id}:0")]]), has
    stamp = lambda d: d.strftime("%Y%m%d")  # noqa: E731
    rows = [[(tr(lang, "btn_prev_day"), f"D:{link.id}:{stamp(day - dt.timedelta(days=1))}"),
             (tr(lang, "btn_next_day"), f"D:{link.id}:{stamp(day + dt.timedelta(days=1))}")]]
    if day != now.date():
        rows.append([(tr(lang, "btn_today_short"), f"D:{link.id}:t")])
    rows.append([(tr(lang, "btn_results"), f"H:{link.id}:0"), (tr(lang, "btn_subjects"), f"J:{link.id}")])
    return text, kb(rows), has


def render_history(db: Session, lang: str, link: ParentBotLink, page: int, now: dt.datetime) -> tuple[str, dict]:
    st = data.student(db, link.student_id)
    name = data.full_name(st) if st else link.student_id
    group = st.group_name if st else ""
    page = max(page, 0)
    items, more = data.attempt_page(db, link.student_id, offset=page * HISTORY_PER_PAGE,
                                    limit=HISTORY_PER_PAGE, now=now)
    lines = [tr(lang, "history_title", name=esc(name))]
    n30, pct30 = data.stats_since(db, link.student_id, now.date() - dt.timedelta(days=30), now)
    if n30:
        lines.append(tr(lang, "history_stats", n=n30, pct=pct30, grade=data.grade_of(pct30) or 2))
    if not items:
        lines += ["", tr(lang, "history_empty")]
    names = data.subject_names(db, {a.subject_code for a in items})
    lessons_by_day: dict[dt.date, list[data.Lesson]] = {}
    for a in items:
        day = a.local.date()
        if day not in lessons_by_day:
            lessons_by_day[day] = data.lessons_on(db, group, day)
        lesson = data.match_lesson(lessons_by_day[day], a.submitted_at, a.owner)
        subject = (lesson.subject if lesson else "") or data.clean_subject(names.get(a.subject_code) or a.subject_code)
        para = para_label(lang, lesson.para) if lesson else a.local.strftime("%H:%M")
        lines += ["", tr(lang, "history_item", date=fmt_date(day), para=para, subject=esc(subject),
                         topic=esc(short(a.topic) or "—"), score=a.score, total=a.total, pct=a.pct,
                         grade=data.grade(a.score, a.total))]
    nav = []
    if more:
        nav.append((tr(lang, "btn_older"), f"H:{link.id}:{page + 1}"))
    if page > 0:
        nav.append((tr(lang, "btn_newer"), f"H:{link.id}:{page - 1}"))
    rows = [nav, [(tr(lang, "btn_subjects"), f"J:{link.id}"), (tr(lang, "btn_today_short"), f"D:{link.id}:t")]]
    return "\n".join(lines), kb(rows)


def render_subjects(db: Session, lang: str, link: ParentBotLink, now: dt.datetime) -> tuple[str, dict]:
    st = data.student(db, link.student_id)
    name = data.full_name(st) if st else link.student_id
    rows = data.subject_stats(db, link.student_id, st.group_name if st else "",
                              data.academic_year_start(now.date()), now)
    lines = [tr(lang, "subjects_title", name=esc(name))]
    if not rows:
        lines += ["", tr(lang, "history_empty")]
    for subject, n, avg, last in rows:
        lines += ["", tr(lang, "subject_item", subject=esc(subject), n=n, pct=avg,
                         last=fmt_date(last) if last else "—")]
    return "\n".join(lines), kb([[(tr(lang, "btn_results"), f"H:{link.id}:0"),
                                  (tr(lang, "btn_today_short"), f"D:{link.id}:t")]])


# ------------------------------------------------------------------ suhbat

class Ctx:
    def __init__(self, db: Session, api: Api, chat: ParentBotChat, now: dt.datetime):
        self.db, self.api, self.chat, self.now = db, api, chat, now

    @property
    def lang(self) -> str:
        return lang_of(self.chat.language)

    def send(self, text: str, markup: dict | None = None) -> None:
        self.api.send(self.chat.chat_id, text, markup)

    def show(self, text: str, markup: dict | None, message_id: int | None) -> None:
        if message_id:
            try:
                self.api.edit(self.chat.chat_id, message_id, text, markup)
                return
            except TelegramError as exc:
                log.info("parent-bot: xabarni tahrirlab bo'lmadi (%s), yangisi yuboriladi", exc.code)
        self.send(text, markup)

    def set_state(self, state: str = "", **values) -> None:
        self.chat.state = state
        self.chat.state_data = values

    def links(self) -> list[ParentBotLink]:
        return list(self.db.execute(
            select(ParentBotLink).where(ParentBotLink.chat_id == self.chat.chat_id, ParentBotLink.is_active.is_(True))
            .order_by(ParentBotLink.id)
        ).scalars().all())

    def link(self, link_id: str) -> ParentBotLink | None:
        try:
            pk = int(link_id)
        except (TypeError, ValueError):
            return None
        row = self.db.get(ParentBotLink, pk)
        if row is None or row.chat_id != self.chat.chat_id or not row.is_active:
            return None
        return row


def chat_for(db: Session, tg_chat: dict, user: dict | None) -> ParentBotChat:
    chat_id = int(tg_chat["id"])
    db.execute(insert(ParentBotChat).values(chat_id=chat_id, state_data={}).on_conflict_do_nothing(
        index_elements=["chat_id"]))
    # Bitta suhbatning ikki yangilanishi parallel kelsa, holat (tanlov bosqichi) aralashmasin.
    chat = db.execute(select(ParentBotChat).where(ParentBotChat.chat_id == chat_id).with_for_update()).scalar_one()
    if user:
        chat.tg_username = str(user.get("username") or "")[:64]
        chat.tg_name = " ".join(x for x in (user.get("first_name"), user.get("last_name")) if x)[:255]
        if not chat.language and str(user.get("language_code") or "")[:2] in LANGS:
            chat.state_data = {**(chat.state_data or {}), "suggested": str(user.get("language_code"))[:2]}
    return chat


def handle_update(db: Session, update: dict, api: Api | None = None, now: dt.datetime | None = None) -> None:
    api = api or Api()
    now = now or now_local()
    member = update.get("my_chat_member")
    if member:
        tg_chat = member.get("chat") or {}
        if tg_chat.get("type") == "private":
            chat = chat_for(db, tg_chat, member.get("from"))
            chat.is_blocked = (member.get("new_chat_member") or {}).get("status") == "kicked"
            db.commit()
        return
    msg = update.get("message")
    cb = update.get("callback_query")
    tg_chat = (msg or (cb or {}).get("message") or {}).get("chat") or {}
    if tg_chat.get("type") != "private":
        return
    chat = chat_for(db, tg_chat, (msg or cb or {}).get("from"))
    # Telegram javob ololmagan yangilanishni qayta yuboradi — o'shani ikkinchi marta bajarmaymiz.
    update_id = int(update.get("update_id") or 0)
    if update_id and update_id == (chat.last_update_id or 0):
        db.commit()
        return
    chat.last_update_id = max(update_id, chat.last_update_id or 0)
    chat.is_blocked = False
    ctx = Ctx(db, api, chat, now)
    try:
        if msg:
            on_message(ctx, msg)
        else:
            on_callback(ctx, cb)
    finally:
        db.commit()


def on_message(ctx: Ctx, msg: dict) -> None:
    text = (msg.get("text") or "").strip()
    command = text.split()[0].split("@")[0].lower() if text.startswith("/") else ""
    if command == "/start" or not ctx.chat.language:
        ctx.set_state()
        if not ctx.chat.language:
            ctx.send(tr("uz", "choose_lang") + "\n" + tr("ru", "choose_lang") + "\n" + tr("en", "choose_lang"),
                     language_kb())
            return
        welcome(ctx)
        return
    commands = {"/today": "btn_today", "/history": "btn_history", "/children": "btn_children", "/add": "btn_add",
                "/settings": "btn_settings", "/help": "btn_help", "/language": "lang", "/til": "lang"}
    action = commands.get(command) or menu_buttons().get(text)
    if action:
        ctx.set_state()
        menu_action(ctx, action)
        return
    if ctx.chat.state == "verify":
        verify(ctx, text)
        return
    ctx.send(tr(ctx.lang, "unknown"), main_menu(ctx.lang))


def welcome(ctx: Ctx) -> None:
    ctx.send(tr(ctx.lang, "welcome"), main_menu(ctx.lang))
    if not ctx.links():
        start_add(ctx, None)


def menu_action(ctx: Ctx, action: str) -> None:
    lang = ctx.lang
    if action == "lang":
        ctx.send(tr(lang, "choose_lang"), language_kb())
    elif action == "btn_add":
        start_add(ctx, None)
    elif action == "btn_help":
        ctx.send(tr(lang, "help"), main_menu(lang))
    elif action == "btn_settings":
        text, markup = settings_screen(ctx)
        ctx.send(text, markup)
    elif action == "btn_children":
        text, markup = children_screen(ctx)
        ctx.send(text, markup)
    elif action in ("btn_today", "btn_history"):
        links = ctx.links()
        if not links:
            ctx.send(tr(lang, "no_children"), kb([[(tr(lang, "btn_add"), "F")]]))
            return
        if len(links) == 1:
            if action == "btn_today":
                text, markup, _has = render_day(ctx.db, lang, links[0], ctx.now.date(), ctx.now)
            else:
                text, markup = render_history(ctx.db, lang, links[0], 0, ctx.now)
            ctx.send(text, markup)
            return
        code = "D:{}:t" if action == "btn_today" else "H:{}:0"
        people = data.students_by_id(ctx.db, [link.student_id for link in links])
        rows = [[(data.full_name(people[link.student_id]) if link.student_id in people else link.student_id,
                  code.format(link.id))] for link in links]
        ctx.send(tr(lang, "pick_child"), kb(rows))


def settings_screen(ctx: Ctx) -> tuple[str, dict]:
    lang = ctx.lang
    on = ctx.chat.daily_summary
    text = tr(lang, "settings", at=DAILY_AT.strftime("%H:%M"), state=tr(lang, "on" if on else "off"),
              lang=LANG_NAMES[lang])
    return text, kb([[(tr(lang, "btn_daily_off" if on else "btn_daily_on"), "N:off" if on else "N:on")],
                     [(tr(lang, "btn_language"), "Z")]])


def children_screen(ctx: Ctx) -> tuple[str, dict]:
    lang = ctx.lang
    links = ctx.links()
    if not links:
        return tr(lang, "no_children"), kb([[(tr(lang, "btn_add"), "F")]])
    people = data.students_by_id(ctx.db, [link.student_id for link in links])
    lines = [tr(lang, "children_title")]
    rows = []
    for link in links:
        st = people.get(link.student_id)
        if st is None:
            continue
        lines += ["", tr(lang, "child_card", name=esc(data.full_name(st)), faculty=esc(st.faculty_name),
                         course=st.course or "—", group=esc(st.group_name))]
        if st.status != "active":
            lines.append(tr(lang, "child_inactive", status=esc(st.status)))
        rows.append([(data.full_name(st), f"k:{link.id}")])
    if len(links) < MAX_CHILDREN:
        rows.append([(tr(lang, "btn_add"), "F")])
    return "\n".join(lines), kb(rows)


def child_screen(ctx: Ctx, link: ParentBotLink) -> tuple[str, dict]:
    lang = ctx.lang
    st = data.student(ctx.db, link.student_id)
    if st is None:
        return tr(lang, "stale"), kb([[(tr(lang, "btn_back"), "K")]])
    text = tr(lang, "child_card", name=esc(data.full_name(st)), faculty=esc(st.faculty_name),
              course=st.course or "—", group=esc(st.group_name))
    if st.status != "active":
        text += "\n" + tr(lang, "child_inactive", status=esc(st.status))
    rows = [[(tr(lang, "btn_today_short"), f"D:{link.id}:t"), (tr(lang, "btn_results"), f"H:{link.id}:0")],
            [(tr(lang, "btn_subjects"), f"J:{link.id}")],
            [(tr(lang, "btn_remove"), f"R:{link.id}"), (tr(lang, "btn_back"), "K")]]
    return text, kb(rows)


# ------------------------------------------------------------------ farzand qo'shish

def start_add(ctx: Ctx, message_id: int | None) -> None:
    if len(ctx.links()) >= MAX_CHILDREN:
        ctx.show(tr(ctx.lang, "limit_children", n=MAX_CHILDREN), None, message_id)
        return
    faculties = data.faculties(ctx.db)
    ctx.set_state("add", faculties=faculties)
    text, markup = faculty_screen(ctx.lang, faculties)
    ctx.show(text, markup, message_id)


def verify(ctx: Ctx, text: str) -> None:
    lang = ctx.lang
    pick = (ctx.chat.state_data or {}).get("pick") or []
    if len(pick) < 3:
        ctx.set_state()
        ctx.send(tr(lang, "stale"), main_menu(lang))
        return
    sid, name, group = pick[:3]
    today = ctx.now.date()
    if ctx.chat.failed_day != today:
        ctx.chat.failed_day, ctx.chat.failed_checks = today, 0
    if ctx.chat.failed_checks >= MAX_FAILED:
        ctx.set_state()
        ctx.send(tr(lang, "too_many"), main_menu(lang))
        return
    if data.student_failures(ctx.db, sid, today) >= MAX_FAILED_PER_STUDENT:
        ctx.set_state()
        ctx.send(tr(lang, "too_many_student"), main_menu(lang))
        return
    st = data.student(ctx.db, sid)
    digits = re.sub(r"\D", "", text)
    looks_like_id = len(digits) >= 10 and parse_birth(text) is None
    by_id = looks_like_id and st is not None and digits == st.student_id
    born = parse_birth(text)
    # Noto'g'ri ID ham urinish (2026-10-23): ilgari u "format xato" deb qaytarilib
    # sanalmasdi va ID'larni cheksiz terib chiqish mumkin edi.
    if not by_id and born is None and not looks_like_id:
        ctx.send(tr(lang, "bad_format"))
        return
    if not by_id and born is not None and st is not None and st.birth_date is None:
        # HEMIS'da sana yo'q — sana bilan tasdiqlab bo'lmaydi, urinish sanalmaydi.
        ctx.send(tr(lang, "need_id"))
        return
    if st is None or not (by_id or (st.birth_date is not None and born == st.birth_date)):
        data.add_student_failure(ctx.db, sid, today)
        ctx.chat.failed_checks += 1
        left = MAX_FAILED - ctx.chat.failed_checks
        if left <= 0:
            ctx.set_state()
            ctx.send(tr(lang, "too_many"), main_menu(lang))
        else:
            ctx.send(tr(lang, "bad_birth", left=left) + "\n\n" + tr(lang, "verify_hint"))
        log.info("parent-bot: tasdiqlash mos kelmadi (chat=%s)", ctx.chat.chat_id)
        return
    link_child(ctx, sid, name, group)


def link_child(ctx: Ctx, sid: str, name: str, group: str) -> None:
    lang = ctx.lang
    db = ctx.db
    ctx.set_state()
    existing = db.execute(select(ParentBotLink).where(ParentBotLink.chat_id == ctx.chat.chat_id,
                                                      ParentBotLink.student_id == sid)).scalar_one_or_none()
    if existing is not None and existing.is_active:
        ctx.send(tr(lang, "already_linked", name=esc(name)), main_menu(lang))
        return
    if len(ctx.links()) >= MAX_CHILDREN:
        ctx.send(tr(lang, "limit_children", n=MAX_CHILDREN), main_menu(lang))
        return
    # Bir vaqtda ikki suhbatdan ulanayotgan bo'lsa — navbat bilan (cheklov oshib ketmasin).
    if db.get_bind().dialect.name == "postgresql":
        db.execute(sql_text("SELECT pg_advisory_xact_lock(7210824, :k)"), {"k": zlib.crc32(sid.encode()) & 0x7FFFFFFF})
    others = list(db.execute(select(ParentBotLink.chat_id).where(
        ParentBotLink.student_id == sid, ParentBotLink.is_active.is_(True),
        ParentBotLink.chat_id != ctx.chat.chat_id)).scalars().all())
    parents = len(others)
    if parents >= MAX_PARENTS:
        ctx.send(tr(lang, "limit_parents", n=MAX_PARENTS), main_menu(lang))
        return
    if existing is None:
        existing = ParentBotLink(chat_id=ctx.chat.chat_id, student_id=sid, is_active=True)
        db.add(existing)
    else:
        existing.is_active = True
        existing.created_at = dt.datetime.now(dt.timezone.utc)
    db.flush()
    log.info("parent-bot: farzand ulandi (chat=%s, link=%s)", ctx.chat.chat_id, existing.id)
    ctx.send(tr(lang, "linked", name=esc(name)), main_menu(lang))
    tell_other_parents(ctx, others, name)
    text, markup, _has = render_day(db, lang, existing, ctx.now.date(), ctx.now)
    ctx.send(text, markup)


def parents_of(db: Session, sid: str) -> int:
    return int(db.execute(select(func.count()).select_from(ParentBotLink).where(
        ParentBotLink.student_id == sid, ParentBotLink.is_active.is_(True))).scalar_one())


def tell_other_parents(ctx: Ctx, chat_ids: list[int], name: str) -> None:
    """Farzandga yangi hisob ulanganda avval ulangan ota-onalarga xabar (begona odam bo'lsa bilishsin)."""
    if not chat_ids:
        return
    who = esc(ctx.chat.tg_name or "") or "—"
    if getattr(ctx.chat, "tg_username", ""):
        who += f" (@{esc(ctx.chat.tg_username)})"
    chats = ctx.db.execute(select(ParentBotChat).where(ParentBotChat.chat_id.in_(chat_ids),
                                                       ParentBotChat.is_blocked.is_(False))).scalars().all()
    for chat in chats:
        try:
            ctx.api.send(chat.chat_id, tr(lang_of(chat.language), "new_parent", name=esc(name), who=who))
        except Exception:  # noqa: BLE001 — asosiy ulanishga ta'sir qilmasin
            log.info("parent-bot: boshqa ota-onaga xabar ketmadi (chat=%s)", chat.chat_id)


def on_callback(ctx: Ctx, cb: dict) -> None:
    lang = ctx.lang
    code = str(cb.get("data") or "")
    message_id = (cb.get("message") or {}).get("message_id")
    if code.startswith("!"):
        # Natija yoki kunlik hisobot xabaridagi tugma (2026-10-23): ilgari o'sha xabar
        # tarix ekraniga almashib, ota-ona natijani chatdan yo'qotardi.
        code, message_id = code[1:], None
    ctx.api.answer(str(cb.get("id") or ""))
    state = ctx.chat.state_data or {}
    head, _, rest = code.partition(":")
    db = ctx.db

    def stale() -> None:
        ctx.set_state()
        ctx.show(tr(lang, "stale"), kb([[(tr(lang, "btn_add"), "F")]]), message_id)

    if code == "noop":
        return
    if head == "L" and rest in LANGS:
        first = not ctx.chat.language
        ctx.chat.language = rest
        if first:
            ctx.show(LANG_NAMES[rest], None, message_id)
            welcome(ctx)
        else:
            ctx.show(LANG_NAMES[rest], None, message_id)
            ctx.send(tr(rest, "help"), main_menu(rest))
        return
    if not ctx.chat.language:
        ctx.send(tr("uz", "choose_lang"), language_kb())
        return
    if code == "Z":
        ctx.show(tr(lang, "choose_lang"), language_kb(), message_id)
        return
    if head == "N":
        ctx.chat.daily_summary = rest == "on"
        text, markup = settings_screen(ctx)
        ctx.show(text, markup, message_id)
        return
    if code == "X":
        ctx.set_state()
        ctx.show(tr(lang, "cancelled"), None, message_id)
        return
    if code == "F":
        start_add(ctx, message_id)
        return
    if code == "K":
        text, markup = children_screen(ctx)
        ctx.show(text, markup, message_id)
        return

    # --- fakultet → kurs → guruh → talaba
    if head == "F" or code == "Fc":
        faculties = state.get("faculties") or []
        if code == "Fc":
            faculty = state.get("faculty")
        else:
            _idx, faculty = pick(faculties, rest)
        if not faculty:
            return stale()
        courses = data.courses(db, faculty)
        ctx.set_state("add", faculties=faculties, faculty=faculty)
        text, markup = course_screen(lang, faculty, courses)
        ctx.show(text, markup, message_id)
        return
    if head == "C" or code == "Cg":
        faculty = state.get("faculty")
        course = state.get("course") if code == "Cg" else (int(rest) if rest.isdigit() else None)
        if not faculty or not course:
            return stale()
        groups = data.groups(db, faculty, course)
        if not groups:
            ctx.show(tr(lang, "nothing_found"), course_screen(lang, faculty, data.courses(db, faculty))[1], message_id)
            return
        ctx.set_state("add", faculties=state.get("faculties") or [], faculty=faculty, course=course, groups=groups)
        text, markup = group_screen(lang, faculty, course, groups, 0)
        ctx.show(text, markup, message_id)
        return
    if head == "G":
        groups = state.get("groups") or []
        if not groups:
            return stale()
        text, markup = group_screen(lang, state.get("faculty") or "", state.get("course") or 0, groups,
                                    int(rest) if rest.isdigit() else 0)
        ctx.show(text, markup, message_id)
        return
    if head == "g":
        groups = state.get("groups") or []
        idx, group = pick(groups, rest)
        if group is None:
            return stale()
        people = [[sid, name] for sid, name in data.students(db, group)]
        if not people:
            ctx.show(tr(lang, "nothing_found"), group_screen(lang, state.get("faculty") or "", state.get("course") or 0,
                                                             groups, idx // GROUPS_PER_PAGE)[1], message_id)
            return
        ctx.set_state("add", **{**state, "group": group, "students": people})
        linked = {link.student_id for link in ctx.links()}
        text, markup = student_screen(lang, group, people, 0, linked)
        ctx.show(text, markup, message_id)
        return
    if head == "S":
        people = state.get("students") or []
        if not people:
            return stale()
        ctx.set_state("add", **state)  # tasdiqlashdan orqaga qaytilgan bo'lishi mumkin
        linked = {link.student_id for link in ctx.links()}
        text, markup = student_screen(lang, state.get("group") or "", people, int(rest) if rest.isdigit() else 0, linked)
        ctx.show(text, markup, message_id)
        return
    if head == "s":
        people = state.get("students") or []
        idx, chosen = pick(people, rest)
        if chosen is None:
            return stale()
        sid, name = chosen
        group = state.get("group") or ""
        if sid in {link.student_id for link in ctx.links()}:
            ctx.set_state()
            ctx.show(tr(lang, "already_linked", name=esc(name)), None, message_id)
            return
        # Cheklov tasdiqlashdan OLDIN (2026-10-23): ilgari ota-ona sanani to'g'ri yozgach rad etilardi.
        if parents_of(db, sid) >= MAX_PARENTS:
            ctx.set_state()
            ctx.show(tr(lang, "limit_parents", n=MAX_PARENTS), None, message_id)
            return
        ctx.set_state("verify", **{**state, "pick": [sid, name, group]})
        ctx.show(tr(lang, "ask_birth", name=esc(data.masked_name(name)), group=esc(group)),
                 kb([[(tr(lang, "btn_back"), f"S:{idx // STUDENTS_PER_PAGE}"), (tr(lang, "btn_cancel"), "X")]]),
                 message_id)
        return

    # --- ulangan farzand bo'yicha ko'rinishlar
    link_id, _, arg = rest.partition(":")
    link = ctx.link(link_id) if head in ("k", "D", "H", "J", "R", "RR") else None
    if head in ("k", "D", "H", "J", "R", "RR") and link is None:
        ctx.show(tr(lang, "stale"), None, message_id)
        return
    if head == "k":
        text, markup = child_screen(ctx, link)
        ctx.show(text, markup, message_id)
    elif head == "D":
        day = ctx.now.date()
        if arg and arg != "t":
            try:
                day = dt.datetime.strptime(arg, "%Y%m%d").date()
            except ValueError:
                pass
        text, markup, _has = render_day(db, lang, link, day, ctx.now)
        ctx.show(text, markup, message_id)
    elif head == "H":
        text, markup = render_history(db, lang, link, int(arg) if arg.isdigit() else 0, ctx.now)
        ctx.show(text, markup, message_id)
    elif head == "J":
        text, markup = render_subjects(db, lang, link, ctx.now)
        ctx.show(text, markup, message_id)
    elif head == "R":
        st = data.student(db, link.student_id)
        name = data.full_name(st) if st else link.student_id
        ctx.show(tr(lang, "remove_confirm", name=esc(name)),
                 kb([[(tr(lang, "btn_yes_remove"), f"RR:{link.id}"), (tr(lang, "btn_no"), f"k:{link.id}")]]),
                 message_id)
    elif head == "RR":
        st = data.student(db, link.student_id)
        name = data.full_name(st) if st else link.student_id
        link.is_active = False
        log.info("parent-bot: farzand olib tashlandi (chat=%s, link=%s)", ctx.chat.chat_id, link.id)
        ctx.show(tr(lang, "removed", name=esc(name)), None, message_id)
