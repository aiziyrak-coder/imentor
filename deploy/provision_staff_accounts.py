#!/usr/bin/env python3
"""
Mahalliy brauzer eksportidan serverga xodimlarni sinxronlash.

Foydalanish:
  1. Admin brauzerida DevTools > Application > localStorage >
     `salomatlik-local-staff-users-v1` qiymatini nusxalang.
  2. `staff_export.json` fayliga saqlang (massiv ko'rinishida).
  3. Serverda: python deploy/provision_staff_accounts.py staff_export.json

Yoki remote_deploy orqali SSH bilan ishga tushiring.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from remote_deploy import merge_env, run, sh_single_quote, ssh_connect_with_retry


def main() -> int:
    if len(sys.argv) < 2:
        print('Usage: provision_staff_accounts.py <staff_export.json>', file=sys.stderr)
        return 1

    export_path = Path(sys.argv[1]).resolve()
    if not export_path.is_file():
        print(f'File not found: {export_path}', file=sys.stderr)
        return 1

    rows = json.loads(export_path.read_text(encoding='utf-8'))
    if not isinstance(rows, list):
        print('Export must be a JSON array of staff users.', file=sys.stderr)
        return 1

    remote_json = '/tmp/imentor_staff_provision.json'
    script = r'''
import json
from django.contrib.auth.models import Group, User

ALLOWED = ("admin", "hodim", "startuper")
rows = json.loads(open("/tmp/imentor_staff_provision.json", encoding="utf-8").read())

def digits_only(phone: str) -> str:
    d = "".join(ch for ch in str(phone) if ch.isdigit())
    if len(d) == 9:
        d = "998" + d
    if len(d) == 10 and d.startswith("0"):
        d = "998" + d[1:]
    return d

created = updated = skipped = 0
for row in rows:
    phone = digits_only(row.get("phoneDigits") or row.get("phoneDisplay") or "")
    password = (row.get("password") or "").strip()
    role = (row.get("role") or "hodim").strip().lower()
    if len(phone) != 12 or not phone.startswith("998"):
        skipped += 1
        continue
    if len(password) < 6:
        skipped += 1
        continue
    if role not in ALLOWED:
        role = "hodim"
    fn = (row.get("firstName") or "").strip()
    ln = (row.get("lastName") or "").strip()
    user, was_created = User.objects.get_or_create(
        username=phone,
        defaults={"first_name": fn, "last_name": ln},
    )
    user.set_password(password)
    if not was_created:
        user.first_name = fn or user.first_name
        user.last_name = ln or user.last_name
    user.save(update_fields=["password", "first_name", "last_name"])
    for name in ALLOWED:
        g = Group.objects.filter(name=name).first()
        if g is not None:
            user.groups.remove(g)
    group, _ = Group.objects.get_or_create(name=role)
    user.groups.add(group)
    if was_created:
        created += 1
    else:
        updated += 1

print(f"PROVISION_OK created={created} updated={updated} skipped={skipped}")
'''

    env = merge_env()
    ssh = ssh_connect_with_retry(env)
    sftp = ssh.open_sftp()
    try:
        sftp.put(str(export_path), remote_json)
    finally:
        sftp.close()

    cmd = (
        f"cd {sh_single_quote(env['REMOTE_APP_DIR'])} && "
        f"source {sh_single_quote(env['REMOTE_VENV'])} && "
        f"python manage.py shell -c {sh_single_quote(script)}"
    )
    out, err, code = run(ssh, cmd)
    print(out or err)
    return 0 if code == 0 and 'PROVISION_OK' in (out or '') else 1


if __name__ == '__main__':
    raise SystemExit(main())
