from __future__ import annotations

import datetime as dt
import logging
import secrets
from fastapi import APIRouter, Depends, HTTPException, Request, status
from jose import JWTError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import NO_ROLE, AuthContext, get_current_auth, require_roles
from app.core.config import get_settings
from app.core.db import get_db
from app.core.security import create_access_token, create_refresh_token, decode_token, verify_password
from app.core.staff_login import is_phone_login, normalize_listener_login
from app.core.throttling import passwordless_failed, passwordless_guard, throttle_login_account
from app.models.online_edu import MalakaListener
from app.models.face_template import FaceTemplate
from app.models.person_identity import STAFF
from app.models.staff_location import StaffProfile
from app.models.student_contingent import StudentContingent
from app.models.user import User
from app.schemas.auth import (
    IdLoginRequest,
    LocalLoginRequest,
    LoginResponse,
    SwitchRoleRequest,
    TokenRefreshRequest,
    TokenRefreshResponse,
)
from app.schemas.auth_extra import OnlineTestStudentLoginRequest
from app.schemas.malaka import MalakaLoginRequest
from app.services import auth_service, user_security
from app.services import password_policy_service as pwd_policy
from app.services import staff_department as staff_dept
from app.services import online_test_client as otc
from app.services import person_identity as pid
from app.services import cam_students
from app.services import staff_merge
from app.services import staff_pinfl
from app.services import staff_profile as sp
from app.services.analytics_service import record_activity_event

router = APIRouter()
logger = logging.getLogger("imentor.auth")
settings = get_settings()

STAFF_ROLES = ("admin", "klinika_admin", "hodim")


def _login_response(
    db: Session,
    user: User,
    role: str,
    *,
    student_id: str | None = None,
    group_name: str | None = None,
    must_change: bool = False,
    include_pinfl: bool = False,
) -> LoginResponse:
    from app.services import teacher_access

    if not teacher_access.allowed(db, user.username, role):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=teacher_access.DENIED)
    extra = {"role": role}
    if student_id:
        extra["student_id"] = student_id
    # Guruh nomi ham tokenga: online ta'limda mavzu qulfi va davomat AYNAN
    # guruh bo'yicha ishlaydi, shuning uchun uni brauzerdan so'rab bo'lmaydi —
    # aks holda talaba boshqa guruh nomini yozib, o'zgalarning darsiga
    # qo'shilib olardi. Bu QO'SHIMCHA da'vo: mavjud kod uni o'qimaydi va
    # eski tokenlar ham ishlaydi.
    if group_name:
        extra["group_name"] = group_name
    # Parol almashtirilmaguncha token faqat parol almashtirishga yaraydi
    # (qarang: `deps.get_current_auth`). Da'vo faqat belgi — haqiqiy holat
    # bazadan o'qiladi, shuning uchun parol almashtirilgach shu token ham
    # darhol to'liq ishlay boshlaydi.
    if must_change:
        extra["mcp"] = 1
    access = create_access_token(user.id, extra)
    refresh = create_refresh_token(user.id, extra)
    return LoginResponse(
        access=access,
        refresh=refresh,
        role=role,
        username=user.username,
        first_name=user.first_name or "",
        last_name=user.last_name or "",
        photo_url=sp.staff_photo_url_for_user(user.username, db),
        student_id=student_id,
        group_name=group_name,
        must_change_password=must_change,
        # JSHSHIR faqat parol bilan kirganda (2026-10-23): parolsiz yo'llar uni Xodim ID
        # bilan to'plab olishga imkon berardi.
        pinfl=staff_pinfl.pinfl_for(db, user.username) if include_pinfl and not student_id else "",
        roles=_choosable_roles(db, user),
    )


def _choosable_roles(db: Session, user: User) -> list[str]:
    """Ikki rolli odamga (talaba + o'qituvchi) — tanlov; boshqalarga bo'sh ro'yxat."""
    # Faqat haqiqiy hisob uchun: testlardagi soxta foydalanuvchi va eski ma'lumot javobni buzmasin.
    if not isinstance(user, User):
        return []
    roles = auth_service.available_roles(db, user)
    return roles if len(roles) > 1 else []


