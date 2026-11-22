"""Bugun o'chib ketgan para xabarlari o'rniga — har para uchun BITTA yakuniy xabar (2026-11-16, rektor so'radi).

Faqat TUGAGAN paralar,
faqat ro'yxat xabari o'chirilgan (replaced/cleared/closed) yoki hech qachon yakuni yuborilmaganlar.
Har yuborilgan id `state.final_ids` ga yoziladi — qayta ishga tushirilsa takrorlanmaydi.
"""
import logging
import sys
import datetime as dt
from collections import defaultdict

logging.disable(logging.WARNING)
from app.services import lesson_watch_bot as bot  # noqa: E402
from sqlalchemy import select  # noqa: E402
from app.core.db import SessionLocal  # noqa: E402
from app.models.lesson_bot import LessonBotPost  # noqa: E402

apply = "--apply" in sys.argv
db = SessionLocal()
now = dt.datetime.now(bot.TZ)
day = now.date()
blocks = bot.day_blocks(db, day)
acts = bot.activity_times(db, {b.teacher for b in blocks}, day, {g for b in blocks for g in b.groups})
offsite = bot.offsite_reason(db, day)
by_slot = defaultdict(list)
for b in blocks:
    by_slot[b.slot].append(b)
rows = db.execute(select(LessonBotPost).where(LessonBotPost.day == day, LessonBotPost.kind.in_(("alert10", "alert15")))).scalars().all()
by = defaultdict(dict)
for r in rows:
    by[r.slot][r.kind] = r
chat = bot.chat_id(db)
sent = 0
for slot in sorted(by):
    sblocks = by_slot.get(slot) or []
    if not sblocks:
        continue
    end = max(b.end for b in sblocks)
    if now <= end:
        print(slot, "— dars hali tugamagan, o'tkazib yuborildi")
        continue
    kinds = by[slot]
    if any((r.state or {}).get("final_ids") for r in kinds.values()) or any(r.status == "final" for r in kinds.values()):
        print(slot, "— yakuni allaqachon bor")
        continue
    listed = [r for r in kinds.values()]
    # Hozirgi qoida (klinik fan + amaliy + monitorli xona, bugun qo'shilgan monitorlar bilan) bo'yicha paraning
    # HAMMA o'qituvchisi: dars oxirigacha ochmaganlar va 10 daqiqadan kech ochganlar (jonli ro'yxat qoidasi).
    full = bot._slot_state(sblocks, acts, end, offsite)
    teachers = {k: v for k, v in full.items()
                if v["offsite"] or not v["entered"] or (v["late"] or 0) >= bot.FIRST_ALERT}
    if not teachers:
        print(slot, "— hamma 10 daqiqa ichida ochgan")
        continue
    para = sblocks[0].first_para or sblocks[0].para
    body = bot.alert_text("alert10", slot, para, len(teachers), teachers, final=True)
    statuses = {k: r.status for k, r in kinds.items()}
    print(f"== {slot} {para} | holat {statuses} | {len(teachers)} o'qituvchi ro'yxatda")
    if not apply:
        print(body[:600].replace("\n", " / "))
        continue
    _c, ids = bot._send(db, chat, body)
    main = kinds.get("alert10") or listed[0]
    main.state = {**(main.state or {}), "final_ids": ids, "teachers": teachers}
    main.status = "final"
    if main.chat_id is None:
        main.chat_id = chat
    db.commit()
    sent += 1
print("yuborildi:", sent)
