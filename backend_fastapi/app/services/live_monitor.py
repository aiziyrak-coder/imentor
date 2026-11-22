"""Jonli test — monitor rejimi (2026-11-12).

Muammo: talabalar savolni ikkinchi telefon bilan suratga olib AI'dan javob olardi (o'rtacha ball 76% → 86%,
100% olganlar 25% → 44%; sahifadan chiqmaganlar ham shuncha olardi). Yechim (foydalanuvchi talabi):
* savol matni FAQAT monitorda, talaba telefonida — faqat variantlar (A, B, C, D);
* talabalar QR'ni skanerlab "Tayyorman"ni bosadi; o'qituvchi hamma tayyor bo'lgandagina "Boshlash"ni bosa oladi;
* har savol — 45 soniya o'qish (monitorda savol, ostida orqaga sanoq va qisqaruvchi chiziq), keyin 45 soniya
  belgilash ("Javoblarni belgilang"), so'ng keyingi savol O'ZI chiqadi. Belgilamagan — xato;
* HAMMA talaba javob belgilasa — belgilash vaqti tugashini kutmay keyingi savol chiqadi (2026-11-16, o'qituvchilar
  taklifi: "bilgan savoliga tez javob beradi, bilmaganiga 45 soniyadan foydalanadi");
* test boshlangach INSON OMILI YO'Q: keyingi savolga o'tkazish, to'xtatish, orqaga qaytish yo'q;
  oxirgi savoldan keyin test o'zi yopiladi va natijalar chiqadi.

Holat: `monitor_phase` (lobby/running/done), `monitor_index`, `monitor_started_at`. Joriy savol va bosqich so'rovda
HISOBLANADI: o'tgan vaqt / (60 + 15, sessiyada saqlangan) — yuzlab talaba har soniyada so'rasa ham bazaga yozilmaydi.
"""

from __future__ import annotations

import datetime as dt
import os

MODE = "monitor"
LOBBY, RUNNING, DONE = "lobby", "running", "done"
READ, ANSWER = "read", "answer"
#: Savol monitorda turadigan vaqt (soniya) va javob belgilash vaqti.
# 2026-11-13: o'qish 40 → 60 soniya (foydalanuvchi talabi), belgilash 15.
# 2026-11-16: 45 + 45 ("test ko'p vaqt olyapti") — hamma javob bersa keyingi savol darhol (`should_advance`).
READ_SECONDS = int(os.environ.get("IMENTOR_MONITOR_READ_SECONDS") or 45)
# 2026-11-13: belgilash 15 → 60 soniya (foydalanuvchi: "vaqt yetmayapti, 1 daqiqa savol, 1 daqiqa javob").
ANSWER_SECONDS = int(os.environ.get("IMENTOR_MONITOR_ANSWER_SECONDS") or 45)
CYCLE_SECONDS = READ_SECONDS + ANSWER_SECONDS
#: Tarmoq kechikishi: belgilash vaqti tugaganidan keyin shuncha qabul qilinadi (oxirgi soniyada bosilgani yo'qolmasin).
#: 2026-11-17: 2 → 6 soniya. Server band paytda (10:40–12:35) javob so'rovlari 8 soniyagacha kechikdi va telefon
#: "kech qoldi" deb tashlab yubordi — talaba belgilagan, natijada "javob belgilanmagan" chiqdi. Keyingi savol
#: o'qilayotganda uning variantlari hali telefonda yo'q, oldingi savol esa monitordan ketgan — ustunlik bermaydi.
ANSWER_GRACE = dt.timedelta(seconds=6)
LETTERS = "ABCDEFGH"


def is_monitor(session) -> bool:
    return (getattr(session, "mode", "") or "") == MODE


#: Avvalgi qoidalarda boshlangan testlar o'z tartibida tugaydi (sessiyada faqat tsikl uzunligi saqlanadi).
_KNOWN_CYCLES = {50: (40, 10), 55: (40, 15), 75: (60, 15), 90: (45, 45), 120: (60, 60)}


