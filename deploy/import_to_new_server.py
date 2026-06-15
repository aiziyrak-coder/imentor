#!/usr/bin/env python3
"""Import old_server_export.json into new server database via SSH + Django shell."""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from remote_deploy import merge_env, ssh_connect_with_retry, run, sh_single_quote

EXPORT_FILE = Path(__file__).resolve().parent / "old_server_export.json"

IMPORT_SCRIPT = r'''
import json
from datetime import datetime, time as dt_time
from django.contrib.auth.models import Group, User
from django.utils.dateparse import parse_datetime

from core.models import (
    CampusBuilding,
    CourseSyllabus,
    StaffLocationPing,
    StaffScheduleSlot,
)

data = json.loads(open("/tmp/imentor_import.json", encoding="utf-8").read())

def parse_time(s):
    if not s:
        return dt_time(9, 0)
    parts = str(s).split(":")
    return dt_time(int(parts[0]), int(parts[1]), int(parts[2]) if len(parts) > 2 else 0)

# Demo users (local-login bilan mos)
USERS = [
    ("998901110001", "AdminDemo123", "admin", "Admin", "Demo"),
    ("998901112233", "TestHodim123", "hodim", "Test", "Hodim"),
    ("998901110002", "TarjimaDemo123", "tarjimon", "Tarjimon", "Demo"),
    ("998901110003", "StartupDemo123", "startuper", "Startuper", "Demo"),
]
for phone, pw, role, fn, ln in USERS:
    u, created = User.objects.get_or_create(username=phone, defaults={"first_name": fn, "last_name": ln})
    if created or not u.has_usable_password():
        u.set_password(pw)
        u.save(update_fields=["password"])
    g, _ = Group.objects.get_or_create(name=role)
    u.groups.add(g)

building_map = {}
for row in data.get("campus_buildings", []):
    obj, _ = CampusBuilding.objects.update_or_create(
        id=row["id"],
        defaults={
            "name": row["name"],
            "short_code": row.get("short_code", ""),
            "latitude": row["latitude"],
            "longitude": row["longitude"],
            "radius_m": row.get("radius_m", 1000),
            "boundary": row.get("boundary") or [],
            "sort_order": row.get("sort_order", 0),
            "notes": row.get("notes", ""),
            "is_active": row.get("is_active", True),
        },
    )
    building_map[row["id"]] = obj

for row in data.get("course_syllabuses", []):
    CourseSyllabus.objects.update_or_create(
        id=row["id"],
        defaults={
            "subject_name": row["subject_name"],
            "subject_code": row["subject_code"],
            "description": row.get("description", ""),
            "file_name": row.get("file_name", ""),
            "topics": row.get("topics") or [],
            "variants": row.get("variants") or [],
            "sort_order": row.get("sort_order", 0),
            "is_active": row.get("is_active", True),
        },
    )

for row in data.get("staff_schedule", []):
    b = building_map.get(row.get("building", {}).get("id")) if row.get("building") else None
    StaffScheduleSlot.objects.update_or_create(
        id=row["id"],
        defaults={
            "owner_key": row["owner_key"],
            "week_phase": row.get("week_phase", "every"),
            "weekday": row["weekday"],
            "start_time": parse_time(row.get("start_time")),
            "end_time": parse_time(row.get("end_time")),
            "building": b,
            "building_name": row.get("building_name", ""),
            "latitude": row["latitude"],
            "longitude": row["longitude"],
            "radius_m": row.get("radius_m", 1000),
            "title": row.get("title", ""),
            "is_active": row.get("is_active", True),
        },
    )

StaffLocationPing.objects.all().delete()
for row in data.get("location_pings", []):
    recorded = parse_datetime(row.get("recorded_at") or "")
    ping = StaffLocationPing.objects.create(
        owner_key=row["owner_key"],
        latitude=row["latitude"],
        longitude=row["longitude"],
        accuracy_m=row.get("accuracy_m"),
        client_ts_ms=row.get("client_ts_ms"),
    )
    if recorded:
        StaffLocationPing.objects.filter(pk=ping.pk).update(recorded_at=recorded)

print("IMPORT_DONE")
print("users", User.objects.count())
print("buildings", CampusBuilding.objects.count())
print("syllabuses", CourseSyllabus.objects.count())
print("schedule", StaffScheduleSlot.objects.count())
print("pings", StaffLocationPing.objects.count())
'''


def main():
    if not EXPORT_FILE.is_file():
        raise SystemExit(f"Missing {EXPORT_FILE} — run export from old server first.")

    payload = EXPORT_FILE.read_text(encoding="utf-8")
    cfg = merge_env()
    client = ssh_connect_with_retry(cfg, verbose=True)

    sftp = client.open_sftp()
    try:
        with sftp.file("/tmp/imentor_import.json", "w") as f:
            f.write(payload)
        with sftp.file("/tmp/imentor_import_run.py", "w") as f:
            f.write(IMPORT_SCRIPT)
    finally:
        sftp.close()

    remote = f"""set -eu
cd /opt/imentor
CID=$(docker compose -f docker-compose.prod.yml -f docker-compose.imentor.yml --env-file deploy/.env.production ps -q backend)
docker cp /tmp/imentor_import.json "$CID":/tmp/imentor_import.json
docker cp /tmp/imentor_import_run.py "$CID":/tmp/imentor_import_run.py
docker compose -f docker-compose.prod.yml -f docker-compose.imentor.yml --env-file deploy/.env.production exec -T backend sh -c 'python manage.py shell < /tmp/imentor_import_run.py'
rm -f /tmp/imentor_import.json /tmp/imentor_import_run.py
curl -sfS http://127.0.0.1:31002/api/health/ && echo " backend_ok"
"""
    code, out, err = run(client, remote, timeout=180)
    print(out.encode("ascii", errors="replace").decode("ascii"))
    if err:
        print(err.encode("ascii", errors="replace").decode("ascii"), file=sys.stderr)
    client.close()
    if code != 0 or "IMPORT_DONE" not in out:
        raise SystemExit(f"Import failed (exit {code})")
    print("Tayyor: ma'lumotlar yangi serverga import qilindi.")


if __name__ == "__main__":
    main()
