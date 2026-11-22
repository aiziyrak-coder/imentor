"""Bitta dars — rektor dars kartasini bosganda ochiladigan to'liq ma'lumot (2026-11-15).

Rektor: «darsni bosganda ichiga kirsin: o'sha darsda nima qilgani, qaysi bo'limda necha daqiqa,
qanday test va keys yaratgani, testni qaysi talabalar ishlagani va baholari, HEMIS'da o'sha
talabalarga qanday baho qo'ygani — iMentor natijasi va HEMIS bahosi yonma-yon».

Manbalar:
  * dars va uning holati — `lesson_report_service.lesson_rows` (ro'yxatdagi karta bilan bir manba);
  * bo'limlar va harakatlar izi — `lesson_evidence.for_lessons` (o'sha o'lchov oynasi);
  * jonli testlar va talaba natijalari — `core_livetestsession` + `core_studenttestattempt`;
  * yaratilgan keys/test/taqdimot/video/tarqatma — dars oynasidagi `created_at`;
  * HEMIS baholari — `/data/student-grade-list?_subject_schedule=<hemis_id>` (FAQAT O'QISH),
    talaba `core_studentcontingent.hemis_id` orqali bog'lanadi.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import time
from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.analytics import StudentTestAttempt
from app.models.hemis_lesson import HemisLesson
from app.models.live_test import LiveTestSession
from app.models.prepared_content import KIND_CASE, KIND_TEST, PreparedContent
from app.models.student_contingent import StudentContingent
from app.models.topic_content import TopicHandout, TopicPresentation, TopicVideo
from app.services import lesson_report_service as lrs
from app.services.dean_access import in_groups

logger = logging.getLogger(__name__)

#: HEMIS baholari keshi: o'tgan dars baholari kam o'zgaradi, bugungisi hali qo'yilayotgan bo'lishi mumkin.
GRADES_TTL_TODAY = 10 * 60
GRADES_TTL_RECENT = 12 * 3600  # oxirgi 7 kun: baho kechroq qo'yilishi mumkin (2026-11-16)
GRADES_TTL_OLD = 7 * 86400


def _name(row: StudentContingent) -> str:
    return " ".join(x for x in (row.last_name, row.first_name, row.middle_name) if x).strip()


def _short(text: str, n: int = 220) -> str:
    text = " ".join(str(text or "").split())
    return text if len(text) <= n else text[: n - 1].rstrip() + "…"


def _cached_grades(hemis_id: str, ttl: int) -> list[dict] | None:
    try:
        from app.services.ai_response_cache import _redis

        raw = _redis().get(f"rx:hemisgrades:v1:{hemis_id}")
        if raw:
            box = json.loads(raw)
            if time.time() - float(box.get("at", 0)) < ttl:
                return box.get("items") or []
    except Exception:  # noqa: BLE001 — kesh bo'lmasa HEMIS'dan olinadi
        pass
    return None


def _store_grades(hemis_id: str, items: list[dict], ttl: int) -> None:
    try:
        from app.services.ai_response_cache import _redis

        _redis().set(f"rx:hemisgrades:v1:{hemis_id}", json.dumps({"at": time.time(), "items": items}), ex=ttl)
    except Exception:  # noqa: BLE001
        pass


def hemis_grades(hemis_ids: list[str], lesson_date: dt.date) -> tuple[list[dict], str]:
    """(baholar, xato matni). Baho: {hemis_student, grade}. HEMIS'ga hech narsa yozilmaydi."""
    from app.services import hemis_client

    if not hemis_client.configured():
        return [], "HEMIS ulanmagan."
    age = (dt.datetime.now(dt.timezone(dt.timedelta(hours=5))).date() - lesson_date).days  # Toshkent kuni
    ttl = GRADES_TTL_TODAY if age <= 0 else GRADES_TTL_RECENT if age <= 7 else GRADES_TTL_OLD
    out: list[dict] = []
    error = ""
    for hid in hemis_ids:
        items = _cached_grades(hid, ttl)
        if items is None:
            try:
                raw = hemis_client.lesson_grades(hid)
            except Exception as exc:  # noqa: BLE001 — HEMIS javob bermasa ham dars ochilsin
                logger.warning("HEMIS baholari olinmadi (%s): %s", hid, exc)
                error = "HEMIS hozir javob bermadi — baholar keyinroq chiqadi."
                continue
            items = [{"hemis_student": str(i.get("_student") or ""), "grade": i.get("grade")} for i in raw]
            _store_grades(hid, items, ttl)
        out.extend(items)
    return out, error


