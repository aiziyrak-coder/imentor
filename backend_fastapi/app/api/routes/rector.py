"""Rektor hisobotlari — alohida kirish, faqat o'qish.

Rektor iMentor foydalanuvchisi emas: u hisob ochmaydi, rol tanlamaydi, fan
o'tmaydi. Unga bitta narsa kerak — institut bo'yicha to'liq manzara. Shu
sababli bu yerda alohida, sodda kirish bor: faqat parol.

Berilgan token DB foydalanuvchisiga bog'lanmagan (`scope` da'vosi bilan) va
SHU marshrutlardan boshqa hech qayerda ishlamaydi — qolgan endpointlar
haqiqiy foydalanuvchi talab qiladi. Admin ham shu sahifani ochib ko'ra oladi.

Hamma javob faqat O'QISH natijasi; bu yerda hech narsa yozilmaydi.
"""

from __future__ import annotations

import datetime as dt
import secrets

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import RECTOR_SCOPE, require_rector, require_rector_wide
from app.services.dean_access import ExclusionScope, allowed_departments, allowed_groups, authenticate_dean, in_groups
from app.core.config import get_settings
from app.core.db import get_db
from app.core.security import create_access_token
from app.core.throttling import throttle_login
from app.schemas.rector import RectorLoginRequest
from app.services import ai_usage_report
from app.services import rector_detail_service as detail
from app.services import control_report_service as control
from app.services import platform_overview as platforms_svc
from app.services import student_report_service as students_svc
from app.services import rector_report_service as svc
from app.services import monitor_schedule_service as monitor_svc

router = APIRouter()
settings = get_settings()

# Bir so'rovda qamrab olinadigan eng uzun oraliq. Cheklovsiz "hamma vaqt"
# so'rovi butun arxivni skanerlab, sahifani ham, bazani ham cho'ktirardi.
MAX_RANGE_DAYS = 366


def _today() -> dt.date:
    return dt.datetime.now(dt.timezone(dt.timedelta(hours=5))).date()


def _parse_day(raw: str | None, fallback: dt.date) -> dt.date:
    if not raw:
        return fallback
    try:
        return dt.date.fromisoformat(raw.strip())
    except ValueError:
        raise HTTPException(status_code=400, detail="Sana YYYY-MM-DD shaklida bo'lishi kerak.")


def _range(date_from: str | None, date_to: str | None) -> tuple[dt.date, dt.date]:
    """Sana oralig'i; berilmasa — oxirgi 7 kun."""
    end = _parse_day(date_to, _today())
    start = _parse_day(date_from, end - dt.timedelta(days=6))
    if start > end:
        start, end = end, start
    if (end - start).days + 1 > MAX_RANGE_DAYS:
        raise HTTPException(
            status_code=400,
            detail=f"Oraliq juda uzun. Eng ko'pi {MAX_RANGE_DAYS} kun.",
        )
    return start, end


# ============================ Kirish ============================


@router.post("/rector/login/")
def rector_login(
    payload: RectorLoginRequest,
    _: None = Depends(throttle_login),
) -> dict:
    """Faqat parol. Boshqa hech narsa so'ralmaydi."""
    configured = (settings.rector_report_password or "").strip()
    if not configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Rektor hisoboti uchun parol hali sozlanmagan. Administratorga murojaat qiling.",
        )
    login = (payload.username or "").strip().lower()
    password = (payload.password or "").strip()
    if not login or login in {"rektor", "rector"}:
        if not secrets.compare_digest(password, configured):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Parol noto'g'ri.")
        token = create_access_token(0, {"scope": RECTOR_SCOPE, "role": "rektor", "kind": "rektor", "label": "Rektor"})
        return {"access": token, "expires_minutes": settings.django_jwt_access_minutes, "kind": "rektor", "label": "Rektor"}

    dean = authenticate_dean(login, password)
    if dean is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Login yoki parol noto'g'ri.")
    # Dekan KAFEDRA bilan cheklanmaydi (rektor talabi, 2026-10-13): hisobotda
    # institutning hamma kafedralari ko'rinadi, hisobotdan chiqarilgan
    # beshtasidan tashqari. Fakultet taqsimoti `dean_access.FACULTIES` da
    # saqlanib qoladi — talab qaytsa, shu ro'yxatni qayta uzatish kifoya.
    #
    # GURUH cheklovi esa qoladi: xalqaro fakultet dekanining o'z kafedrasi yo'q,
    # uning guruhlariga butun institut dars beradi.
    token = create_access_token(0, {
        "scope": RECTOR_SCOPE,
        "role": "dekan",
        "kind": "dekan",
        "login": dean.login,
        "label": dean.label,
        "departments": [],
        "groups": list(dean.groups),
    })
    return {"access": token, "expires_minutes": settings.django_jwt_access_minutes, "kind": "dekan", "label": dean.label, "departments": []}