def _student_group(db: Session, student_id: str) -> str | None:
    row = db.execute(
        select(StudentContingent.group_name).where(StudentContingent.student_id == student_id).limit(1)
    ).first()
    return (row[0] or None) if row else None


@router.post("/auth/switch-role/", response_model=LoginResponse)
def switch_role(
    payload: SwitchRoleRequest,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_current_auth),
) -> LoginResponse:
    """Ikki rolli odam kirgandan keyin tanlagan rol bilan yangi token (2026-10-28).

    Rol baribir bazadan tekshiriladi — token faqat tanlovni saqlaydi.
    """
    user = auth.user
    if payload.role not in auth_service.available_roles(db, user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bu rol sizning hisobingizda yo'q.")
    student_id = auth_service.resolve_student_id(user, None) if payload.role == "student" else None
    group_name = _student_group(db, student_id) if student_id else None
    return _login_response(db, user, payload.role, student_id=student_id, group_name=group_name,
                           must_change=pwd_policy.must_change(db, user.username))


def _mask_login(username: str) -> str:
    """`998939838000` -> `+998 93 ••• •• 00`; boshqa login -> `3442•••031`."""
    if len(username) == 12 and username.isdigit() and username.startswith("998"):
        return f"+998 {username[3:5]} ••• •• {username[-2:]}"
    if len(username) > 6:
        return f"{username[:4]}•••{username[-3:]}"
    return "•••"


def _disabled_account_message(db: Session, user: User) -> str:
    """O'chirilgan hisob uchun xabar. Ko'p xodimning eski Xodim ID hisobi o'chirilgan,
    ishlaydigani esa o'zi ro'yxatdan o'tgan telefon hisobi — avgustdagi qog'oz
    ro'yxatdan Xodim ID yozib "parol xato" deb qolishardi. Parol to'g'ri kiritilgandan
    keyingina (shu funksiya shundan so'ng chaqiriladi) ishlaydigan loginning yashirilgan
    ko'rinishi aytiladi."""
    # Admin birlashtirgan hisob: qayerga ko'chgani tarixda aniq yozilgan (ismi qanday yozilganidan qat'i nazar).
    merged_into = staff_merge.merged_into(db, user.username)
    if merged_into:
        return (
            "Bu hisob boshqa hisob bilan birlashtirilgan. Endi shu login bilan kiring: "
            f"{_mask_login(merged_into)}. JSHSHIR bilan ham kirish mumkin."
        )
    first = (user.first_name or "").strip().lower()
    last = (user.last_name or "").strip().lower()
    if first and last:
        twins = db.execute(
            select(User.username).where(
                User.is_active.is_(True),
                User.id != user.id,
                func.lower(func.trim(User.first_name)) == first,
                func.lower(func.trim(User.last_name)) == last,
            ).limit(2)
        ).scalars().all()
        if len(twins) == 1:
            return (
                "Bu eski hisob o'chirilgan. Siz boshqa login bilan ro'yxatdan o'tgansiz: "
                f"{_mask_login(twins[0])}. Shu login va o'zingiz qo'ygan parol bilan kiring."
            )
    return "Bu hisob o'chirilgan. Telefon raqamingiz bilan kiring yoki administratorga murojaat qiling."


@router.post("/auth/local-login/", response_model=LoginResponse)
def local_login(
    payload: LocalLoginRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> LoginResponse:
    username = payload.phone_digits
    throttle_login_account(request, username)
    user = auth_service.get_user_by_username(db, username)

    # JSHSHIR (14 raqam) — hisob logini emas: cam.fermi.uz'dan bog'langan hisob topiladi,
    # parol o'sha hisobning o'z paroli. JSHSHIR nomi bilan yangi hisob ochilmaydi.
    if user is None and staff_pinfl.is_pinfl(username):
        owner = staff_pinfl.owner_for(db, username)
        user = auth_service.get_user_by_username(db, owner) if owner else None
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Bu JSHSHIR hali iMentor hisobingizga bog'lanmagan. Xodim ID yoki telefon raqamingiz "
                "bilan kiring yoki administratorga murojaat qiling.",
            )

    if user is None:
        if not payload.register:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Telefon yoki parol noto'g'ri.")
        if not settings.django_allow_open_registration:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Ro'yxatdan o'tish faqat administrator orqali mumkin.",
            )
        reg_role = "hodim"
        user = auth_service.create_user(
            db, username, payload.password, payload.first_name.strip(), payload.last_name.strip()
        )
        auth_service.set_user_role_group(db, user, reg_role)
        role = reg_role
        now = dt.datetime.now(dt.timezone.utc)
        profile = db.execute(select(StaffProfile).where(StaffProfile.owner_key == user.username)).scalar_one_or_none()
        if profile is None:
            profile = StaffProfile(owner_key=user.username, updated_at=now)
            db.add(profile)
        profile.faculty = payload.faculty.strip()
        profile.direction = payload.direction.strip()
        staff_dept.apply_staff_department(db, profile, department_name=payload.department.strip())
        profile.updated_at = now
        record_activity_event(db, owner_key=user.username, role=role, event_type="register")
        db.commit()
        db.refresh(user)
        return _login_response(db, user, role)

    if not verify_password(payload.password, user.password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Telefon yoki parol noto'g'ri.")
    # O'chirilgan hisobga token berilmaydi. Ilgari kirish "muvaffaqiyatli" bo'lib,
    # keyingi so'rovdayoq 401 bilan chiqarib yuborardi — xodim sababini bilmasdi
    # (masalan, ikkita hisobdan keraksizi o'chirilgan Xodim ID hisobi).
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=_disabled_account_message(db, user))
    # Hisobi bor, parolni to'g'ri yozgan, lekin "Ro'yxatdan o'tish"ni bosgan —
    # rad etmaymiz, shunchaki kiritamiz (parol tekshirildi, yangi hisob ochilmaydi).

    role = auth_service.resolve_login_role(db, user, payload.role)
    if not role:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=NO_ROLE)
    auth_service.touch_last_login(db, user)
    record_activity_event(db, owner_key=user.username, role=role, event_type="login")
    db.commit()
    return _login_response(db, user, role, must_change=pwd_policy.must_change(db, user.username), include_pinfl=True)


