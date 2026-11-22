"""Darsni sababli boshqa joyda o'tish: o'qituvchi dars vaqtida qayd etadi, admin ko'radi (2026-11-12)."""

from __future__ import annotations

import datetime as dt
from collections import Counter, defaultdict

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import AuthContext, require_rector, require_roles
from app.api.routes.staff_absence import _people
from app.core.db import get_db
from app.models.offsite_lesson import OffsiteLesson
from app.services import lesson_report_service as lr
from app.services import offsite_lesson as svc

router = APIRouter()

TEACHER = "hodim"


def _clear_reports() -> None:
    from app.services import control_report_service

    control_report_service.clear_cache()


# ------------------------------------------------------------------ o'qituvchi
@router.get("/staff/me/offsite-lessons/current/")
def current_offsite(
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles(TEACHER)),
) -> dict:
    """Hozirgi dars(lar) — tugma shu darslar uchun ko'rinadi; qayd etilgani belgilanadi."""
    owner = auth.user.username
    now = lr.current_time()
    lessons = svc.current_lessons(db, owner, now)
    # Bitta qayd butun ketma-ket darsni qamraydi — keyingi parada tugma qayta chiqmaydi (2026-11-16).
    marked = svc.covered_marks(db, now.date(), now.date(), owner=owner).get(owner, {})
    return {
        "lessons": [{**svc.lesson_dict(x), "marked": x.id in marked,
                     "reason_label": marked.get(x.id, "")} for x in lessons],
        "reasons": svc.REASONS,
        # Hozir darsi bo'lmasa ham kartochka ko'rinadi (2026-11-12, "umuman chiqmayapti") — keyingi dars bilan.
        "next_lesson": (lambda x: svc.lesson_dict(x) if x else None)(None if lessons else svc.next_lesson(db, owner, now)),
    }


