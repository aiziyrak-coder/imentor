"""Admin panel «Monitorli xonalar» (2026-11-16)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import AuthContext, require_roles
from app.core.db import get_db
from app.services import monitor_rooms_admin as svc

router = APIRouter()
ADMIN = require_roles("admin")


class DepartmentIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)


class RoomIn(BaseModel):
    department_id: int
    room_full: str = Field(default="", max_length=255)
    hemis_codes: list[str] = Field(default_factory=list, max_length=10)


class SubjectPatch(BaseModel):
    name: str = Field(min_length=1, max_length=300)
    # true — klinik (nazoratda), false — klinik emas, null — avtomatik qoidaga qaytarish.
    clinical: bool | None = None


class Change(BaseModel):
    code: str = Field(min_length=1, max_length=32)
    on: bool


class ChangesIn(BaseModel):
    changes: list[Change] = Field(min_length=1, max_length=300)


class KeepIn(BaseModel):
    keep_id: int


class CodeIn(BaseModel):
    code: str = Field(min_length=1, max_length=32)


class RoomPatch(BaseModel):
    room_full: str | None = Field(default=None, max_length=255)
    hemis_codes: list[str] | None = Field(default=None, max_length=10)
    note: str | None = Field(default=None, max_length=255)


def _who(auth: AuthContext) -> str:
    return getattr(auth.user, "username", "") or ""


def _guard(fn):
    try:
        return fn()
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/admin/monitor-rooms/")
def list_rooms(db: Session = Depends(get_db), _: AuthContext = Depends(ADMIN)) -> dict:
    return svc.snapshot(db)


@router.get("/admin/monitor-rooms/catalog/")
def catalog(db: Session = Depends(get_db), _: AuthContext = Depends(ADMIN)) -> dict:
    """HEMIS'dagi hamma faol xonalar — monitor bor-yo'qligi, darslari (2026-11-16)."""
    from app.services import monitor_rooms_catalog as cat

    try:
        return cat.catalog(db)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail="HEMIS xonalar ro'yxatini bermadi — keyinroq urinib ko'ring.") from exc


@router.post("/admin/monitor-rooms/catalog/apply/")
def apply_changes(body: ChangesIn, db: Session = Depends(get_db), auth: AuthContext = Depends(ADMIN)) -> dict:
    """«Tahrirlash» rejimida yig'ilgan o'zgarishlar — bitta tasdiq bilan (tarixga yoziladi)."""
    from app.services import monitor_rooms_catalog as cat

    return cat.apply_changes(db, [c.model_dump() for c in body.changes], by=_who(auth))


@router.post("/admin/monitor-rooms/catalog/duplicates/{code}/")
def resolve_duplicate(code: str, body: KeepIn, db: Session = Depends(get_db), auth: AuthContext = Depends(ADMIN)) -> dict:
    """Bitta xonada bir necha monitor — bittasi qoladi."""
    from app.services import monitor_rooms_catalog as cat

    return _guard(lambda: cat.resolve_duplicate(db, code, body.keep_id, by=_who(auth)))


@router.post("/admin/monitor-rooms/catalog/relink/{room_id}/")
def relink(room_id: int, body: CodeIn, db: Session = Depends(get_db), auth: AuthContext = Depends(ADMIN)) -> dict:
    """HEMIS'da faol xonasi yo'q monitorni faol xonaga bog'lash."""
    from app.services import monitor_rooms_catalog as cat

    return _guard(lambda: cat.relink(db, room_id, body.code, by=_who(auth)))


@router.post("/admin/monitor-rooms/catalog/retire/{room_id}/")
def retire(room_id: int, db: Session = Depends(get_db), auth: AuthContext = Depends(ADMIN)) -> dict:
    from app.services import monitor_rooms_catalog as cat

    return _guard(lambda: cat.retire(db, room_id, by=_who(auth)))


@router.post("/admin/monitor-rooms/catalog/undo/{log_id}/")
def undo(log_id: int, db: Session = Depends(get_db), auth: AuthContext = Depends(ADMIN)) -> dict:
    """Tarixdagi o'zgarishni qaytarish."""
    from app.services import monitor_rooms_catalog as cat

    return _guard(lambda: cat.undo(db, log_id, by=_who(auth)))