# ======================= Parolsiz kirish: JSHSHIR yoki pasport =======================
#
# 2026-10-02: xodim ham, talaba ham parol yozmaydi — o'zining JSHSHIRi yoki
# pasporti bilan kiradi (uchinchi yo'l — yuz skaneri). Raqamlar HEMIS'da YO'Q
# (tekshirildi: talabada 62, xodimda 33 maydon, bunday maydon yo'q), ular
# cam.fermi.uz dan FAQAT O'QIB olinadi — qarang `core_personidentity`.
#
# Parol bo'lmagani uchun xabar ham umumiy: qaysi raqam topilmagani aytilmaydi,
# aks holda bu raqam tekshirish vositasiga aylanardi.

ID_DENIED = (
    "Bu ma'lumot bilan hisob topilmadi. Raqamni tekshirib qayta urining "
    "yoki kadrlar bo'limiga murojaat qiling."
)


def _staff_owner(db: Session, person) -> str:
    """Xodimning iMentor hisobi: avval JSHSHIR bog'lanishi, keyin yuz yozuvi."""
    owner = staff_pinfl.owner_for(db, person.pinfl) if person.pinfl else None
    if owner:
        return owner
    # Pasporti bor, lekin JSHSHIRi yo'q xodim ham kira olsin: yuz shabloni
    # cam.fermi.uz dagi AYNAN shu odamga bog'langan.
    row = db.execute(
        select(FaceTemplate).where(
            FaceTemplate.source_person_id == person.source_id,
            FaceTemplate.is_active.is_(True),
        )
    ).scalars().first()
    return (row.owner_key or "") if row is not None else ""


