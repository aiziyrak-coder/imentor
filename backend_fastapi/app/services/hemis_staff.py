"""Xodim profilini HEMIS'dan to'ldirish (2026-09-26).

Auditda: 781 ta profilda lavozim bo'sh, 139 tasida kafedra bo'sh edi. Bu
rektor hisobotida "profil to'liq emas" va "kafedra —" bo'lib chiqardi, fan
tanlash sahifasi esa kafedra o'rniga butun katalogni ko'rsatardi.

HEMIS'da har xodimning kafedrasi, lavozimi va ish holati bor. Qoidalar:

  * faqat BO'SH maydon to'ldiriladi — o'qituvchi yoki admin yozgani o'zgarmaydi;
  * kafedra faqat iMentor kafedrasiga ishonchli bog'langan HEMIS bo'limidan
    olinadi (`AcademicDepartment.hemis_id`), taxmin qilinmaydi;
  * ish holati (`hemis_status`) har safar yangilanadi: ta'tildagi o'qituvchi
    nazorat hisobotida ayblanmaydi, ishdan ketganning ochiq hisobi ko'rinadi.

HEMIS'ga hech narsa YOZILMAYDI.
"""

from __future__ import annotations

import datetime as dt
from typing import Any, Iterable

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.content import AcademicDepartment
from app.models.staff_location import StaffProfile
from app.models.user import User

WORKING = "Ishlamoqda"
ON_LEAVE = "Ta’tilda"
LEFT = "Bo‘shagan"

# Bir odamning bir nechta HEMIS yozuvi bo'lsa (o'rindoshlik) — qaysi biri asosiy.
_STATUS_RANK = {WORKING: 0, ON_LEAVE: 1, LEFT: 2}


def _name(value: Any) -> str:
    return str((value or {}).get("name") or "").strip()


def status_of(record: dict) -> str:
    """HEMIS ish holati, apostrof shakli bir xil qilingan."""
    raw = _name(record.get("employeeStatus"))
    folded = raw.replace("'", "’").replace("ʼ", "’")
    if folded.lower().startswith("ta’til"):
        return ON_LEAVE
    if "shagan" in raw.lower():
        return LEFT
    if raw.lower().startswith("ishla"):
        return WORKING
    return raw


def primary_record(records: list[dict]) -> dict:
    """Asosiy yozuv: avval ishlayotgani, keyin asosiy shtat (o'rindosh emas)."""
    def rank(r: dict) -> tuple[int, int]:
        form = _name(r.get("employmentForm")).lower()
        return (_STATUS_RANK.get(status_of(r), 3), 0 if "asosiy" in form else 1)
    return sorted(records, key=rank)[0]


def _departments_by_hemis(db: Session) -> dict[str, AcademicDepartment]:
    """HEMIS kafedra id → iMentor kafedrasi.

    Bitta HEMIS kafedrasiga iMentor'da bir nechta yozuv bog'langan bo'lishi
    mumkin ("Pediatriya" va "Pediatriya 1"). Unda nomi HEMIS nomiga AYNAN mos
    keladigani olinadi; bunday bo'lmasa — hech biri (taxmin qilinmaydi).
    """
    from app.services.hemis_departments import norm

    groups: dict[str, list[AcademicDepartment]] = {}
    for d in db.execute(select(AcademicDepartment)).scalars():
        if d.hemis_id and d.is_active:
            groups.setdefault(d.hemis_id, []).append(d)
    out: dict[str, AcademicDepartment] = {}
    for hemis_id, deps in groups.items():
        if len(deps) == 1:
            out[hemis_id] = deps[0]
            continue
        exact = [d for d in deps if norm(d.name) == norm(d.hemis_name)]
        if len(exact) == 1:
            out[hemis_id] = exact[0]
    return out


def _busiest_record(dep: AcademicDepartment, chairs: list, staff_counts: dict) -> AcademicDepartment:
    """Shu kafedraning iMentor'dagi yozuvlaridan xodimlari eng ko'pi (bo'lmasa — o'zi)."""
    names = (dep.name, getattr(dep, "hemis_name", "") or "")
    same = [d for d in chairs if d.id == dep.id or same_chair(d.name, *names)]
    return max(same or [dep], key=lambda d: (staff_counts.get(d.id, 0), d.id == dep.id))


def same_chair(current: str, *hemis_names: str) -> bool:
    """Bitta kafedraning ikki yozilishimi ("Terapiya UASH" ≈ "Fakultativ terapiya (UASH)")."""
    from difflib import SequenceMatcher

    from app.services.hemis_departments import norm

    def plain(value: str) -> str:
        return " ".join(norm(value).replace("(", " ").replace(")", " ").split())

    mine = plain(current)
    if not mine:
        return False
    for name in hemis_names:
        other = plain(name)
        if other and (mine in other or other in mine or SequenceMatcher(None, mine, other).ratio() >= 0.75):
            return True
    return False


