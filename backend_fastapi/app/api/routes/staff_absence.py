"""Kasallik varaqasi, ta'til, xizmat safari: o'qituvchi yuboradi, admin tasdiqlaydi (2026-10-28)."""

from __future__ import annotations

import datetime as dt
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import AuthContext, require_roles
from app.core.db import get_db
from app.models.staff_absence import APPROVED, PENDING, REJECTED, StaffAbsence
from app.models.staff_location import StaffProfile
from app.models.user import User
from app.services import staff_absence as sa_svc

router = APIRouter()

TEACHER = "hodim"


def _today() -> dt.date:
    return dt.datetime.now(dt.timezone(dt.timedelta(hours=5))).date()


def _people(db: Session, owners: set[str]) -> dict[str, tuple[str, str]]:
    """owner_key → (F.I.Sh., kafedra)."""
    if not owners:
        return {}
    names = {
        u: f"{(last or '').strip()} {(first or '').strip()}".strip()
        for u, first, last in db.execute(
            select(User.username, User.first_name, User.last_name).where(User.username.in_(owners))
        ).all()
    }
    deps = dict(db.execute(
        select(StaffProfile.owner_key, StaffProfile.department).where(StaffProfile.owner_key.in_(owners))
    ).all())
    return {o: (names.get(o, o), deps.get(o) or "") for o in owners}


def _teacher_options(db: Session, query: str, me: str, limit: int = 30) -> list[dict]:
    """O'rinbosar nomzodlari — oxirgi 90 kunda HEMIS'da darsi bor o'qituvchilar (iMentor kaliti bilan)."""
    from app.models.hemis_lesson import HemisLesson

    since = _today() - dt.timedelta(days=90)
    rows = db.execute(
        select(HemisLesson.teacher_username, func.max(HemisLesson.teacher_name), func.max(HemisLesson.employee_id),
               func.max(HemisLesson.department_name))
        .where(HemisLesson.lesson_date >= since, HemisLesson.teacher_username != "")
        .group_by(HemisLesson.teacher_username)
    ).all()
    my_dep = next((d for k, _n, _e, d in rows if k == me), "")
    words = [w for w in (query or "").lower().split() if w]
    out = []
    for key, name, emp, dep in rows:
        if key == me:
            continue
        hay = f"{name or ''} {dep or ''}".lower()
        if words and not all(w in hay for w in words):
            continue
        out.append({"key": key, "name": (name or key).strip(), "employee_id": emp or "", "department": dep or ""})
    out.sort(key=lambda x: (x["department"] != my_dep, x["name"]))
    return out[:limit]


def _substitute_for(db: Session, me: str, key: str) -> dict | None:
    key = (key or "").strip()
    if not key:
        return None
    if key == me:
        raise HTTPException(status_code=400, detail="O'zingizni o'rinbosar qilib bo'lmaydi.")
    found = [o for o in _teacher_options(db, "", me, limit=100000) if o["key"] == key]
    if not found:
        raise HTTPException(status_code=400, detail="Bunday o'qituvchi topilmadi.")
    return found[0]


def _clear_reports() -> None:
    # Tasdiqlangan kun hisobotni o'zgartiradi — keshlar yangilansin.
    from app.services import control_report_service

    control_report_service.clear_cache()


# ------------------------------------------------------------------ o'qituvchi
@router.get("/staff/me/absences/")
def my_absences(
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles(TEACHER)),
) -> dict:
    rows = db.execute(
        select(StaffAbsence).where(StaffAbsence.owner_key == auth.user.username)
        .order_by(StaffAbsence.start_date.desc(), StaffAbsence.id.desc()).limit(50)
    ).scalars().all()
    subs = sa_svc.load_substitutes(db)
    return {"items": [sa_svc.as_dict(r, substitute=subs.get(str(r.id))) for r in rows], "kinds": sa_svc.KIND_LABELS}


@router.get("/staff/me/absences/teachers/")
def substitute_candidates(
    q: str = "",
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles(TEACHER)),
) -> dict:
    """O'rinbosar tanlash uchun: avval o'z kafedrasidagilar, qidiruv ism yoki kafedra bo'yicha."""
    return {"items": _teacher_options(db, q, auth.user.username)}


class SubstituteIn(BaseModel):
    substitute_key: str = Field("", max_length=128)


@router.put("/staff/me/absences/{pk}/substitute/")
def set_substitute(
    pk: int,
    payload: SubstituteIn,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles(TEACHER)),
) -> dict:
    """O'rinbosarni keyin ham qo'shish/almashtirish/olib tashlash mumkin (tasdiqlangan arizada ham)."""
    row = db.get(StaffAbsence, pk)
    if row is None or row.owner_key != auth.user.username:
        raise HTTPException(status_code=404, detail="Topilmadi.")
    sub = _substitute_for(db, auth.user.username, payload.substitute_key)
    sa_svc.save_substitute(db, row.id, sub)
    db.commit()
    _clear_reports()
    return sa_svc.as_dict(row, substitute=sub)