def _student_user(db: Session, person) -> tuple[User, str] | None:
    """Talabaning hisobi; birinchi kirishda ochiladi.

    Kontingentdagi `student_id` bo'yicha topiladi — cam.fermi.uz shu raqamni
    `hemis_id` ustunida saqlaydi (7031 tasining hammasi mos tushdi).
    Hisob nomi `ot_<student_id>`: test topshiriqlari ilgaridan shu nom bilan
    yozilgan, shuning uchun eski natijalar yo'qolmaydi.
    """
    sid = (person.hemis_id or "").strip()
    if not sid:
        return None
    row = db.execute(
        select(StudentContingent).where(StudentContingent.student_id == sid)
    ).scalars().first()
    if row is None:
        return None
    username = f"ot_{sid}"
    user = auth_service.get_user_by_username(db, username)
    if user is None:
        # Parol o'rniga tasodifiy qiymat: bu hisobga parol bilan kirilmaydi.
        user = auth_service.create_user(
            db, username, secrets.token_urlsafe(32),
            (row.first_name or "").strip(), (row.last_name or "").strip(),
        )
        auth_service.set_user_role_group(db, user, "student")
    return user, sid


def _student_by_id(db: Session, student_id: str) -> tuple[User, str] | None:
    """Talabani KONTINGENTDAN topadi — cam.fermi.uz kerak emas.

    JSHSHIR va pasport faqat cam.fermi.uz da bor, u esa biometrik ro'yxatdan
    o'tgandan keyin to'ladi. Yangi kelgan va xorijiy talaba u yerda hali yo'q,
    shuning uchun ular kira olmasdi (2026-10-05 shikoyati). Kontingent esa
    HEMIS'dan to'g'ridan-to'g'ri keladi va BARCHA talabani qamraydi.
    """
    sid = (student_id or "").strip()
    if not sid:
        return None
    row = db.execute(
        select(StudentContingent).where(StudentContingent.student_id == sid)
    ).scalars().first()
    if row is None:
        return None
    username = f"ot_{sid}"
    user = auth_service.get_user_by_username(db, username)
    if user is None:
        user = auth_service.create_user(
            db, username, secrets.token_urlsafe(32),
            (row.first_name or "").strip(), (row.last_name or "").strip(),
        )
        auth_service.set_user_role_group(db, user, "student")
    return user, sid


def _student_from_cam(db: Session, pinfl: str) -> tuple[User, str] | None:
    """cam.fermi.uz `/students/lookup` orqali. Javobda talaba ID'si bo'lmasa —
    kontingentdan JSHSHIR bo'yicha. Ishlamasa jim: oddiy "topilmadi" bo'ladi."""
    try:
        found = cam_students.lookup(pinfl)
    except cam_students.CamStudentsUnavailable as exc:
        logger.warning("cam.fermi.uz talaba qidiruvi ishlamadi: %s", exc)
        return None
    if found is None:
        return None
    sid = found.student_id
    if not sid:
        row = db.execute(
            select(StudentContingent).where(StudentContingent.pinfl == pinfl)
        ).scalars().first()
        sid = (row.student_id or "").strip() if row is not None else ""
    return _student_by_id(db, sid) if sid else None


#: PAROLSIZ kirish (ID, JSHSHIR, pasport, yuz) faqat shu rolga. 2026-10-23 auditi: id-login
#: STAFF_ROLES ni qabul qilardi — istalgan admin logini yozilsa parolsiz ADMIN token berilardi.
#: Admin va klinika admini faqat parol bilan kiradi (yuz va JSHSHIR yo'llari ham shunday).
PASSWORDLESS_ROLE = "hodim"