def sync(db: Session, people: Iterable[dict], link: dict[Any, str], *, dry_run: bool = False) -> dict:
    """`link` — `hemis_schedule.teacher_map` natijasi (HEMIS id → login)."""
    by_login: dict[str, list[dict]] = {}
    for person in people:
        login = link.get(person.get("id"))
        if login:
            by_login.setdefault(login, []).append(person)

    departments = _departments_by_hemis(db)
    chairs = [d for d in db.execute(select(AcademicDepartment)).scalars() if d.is_active]
    staff_counts = dict(db.execute(
        select(StaffProfile.department_id, func.count()).group_by(StaffProfile.department_id)
    ).all())
    profiles = {
        p.owner_key: p
        for p in db.execute(select(StaffProfile).where(StaffProfile.owner_key.in_(list(by_login)))).scalars()
    }
    now = dt.datetime.now(dt.timezone.utc)
    stats = {"hemisda_boglangan": len(by_login), "kafedra_toldirildi": 0, "kafedra_ozgardi": [], "lavozim_toldirildi": 0,
             "profil_yaratildi": 0, "holat_ozgardi": 0, "tatilda": 0, "boshagan_faol_hisob": []}

    active = {u for (u,) in db.execute(select(User.username).where(User.is_active.is_(True)))}
    for login, records in by_login.items():
        record = primary_record(records)
        status = status_of(record)
        dep = departments.get(str((record.get("department") or {}).get("id") or ""))
        position = _name(record.get("staffPosition"))[:255]

        profile = profiles.get(login)
        if profile is None:
            profile = StaffProfile(owner_key=login, department=dep.name if dep else "",
                                   department_id=dep.id if dep else None, job_title=position,
                                   hemis_status=status, hemis_synced_at=now, updated_at=now)
            if not dry_run:
                db.add(profile)
            stats["profil_yaratildi"] += 1
        else:
            # HEMIS ustun (2026-10-21, foydalanuvchi: "hamma narsa HEMIS orqali").
            # Ilgari faqat bo'sh maydon to'ldirilardi va boshida yuklangan ro'yxat
            # qolib ketardi: Endokrinologiyaga o'tgan o'qituvchi Anatomiyada turardi.
            # HEMIS kafedrasi iMentor'dagi bitta kafedraga aniq bog'lanmasa — tegilmaydi.
            # Bitta kafedraning iMentor'dagi ikkinchi yozuviga ("Normal anatomiya" →
            # "Yu. Nishonov nomidagi Normal anatomiya") ko'chirilmaydi: kitoblar va fanlar
            # o'qituvchining hozirgi yozuvida — faqat BOSHQA kafedraga o'tish qo'llanadi.
            if (dep is not None and (profile.department_id != dep.id or (profile.department or "") != dep.name)
                    and not same_chair(profile.department or "", dep.name, getattr(dep, "hemis_name", "") or "")):
                if (profile.department or "").strip():
                    stats["kafedra_ozgardi"].append(
                        (login, profile.department or "", _busiest_record(dep, chairs, staff_counts).name))
                else:
                    stats["kafedra_toldirildi"] += 1
                # Yangi kafedraning ham ikki yozuvi bo'lishi mumkin — xodimlari ko'p
                # (kitob va fanlari o'sha yerda) yozuv olinadi.
                target = _busiest_record(dep, chairs, staff_counts)
                if not dry_run:
                    profile.department = target.name
                    profile.department_id = target.id
            if position and (profile.job_title or "") != position:
                stats["lavozim_toldirildi"] += 1
                if not dry_run:
                    profile.job_title = position
            if (profile.hemis_status or "") != status:
                stats["holat_ozgardi"] += 1
            if not dry_run:
                profile.hemis_status = status
                profile.hemis_synced_at = now

        if status == ON_LEAVE:
            stats["tatilda"] += 1
        if status == LEFT and login in active:
            stats["boshagan_faol_hisob"].append(login)

    if not dry_run:
        db.commit()
    return stats


def _person_name(value: Any) -> str:
    """"ULUG‘BEK" -> "Ulug‘bek" (str.title() apostrofdan keyin ham bosh harf qo'yardi)."""
    words = str(value or "").split()
    return " ".join(w[:1].upper() + w[1:].lower() for w in words)