@router.post("/staff/me/absences/", status_code=201)
async def submit_absence(
    kind: str = Form(...),
    start_date: dt.date = Form(...),
    end_date: dt.date = Form(...),
    note: str = Form(""),
    substitute_key: str = Form(""),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles(TEACHER)),
) -> dict:
    """Ariza + hujjat rasmi (varaqa, buyruq). Admin tasdiqlaguncha hisobotga ta'sir qilmaydi."""
    kind = (kind or "").strip()
    if kind not in sa_svc.KIND_LABELS:
        raise HTTPException(status_code=400, detail="Sababni tanlang.")
    problem = sa_svc.date_problem(start_date, end_date, _today(), kind)
    if problem:
        raise HTTPException(status_code=400, detail=problem)
    content = await file.read(sa_svc.MAX_DOC_BYTES + 1)
    if not content:
        raise HTTPException(status_code=400, detail="Hujjat rasmini yuklang.")
    if len(content) > sa_svc.MAX_DOC_BYTES:
        raise HTTPException(status_code=413, detail="Fayl 8 MB dan katta.")
    mime = sa_svc.doc_type(content)
    if mime is None:
        raise HTTPException(status_code=400, detail="Faqat rasm (JPG, PNG, WEBP, HEIC) yoki PDF.")
    owner = auth.user.username
    sub = _substitute_for(db, owner, substitute_key)
    waiting = db.execute(
        select(func.count()).select_from(StaffAbsence)
        .where(StaffAbsence.owner_key == owner, StaffAbsence.status == PENDING)
    ).scalar() or 0
    if waiting >= sa_svc.MAX_PENDING:
        raise HTTPException(status_code=429, detail="Ko'rib chiqilmagan arizalaringiz ko'p — avval ular hal bo'lsin.")
    now = dt.datetime.now(dt.timezone.utc)
    row = StaffAbsence(
        owner_key=owner, kind=kind, start_date=start_date, end_date=end_date,
        note=(note or "").strip()[:500], status=PENDING,
        doc_name=(file.filename or "hujjat")[:255], doc_type=mime, doc_size=len(content), doc_data=content,
        created_at=now, updated_at=now,
    )
    db.add(row)
    db.flush()
    if sub:
        sa_svc.save_substitute(db, row.id, sub)
    db.commit()
    db.refresh(row)
    return sa_svc.as_dict(row, substitute=sub)


@router.delete("/staff/me/absences/{pk}/")
def withdraw_absence(
    pk: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles(TEACHER)),
) -> dict:
    row = db.get(StaffAbsence, pk)
    if row is None or row.owner_key != auth.user.username:
        raise HTTPException(status_code=404, detail="Topilmadi.")
    if row.status != PENDING:
        raise HTTPException(status_code=409, detail="Ko'rib chiqilgan arizani o'chirib bo'lmaydi.")
    sa_svc.save_substitute(db, row.id, None)
    db.delete(row)
    db.commit()
    return {"ok": True}


def _document(row: StaffAbsence | None) -> Response:
    if row is None or not row.doc_data:
        raise HTTPException(status_code=404, detail="Hujjat yo'q.")
    name = quote(row.doc_name or "hujjat")
    return Response(
        content=row.doc_data, media_type=row.doc_type or "application/octet-stream",
        headers={"Content-Disposition": f"inline; filename*=UTF-8''{name}", "Cache-Control": "private, no-store",
                 "X-Content-Type-Options": "nosniff"},
    )


@router.get("/staff/me/absences/{pk}/document/")
def my_absence_document(
    pk: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles(TEACHER)),
) -> Response:
    row = db.get(StaffAbsence, pk)
    if row is None or row.owner_key != auth.user.username:
        raise HTTPException(status_code=404, detail="Topilmadi.")
    return _document(row)


# ------------------------------------------------------------------ admin
class DecisionIn(BaseModel):
    approve: bool
    note: str = Field("", max_length=255)


@router.get("/admin/staff-absences/")
def admin_absences(
    status_filter: str = "pending",
    db: Session = Depends(get_db),
    _: AuthContext = Depends(require_roles("admin")),
) -> dict:
    q = select(StaffAbsence)
    if status_filter in sa_svc.STATUSES:
        q = q.where(StaffAbsence.status == status_filter)
    rows = db.execute(q.order_by(StaffAbsence.created_at.desc()).limit(300)).scalars().all()
    people = _people(db, {r.owner_key for r in rows})
    counts = dict(db.execute(select(StaffAbsence.status, func.count()).group_by(StaffAbsence.status)).all())
    subs = sa_svc.load_substitutes(db)
    return {
        "items": [sa_svc.as_dict(r, name=people.get(r.owner_key, ("", ""))[0],
                                 department=people.get(r.owner_key, ("", ""))[1],
                                 substitute=subs.get(str(r.id))) for r in rows],
        "counts": {s: int(counts.get(s, 0)) for s in sa_svc.STATUSES},
    }


@router.get("/admin/staff-absences/{pk}/document/")
def admin_absence_document(
    pk: int,
    db: Session = Depends(get_db),
    _: AuthContext = Depends(require_roles("admin")),
) -> Response:
    return _document(db.get(StaffAbsence, pk))


@router.post("/admin/staff-absences/{pk}/decide/")
def decide_absence(
    pk: int,
    payload: DecisionIn,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("admin")),
) -> dict:
    row = db.get(StaffAbsence, pk)
    if row is None:
        raise HTTPException(status_code=404, detail="Topilmadi.")
    if not payload.approve and not payload.note.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Rad etish sababini yozing.")
    now = dt.datetime.now(dt.timezone.utc)
    row.status = APPROVED if payload.approve else REJECTED
    row.decided_by = auth.user.username
    row.decided_at = now
    row.decision_note = payload.note.strip()[:255]
    row.updated_at = now
    db.commit()
    db.refresh(row)
    _clear_reports()
    name, department = _people(db, {row.owner_key}).get(row.owner_key, ("", ""))
    return sa_svc.as_dict(row, name=name, department=department,
                          substitute=sa_svc.load_substitutes(db).get(str(row.id)))