def _staff_by_id(db: Session, staff_id: str) -> User | None:
    """Xodimni Xodim ID bo'yicha topadi — iMentor logini aynan shu raqam."""
    key = (staff_id or "").strip()
    if not key:
        return None
    # 2026-11-17 (audit): ~260 o'qituvchining logini TELEFON RAQAMI (eski, qo'lda qo'shilgan hisoblar).
    # Ilgari "Xodim ID" maydoniga birovning telefon raqamini yozib, uning hisobiga parolsiz kirib
    # bo'lardi — telefon raqami sir emas. Telefon logini endi faqat parol bilan.
    if is_phone_login(key):
        return None
    user = auth_service.get_user_by_username(db, key)
    if user is None or not user.is_active:
        return None
    # Faqat o'qituvchi: talaba hisobiga bu yo'l bilan kirilmaydi (uning o'z yo'li bor),
    # admin esa parolsiz kirmaydi.
    return user if auth_service.resolve_user_role_from_db(db, user) == PASSWORDLESS_ROLE else None


def _staff_by_pinfl(db: Session, pinfl: str) -> User | None:
    """JSHSHIR institut xodim ro'yxatida bog'langan faol o'qituvchi hisobi (admin emas)."""
    owner = staff_pinfl.owner_for(db, pinfl)
    user = auth_service.get_user_by_username(db, owner) if owner else None
    if user is None or not user.is_active:
        return None
    return user if auth_service.resolve_user_role_from_db(db, user) == PASSWORDLESS_ROLE else None


def _passwordless_allowed(db: Session, user: User) -> None:
    """O'qituvchi "faqat parol bilan kirish"ni yoqqan bo'lsa — parolsiz yo'l yopiq (2026-11-17, D2)."""
    if user_security.password_only(db, user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=user_security.PASSWORD_ONLY)


def _issue_student(db: Session, user: User, student_id: str) -> LoginResponse:
    """Talaba yo'li bilan topilgan hisob. Xodim hisobi bo'lsa (2026-11-19: ikki rol o'chirildi, `ot_` hisobi
    o'qituvchi) — xodim bo'lib kiradi, talaba tokeni berilmaydi. Birlashtirilgan (nofaol) hisob — qayerga ko'chgani."""
    if not user.is_active:
        if staff_merge.merged_into(db, user.username):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=_disabled_account_message(db, user))
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=ID_DENIED)
    if auth_service.is_staff_account(db, user):
        _passwordless_allowed(db, user)
        return _issue(db, user, PASSWORDLESS_ROLE)
    # 2026-11-23: admin talaba JSHSHIRini o'qituvchi hisobiga bog'lagan (magistrant-o'qituvchi) — Talaba ID
    # bilan kirganda ham o'qituvchi bo'lib kiradi. Ilgari faqat JSHSHIR bilan kirganda ishlardi va ular
    # odatdagidek Talaba ID bilan kirib, talaba kabinetida qolib ketardi.
    staff = _admin_linked_staff(db, student_id)
    if staff is not None:
        _passwordless_allowed(db, staff)
        return _issue(db, staff, PASSWORDLESS_ROLE)
    return _issue(db, user, "student", student_id)


def _admin_linked_staff(db: Session, student_id: str) -> User | None:
    from app.models.person_identity import PersonIdentity

    sid = (student_id or "").strip()
    if not sid:
        return None
    pinfls = db.execute(
        select(PersonIdentity.pinfl).where(PersonIdentity.hemis_id == sid, PersonIdentity.pinfl != "")
    ).scalars().all()
    for pinfl in pinfls:
        owner = staff_pinfl.admin_owner_for(db, pinfl)
        if owner:
            user = auth_service.get_user_by_username(db, owner)
            if user is not None and user.is_active:
                return user
    return None


def _issue(db: Session, user: User, role: str, student_id: str | None = None) -> LoginResponse:
    auth_service.touch_last_login(db, user)
    record_activity_event(db, owner_key=user.username, role=role, event_type="login")
    db.commit()
    return _login_response(db, user, role, student_id=student_id)


