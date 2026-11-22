"""Hisob xavfsizligi (2026-11-17 auditi, G8 + D2).

* `POST /auth/logout-all/` — o'zining barcha sessiyalarini (shu qurilma ham) yopish.
* `GET/PUT /auth/me/security/` — o'qituvchi "faqat parol bilan kirish"ni yoqadi/o'chiradi.
* `POST /admin/staff/{username}/revoke-sessions/` — admin begona qo'lga tushgan hisobni darhol chiqaradi.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import AuthContext, get_current_auth, require_roles
from app.core.db import get_db
from app.services import auth_service, user_security

router = APIRouter()

#: Parolsiz kirish faqat o'qituvchiga ochiq — sozlama ham faqat unga.
PASSWORDLESS_ROLE = "hodim"


class SecurityOut(BaseModel):
    password_only: bool
    has_password: bool
    can_set: bool


class SecurityIn(BaseModel):
    password_only: bool


def _has_password(auth: AuthContext) -> bool:
    stored = auth.user.password or ""
    return bool(stored) and not stored.startswith("!")


def _out(db: Session, auth: AuthContext) -> SecurityOut:
    return SecurityOut(
        password_only=user_security.password_only(db, auth.user),
        has_password=_has_password(auth),
        can_set=auth.role == PASSWORDLESS_ROLE,
    )


@router.post("/auth/logout-all/")
def logout_all(db: Session = Depends(get_db), auth: AuthContext = Depends(get_current_auth)) -> dict:
    user_security.revoke_tokens(db, auth.user)
    db.commit()
    return {"ok": True}


@router.get("/auth/me/security/", response_model=SecurityOut)
def my_security(db: Session = Depends(get_db), auth: AuthContext = Depends(get_current_auth)) -> SecurityOut:
    return _out(db, auth)


@router.put("/auth/me/security/", response_model=SecurityOut)
def set_my_security(
    payload: SecurityIn,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_current_auth),
) -> SecurityOut:
    if auth.role != PASSWORDLESS_ROLE:
        raise HTTPException(status_code=403, detail="Bu sozlama faqat o'qituvchi hisobi uchun.")
    if payload.password_only and not _has_password(auth):
        # Aks holda odam o'z hisobini butunlay yopib qo'yardi: parolsiz yo'l yopiq, parol esa yo'q.
        raise HTTPException(
            status_code=400,
            detail="Avval parol qo'ying (Sozlamalar → Parolni almashtirish), keyin bu himoyani yoqing.",
        )
    user_security.set_password_only(db, auth.user, payload.password_only)
    db.commit()
    return _out(db, auth)


@router.post("/admin/staff/{username}/revoke-sessions/")
def admin_revoke_sessions(
    username: str,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("admin")),
) -> dict:
    user = auth_service.get_user_by_username(db, username.strip())
    if user is None:
        raise HTTPException(status_code=404, detail="Hisob topilmadi.")
    user_security.revoke_tokens(db, user)
    db.commit()
    return {"ok": True}
