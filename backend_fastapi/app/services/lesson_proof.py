"""Dars bo'yicha dalillar to'plami — daqiqama-daqiqa (2026-11-16).

Rektor: «prokuratura tergovchilari dalil yig'gandek — o'qituvchining dars o'tishini ikir-chikirigacha
ko'raylik, aniq statistika kerak».

Hamma narsa bazadagi qaydlardan, taxminsiz:
  * o'qituvchi: heartbeat (har ~30–60 s, qaysi bo'limda) va page_view — `core_useractivityevent`;
  * qaysi tarmoqdan: `meta.ip_hash` (IP o'zi saqlanmaydi; faqat «institut tarmog'imi» degan xulosa);
  * xona kompyuteriga QR bilan kirish — `core_devicepairingsession`;
  * joylashuv — `core_stafflocationping` + `core_campusbuilding` (bo'lsa);
  * talabalar: guruh talabalarining shu oynadagi hodisalari, jonli test qoralamasi (boshlagan vaqti),
    topshirgan vaqti va test paytida boshqa oynaga o'tishlari (`core_studenttestattemptevent`).
"""

from __future__ import annotations

import datetime as dt
import json
import math
import time
from collections import Counter, defaultdict

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models.analytics import StudentTestAttemptEvent, UserActivityEvent
from app.models.device_pairing import DevicePairingSession
from app.models.live_test import LiveTestDraft
from app.models.staff_location import CampusBuilding, StaffLocationPing

TZ = dt.timezone(dt.timedelta(hours=5))  # Toshkent (yozgi vaqt yo'q)
#: Shu kuni shuncha va undan ko'p turli foydalanuvchi ishlatgan tarmoq — institut tarmog'i (NAT).
CAMPUS_NET_USERS = 15
#: Shundan uzun harakatsizlik «tanaffus» sifatida ko'rsatiladi.
GAP_MINUTES = 5
HEARTBEAT_CAP = 900


def _aware(t: dt.datetime) -> dt.datetime:
    return t if t.tzinfo else t.replace(tzinfo=dt.timezone.utc)


def _hm(t: dt.datetime) -> str:
    return _aware(t).astimezone(TZ).strftime("%H:%M")


def _minute(t: dt.datetime) -> dt.datetime:
    t = _aware(t).astimezone(TZ)
    return t.replace(second=0, microsecond=0)


def _campus_nets(db: Session, day: dt.date) -> set[str]:
    """Shu kuni ko'p odam ishlatgan tarmoqlar (ip_hash). Redis'da kun bo'yi saqlanadi."""
    key = f"rx:campusnet:v1:{day.isoformat()}"
    try:
        from app.services.ai_response_cache import _redis

        raw = _redis().get(key)
        if raw:
            return set(json.loads(raw))
    except Exception:  # noqa: BLE001
        pass
    lo = dt.datetime.combine(day, dt.time(7, 0), tzinfo=TZ)
    hi = dt.datetime.combine(day, dt.time(19, 0), tzinfo=TZ)
    rows = db.execute(text(
        "select meta->>'ip_hash' h from core_useractivityevent "
        "where occurred_at >= :lo and occurred_at < :hi and meta ? 'ip_hash' "
        "group by 1 having count(distinct owner_key) >= :n"
    ), {"lo": lo, "hi": hi, "n": CAMPUS_NET_USERS}).scalars().all()
    nets = {r for r in rows if r}
    try:
        from app.services.ai_response_cache import _redis

        _redis().set(key, json.dumps(sorted(nets)), ex=6 * 3600 if day >= dt.datetime.now(dt.timezone(dt.timedelta(hours=5))).date() else 7 * 86400)
    except Exception:  # noqa: BLE001
        pass
    return nets


def _distance_m(lat1, lon1, lat2, lon2) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


#: Bitta «ekranda ochiq» belgisi necha daqiqani qoplaydi (mijoz har 5 daqiqada yuboradi).
PRESENCE_SPAN = 5