@router.get("/admin/monitor-rooms/hemis-rooms/")
def hemis_rooms(refresh: bool = Query(default=False), db: Session = Depends(get_db), _: AuthContext = Depends(ADMIN)) -> dict:
    """HEMIS xonalari ro'yxati — qaysi monitorga bog'langani bilan (tanlash oynasi uchun)."""
    try:
        rooms = svc.hemis_rooms(force=refresh)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail="HEMIS xonalar ro'yxatini bermadi.") from exc
    taken: dict[str, list[str]] = {}
    for dep in svc.snapshot(db, with_hemis=False)["departments"]:
        for r in dep["rooms"]:
            if r["active"]:
                for c in r["hemis_codes"]:
                    taken.setdefault(c, []).append(f"{r['monitor_id']} · {dep['name']}")
    # Faqat faol HEMIS xonalari: nofaol nusxalar (bitta xonaning eski yozuvlari) tanlashda chalkashtirmasin.
    return {"rooms": [{**r, "monitors": taken.get(r["code"], [])} for r in rooms if r.get("active", True)]}


@router.get("/admin/monitor-rooms/subjects/")
def scope_subjects(db: Session = Depends(get_db), _: AuthContext = Depends(ADMIN)) -> dict:
    """Nazoratdagi fanlar: amaliy mashg'ulotli har fan — klinikmi (avtomatik / admin), darslari."""
    from app.services import subject_scope_admin

    return subject_scope_admin.subjects(db)


@router.patch("/admin/monitor-rooms/subjects/")
def set_subject_scope(body: SubjectPatch, db: Session = Depends(get_db), auth: AuthContext = Depends(ADMIN)) -> dict:
    """Fan klinikmi — admin qarori (`clinical: null` avtomatik qoidaga qaytaradi)."""
    from app.services import subject_scope_admin

    return _guard(lambda: subject_scope_admin.set_override(db, body.name, body.clinical, by=_who(auth)))


@router.post("/admin/monitor-rooms/departments/", status_code=201)
def add_department(body: DepartmentIn, db: Session = Depends(get_db), _: AuthContext = Depends(ADMIN)) -> dict:
    dep = _guard(lambda: svc.add_department(db, body.name))
    return {"id": dep.id, "name": dep.name, "row": dep.row}


@router.patch("/admin/monitor-rooms/departments/{dep_id}/")
def rename_department(dep_id: int, body: DepartmentIn, db: Session = Depends(get_db), _: AuthContext = Depends(ADMIN)) -> dict:
    _guard(lambda: svc.rename_department(db, dep_id, body.name))
    return {"ok": True}


@router.post("/admin/monitor-rooms/rooms/", status_code=201)
def add_room(body: RoomIn, db: Session = Depends(get_db), auth: AuthContext = Depends(ADMIN)) -> dict:
    room = _guard(lambda: svc.add_room(db, body.department_id, room_full=body.room_full,
                                       hemis_codes=body.hemis_codes, by=_who(auth)))
    return {"id": room.id, "monitor_id": room.monitor_id}


@router.patch("/admin/monitor-rooms/rooms/{room_id}/")
def update_room(room_id: int, body: RoomPatch, db: Session = Depends(get_db), auth: AuthContext = Depends(ADMIN)) -> dict:
    room = _guard(lambda: svc.update_room(db, room_id, room_full=body.room_full, hemis_codes=body.hemis_codes,
                                          note=body.note, by=_who(auth)))
    return {"id": room.id, "monitor_id": room.monitor_id}


@router.delete("/admin/monitor-rooms/rooms/{room_id}/")
def remove_room(room_id: int, db: Session = Depends(get_db), auth: AuthContext = Depends(ADMIN)) -> dict:
    _guard(lambda: svc.remove_room(db, room_id, by=_who(auth)))
    return {"ok": True}


@router.post("/admin/monitor-rooms/rooms/{room_id}/restore/")
def restore_room(room_id: int, db: Session = Depends(get_db), auth: AuthContext = Depends(ADMIN)) -> dict:
    _guard(lambda: svc.restore_room(db, room_id, by=_who(auth)))
    return {"ok": True}


@router.post("/admin/monitor-rooms/resync/")
def resync(_: AuthContext = Depends(ADMIN)) -> dict:
    """HEMIS darslarini hozir qayta solishtirish (fonda)."""
    import threading

    threading.Thread(target=svc.resync_now, name="monitor-rooms-resync-now", daemon=True).start()
    return {"started": True}