@router.post("/auth/id-login/", response_model=LoginResponse)
def id_login(
    payload: IdLoginRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> LoginResponse:
    """JSHSHIR, pasport yoki institut raqami bilan kirish. Parol so'ralmaydi."""
    pinfl = (payload.pinfl or "").strip()
    institute_id = (payload.institute_id or "").strip()
    ident = institute_id or pinfl or f"{payload.passport_series}{payload.passport_number}"
    throttle_login_account(request, ident)
    passwordless_guard(request, ident)
    try:
        return _id_login(payload, db)
    except HTTPException as exc:
        if exc.status_code == status.HTTP_401_UNAUTHORIZED:
            passwordless_failed(request)
        raise


def _id_login(payload: IdLoginRequest, db: Session) -> LoginResponse:
    denied = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=ID_DENIED)
    pinfl = (payload.pinfl or "").strip()
    institute_id = (payload.institute_id or "").strip()

    # Institut bergan raqam (Talaba ID / Xodim ID) — HEMIS ma'lumotidan
    # to'g'ridan-to'g'ri, cam.fermi.uz ga bog'liq emas.
    if institute_id:
        staff = _staff_by_id(db, institute_id)
        if staff is not None:
            _passwordless_allowed(db, staff)
            return _issue(db, staff, PASSWORDLESS_ROLE)
        found_student = _student_by_id(db, institute_id)
        if found_student is None:
            raise denied
        user, student_id = found_student
        return _issue_student(db, user, student_id)

    person = pid.find(
        db, pinfl=pinfl,
        series=payload.passport_series, number=payload.passport_number,
    )
    if (person is None or person.kind != STAFF) and staff_pinfl.admin_owner_for(db, pinfl):
        # Administrator JSHSHIRni o'qituvchi hisobiga qo'lda bog'lagan — cam.fermi.uz'da u talaba
        # bo'lib tursa ham (magistrant stajer-o'qituvchi, 2026-11-02) o'qituvchi bo'lib kiradi.
        # Talaba sifatida — Talaba ID bilan.
        staff = _staff_by_pinfl(db, pinfl)
        if staff is not None:
            _passwordless_allowed(db, staff)
            return _issue(db, staff, PASSWORDLESS_ROLE)
    if person is None and pid.is_pinfl(pinfl):
        # cam.fermi.uz nusxasida yo'q, lekin JSHSHIR xodim hisobiga bog'langan (`core_staffpinfl` —
        # cam.fermi.uz xodim JSHSHIRi, yuz/ism/admin bo'yicha bog'langan). 2026-10-28: 5 xodim
        # JSHSHIR bilan "hisob topilmadi" olardi, garchi HEMIS'da va iMentor'da bo'lsa ham.
        staff = _staff_by_pinfl(db, pinfl)
        if staff is not None:
            _passwordless_allowed(db, staff)
            return _issue(db, staff, PASSWORDLESS_ROLE)
    if person is None and pid.is_pinfl(pinfl):
        # Nusxada yo'q — nusxadan keyin cam.fermi.uz'da ro'yxatdan o'tgan talaba
        # bo'lishi mumkin: jonli so'raymiz (2026-10-12).
        found_live = _student_from_cam(db, pinfl)
        if found_live is not None:
            user, student_id = found_live
            return _issue_student(db, user, student_id)
    if person is None:
        raise denied

    if person.kind == STAFF:
        owner = _staff_owner(db, person)
        user = auth_service.get_user_by_username(db, owner) if owner else None
        if user is None:
            raise denied
        if not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail=_disabled_account_message(db, user)
            )
        role = auth_service.resolve_user_role_from_db(db, user)
        if not role:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=NO_ROLE)
        if role != PASSWORDLESS_ROLE:
            # Admin JSHSHIR/pasport bilan parolsiz kirmaydi — javob "topilmadi" bilan bir xil.
            raise denied
        _passwordless_allowed(db, user)
        return _issue(db, user, role)

    found = _student_user(db, person)
    if found is None:
        raise denied
    user, student_id = found
    return _issue_student(db, user, student_id)


@router.get("/auth/passport-series/")
def passport_series() -> dict:
    """Pasport seriyasi ro'yxati — kirish oynasidagi tanlov uchun."""
    return {"series": list(pid.SERIES_CHOICES)}