def _other_sessions(db: Session, owner: str, roster_ids: set[str], lo: dt.datetime, hi: dt.datetime) -> list[dict]:
    """Shu dars vaqtida guruh talabalari BOSHQA hisobning jonli testida qatnashganmi (2026-11-19, Sobirova:
    dars talaba hisobidan o'tilgan; o'rinbosar o'qituvchi). «Kirmadi» bahsida eng kuchli dalil."""
    if not roster_ids:
        return []
    try:
        rows = db.execute(text("""
            select s.owner_key, count(distinct a.student_id), min(a.submitted_at)
              from core_studenttestattempt a join core_livetestsession s on s.id = a.session_id
             where a.submitted_at >= :lo and a.submitted_at < :hi and a.student_id = any(:ids)
               and s.owner_key <> :owner
             group by 1 order by 2 desc limit 5"""),
            {"lo": lo, "hi": hi, "ids": sorted(roster_ids), "owner": owner or ""}).all()
    except Exception:  # noqa: BLE001 — dalil qo'shimcha; bo'lmasa ham dars oynasi ochiladi
        db.rollback()
        return []
    out = []
    for key, n, first in rows:
        name = db.execute(text("select teacher_name from core_hemislesson where teacher_username = :k limit 1"),
                          {"k": key}).scalar() or db.execute(
            text("select trim(last_name || ' ' || first_name) from auth_user where username = :k"), {"k": key}).scalar()
        out.append({"owner": key, "name": name or key, "students": int(n), "first": _aware(first).isoformat()})
    return out


