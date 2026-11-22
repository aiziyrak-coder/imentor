"""Tokenlarni bekor qilish va "faqat parol bilan kirish" (qarang: `models/user_security.py`)."""

from __future__ import annotations

import datetime as dt
from typing import Any

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models.user import User
from app.models.user_security import UserSecurity

REVOKED = "Sessiya yopilgan. Iltimos, qayta kiring."
PASSWORD_ONLY = (
    "Bu hisobga faqat parol bilan kiriladi (egasi parolsiz kirishni o'chirgan). "
    "Parol bilan kiring yoki yuz orqali kiring."
)


def _now_floor() -> dt.datetime:
    # JWT `iat` butun soniya: bekor qilish vaqti ham soniyagacha qirqiladi, aks holda shu soniyada
    # berilgan YANGI token ham "eski" bo'lib qolardi (parol almashtirgan odam darhol chiqib ketardi).
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0)


def _upsert(db: Session, user_id: int, **values: Any) -> None:
    values["updated_at"] = dt.datetime.now(dt.timezone.utc)
    stmt = insert(UserSecurity).values(user_id=user_id, **values)
    db.execute(stmt.on_conflict_do_update(index_elements=["user_id"], set_=values))


def get(db: Session, user_id: int) -> UserSecurity | None:
    return db.get(UserSecurity, user_id)


def revoke_tokens(db: Session, user: User) -> dt.datetime:
    """Shu paytgacha berilgan barcha tokenlarni bekor qiladi. Commit qilmaydi."""
    at = _now_floor()
    _upsert(db, user.id, tokens_valid_after=at)
    return at


def token_revoked(db: Session, user: User, claims: dict[str, Any]) -> bool:
    row = get(db, user.id)
    if not isinstance(row, UserSecurity) or row.tokens_valid_after is None:
        return False
    try:
        iat = int(claims.get("iat") or 0)
    except (TypeError, ValueError):
        return True
    return iat < int(row.tokens_valid_after.timestamp())


def password_only(db: Session, user: User) -> bool:
    row = get(db, user.id)
    return isinstance(row, UserSecurity) and bool(row.password_only)


def set_password_only(db: Session, user: User, value: bool) -> None:
    _upsert(db, user.id, password_only=bool(value))