def _chairs_for_new_staff(db: Session) -> dict[str, AcademicDepartment]:
    """HEMIS kafedra id → iMentor kafedrasi, yangi hisob uchun.

    `_departments_by_hemis` bitta HEMIS kafedrasiga iMentor'da ikki yozuv
    bog'langan bo'lsa (Mikrobiologiya, Epidemiologiya, Stomatologiya,
    Endokrinologiya, Lotin tili — 2026-10-21) hech birini tanlamaydi. Yangi
    o'qituvchi esa baribir shu kafedraga tegishli: o'qituvchilari eng ko'p
    bo'lgan yozuv olinadi (dublikatda odatda hech kim yo'q).

    2026-11-03: nomi HEMIS'dagiga AYNAN mos yozuv ham ustun emas — u ko'pincha
    HEMIS imlosi bilan keyin qo'shilgan bo'sh dublikat: "Fakultativ terapiya
    (UASH)" 2 xodim, "Terapiya UASH" 23 xodim va fanlari shu yerda; "Ichki
    kasallilar propedevtikasi" (HEMIS'dagi xato bilan) 2 xodim, 0 fan. Yangi
    o'qituvchi o'sha bo'sh yozuvga tushib, kafedrasining fanlarini ko'rmasdi.
    """
    from sqlalchemy import func

    out = _departments_by_hemis(db)
    counts = dict(
        db.execute(select(StaffProfile.department_id, func.count()).group_by(StaffProfile.department_id)).all()
    )
    groups: dict[str, list[AcademicDepartment]] = {}
    for d in db.execute(select(AcademicDepartment)).scalars():
        if d.hemis_id and d.is_active:
            groups.setdefault(d.hemis_id, []).append(d)
    for hemis_id, deps in groups.items():
        if len(deps) < 2:
            continue
        best = max(deps, key=lambda d: (counts.get(d.id, 0), -d.id))
        if counts.get(best.id, 0) > 0:
            out[hemis_id] = best
    return out


def provision_new_staff(db: Session, people: Iterable[dict], link: dict[Any, str], *, dry_run: bool = False) -> list[dict]:
    """Yangi ishga kirgan o'qituvchiga iMentor hisobi (2026-10-21).

    Shikoyat: yangi o'qituvchilar kira olmaydi — "mavjud emas" (masalan
    Mikrobiologiya stajer-o'qituvchisi, Xodim ID 3442612067). Sinxron faqat
    BOR hisoblarning profilini yangilardi, yangi xodimga hisob ochmasdi.

    Hisob faqat shunda ochiladi: HEMIS'da "Ishlamoqda", iMentor kafedrasiga
    bog'langan kafedrada, Xodim ID bilan hisob YO'Q (o'chirilgani ham —
    u ataylab o'chirilgan yoki birlashtirilgan bo'lishi mumkin) va u
    `teacher_map` orqali boshqa hisobga (telefon raqamli) bog'lanmagan —
    aks holda ikki hisob paydo bo'lardi. Login = Xodim ID, rol — hodim.
    Parol tasodifiy: xodim "ID raqam", JSHSHIR yoki yuz bilan kiradi.
    Yangi login `link` ga qo'shiladi, shunda `sync` profilini to'ldiradi.
    """
    import secrets

    from app.services import auth_service

    departments = _chairs_for_new_staff(db)
    existing = {u for (u,) in db.execute(select(User.username))}
    now = dt.datetime.now(dt.timezone.utc)
    by_id: dict[str, list[dict]] = {}
    for person in people:
        staff_id = str(person.get("employee_id_number") or "").strip()
        if staff_id.isdigit():
            by_id.setdefault(staff_id, []).append(person)

    linked_people = {pid for pid, login in link.items() if login}
    created: list[dict] = []
    for staff_id, records in by_id.items():
        if staff_id in existing or any(r.get("id") in linked_people for r in records):
            continue
        record = primary_record(records)
        if status_of(record) != WORKING:
            continue
        dep = departments.get(str((record.get("department") or {}).get("id") or ""))
        if dep is None:
            continue
        last = _person_name(record.get("second_name"))
        first = _person_name(record.get("first_name"))
        if not (last and first):
            continue
        created.append({"login": staff_id, "name": f"{last} {first}", "department": dep.name,
                        "position": _name(record.get("staffPosition"))})
        if dry_run:
            continue
        user = auth_service.create_user(db, staff_id, secrets.token_urlsafe(32), first, last)
        auth_service.set_user_role_group(db, user, "hodim")
        # Profil shu yerda: kafedrasi dublikatli bo'lsa `sync` uni to'ldirmaydi.
        db.add(StaffProfile(owner_key=staff_id, department=dep.name, department_id=dep.id,
                            job_title=_name(record.get("staffPosition"))[:255], hemis_status=WORKING,
                            hemis_synced_at=now, updated_at=now))
        for r in records:
            if r.get("id") is not None:
                link[r["id"]] = staff_id
    if created and not dry_run:
        db.commit()
    return created


def on_leave_logins(db: Session) -> set[str]:
    """Hozir HEMIS bo'yicha ta'tildagi xodimlar — hisobotda ayblanmaydi."""
    return {
        owner
        for (owner,) in db.execute(select(StaffProfile.owner_key).where(StaffProfile.hemis_status == ON_LEAVE))
    }