@router.post("/auth/token/refresh/", response_model=TokenRefreshResponse)
def token_refresh(payload: TokenRefreshRequest, db: Session = Depends(get_db)) -> TokenRefreshResponse:
    try:
        claims = decode_token(payload.refresh)
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token yaroqsiz yoki muddati o'tgan.")
    if claims.get("token_type") != "refresh":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token talab qilinadi.")

    user_id = claims.get("user_id")
    user = db.get(User, int(user_id)) if user_id else None
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Foydalanuvchi topilmadi.")
    # Bekor qilingan refresh token yangi token ololmaydi (2026-11-17, G8).
    if user_security.token_revoked(db, user, claims):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=user_security.REVOKED)

    # Rol faqat bazadan: guruhi olib tashlangan foydalanuvchi eski tokendagi
    # rol bilan yangilanib yuravermasin (2026-09-26). Ikki rolli odamning tanlovi
    # (2026-10-28) saqlanadi, lekin u ham bazadan tekshiriladi.
    role = auth_service.session_role(db, user, claims.get("role"))
    if not role:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=NO_ROLE)
    extra: dict = {"role": role}
    student_id = auth_service.resolve_student_id(user, claims.get("student_id"))
    if student_id:
        extra["student_id"] = student_id

    # Guruh nomi ham ko'chirilishi SHART. Online ta'limda talabaning guruhi
    # faqat shu da'vodan olinadi — yangilangan tokenda u yo'qolsa, talaba
    # tizimda ko'rinib turadi, lekin har bir so'rov "guruhingiz aniqlanmadi"
    # deb rad etiladi va chiqib-kirishdan boshqa yo'l qolmaydi.
    group_name = str(claims.get("group_name") or "").strip()
    if group_name:
        extra["group_name"] = group_name

    # Bazadan qayta o'qiladi: parol almashtirilgan bo'lsa belgi tushib qoladi.
    if pwd_policy.must_change(db, user.username):
        extra["mcp"] = 1

    return TokenRefreshResponse(
        access=create_access_token(user.id, extra),
        refresh=create_refresh_token(user.id, extra),
    )


@router.post("/auth/online-test-login/", response_model=LoginResponse)
def online_test_student_login(
    payload: OnlineTestStudentLoginRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> LoginResponse:
    student_id = (payload.id or payload.student_id or payload.username or "").strip()
    throttle_login_account(request, student_id)
    password = (payload.password or "").strip()
    if not student_id or not password:
        raise HTTPException(status_code=400, detail="Talaba ID va parol majburiy.")

    try:
        ot = otc.online_test_login(student_id, password)
    except otc.OnlineTestAuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)

    user_info = ot["user"]
    first_name, last_name = otc.split_person_name(str(user_info.get("name") or ""))
    sid = str(user_info.get("id") or student_id).strip()
    # Ism HEMIS kontingentidan (2026-11-24): onlinetest ismni qisqartirib/teskari bo'lib beradi ("Raj Ravi" —
    # aslida "Sofia Ravi Raj") va har kirishda iMentor'dagi to'g'rilangan ismni bosib ketardi.
    row = db.execute(select(StudentContingent).where(StudentContingent.student_id == sid)).scalars().first()
    if row is not None and (row.first_name or "").strip() and (row.last_name or "").strip():
        first_name = " ".join(w.capitalize() for w in row.first_name.split())[:150]
        last_name = " ".join(w.capitalize() for w in row.last_name.split())[:150]
    username = f"ot_{sid}"[:150]

    user = auth_service.get_user_by_username(db, username)
    if user is not None and auth_service.is_staff_account(db, user):
        # Xodim hisobi (2026-11-19): talabaga aylantirilmaydi — o'qituvchi bo'lib kiradi.
        if not user.is_active:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=_disabled_account_message(db, user))
        return _issue(db, user, PASSWORDLESS_ROLE)
    if user is None:
        user = auth_service.create_user(db, username, "", first_name, last_name)
        user.password = ""
    else:
        if not user.is_active and staff_merge.merged_into(db, user.username):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=_disabled_account_message(db, user))
        user.first_name = first_name
        user.last_name = last_name
    auth_service.set_user_role_group(db, user, "student")
    auth_service.touch_last_login(db, user)
    record_activity_event(db, owner_key=user.username, role="student", event_type="login")
    db.commit()
    db.refresh(user)

    group_name = str(user_info.get("group_name") or "").strip() or None
    return _login_response(db, user, "student", student_id=sid, group_name=group_name)