def timings(session) -> tuple[int, int, int]:
    """(o'qish, belgilash, tsikl) soniya — SESSIYANING o'zidan (`seconds_per_question`).

    Global qiymat o'zgarsa (deploy), allaqachon ketayotgan test eski tartibida tugaydi — savol
    vaqtlari test o'rtasida siljimaydi. Yangi test "Boshlash" bosilganda joriy qiymatni oladi."""
    cycle = int(getattr(session, "seconds_per_question", 0) or 0)
    if cycle in _KNOWN_CYCLES:
        read_s, answer_s = _KNOWN_CYCLES[cycle]
        return read_s, answer_s, cycle
    if cycle <= ANSWER_SECONDS:
        cycle = CYCLE_SECONDS
    return cycle - ANSWER_SECONDS, ANSWER_SECONDS, cycle


def state(session, total: int, now: dt.datetime) -> dict:
    """{phase, stage, index, total, read_ends_at, ends_at} — vaqtdan hisoblanadi."""
    phase = session.monitor_phase or LOBBY
    if session.is_closed:
        phase = DONE
    if phase == RUNNING:
        read_s, answer_s, cycle_s = timings(session)
    else:
        read_s, answer_s, cycle_s = READ_SECONDS, ANSWER_SECONDS, CYCLE_SECONDS
    out = {"phase": phase, "stage": "", "index": 0, "total": total, "read_seconds": read_s,
           "answer_seconds": answer_s, "read_ends_at": None, "ends_at": None}
    if phase != RUNNING or session.monitor_started_at is None:
        if phase == DONE:
            out["index"] = total
        return out
    elapsed = max(0.0, (now - session.monitor_started_at).total_seconds())
    done_cycles = int(elapsed // cycle_s)
    index = int(session.monitor_index or 0) + done_cycles
    if index >= total:
        out.update(phase=DONE, index=total)
        return out
    started = session.monitor_started_at + dt.timedelta(seconds=done_cycles * cycle_s)
    read_ends = started + dt.timedelta(seconds=read_s)
    out.update(index=index, stage=READ if now < read_ends else ANSWER, read_ends_at=read_ends,
               ends_at=started + dt.timedelta(seconds=cycle_s))
    return out


def options_of(question: dict) -> list[str]:
    return [str(x) for x in (question.get("options") or [])] if isinstance(question, dict) else []


def _base_view(st: dict) -> dict:
    return {"phase": st["phase"], "stage": st["stage"], "index": st["index"], "total": st["total"],
            "read_seconds": st["read_seconds"], "answer_seconds": st["answer_seconds"],
            "read_ends_at_ms": _ms(st["read_ends_at"]), "ends_at_ms": _ms(st["ends_at"])}


#: O'qish tugashidan shuncha soniya oldin variantlar telefonga OLDINDAN yuboriladi (`next_options`), lekin
#: telefon ularni o'qish tugaguncha ko'rsatmaydi. 2026-11-13: variantlar faqat chegaradagi BITTA so'rov bilan
#: kelardi — mobil internet bir lahza qotsa (so'rov 8 s kutardi), 15 soniyalik belgilash vaqti tugab qolardi.
PREFETCH_SECONDS = 6


def student_view(st: dict, questions: list, now: dt.datetime | None = None) -> dict:
    """Talaba telefoni uchun: savol MATNISIZ; variantlar (`options`) FAQAT belgilash bosqichida (2026-11-12:
    O'qish vaqtida (60 s) talaba faqat monitorga qarab savolni o'qiydi — ekranda variant yo'q). O'qishning
    oxirgi `PREFETCH_SECONDS` soniyasida joriy savol variantlari `next_options` da oldindan keladi — telefon
    ularni o'z soati bilan aynan belgilash boshlanganda ochadi, internetni kutmaydi."""
    view = {**_base_view(st), "options": []}
    if st["phase"] != RUNNING or not 0 <= st["index"] < len(questions):
        return view
    if st["stage"] == ANSWER:
        view["options"] = options_of(questions[st["index"]])
    elif now is not None and st["read_ends_at"] is not None             and (st["read_ends_at"] - now).total_seconds() <= PREFETCH_SECONDS:
        view["next_options"] = options_of(questions[st["index"]])
    return view


def monitor_view(st: dict, questions: list) -> dict:
    """O'qituvchi monitori uchun: FAQAT joriy savol matni — variantlar monitorda ko'rsatilmaydi (2026-11-12),
    ular belgilash bosqichida faqat talaba telefonida chiqadi. To'g'ri javob hech qachon yuborilmaydi."""
    view = {**_base_view(st), "question": "", "options": [],
            "option_count": 0}
    if st["phase"] == RUNNING and 0 <= st["index"] < len(questions):
        q = questions[st["index"]] if isinstance(questions[st["index"]], dict) else {}
        view["question"] = str(q.get("question") or "")
        view["option_count"] = len(options_of(q))
    return view


def can_answer(session, total: int, index: int, now: dt.datetime) -> bool:
    """Faqat JORIY savolga va faqat uning BELGILASH bosqichida (+ tarmoq kechikishi)."""
    st = state(session, total, now)
    if st["phase"] == RUNNING and st["index"] == index and st["stage"] == ANSWER:
        return True
    # Belgilash vaqti endigina tugagan (keyingi savol o'qilmoqda) — oxirgi soniyada bosilgan javob qabul qilinadi.
    before = state(session, total, now - ANSWER_GRACE)
    return before["phase"] == RUNNING and before["index"] == index and before["stage"] == ANSWER


def answered_count(drafts, index: int) -> tuple[int, int]:
    """(joriy savolga javob belgilaganlar, testdagi talabalar) — testda «Tayyorman» bosganlar sanaladi."""
    seen: set[str] = set()
    total = answered = 0
    for d in drafts:
        key = (d.student_id or d.participant_key or "").strip()
        if not key or key in seen or d.ready_at is None:
            continue
        seen.add(key)
        total += 1
        answers = d.answers or []
        if 0 <= index < len(answers) and isinstance(answers[index], int) and answers[index] >= 0:
            answered += 1
    return answered, total


def should_advance(session, total_questions: int, index: int, drafts, now: dt.datetime) -> bool:
    """Hamma talaba JORIY savolga javob belgilagan va hali uning belgilash bosqichi — kutish shart emas."""
    st = state(session, total_questions, now)
    if st["phase"] != RUNNING or st["stage"] != ANSWER or st["index"] != index:
        return False
    answered, people = answered_count(drafts, index)
    return people > 0 and answered >= people


def advance(session, index: int, now: dt.datetime) -> None:
    """Keyingi savol HOZIR boshlanadi: holat yana vaqtdan hisoblanadi, faqat boshlanish nuqtasi suriladi.
    Oxirgi savoldan keyin `monitor_index` = savollar soni → test tugagan (`_auto_finalize` yopadi)."""
    session.monitor_index = index + 1
    session.monitor_started_at = now


def put_answer(answers: list, index: int, option: int, total: int) -> list:
    out = list(answers or [])
    if len(out) < total:
        out += [-1] * (total - len(out))
    out[index] = option
    return out[:total]


def roster(drafts, submissions, st: dict) -> dict:
    """O'qituvchi uchun: kim qo'shildi, kim tayyor, joriy savolga nechta javob."""
    people = []
    seen: set[str] = set()
    for d in sorted(drafts, key=lambda x: ((x.last_name or ""), (x.first_name or ""))):
        key = (d.student_id or d.participant_key or "").strip()
        if not key or key in seen:
            continue
        seen.add(key)
        answers = d.answers or []
        idx = st["index"]
        answered_now = 0 <= idx < len(answers) and isinstance(answers[idx], int) and answers[idx] >= 0
        people.append({"name": f"{(d.last_name or '').strip()} {(d.first_name or '').strip()}".strip() or "Talaba",
                       "ready": d.ready_at is not None, "answered_current": bool(answered_now)})
    joined = len(people)
    ready = sum(1 for p in people if p["ready"])
    return {"joined": joined, "ready": ready, "answered_current": sum(1 for p in people if p["answered_current"]),
            "can_start": st["phase"] == LOBBY and joined > 0 and ready == joined,
            "people": people, "submitted": len(submissions)}


def _ms(value: dt.datetime | None) -> int | None:
    return int(value.timestamp() * 1000) if value else None
