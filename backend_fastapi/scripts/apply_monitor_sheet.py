"""Google jadvaldagi «Interaktiv doska» ro'yxatini `core_monitorroom` ga qo'llash (2026-11-16).

    python scripts/apply_monitor_sheet.py boards.csv            # sinov: nima o'zgarishini ko'rsatadi
    python scripts/apply_monitor_sheet.py boards.csv --apply    # saqlash

Qoidalar:
  * qator raqami (T/r) = kafedra; jadvaldagi xona tizimdagisiga (bino + xona raqami/harfi) mos kelsa —
    o'sha monitor, ID o'zgarmaydi, nomi jadvaldagidek yoziladi;
  * jadvalda bor, tizimda yo'q — yangi monitor (yangi ID), bugundan hisobga kiradi (o'tgan darslar o'zgarmaydi);
  * tizimda bor, jadvalda yo'q — O'CHIRILMAYDI, izoh qo'yiladi; admin sahifada o'zi hal qiladi;
  * HEMIS xonasi nom bo'yicha topilsa — bog'lanadi (`hemis_codes`), topilmasa admin tanlaydi.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import re
import sys

sys.path.insert(0, ".")

from sqlalchemy import select  # noqa: E402

from app.core.db import SessionLocal  # noqa: E402
from app.models.monitor_room import MonitorDepartment, MonitorRoom  # noqa: E402
from app.services import hemis_schedule as hs  # noqa: E402
from app.services import monitor_inventory  # noqa: E402
from app.services import monitor_rooms_admin as svc  # noqa: E402

NOTE_MISSING = "Google jadvalda yo'q (2026-11-16) — tekshiring"


def clean(v) -> str:
    return re.sub(r"\s+", " ", str(v or "").replace("\n", " ")).strip()


def key(text: str) -> tuple[str, str, str]:
    letter, number = hs._room_key(text)
    return hs._inventory_building(text), letter, number


def same(a: tuple, b: tuple) -> bool:
    if a[2] != b[2] or a[1] != b[1] or not a[2]:
        return False
    return a[0] == b[0] or not a[0] or not b[0]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("csv")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    sheet: dict[int, tuple[str, list[str]]] = {}
    for r in csv.reader(open(args.csv, encoding="utf-8")):
        cells = [clean(c) for c in r]
        if cells and cells[0].isdigit():
            sheet[int(cells[0])] = (cells[1], [c for c in cells[2:] if c])

    hemis = svc.hemis_rooms(force=True)
    today = dt.date.today()
    db = SessionLocal()
    deps = {d.row: d for d in db.execute(select(MonitorDepartment)).scalars()}
    rooms = db.execute(select(MonitorRoom)).scalars().all()
    by_dep: dict[int, list[MonitorRoom]] = {}
    for r in rooms:
        by_dep.setdefault(r.department_id, []).append(r)

    next_n = max(int(re.sub(r"\D", "", r.monitor_id) or 0) for r in rooms) + 1 if rooms else 1
    kept = added = missing = linked = unlinked = 0
    for row, (name, texts) in sorted(sheet.items()):
        dep = deps.get(row)
        if dep is None:
            dep = MonitorDepartment(row=row, name=name, aliases=[], group_rooms=[])
            db.add(dep)
            db.flush()
            print(f"+ KAFEDRA {row}. {name}")
        elif clean(dep.name).casefold() != name.casefold():
            print(f"  {row}. nomi: «{dep.name}» → jadvalda «{name}» (nomi o'zgartirilmadi)")
        mine = [r for r in by_dep.get(dep.id, []) if r.active_to is None]
        used: set[int] = set()
        for text in texts:
            k = key(text)
            match = next((r for r in mine if r.id not in used and same(key(r.room_full), k)), None)
            codes = svc.match_codes(text, hemis)
            if match is not None:
                used.add(match.id)
                kept += 1
                if match.room_full != text:
                    print(f"  = {match.monitor_id} {row}. «{match.room_full}» → «{text}»")
                match.room_full = text[:255]
                if codes and not match.hemis_codes:
                    match.hemis_codes = codes
                if NOTE_MISSING in (match.note or ""):
                    match.note = ""
                room = match
            else:
                mid = f"MON-{next_n:03d}"
                next_n += 1
                room = MonitorRoom(monitor_id=mid, department_id=dep.id, room_full=text[:255], hemis_codes=codes,
                                   sort=100 + len(used) + added, active_from=today, updated_by="google-sheet")
                db.add(room)
                added += 1
                print(f"+ {mid} {row}. {name[:40]} — «{text}»" + ("" if codes else "  [HEMIS'da topilmadi]"))
            if room.hemis_codes:
                linked += 1
            else:
                unlinked += 1
        for r in mine:
            if r.id not in used:
                missing += 1
                r.note = NOTE_MISSING
                if not r.hemis_codes:
                    r.hemis_codes = svc.match_codes(r.room_full, hemis)
                print(f"? {r.monitor_id} {row}. «{r.room_full}» — jadvalda yo'q, faol qoladi")
    # Jadvalda umuman yo'q kafedralarning xonalari ham HEMIS bilan bog'lanadi.
    for r in rooms:
        if not r.hemis_codes:
            r.hemis_codes = svc.match_codes(r.room_full, hemis)

    print(f"\nmos: {kept}, yangi: {added}, jadvalda yo'q (faol qoldi): {missing}, "
          f"HEMIS bilan bog'langan: {linked}, bog'lanmagan: {unlinked}")
    if args.apply:
        db.commit()
        monitor_inventory.clear()
        print("SAQLANDI")
    else:
        db.rollback()
        print("SINOV (saqlanmadi)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