# ============================ Hisobotlar ============================


@router.get("/rector/filters/")
def rector_filters(
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_rector),
) -> dict:
    """Smart filtrlar uchun ro'yxatlar: kafedra, fan, guruh, o'quv yili, baho."""
    data = svc.filter_options(db)
    scope_groups = allowed_groups(ctx)
    if scope_groups:
        data["groups"] = [g for g in data.get("groups", []) if in_groups(g, scope_groups)]
    scope = allowed_departments(ctx, db)
    # Hisobotdan chiqarilgan kafedralarni `filter_options` o'zi olib tashlaydi.
    allowed = set() if isinstance(scope, ExclusionScope) else set(scope)
    if allowed:
        data["departments"] = [d for d in data.get("departments", []) if d in allowed]
        data["scope"] = {"kind": ctx.get("kind"), "label": ctx.get("label"), "departments": data["departments"]}
    else:
        data["scope"] = {"kind": ctx.get("kind"), "label": ctx.get("label"), "departments": []}
    # Guruh bilan cheklangan dekan (xalqaro fakultet) uchun kafedra kesimida
    # ishlaydigan bo'limlar 403 qaytaradi — sahifa o'sha tugmalarni
    # ko'rsatmasligi uchun doira shu yerda aytiladi (2026-10-11).
    data["scope"]["groups"] = list(allowed_groups(ctx))
    # Aqlli filtr kafedralarni fakultet bo'yicha guruhlaydi (2026-11-15).
    from app.services import dean_access as _da

    canon = _da.canonical_map(db)
    fac = {d["name"]: d["faculty"] for d in _da.OFFICIAL_DEPARTMENTS}
    data["department_faculty"] = {d: fac.get(_da.canonical(d, canon) or d, "") for d in data.get("departments", [])}
    # Fakultet butunligicha tanlanadi (2026-11-16): `department` ga fakultet nomi beriladi.
    data["faculties"] = [f for f in _da.faculty_names() if f in set(data["department_faculty"].values())]
    return data


@router.get("/rector/control/")
def rector_control(
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    department: str = Query(default=""),
    q: str = Query(default="", max_length=128),
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_rector),
) -> dict:
    """Rektor nazorat paneli: monitorli darslarda iMentor ishlatilishi.

    Bitta so'rovda butun sahifa — asosiy ko'rsatkich, e'tibor talab qiladigan
    o'qituvchilar, kunlik kesim, kafedralar va o'qituvchilar ro'yxati.
    """
    start, end = _range(date_from, date_to)
    out = control.overview(db, start, end, department=department, query=q, groups=allowed_groups(ctx))
    if department.strip():
        # Kesim filtrdan qat'i nazar BUTUN institutni ko'rsatadi (2026-11-17: fakultet tanlanganda qolgan
        # fakultetlar "0% · 0/0" bo'lib, nazoratda emasdek ko'rinardi). Filtrsiz hisobot keshda turadi.
        full = control.overview(db, start, end, groups=allowed_groups(ctx))
        out = {**out, "sections": full["sections"], "sections_scope": "all"}
    allowed = allowed_departments(ctx, db)
    if allowed:
        keys = {monitor_svc._norm(d) for d in allowed}

        def ok(name: str) -> bool:
            value = monitor_svc._norm(name)
            return any(k in value or value in k for k in keys)

        out["departments"] = [r for r in out["departments"] if ok(r["department"])]
        out["teachers"] = [r for r in out["teachers"] if ok(r["department"])]
        out["attention"] = [r for r in out["attention"] if ok(r["department"])]
        out["sections"] = _sections_for(out.get("sections") or [], ok)
    return out


