"""«Umuman ochmagan» o'qituvchilar uchun dalil (2026-11-16).

Rektor: «ular kirdik demoqda, bizda 0 daqiqa — aniq dalillar bilan kirmaganini isbotlab qo'yishimiz kerak».
Har o'qituvchi uchun bazadan, taxminsiz:
  * tanlangan davrda o'z hisobidagi hamma qaydlar soni (kirish, sahifa, faollik signali) va birinchisi;
  * davrdagi QR bilan kompyuterga ulanishlar va jonli testlar soni;
  * davrdan OLDINGI oxirgi faolligi (qachondan beri iMentor'ni ochmagan);
  * dars o'tadigan monitorli xonalarida shu davrda boshqa o'qituvchilar iMentor'da dars o'tganmi
    (xona ishlaganining isboti — «monitor ishlamadi» degan bahona yopiladi).
"""

from __future__ import annotations

import datetime as dt
from collections import defaultdict

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.analytics import UserActivityEvent
from app.models.device_pairing import DevicePairingSession
from app.models.hemis_lesson import HemisLesson
from app.models.live_test import LiveTestSession
from app.services.rector_report_service import range_bounds


def build(db: Session, owners: list[str], start_day: dt.date, end_day: dt.date,
          rooms: list[dict] | None = None) -> dict[str, dict]:
    """`rooms` — hisobotdagi xonalar ro'yxati (`monitor_room_service.payload`)."""
    owners = [o for o in owners if o and not o.startswith("name:")]
    if not owners:
        return {}
    lo, hi = range_bounds(start_day, end_day)
    out: dict[str, dict] = {o: {"events": 0, "first": None, "qr": 0, "live_tests": 0, "last_before": None,
                                "rooms": 0, "rooms_working": 0} for o in owners}
    for o, n, first in db.execute(
        select(UserActivityEvent.owner_key, func.count(), func.min(UserActivityEvent.occurred_at))
        .where(UserActivityEvent.owner_key.in_(owners), UserActivityEvent.occurred_at >= lo, UserActivityEvent.occurred_at < hi)
        .group_by(UserActivityEvent.owner_key)
    ).all():
        out[o]["events"] = int(n)
        out[o]["first"] = first.isoformat() if first else None
    for o, last in db.execute(
        select(UserActivityEvent.owner_key, func.max(UserActivityEvent.occurred_at))
        .where(UserActivityEvent.owner_key.in_(owners), UserActivityEvent.occurred_at < lo)
        .group_by(UserActivityEvent.owner_key)
    ).all():
        out[o]["last_before"] = last.isoformat() if last else None
    for o, n in db.execute(
        select(DevicePairingSession.owner_key, func.count())
        .where(DevicePairingSession.owner_key.in_(owners), DevicePairingSession.created_at >= lo,
               DevicePairingSession.created_at < hi, DevicePairingSession.status.in_(("picked_up", "confirmed")))
        .group_by(DevicePairingSession.owner_key)
    ).all():
        out[o]["qr"] = int(n)
    for o, n in db.execute(
        select(LiveTestSession.owner_key, func.count())
        .where(LiveTestSession.owner_key.in_(owners), LiveTestSession.created_at >= lo, LiveTestSession.created_at < hi)
        .group_by(LiveTestSession.owner_key)
    ).all():
        out[o]["live_tests"] = int(n)
    # Xona isboti: o'qituvchining monitorli xonalari va ularda shu davrda iMentor'da dars o'tgan BOSHQA o'qituvchilar.
    # Bu o'qituvchilar ochmagan, ya'ni xonadagi `used_teachers` faqat boshqalar.
    if rooms:
        working = {r["monitor_id"] for r in rooms if r.get("used_teachers")}
        mine: dict[str, set] = defaultdict(set)
        for o, mid in db.execute(
            select(HemisLesson.teacher_username, HemisLesson.monitor_id)
            .where(HemisLesson.teacher_username.in_(owners), HemisLesson.lesson_date >= start_day,
                   HemisLesson.lesson_date <= end_day, HemisLesson.monitor_id != "")
        ).all():
            mine[o].add(mid)
        for o, mids in mine.items():
            out[o]["rooms"] = len(mids)
            out[o]["rooms_working"] = len(mids & working)
    return out
