"""cam.fermi.uz davomati uchun: qaysi talaba qachon test yechgan (faqat o'qish).

Kamera platformasi (cam.fermi.uz) talabani darsda "keldi" deb hisoblaydi,
agar u kamerada ko'ringan YOKI shu dars vaqtida iMentor'da test yechgan
bo'lsa (2026-11-19, buyurtmachi talabi). Bu endpoint ikkinchi manbani beradi.

Ism, javoblar, savollar BERILMAYDI — faqat HEMIS ID, vaqt, fan kodi va ball.
Kalit: IMENTOR_EXTERNAL_API_KEYS (X-Api-Key), tashqi API bilan bir xil.

Ikki manba, har biri o'z kursori bilan (`since_id`):
  * ``attempts``    — core_studenttestattempt (yakunlangan urinishlar arxivi, ball bilan);
  * ``submissions`` — core_livetestsubmission (topshirilgan javoblar, sessiya hali
    yopilmagan bo'lsa ham — bugungi davomat kechikmasin).
"""

from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_external_api_key
from app.core.db import get_db
from app.models.analytics import StudentTestAttempt
from app.models.live_test import LiveTestSession, LiveTestSubmission

router = APIRouter(dependencies=[Depends(require_external_api_key)])

MAX_LIMIT = 5000


def _iso(value: dt.datetime | None) -> str | None:
    return value.isoformat() if value else None


@router.get("/external/camera/test-activity/")
def camera_test_activity(
    source: str = Query(default="attempts", pattern="^(attempts|submissions)$"),
    since_id: int = Query(default=0, ge=0),
    date_from: dt.date | None = Query(default=None),
    limit: int = Query(default=2000, ge=1, le=MAX_LIMIT),
    db: Session = Depends(get_db),
) -> dict:
    """`since_id` dan keyingi yozuvlar, id bo'yicha o'sib boruvchi tartibda."""
    if date_from is not None and date_from < dt.date(2020, 1, 1):
        raise HTTPException(status_code=400, detail="date_from too old.")
    since = dt.datetime.combine(date_from, dt.time.min, tzinfo=dt.timezone.utc) if date_from else None
    if source == "attempts":
        a = StudentTestAttempt
        stmt = select(a.id, a.student_id, a.session_id, a.subject_code, a.started_at, a.submitted_at,
                      a.score, a.total).where(a.id > since_id, a.student_id != "")
        if since is not None:
            stmt = stmt.where(a.submitted_at >= since)
        rows = db.execute(stmt.order_by(a.id).limit(limit)).all()
        items = [{"id": r.id, "student_id": r.student_id, "session_id": r.session_id,
                  "subject_code": r.subject_code or "", "started_at": _iso(r.started_at),
                  "submitted_at": _iso(r.submitted_at), "score": r.score, "total": r.total} for r in rows]
    else:
        s, ses = LiveTestSubmission, LiveTestSession
        stmt = (select(s.id, s.student_id, s.session_id, s.submitted_at, ses.subject_code)
                .join(ses, ses.id == s.session_id)
                .where(s.id > since_id, s.student_id != ""))
        if since is not None:
            stmt = stmt.where(s.submitted_at >= since)
        rows = db.execute(stmt.order_by(s.id).limit(limit)).all()
        items = [{"id": r.id, "student_id": r.student_id, "session_id": r.session_id,
                  "subject_code": r.subject_code or "", "started_at": None,
                  "submitted_at": _iso(r.submitted_at), "score": None, "total": None} for r in rows]
    return {"source": source, "items": items,
            "next_since_id": items[-1]["id"] if items else since_id, "has_more": len(items) == limit}