def _sections_for(sections: list[dict], ok) -> list[dict]:
    """Dekan kesimi: faqat o'z kafedralari; fakultet jami shu kafedralardan qayta sanaladi."""
    out = []
    for fac in sections:
        deps = [d for d in fac.get("departments") or [] if ok(d.get("department") or "")]
        if not deps:
            continue
        seen: dict[str, dict] = {}
        for d in deps:
            for k in d.get("teacher_keys") or []:
                seen.setdefault(k, d)
        totals = {name: 0 for name in ("full", "partial", "opened", "none")}
        # Fakultet jami — kafedralarning toifalari yig'indisi (o'qituvchi ikki kafedrada bo'lsa — bir marta).
        for d in deps:
            for name in totals:
                totals[name] += int(d.get(name) or 0)
        teachers = len(seen) or sum(int(d.get("teachers") or 0) for d in deps)
        used = min(totals["full"] + totals["partial"], teachers)
        out.append({**fac, "departments": deps, "teachers": teachers, "used": used,
                    "percent": round(100 * used / teachers) if teachers else 0, **totals})
    return out


@router.get("/rector/platforms/")
def rector_platforms(
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    names_only: bool = Query(default=False, alias="names"),
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_rector),
) -> dict:
    """Institut tizimlari.

    iMentor raqamlari jonli hisoblanadi, qolganlari soatlik yig'ilgan
    nusxadan o'qiladi — boshqa loyihalarning xizmatlariga tegilmaydi.
    Dekan ham ko'ra oladi: bu raqamlar kafedra kesimida emas, umumiy.
    """
    start, end = _range(date_from, date_to)
    return platforms_svc.overview(db, start, end, names_only=names_only)


@router.get("/rector/control/students/")
def rector_control_students(
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_rector),
) -> dict:
    """Talabalar nazorati: test faolligi va guruhlar qamrovi."""
    start, end = _range(date_from, date_to)
    return control.students(db, start, end, only_groups=allowed_groups(ctx))


# ===================== Talabalar sahifasi (2026-10-15) =====================
# Rektor: o'qituvchilar bo'yicha alohida, talabalar bo'yicha alohida sahifa.
# Dekan cheklovi hamma yo'lda bir xil: `allowed_groups(ctx)`.


@router.get("/rector/students-report/filters/")
def rector_students_filters(
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_rector),
) -> dict:
    """Saralash ro'yxatlari: fakultet, guruh, kurs, fan."""
    return students_svc.filters(db, groups=allowed_groups(ctx))


@router.get("/rector/students-report/")
def rector_students_report(
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    faculty: str = Query(default=""),
    group: str = Query(default=""),
    course: int | None = Query(default=None),
    subject_code: str = Query(default=""),
    q: str = Query(default="", max_length=120),
    scope: str = Query(default="monitor", pattern="^(monitor|all)$"),
    department: str = Query(default="", max_length=200),
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_rector),
) -> dict:
    """Talabalar ro'yxati — filtr bo'yicha, test topshirmaganlari bilan."""
    start, end = _range(date_from, date_to)
    return students_svc.student_rows(
        db, start, end, faculty=faculty.strip(), group=group.strip(), course=course,
        subject_code=subject_code.strip(), query=q.strip(), scope=scope,
        department=department.strip(), groups=allowed_groups(ctx),
    )


@router.get("/rector/students-report/overview/")
def rector_students_overview(
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    faculty: str = Query(default=""),
    group: str = Query(default=""),
    course: int | None = Query(default=None),
    subject_code: str = Query(default=""),
    scope: str = Query(default="monitor", pattern="^(monitor|all)$"),
    department: str = Query(default="", max_length=200),
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_rector),
) -> dict:
    """Rahbariyat tahlili: qamrov, baholar, kurs/guruh kesimi, xavf, halollik."""
    start, end = _range(date_from, date_to)
    return students_svc.cached_overview(
        db, start, end, faculty=faculty.strip(), group=group.strip(), course=course,
        subject_code=subject_code.strip(), scope=scope, department=department.strip(),
        groups=allowed_groups(ctx),
    )


@router.get("/rector/students-report/trend/")
def rector_students_trend(
    date_to: str | None = Query(default=None, alias="to"),
    weeks: int = Query(default=8, ge=2, le=16),
    faculty: str = Query(default=""),
    group: str = Query(default=""),
    course: int | None = Query(default=None),
    subject_code: str = Query(default=""),
    scope: str = Query(default="monitor", pattern="^(monitor|all)$"),
    department: str = Query(default="", max_length=200),
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_rector),
) -> dict:
    """Haftalar bo'yicha talabalar qamrovi va natijasi."""
    _start, end = _range(None, date_to)
    return students_svc.weekly_trend(
        db, end, weeks=weeks, faculty=faculty.strip(), group=group.strip(), course=course,
        subject_code=subject_code.strip(), scope=scope, department=department.strip(),
        groups=allowed_groups(ctx),
    )