@router.post("/staff/me/offsite-lessons/", status_code=201)
async def submit_offsite(
    lesson_id: int = Form(...),
    reason: str = Form(...),
    note: str = Form(""),
    lat: float | None = Form(None),
    lon: float | None = Form(None),
    accuracy: float | None = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles(TEACHER)),
) -> dict:
    owner = auth.user.username
    reason = (reason or "").strip()
    if reason not in svc.REASONS:
        raise HTTPException(status_code=400, detail="Sababni tanlang.")
    lesson = next((x for x in svc.current_lessons(db, owner, lr.current_time()) if x.id == lesson_id), None)
    if lesson is None:
        raise HTTPException(status_code=409, detail="Faqat dars vaqtida qayd etiladi — hozir jadvalda bu darsingiz yo'q.")
    if lesson.id in svc.covered_marks(db, lesson.lesson_date, lesson.lesson_date, owner=owner).get(owner, {}):
        raise HTTPException(status_code=409, detail="Bu dars allaqachon qayd etilgan — ketma-ket paralar uchun bitta qayd yetarli.")
    # Izoh har qanday sababda majburiy (2026-11-12): rasm + izoh, keyin yuborish; rektor hisobotida ko'rinadi.
    if len((note or "").strip()) < svc.MIN_NOTE:
        raise HTTPException(status_code=400, detail="Izoh yozing: qayerda va nega darsni boshqa joyda o'tyapsiz.")
    content = await file.read(svc.MAX_PHOTO_BYTES + 1)
    if not content:
        raise HTTPException(status_code=400, detail="Darsdan rasm yuklang.")
    if len(content) > svc.MAX_PHOTO_BYTES:
        raise HTTPException(status_code=413, detail="Rasm 8 MB dan katta.")
    mime = svc.photo_type(content)
    if mime is None:
        raise HTTPException(status_code=400, detail="Faqat rasm (JPG, PNG, WEBP, HEIC).")
    lesson_info = svc.lesson_dict(lesson)
    row = OffsiteLesson(
        owner_key=owner, lesson_id=lesson.id, lesson_date=lesson.lesson_date,
        para=lesson_info["para"][:16], start_time=lesson_info["start_time"][:8], end_time=lesson_info["end_time"][:8],
        subject_name=lesson_info["subject_name"][:255], group_name=lesson_info["group_name"][:128],
        scheduled_room=lesson_info["room"][:255], reason=reason, note=(note or "").strip()[:500],
        lat=lat if lat is not None and -90 <= lat <= 90 else None,
        lon=lon if lon is not None and -180 <= lon <= 180 else None,
        accuracy_m=accuracy if accuracy is not None and accuracy >= 0 else None,
        photo_type=mime, photo_size=len(content), photo_data=content,
        created_at=dt.datetime.now(dt.timezone.utc),
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Bu dars allaqachon qayd etilgan.") from None
    db.refresh(row)
    _clear_reports()
    return svc.as_dict(row)


def _photo(row: OffsiteLesson | None) -> Response:
    if row is None or not row.photo_data:
        raise HTTPException(status_code=404, detail="Rasm yo'q.")
    return Response(
        content=row.photo_data, media_type=row.photo_type or "application/octet-stream",
        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"},
    )


# ------------------------------------------------------------------ admin
def _report(db: Session, start: dt.date | None, end: dt.date | None, department_ok=None) -> dict:
    """Alohida hisobot: qaydlar ro'yxati, sabablar va o'qituvchilar kesimida (admin va rektor uchun bitta manba)."""
    today = lr.current_time().date()
    end = end or today
    start = start or (end - dt.timedelta(days=6))
    if start > end:
        start, end = end, start
    if (end - start).days > 120:
        raise HTTPException(status_code=400, detail="Ko'pi bilan 120 kunlik oraliq.")
    rows = db.execute(
        select(OffsiteLesson).where(OffsiteLesson.lesson_date >= start, OffsiteLesson.lesson_date <= end)
        .order_by(OffsiteLesson.lesson_date.desc(), OffsiteLesson.start_time.desc(), OffsiteLesson.id.desc())
        .limit(2000)
    ).scalars().all()
    people = _people(db, {r.owner_key for r in rows})
    items = [svc.as_dict(r, name=people.get(r.owner_key, ("", ""))[0], department=people.get(r.owner_key, ("", ""))[1])
             for r in rows]
    if department_ok is not None:
        items = [it for it in items if department_ok(it["department"])]
    by_reason = Counter(it["reason"] for it in items)
    per_teacher: dict[str, dict] = defaultdict(lambda: {"count": 0, "reasons": Counter()})
    for it in items:
        t = per_teacher[it["owner_key"]]
        t.update(owner_key=it["owner_key"], name=it["name"], department=it["department"])
        t["count"] += 1
        t["reasons"][it["reason_label"]] += 1
    teachers = sorted(
        ({**v, "reasons": dict(v["reasons"])} for v in per_teacher.values()), key=lambda v: (-v["count"], v["name"])
    )
    return {
        "start": start.isoformat(),
        "end": end.isoformat(),
        "total": len(items),
        "teachers_count": len(teachers),
        "by_reason": [{"reason": k, "label": svc.label(k), "count": by_reason[k]} for k in svc.REASONS if by_reason.get(k)],
        "teachers": teachers,
        "items": items,
    }


@router.get("/admin/offsite-lessons/")
def admin_offsite(
    start: dt.date | None = None,
    end: dt.date | None = None,
    db: Session = Depends(get_db),
    _: AuthContext = Depends(require_roles("admin")),
) -> dict:
    return _report(db, start, end)


@router.get("/admin/offsite-lessons/{pk}/photo/")
def admin_offsite_photo(
    pk: int,
    db: Session = Depends(get_db),
    _: AuthContext = Depends(require_roles("admin")),
) -> Response:
    return _photo(db.get(OffsiteLesson, pk))


# ------------------------------------------------------------------ rektor (va dekan — o'z kafedralari)
def _department_filter(ctx: dict, db: Session):
    from app.services import monitor_schedule_service as monitor_svc
    from app.services.dean_access import allowed_departments

    allowed = allowed_departments(ctx, db)
    if not allowed:
        return None
    keys = {monitor_svc._norm(d) for d in allowed}

    def ok(name: str) -> bool:
        value = monitor_svc._norm(name or "")
        return bool(value) and any(k in value or value in k for k in keys)

    return ok


@router.get("/rector/offsite-lessons/")
def rector_offsite(
    start: dt.date | None = None,
    end: dt.date | None = None,
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_rector),
) -> dict:
    """Rektor hisobotida: boshqa joyda o'tilgan darslar — rasm va izoh bilan (2026-11-12)."""
    return _report(db, start, end, _department_filter(ctx, db))


@router.get("/rector/offsite-lessons/{pk}/photo/")
def rector_offsite_photo(
    pk: int,
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_rector),
) -> Response:
    row = db.get(OffsiteLesson, pk)
    ok = _department_filter(ctx, db)
    if row is not None and ok is not None:
        department = _people(db, {row.owner_key}).get(row.owner_key, ("", ""))[1]
        if not ok(department):
            row = None
    return _photo(row)
