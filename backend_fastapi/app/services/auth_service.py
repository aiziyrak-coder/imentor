from __future__ import annotations

import datetime as dt
import os

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.models.user import Group, User

ALLOWED_ROLES = ("admin", "hodim")
# Guruh sifatida saqlanadigan barcha rollar (Django ALLOWED_ROLES bilan bir xil —
# STAFF_ROLES + student). LocalLogin faqat admin/hodim qabul qiladi,
# lekin klinika_admin/student rollari boshqa oqimlar orqali (clinic-admin,
# online-test-login) tayinlanadi va shu ro'yxatda bo'lishi kerak.
ALL_GROUP_ROLES = ("admin", "klinika_admin", "hodim", "student")




def resolve_user_role_from_db(db: Session, user: User) -> str | None:
    if user.is_superuser:
        return "admin"
    group_names = {g.name.lower() for g in user.groups}
    for role in ALLOWED_ROLES + ("klinika_admin", "student"):
        if role in group_names:
            return role
    return None


#: Ham talaba, ham o'qituvchi (2026-10-28): magistrant stajer-o'qituvchi bitta `ot_<Talaba ID>` hisobida
#: ikki rolda ishlaydi — kirgandan keyin qaysi biri bilan davom etishini tanlaydi. Hisobda ikkala
#: guruh bo'lsa ham, yoki HEMIS'ga ko'ra u faol talaba VA ishlayotgan xodim bo'lsa ham.
DUAL_ROLES = ("hodim", "student")


def _hemis_dual(db: Session, user: User) -> bool:
    """`ot_<ID>` hisobi: kontingentda faol talaba va HEMIS xodim profili shu hisobga biriktirilgan."""
    from app.models.staff_location import StaffProfile
    from app.models.student_contingent import StudentContingent

    username = str(user.username or "")
    if not username.startswith("ot_") or len(username) <= 3:
        return False
    student = db.execute(
        select(StudentContingent.id).where(StudentContingent.student_id == username[3:],
                                           StudentContingent.status == "active").limit(1)
    ).first()
    if student is None:
        return False
    # Ishdan bo'shagan (`hemis_staff.LEFT`) xodim o'qituvchi bo'lib kira olmaydi.
    staff = db.execute(
        select(StaffProfile.id).where(StaffProfile.owner_key == username, StaffProfile.department != "",
                                      StaffProfile.hemis_status != "", StaffProfile.hemis_status != "Bo‘shagan")
        .limit(1)
    ).first()
    return staff is not None


#: 2026-11-19 (foydalanuvchi): "faqat xodim qilib, o'quvchiligi kerak emas, bitta hisobli, konfliktsiz; ikki
#: rollilarni faqat o'qituvchi qiling". Ikki rol (bitta hisobda talaba + o'qituvchi) O'CHIRILDI: talaba hisobidan
#: dars o'tilsa bot va hisobot o'qituvchini ko'rmasdi (Sobirova — `ot_` hisobidan 59 jonli test, darslari esa
#: Xodim ID hisobida). Endi har kimda bitta rol; xodim hisobi talaba yo'li bilan kirsa ham xodim bo'lib qoladi
#: (`is_staff_account`). Qayta yoqish kerak bo'lsa — `DUAL_ROLE_ENABLED = True`.
DUAL_ROLE_ENABLED = False


def available_roles(db: Session, user: User) -> list[str]:
    """Foydalanuvchi qaysi rollarda kira oladi; birinchisi — bazadagi asosiy rol emas, tanlov tartibi."""
    primary = resolve_user_role_from_db(db, user)
    if not DUAL_ROLE_ENABLED or primary not in DUAL_ROLES:
        return [primary] if primary else []
    groups = {g.name.lower() for g in user.groups}
    if groups.issuperset(DUAL_ROLES) or _hemis_dual(db, user):
        return list(DUAL_ROLES)
    return [primary]