@router.get("/rector/students-archive/")
def rector_students_archive(
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    faculty: str = Query(default=""),
    group: str = Query(default=""),
    course: int | None = Query(default=None),
    subject_code: str = Query(default=""),
    q: str = Query(default="", max_length=120),
    department: str = Query(default="", max_length=200),
    trend: str = Query(default="", pattern="^(|up|down|flat|few)$"),
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_rector),
) -> dict:
    """Qamrovdagi talabalar (o'qituvchilar nazoratidagi kafedralar darslari) — arxivdagi
    natijalar, o'rtacha baho va o'quv yili boshidan bilim dinamikasi (2026-10-23)."""
    from app.services import student_archive_report as archive

    start, end = _range(date_from, date_to)
    return archive.roster(
        db, start, end, faculty=faculty.strip(), group=group.strip(), course=course,
        subject_code=subject_code.strip(), query=q.strip(), department=department.strip(),
        trend=trend, groups=allowed_groups(ctx),
    )


@router.get("/rector/students-archive/{student_key}/")
def rector_student_archive(
    student_key: str,
    date_to: str | None = Query(default=None, alias="to"),
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_rector),
) -> dict:
    """Bitta talaba: o'quv yili boshidan har fan bo'yicha barcha natijalar (sana, para,
    mavzu, o'qituvchi, ball, baho) va fan bo'yicha dinamika."""
    from app.services import student_archive_report as archive

    _start, end = _range(None, date_to)
    try:
        return archive.profile(db, student_key.strip(), end, groups=allowed_groups(ctx))
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/rector/students-report/{student_key}/attempts/")
def rector_student_attempts(
    student_key: str,
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    scope: str = Query(default="all", pattern="^(monitor|all)$"),
    department: str = Query(default="", max_length=200),
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_rector),
) -> dict:
    """Bitta talaba: qaysi kuni, qaysi darsda, qaysi mavzuda test topshirgan."""
    start, end = _range(date_from, date_to)
    try:
        return students_svc.student_attempts(
            db, student_key.strip(), start, end, scope=scope,
            department=department.strip(), groups=allowed_groups(ctx),
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.get("/rector/students-report/attempt/{attempt_id}/")
def rector_student_attempt(
    attempt_id: int,
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_rector),
) -> dict:
    """Bitta test: savollar, talaba belgilagan javoblar va to'g'ri javoblar."""
    try:
        return students_svc.attempt_detail(db, attempt_id, groups=allowed_groups(ctx))
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/rector/control/people/")
def rector_control_people(
    metric: str,
    key: str = Query(default=""),
    department: str = Query(default=""),
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_rector),
) -> dict:
    """Sahifadagi bitta RAQAM ortidagi odamlar — rektor raqamni bosganda ochiladi."""
    start, end = _range(date_from, date_to)
    try:
        out = control.people(db, start, end, metric=metric, key=key, department=department,
                             groups=allowed_groups(ctx))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    # «Umuman ochmagan» — har biriga dalil (2026-11-16): davrdagi qaydlar, QR, jonli test, oxirgi faollik, xona isboti.
    if metric in ("t_none", "none") and out.get("people"):
        from app.services import absence_proof

        ov = control.overview(db, start, end, department=department, groups=allowed_groups(ctx))
        proof = absence_proof.build(db, [p["key"] for p in out["people"]], start, end, rooms=ov.get("rooms") or [])
        out = {**out, "people": [{**p, "proof": proof.get(p["key"])} for p in out["people"]]}
    return out


@router.get("/rector/control/teacher/{owner_key}/")
def rector_control_teacher(
    owner_key: str,
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_rector),
) -> dict:
    """Bitta o'qituvchining batafsil hisoboti — ro'yxatdagi ismga bosilganda."""
    start, end = _range(date_from, date_to)
    return control.teacher_detail(db, owner_key, start, end, groups=allowed_groups(ctx))


@router.get("/rector/control/teacher/{owner_key}/dossier/")
def rector_control_teacher_dossier(
    owner_key: str,
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_rector),
) -> dict:
    """O'qituvchining davr bo'yicha dalillar jadvali — har dars bir qatorda (2026-11-16)."""
    from app.services import teacher_dossier

    start, end = _range(date_from, date_to)
    return teacher_dossier.build(db, owner_key, start, end, groups=allowed_groups(ctx))