@router.post("/auth/malaka-login/", response_model=LoginResponse)
def malaka_login(
    payload: MalakaLoginRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> LoginResponse:
    """Malaka oshirish tinglovchisi: login — pasport seriyasi va raqami.

    Tinglovchi OnlineTest'da yo'q, u farmoyish bo'yicha qabul qilinadi.
    Guruhi tokenga SHU yerda, `malaka_listener` jadvalidan yoziladi —
    online talabadagi kabi tashqaridan olinmaydi.

    Boshlang'ich parol ham pasport. U almashtirilmaguncha parol maydoni
    ham login kabi erkin o'qiladi ("aa 1111111" = "AA1111111"): pasportni
    har kim o'zicha yozadi va birinchi kirishning o'zi to'siq bo'lmasin.

    2026-09-19: bu marshrut serverdagi manba kodda yo'q edi (faqat eski
    image'da bor edi) va backend qayta yig'ilganda yo'qolib, tinglovchilar
    "Not Found" olgan — `tests/test_malaka_login_route.py` qaytmasligini tekshiradi.
    """
    denied = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED, detail="Login yoki parol noto'g'ri."
    )
    username = normalize_listener_login(payload.login)
    if not username:
        raise denied
    throttle_login_account(request, username)
    listener = db.execute(
        select(MalakaListener).where(MalakaListener.username == username)
    ).scalar_one_or_none()
    user = auth_service.get_user_by_username(db, username) if listener else None
    if listener is None or not listener.is_active or user is None or not user.is_active:
        raise denied

    pending = pwd_policy.must_change(db, username)
    ok = verify_password(payload.password, user.password or "")
    if not ok and pending:
        ok = verify_password(normalize_listener_login(payload.password), user.password or "")
    if not ok:
        raise denied

    group = listener.group
    if group is None or not group.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Guruhingiz hali faollashtirilmagan. Fakultetga murojaat qiling.",
        )

    auth_service.touch_last_login(db, user)
    record_activity_event(db, owner_key=user.username, role="student", event_type="login")
    db.commit()
    return _login_response(
        db, user, "student", student_id=username, group_name=group.name, must_change=pending
    )


@router.get("/academic-catalog/")
def academic_catalog(auth: AuthContext = Depends(require_roles(*STAFF_ROLES, "student"))) -> dict:
    try:
        return otc.fetch_academic_catalog()
    except otc.OnlineTestAuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)


@router.get("/public/kafedralar/")
def public_kafedralar() -> list[dict]:
    """Ro'yxatdan o'tish formasi uchun kafedra ro'yxati — faqat nom/kod, talaba ma'lumotisiz."""
    try:
        catalog = otc.fetch_academic_catalog()
    except otc.OnlineTestAuthError:
        return []
    rows: list[dict] = []
    for kafedra in catalog.get("kafedralar") or []:
        name = str(kafedra.get("name") or "").strip()
        if not name:
            continue
        rows.append(
            {
                "id": kafedra.get("id"),
                "name": name,
                "code": kafedra.get("code"),
                "directions": [
                    str(d.get("name") or "").strip()
                    for d in (kafedra.get("directions") or [])
                    if str(d.get("name") or "").strip()
                ],
            }
        )
    rows.sort(key=lambda r: r["name"])
    return rows


@router.get("/admin/cam-students/health/")
def cam_students_health(_: AuthContext = Depends(require_roles("admin"))) -> dict:
    """cam.fermi.uz talabalar API kaliti ishlayaptimi (kalitning o'zi qaytarilmaydi)."""
    return cam_students.health()