def build(db: Session, *, owner: str, day: dt.date, sched: tuple[dt.datetime, dt.datetime],
          window: tuple[dt.datetime, dt.datetime], groups: list[str], roster_ids: set[str],
          sessions: list, attempts: list) -> dict:
    s_start, s_end = sched
    w_start, w_end = window
    # Ko'rsatiladigan oraliq: o'lchov oynasi (dars −15 / +5, qo'shni para bilan qirqilgan).
    minutes = []
    t = _minute(w_start)
    while t < _aware(w_end):
        minutes.append(t)
        t += dt.timedelta(minutes=1)
    index = {m: i for i, m in enumerate(minutes)}

    # ---- O'qituvchi
    events = db.execute(select(UserActivityEvent).where(
        UserActivityEvent.owner_key == owner,
        UserActivityEvent.occurred_at >= w_start - dt.timedelta(minutes=15),
        UserActivityEvent.occurred_at < w_end,
    ).order_by(UserActivityEvent.occurred_at, UserActivityEvent.id)).scalars().all() if owner else []
    teacher_page: list[str | None] = [None] * len(minutes)
    nets: Counter = Counter()
    journal: list[dict] = []
    first_act = last_act = None
    for e in events:
        when = _aware(e.occurred_at)
        meta = e.meta or {}
        page = str(meta.get("page") or "other")
        if e.event_type == "heartbeat":
            dur = min(max(0, int(e.duration_sec or 0)), HEARTBEAT_CAP)
            a = max(when - dt.timedelta(seconds=dur or 30), _aware(w_start))
            if when < _aware(w_start):
                continue
            m = _minute(a)
            while m <= _minute(when):
                if m in index:
                    teacher_page[index[m]] = page
                m += dt.timedelta(minutes=1)
        if not (_aware(w_start) <= when < _aware(w_end)):
            continue
        if meta.get("ip_hash"):
            nets[meta["ip_hash"]] += 1
        first_act = first_act or when
        last_act = when
        if e.event_type == "page_view":
            journal.append({"at": when.isoformat(), "who": "teacher", "kind": "open", "page": page})
        elif e.event_type == "content_view":
            # Aynan QAYSI material ochilgani (nomi bilan) — "kirib qo'ydi" emas, nima ko'rsatgani.
            journal.append({"at": when.isoformat(), "who": "teacher", "kind": "content_view", "page": page,
                            "content": str(meta.get("kind") or ""), "title": str(meta.get("title") or "")[:200]})
        elif e.event_type == "login":
            journal.append({"at": when.isoformat(), "who": "teacher", "kind": "login",
                            "method": str(meta.get("method") or "")})
        elif e.event_type not in ("heartbeat",):
            journal.append({"at": when.isoformat(), "who": "teacher", "kind": e.event_type, "page": page})

    # «Ekranda ochiq, harakatsiz» (2026-11-19): brauzer 20 daqiqa harakatsizlikdan keyin heartbeat yozmaydi, lekin
    # ko'rinib turgan va fokusdagi varaq har 5 daqiqada belgi yuboradi (`page_presence`). Belgidan oldingi
    # 5 daqiqa (harakat bo'lmagan bo'lsa) — sahifa ekranda ochiq turgan: o'qituvchi iMentor'dan chiqmagan.
    from app.services import page_presence

    open_page: list[str | None] = [None] * len(minutes)
    for when, page in page_presence.marks(owner, _aware(w_start), _aware(w_end) + dt.timedelta(minutes=5)):
        m = _minute(when)
        for k in range(PRESENCE_SPAN):
            mm = m - dt.timedelta(minutes=k)
            if mm in index and teacher_page[index[mm]] is None:
                open_page[index[mm]] = page or "open"

    # Faol daqiqalar faqat REJADAGI dars ichida sanaladi.
    in_lesson = [i for i, m in enumerate(minutes) if _aware(s_start) <= m < _aware(s_end)]
    active_in_lesson = sum(1 for i in in_lesson if teacher_page[i])
    gaps = []
    run = None
    for i in in_lesson:
        if teacher_page[i] is None:
            run = run if run is not None else i
        else:
            if run is not None and i - run >= GAP_MINUTES:
                gaps.append((run, i))
            run = None
    if run is not None and in_lesson and in_lesson[-1] + 1 - run >= GAP_MINUTES:
        gaps.append((run, in_lesson[-1] + 1))
    # Faol bo'lmagan dars — bitta uzun "tanaffus" emas, umuman ochilmagan.
    if not active_in_lesson:
        gaps = []
    gap_rows = [{"from": minutes[a].isoformat(), "to": (minutes[b - 1] + dt.timedelta(minutes=1)).isoformat(),
                 "minutes": b - a, "open_minutes": sum(1 for i in range(a, b) if open_page[i]),
                 "open_page": next((open_page[i] for i in range(a, b) if open_page[i] and open_page[i] != "open"), "")}
                for a, b in gaps]
    for g in gap_rows:
        journal.append({"at": g["from"], "who": "teacher", "kind": "gap", "minutes": g["minutes"], "to": g["to"],
                        "open_minutes": g["open_minutes"], "page": g["open_page"]})

    campus = _campus_nets(db, day) if nets else set()
    net_info = {
        "networks": len(nets),
        "campus": sum(1 for h in nets if h in campus),
        "outside": sum(1 for h in nets if h not in campus),
    }

    # ---- Xona kompyuteriga QR bilan kirish
    pairings = db.execute(select(DevicePairingSession).where(
        DevicePairingSession.owner_key == owner,
        DevicePairingSession.created_at >= w_start - dt.timedelta(hours=3),
        DevicePairingSession.created_at < w_end,
    ).order_by(DevicePairingSession.created_at)).scalars().all() if owner else []
    qr = []
    for p in pairings:
        at = p.picked_up_at or p.confirmed_at
        if at is None or p.status not in ("picked_up", "confirmed"):
            continue
        qr.append({"at": _aware(at).isoformat(), "before_lesson": _aware(at) < _aware(w_start)})
        if _aware(w_start) <= _aware(at) < _aware(w_end):
            journal.append({"at": _aware(at).isoformat(), "who": "teacher", "kind": "qr"})

    # ---- Yuz orqali kirish (kamera o'qituvchini tanigan — hisobga aynan o'zi kirgan)
    logins = []
    if owner:
        for when, meta in db.execute(select(UserActivityEvent.occurred_at, UserActivityEvent.meta).where(
            UserActivityEvent.owner_key == owner, UserActivityEvent.event_type == "login",
            UserActivityEvent.occurred_at >= w_start - dt.timedelta(hours=3), UserActivityEvent.occurred_at < w_end,
        ).order_by(UserActivityEvent.occurred_at)).all():
            method = str((meta or {}).get("method") or "")
            if method in ("face", "pinfl_cam"):
                logins.append({"at": _aware(when).isoformat(), "method": "face",
                               "before_lesson": _aware(when) < _aware(w_start)})

    # ---- Joylashuv
    location = None
    pings = db.execute(select(StaffLocationPing).where(
        StaffLocationPing.owner_key == owner,
        StaffLocationPing.recorded_at >= w_start, StaffLocationPing.recorded_at < w_end,
    ).order_by(StaffLocationPing.recorded_at)).scalars().all() if owner else []
    if pings:
        buildings = db.execute(select(CampusBuilding).where(CampusBuilding.is_active.is_(True))).scalars().all()
        best = None
        for p in pings:
            for b in buildings:
                d = _distance_m(p.latitude, p.longitude, b.latitude, b.longitude)
                if best is None or d < best[0]:
                    best = (d, b, p)
        if best:
            d, b, p = best
            location = {"pings": len(pings), "building": b.name, "distance_m": round(d),
                        "inside": d <= (b.radius_m or 100), "accuracy_m": round(p.accuracy_m or 0) or None,
                        "at": _aware(p.recorded_at).isoformat()}

    # ---- Talabalar
    student_rows = db.execute(text(
        "select c.student_id, e.event_type, e.occurred_at, e.duration_sec, e.meta->>'page' "
        "from core_useractivityevent e join core_studentcontingent c "
        "  on c.student_id = regexp_replace(e.owner_key, '^ot_', '') "
        "where e.role = 'student' and e.occurred_at >= :lo and e.occurred_at < :hi and c.group_name = any(:g)"
    ), {"lo": w_start, "hi": w_end, "g": groups}).all() if groups else []
    per_min_students: list[set] = [set() for _ in minutes]
    st_first: dict[str, dt.datetime] = {}
    st_last: dict[str, dt.datetime] = {}
    st_minutes: dict[str, set] = defaultdict(set)
    opened_test: dict[str, dt.datetime] = {}
    for sid, kind, when, dur, page in student_rows:
        when = _aware(when)
        st_first[sid] = min(st_first.get(sid, when), when)
        st_last[sid] = max(st_last.get(sid, when), when)
        a = when - dt.timedelta(seconds=min(int(dur or 0), HEARTBEAT_CAP)) if kind == "heartbeat" else when
        m = _minute(max(a, _aware(w_start)))
        while m <= _minute(when):
            if m in index:
                per_min_students[index[m]].add(sid)
                st_minutes[sid].add(m)
            m += dt.timedelta(minutes=1)
        if kind == "live_test_opened":
            opened_test[sid] = min(opened_test.get(sid, when), when)

    ids = [s.id for s in sessions]
    drafts = db.execute(select(LiveTestDraft).where(LiveTestDraft.session_id.in_(ids))).scalars().all() if ids else []
    started: dict[str, dt.datetime] = {}
    for d in drafts:
        if d.student_id and d.started_at:
            started[d.student_id] = min(started.get(d.student_id, _aware(d.started_at)), _aware(d.started_at))
    blur = Counter()
    if ids:
        for sid, kind in db.execute(select(StudentTestAttemptEvent.student_id, StudentTestAttemptEvent.event_type)
                                    .where(StudentTestAttemptEvent.session_id.in_(ids))).all():
            if kind in ("tab_blur", "visibility_hidden"):
                blur[sid] += 1
    for s in sessions:
        journal.append({"at": _aware(s.created_at).isoformat(), "who": "teacher", "kind": "live_test",
                        "topic": str((s.payload or {}).get("topic") or "")})
    for a in attempts:
        journal.append({"at": _aware(a.submitted_at).isoformat(), "who": "student", "kind": "submit",
                        "student_id": a.student_id, "score": a.score, "total": a.total})

    students = {}
    for sid in set(st_first) | set(started) | set(blur) | {a.student_id for a in attempts}:
        students[sid] = {
            "first_seen": st_first[sid].isoformat() if sid in st_first else None,
            "active_minutes": len(st_minutes.get(sid, ())),
            "test_started": started[sid].isoformat() if sid in started else (opened_test[sid].isoformat() if sid in opened_test else None),
            "tab_switches": blur.get(sid, 0),
        }
    roster_active = len([sid for sid in st_first if sid in roster_ids])
    first_student = min((v for k, v in st_first.items()), default=None)

    journal.sort(key=lambda x: x["at"])
    timeline = [{"t": m.isoformat(), "page": teacher_page[i], "students": len(per_min_students[i]),
                 "in_lesson": _aware(s_start) <= m < _aware(s_end), "open": bool(open_page[i])}
                for i, m in enumerate(minutes)]
    lesson_len = len(in_lesson)
    return {
        "scheduled": {"from": _aware(s_start).isoformat(), "to": _aware(s_end).isoformat(), "minutes": lesson_len},
        "teacher": {
            "first": first_act.isoformat() if first_act else None,
            "last": last_act.isoformat() if last_act else None,
            "late_minutes": round((first_act - _aware(s_start)).total_seconds() / 60) if first_act else None,
            "early_leave_minutes": round((_aware(s_end) - last_act).total_seconds() / 60) if last_act else None,
            "active_minutes": active_in_lesson,
            "coverage": round(100 * active_in_lesson / lesson_len) if lesson_len else 0,
            "gaps": gap_rows,
            "pages_opened": sum(1 for j in journal if j["kind"] == "open"),
            # Harakatsiz, lekin sahifa ekranda ochiq turgan daqiqalar (dars ichida).
            "open_idle_minutes": sum(1 for i in in_lesson if open_page[i]),
        },
        "other_sessions": _other_sessions(db, owner, roster_ids, w_start, w_end),
        "network": net_info,
        "qr": qr,
        "face_logins": logins,
        "location": location,
        "students": {
            "roster": len(roster_ids),
            "active": roster_active,
            "active_other": len([sid for sid in st_first if sid not in roster_ids]),
            "first_seen": first_student.isoformat() if first_student else None,
            "peak": max((len(x) for x in per_min_students), default=0),
            "tab_switchers": sum(1 for v in blur.values() if v >= 5),
        },
        "per_student": students,
        "timeline": timeline,
        "journal": journal[:400],
    }