@router.get("/rector/control/graded-not-opened/")
def rector_graded_not_opened(
    department: str = Query(default=""),
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_rector),
) -> dict:
    """HEMIS'da baho qo'yilgan, lekin iMentor umuman ochilmagan darslar (tunda yig'ilgan ro'yxat, 2026-11-16)."""
    from app.services import graded_scan

    start, end = _range(date_from, date_to)
    data = graded_scan.load()
    if not data:
        return {"ready": False, "items": []}
    items = [i for i in data.get("items", []) if start.isoformat() <= i["date"] <= end.isoformat()]
    groups = allowed_groups(ctx)
    if groups:
        items = [i for i in items if any(in_groups(g, groups) for g in i.get("groups") or [])]
    if department:
        from app.services.dean_access import department_filter

        mine = department_filter(db, department)
        items = [i for i in items if mine(i.get("department") or "")]
    return {"ready": True, "at": data.get("at"), "scan_from": data.get("from"), "scan_to": data.get("to"),
            "checked": data.get("checked"), "items": items,
            # Tanlangan davr tekshirilgan oraliqdan chiqsa — sahifa buni aytadi.
            "partial": start.isoformat() < str(data.get("from") or "")}


@router.get("/rector/control/lesson/{lesson_id}/")
def rector_control_lesson(
    lesson_id: int,
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_rector),
) -> dict:
    """Bitta dars ichi: bo'limlar, jonli testlar, yaratilgani, talabalar natijasi va HEMIS bahosi (2026-11-15)."""
    from app.services import lesson_detail_service as lesson_detail

    try:
        return lesson_detail.lesson_detail(db, lesson_id, groups=allowed_groups(ctx))
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc


@router.get("/rector/control/student/{student_key}/")
def rector_control_student(
    student_key: str,
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_rector),
) -> dict:
    """Bitta talabaning batafsil hisoboti."""
    start, end = _range(date_from, date_to)
    try:
        return control.student_detail(db, student_key, start, end, groups=allowed_groups(ctx))
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc


@router.get("/rector/teachers/{owner_key}/")
def rector_teacher_detail(
    owner_key: str,
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_rector_wide),
) -> dict:
    start, end = _range(date_from, date_to)
    return svc.teacher_detail(db, owner_key.strip(), start_day=start, end_day=end, allowed_departments=allowed_departments(ctx, db))


@router.get("/rector/students/{student_key}/")
def rector_student_detail(
    student_key: str,
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_rector_wide),
) -> dict:
    start, end = _range(date_from, date_to)
    return svc.student_detail(db, student_key.strip(), start_day=start, end_day=end, allowed_departments=allowed_departments(ctx, db))


@router.get("/rector/detail/")
def rector_metric_detail(
    metric: str = Query(min_length=2, max_length=64),
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    department: str = Query(default=""),
    limit: int = Query(default=detail.MAX_ROWS, ge=1, le=2000),
    db: Session = Depends(get_db),
    _: str = Depends(require_rector_wide),
) -> dict:
    """Bitta raqamning ortidagi ro'yxat: bu nima, qanday hisoblangan, kim/nima."""
    start, end = _range(date_from, date_to)
    data = detail.metric_detail(
        db,
        metric=metric.strip(),
        start_day=start,
        end_day=end,
        department=department,
        limit=limit,
    )
    if data is None:
        raise HTTPException(status_code=404, detail="Bunday ko'rsatkich yo'q.")
    return data


# ============================ AI sarfi ============================
#
# Sahifada tugmasi yo'q; xarajat o'lchovi uchun (tejashdan oldin-keyin solishtirish).


@router.get("/rector/ai-usage/")
def rector_ai_usage(
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    db: Session = Depends(get_db),
    _: str = Depends(require_rector_wide),
) -> dict:
    """AI sarfi: funksiya va model bo'yicha token va taxminiy narx."""
    start, end = _range(date_from, date_to)
    return ai_usage_report.ai_usage(db, start_day=start, end_day=end)


@router.get("/rector/telegram-bot/")
def rector_telegram_bot(
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    department: str = Query(default=""),
    db: Session = Depends(get_db),
    _: str = Depends(require_rector_wide),
) -> dict:
    """«Telegram bot» sahifasi (2026-11-18): bot postlari, mas'ullar bog'lanishi, eslatmalar va xulosalar.

    Guruh bilan cheklangan dekanga yopiq (`require_rector_wide`): bot postlarida talaba guruhi saqlanmaydi,
    ya'ni uning faqat o'z guruhlarini ko'rsatib bo'lmaydi."""
    from app.services import lesson_bot_report

    start, end = _range(date_from, date_to)
    return lesson_bot_report.report(db, start, end, department=department)