def _siblings(db: Session, lesson: HemisLesson) -> list[HemisLesson]:
    """Shu darsning hamma guruh qatorlari (HEMIS har guruhga alohida qator beradi)."""
    rows = db.execute(select(HemisLesson).where(
        HemisLesson.lesson_date == lesson.lesson_date,
        HemisLesson.teacher_username == lesson.teacher_username,
    )).scalars().all()
    key = lrs.lesson_key(lesson)
    return [r for r in rows if lrs.lesson_key(r) == key and getattr(r, "hemis_status", "") != "missing_from_hemis"] or [lesson]


def lesson_detail(db: Session, lesson_id: int, *, groups: tuple[str, ...] = (),
                  with_hemis: bool = True) -> dict:
    lesson = db.get(HemisLesson, lesson_id)
    if lesson is None:
        raise LookupError("Dars topilmadi.")
    rows = _siblings(db, lesson)
    group_names = sorted({r.group_name for r in rows if r.group_name})
    if groups and not any(in_groups(g, groups) for g in group_names):
        raise PermissionError("Bu dars sizning guruhlaringizga tegishli emas.")
    owner = lesson.teacher_username or ""
    day = lesson.lesson_date

    # 1. Karta — ro'yxatdagi bilan bir manba.
    ids = {r.id for r in rows}
    card = None
    if owner:
        for item in lrs.lesson_rows(db, day, day, teacher=owner, groups=groups):
            if item["id"] in ids:
                card = item
                break
    if card is None:
        card = {"id": lesson.id, "date": day.isoformat(), "weekday": lesson.weekday, "para": lesson.para,
                "start_time": lesson.start_time, "end_time": lesson.end_time, "teacher_name": lesson.teacher_name,
                "teacher_key": owner, "department": lesson.department_name, "subject": lesson.subject_name,
                "group": ", ".join(group_names), "lesson_type": lesson.lesson_type, "room": lesson.auditorium_name,
                "building": lesson.building_name, "monitor_id": lesson.monitor_id, "used": False, "counted": True,
                "students": 0, "hemis_id": lesson.hemis_id, "auditorium_code": lesson.auditorium_code,
                "monitor_room": lesson.monitor_room, "monitor_department": lesson.monitor_department, "synced_at": None}

    # 2. O'lchov oynasi — kartadagi daqiqa bilan bir xil (qo'shni para bilan qirqilgan).
    day_lessons = lrs._lessons(db, day, day, teacher=owner, pending=True, all_types=True) if owner else []
    head = next((x for x in day_lessons if x.id in ids), None)
    windows = lrs.clipped_windows(day_lessons) if day_lessons else {}
    start, end = windows.get(head.id) if head is not None and head.id in windows else lrs._window(lesson)
    from app.services.lesson_evidence import for_lessons

    evidence = for_lessons(db, [head], windows).get(head.id) if head is not None else None

    # 3. Jonli testlar va talabalar natijasi.
    sessions = db.execute(select(LiveTestSession).where(
        LiveTestSession.owner_key == owner, LiveTestSession.created_at >= start, LiveTestSession.created_at < end,
    ).order_by(LiveTestSession.created_at)).scalars().all() if owner else []
    attempts = db.execute(select(StudentTestAttempt).where(
        StudentTestAttempt.session_id.in_([s.id for s in sessions]),
    ).order_by(StudentTestAttempt.submitted_at)).scalars().all() if sessions else []
    by_session: dict[int, list] = defaultdict(list)
    for a in attempts:
        by_session[a.session_id].append(a)
    live = []
    for s in sessions:
        rows_ = by_session.get(s.id, [])
        pcts = [round(100 * a.score / a.total) for a in rows_ if a.total]
        live.append({
            "id": s.id,
            "topic": str((s.payload or {}).get("topic") or s.subject_code or "").strip(),
            "at": s.created_at.isoformat(),
            "questions": len((s.payload or {}).get("questions") or []),
            "students": len({a.student_id for a in rows_}),
            "average": round(sum(pcts) / len(pcts)) if pcts else None,
            "closed": bool(s.is_closed),
        })

    # 4. Shu dars vaqtida yaratgani.
    created: list[dict] = []
    if owner:
        for p in db.execute(select(PreparedContent).where(
            PreparedContent.owner_key == owner, PreparedContent.kind.in_((KIND_CASE, KIND_TEST)),
            PreparedContent.created_at >= start, PreparedContent.created_at < end,
        ).order_by(PreparedContent.created_at)).scalars():
            qs = (p.payload or {}).get("questions") or []
            item = {"kind": p.kind, "topic": p.topic, "at": p.created_at.isoformat(), "count": len(qs)}
            if p.kind == KIND_CASE:
                item["items"] = [_short(q.get("scenario") or q.get("focus") or "") for q in qs[:5] if isinstance(q, dict)]
            else:
                item["items"] = [_short(q.get("question") or "", 160) for q in qs[:5] if isinstance(q, dict)]
            created.append(item)
        for model, kind in ((TopicPresentation, "presentation"), (TopicHandout, "handout"), (TopicVideo, "video")):
            for m in db.execute(select(model).where(
                model.owner_key == owner, model.created_at >= start, model.created_at < end,
            ).order_by(model.created_at)).scalars():
                created.append({"kind": kind, "topic": m.topic, "title": m.title or "", "at": m.created_at.isoformat(),
                                "count": 0, "items": []})
    created.sort(key=lambda x: x["at"])

    # 5. Talabalar: guruh ro'yxati + iMentor natijasi + HEMIS bahosi yonma-yon.
    roster = db.execute(select(StudentContingent).where(
        StudentContingent.group_name.in_(group_names),
    )).scalars().all() if group_names else []
    roster = [r for r in roster if (r.status or "active") in ("active", "")] or roster
    by_sid = {r.student_id: r for r in roster if r.student_id}
    grades, hemis_error = (hemis_grades([r.hemis_id for r in rows if r.hemis_id], day) if with_hemis else ([], ""))
    graded_hids = {g["hemis_student"] for g in grades if g["hemis_student"]}
    extra = db.execute(select(StudentContingent).where(
        StudentContingent.hemis_id.in_(graded_hids - {r.hemis_id for r in roster}),
    )).scalars().all() if graded_hids else []
    for r in extra:
        by_sid.setdefault(r.student_id, r)
    by_hid = {r.hemis_id: r for r in by_sid.values() if r.hemis_id}
    hemis_by_sid: dict[str, int] = {}
    for g in grades:
        r = by_hid.get(g["hemis_student"])
        if r is not None and g.get("grade") is not None:
            hemis_by_sid[r.student_id] = int(g["grade"])

    best: dict[str, StudentTestAttempt] = {}
    for a in attempts:
        cur = best.get(a.student_id)
        if cur is None or (a.total and (cur.total == 0 or a.score / a.total > cur.score / cur.total)):
            best[a.student_id] = a
    students = []
    for sid in sorted(set(by_sid) | set(best)):
        r = by_sid.get(sid)
        a = best.get(sid)
        imentor = round(100 * a.score / a.total) if a is not None and a.total else None
        hemis = hemis_by_sid.get(sid)
        students.append({
            "student_id": sid,
            "name": _name(r) if r is not None else f"{a.last_name} {a.first_name}".strip(),
            "group": r.group_name if r is not None else "",
            "imentor": imentor,
            "score": a.score if a is not None else None,
            "total": a.total if a is not None else None,
            "attempts": sum(1 for x in attempts if x.student_id == sid),
            "hemis": hemis,
            "diff": (hemis - imentor) if hemis is not None and imentor is not None else None,
        })
    students.sort(key=lambda x: (x["imentor"] is None and x["hemis"] is None, x["name"]))

    # 6. Dalillar to'plami — daqiqama-daqiqa (2026-11-16).
    from app.services import lesson_proof

    proof = lesson_proof.build(db, owner=owner, day=day, sched=lrs._scheduled(head or lesson), window=(start, end),
                               groups=group_names, roster_ids={r.student_id for r in roster if r.student_id},
                               sessions=sessions, attempts=attempts)
    names = {}
    for row in students:
        row.update(proof["per_student"].get(row["student_id"]) or
                   {"first_seen": None, "active_minutes": 0, "test_started": None, "tab_switches": 0})
        names[row["student_id"]] = row["name"]
    for j in proof["journal"]:
        if j.get("student_id"):
            j["name"] = names.get(j["student_id"], "")
    proof.pop("per_student", None)

    # 7. Ikkinchi qatlam (2026-11-16): xona isboti, 30 kunlik odat, test halolligi, HEMIS belgilari.
    from app.services import lesson_proof_extra as extra

    proof["room_day"] = extra.room_day(db, lesson, ids)
    proof["history"] = extra.teacher_history(db, owner, day, lesson.id)
    proof["integrity"] = extra.test_integrity(attempts, names)
    # iMentor foizi va HEMIS bali bir xil shkala emas, shuning uchun oddiy ayirma deyarli hammani "shubhali"
    # qilardi (2026-11-16 tuzatish). Belgi faqat pog'ona bo'yicha aniq ziddiyatda: test qoniqarsiz (<55%),
    # HEMIS'da esa "yaxshi" yoki "a'lo" (>=71), yoki aksincha.
    # «Izi yo'q» faqat shu darsda jonli test BO'LGANDA ma'noli: oddiy darsda talaba iMentor'ga kirishi shart
    # emas. «Baho yo'q» esa faqat o'qituvchi shu darsga kimgadir baho QO'YGANDA: aks holda u hali umuman
    # baho qo'ymagan — bu har talabaning emas, darsning holati.
    has_test, has_grades = bool(best), bool(hemis_by_sid)
    for row in students:
        im, he = row["imentor"], row["hemis"]
        if has_test and he is not None and im is None and not row.get("active_minutes"):
            row["flag"] = "graded_without_trace"
        elif im is not None and he is not None and im < 55 and he >= 71:
            row["flag"] = "low_test_high_grade"
        elif im is not None and he is not None and im >= 71 and he < 55:
            row["flag"] = "high_test_low_grade"
        elif has_grades and im is not None and he is None:
            row["flag"] = "tested_not_graded"
        else:
            row["flag"] = ""
    proof["hemis_flags"] = {k: sum(1 for r in students if r["flag"] == k)
                            for k in ("graded_without_trace", "low_test_high_grade", "high_test_low_grade", "tested_not_graded")}

    both = [s for s in students if s["diff"] is not None]
    return {
        "lesson": {**card, "evidence": evidence, "groups": group_names},
        "window": {"from": start.isoformat(), "to": end.isoformat()},
        "live_tests": live,
        "created": created,
        "students": students,
        "summary": {
            "roster": len(roster),
            "tested": len(best),
            "graded": len(hemis_by_sid),
            "imentor_avg": round(sum(s["imentor"] for s in students if s["imentor"] is not None) / len(best)) if best else None,
            "hemis_avg": round(sum(hemis_by_sid.values()) / len(hemis_by_sid)) if hemis_by_sid else None,
            "big_gap": sum(1 for s in both if abs(s["diff"]) >= 25),
        },
        "hemis_error": hemis_error,
        "proof": proof,
    }