def is_staff_account(db: Session, user: User | None) -> bool:
    """Xodim (o'qituvchi) hisobi — talaba kirish yo'llari uni talabaga aylantirmasin (2026-11-19)."""
    if not user:
        return False
    if getattr(user, "is_superuser", False):
        return True
    groups = {str(getattr(g, "name", "")).lower() for g in (getattr(user, "groups", None) or [])}
    return bool(groups & {"hodim", "klinika_admin", "admin"})


def session_role(db: Session, user: User, claimed: str | None) -> str | None:
    """Tokendagi rol — faqat foydalanuvchida haqiqatan bor bo'lsa; aks holda bazadagi rol.

    Rol hamon bazadan tekshiriladi (2026-09-26 qoidasi): token faqat IKKI ROLLI odam
    qaysi birini tanlaganini aytadi, yangi rol bera olmaydi.
    """
    primary = resolve_user_role_from_db(db, user)
    want = str(claimed or "").strip().lower()
    if primary and want and want != primary and want in DUAL_ROLES and want in available_roles(db, user):
        return want
    return primary


def set_user_role_group(db: Session, user: User, role: str) -> None:
    role = (role or "").strip().lower()
    if role not in ALL_GROUP_ROLES:
        return
    for name in ALL_GROUP_ROLES:
        group = db.execute(select(Group).where(Group.name == name)).scalar_one_or_none()
        if group is not None and group in user.groups:
            user.groups.remove(group)
    group = db.execute(select(Group).where(Group.name == role)).scalar_one_or_none()
    if group is None:
        group = Group(name=role)
        db.add(group)
        db.flush()
    user.groups.append(group)


def ensure_admin_group(db: Session, user: User) -> None:
    group = db.execute(select(Group).where(Group.name == "admin")).scalar_one_or_none()
    if group is None:
        group = Group(name="admin")
        db.add(group)
        db.flush()
    if group not in user.groups:
        user.groups.append(group)


def resolve_student_id(user: User, jwt_claim: str | None = None) -> str | None:
    """OnlineTest talaba ID — JWT claim yoki shadow username `ot_<id>`."""
    claim = str(jwt_claim or "").strip()
    if claim:
        return claim
    uname = str(user.username or "")
    if uname.startswith("ot_"):
        sid = uname[3:].strip()
        return sid or None
    return None


def resolve_login_role(db: Session, user: User, requested_role: str | None) -> str:
    """Login paytida rol — Django LocalLoginView bilan bir xil: DB guruhlari asosiy manba.

    Guruhni `hodim`ga o'zgartirmaydi. Aks holda admin/klinika_admin har kirishda
    (frontend role yubormaganda default `hodim`) huquqini yo'qotardi.
    """
    if user.is_superuser:
        return "admin"
    # 2026-11-17 (audit D3): ilgari `role:"admin"` so'ralsa va telefon `DEMO_ADMIN_PHONES` ro'yxatida
    # bo'lsa, hisob ADMIN guruhiga qo'shib yuborilardi — so'rov tanasidan admin olish yo'li edi.
    # Endi rol FAQAT bazadan: adminni faqat superuser (admin panel orqali) tayinlaydi.
    # Rolsiz hisob endi o'qituvchi bo'lib kirmaydi (2026-09-26) — bo'sh qaytadi,
    # login yo'li uni rad etadi.
    return resolve_user_role_from_db(db, user) or ""


def get_user_by_username(db: Session, username: str) -> User | None:
    return db.execute(select(User).where(User.username == username)).scalar_one_or_none()


def create_user(db: Session, username: str, password: str, first_name: str, last_name: str) -> User:
    user = User(
        username=username,
        password=hash_password(password),
        first_name=first_name,
        last_name=last_name,
        is_superuser=False,
        is_staff=False,
        is_active=True,
        date_joined=dt.datetime.now(dt.timezone.utc),
    )
    db.add(user)
    db.flush()
    return user


def touch_last_login(db: Session, user: User) -> None:
    user.last_login = dt.datetime.now(dt.timezone.utc)
