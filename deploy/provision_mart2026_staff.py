#!/usr/bin/env python3
"""Provision Mart 2026 asosiy o'rindosh staff on production server."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from remote_deploy import merge_env, run, sh_single_quote, ssh_connect_with_retry

ROSTER_FILE = Path(__file__).resolve().parent / "data" / "staff_mart2026_asosiy.json"
REMOTE_JSON = "/tmp/imentor_staff_mart2026.json"
DEFAULT_PASSWORD = "imentor123"


def main() -> int:
    if not ROSTER_FILE.is_file():
        print(f"Missing roster: {ROSTER_FILE}", file=sys.stderr)
        return 1

    cfg = merge_env()
    remote_path = (cfg.get("REMOTE_REPO_PATH") or "/opt/imentor").strip()
    client = ssh_connect_with_retry(cfg, verbose=True)
    try:
        sftp = client.open_sftp()
        try:
            sftp.put(str(ROSTER_FILE), REMOTE_JSON)
        finally:
            sftp.close()

        script = f"""set -eu
cd {sh_single_quote(remote_path)}
CID=$(docker compose -f docker-compose.prod.yml -f docker-compose.imentor.yml --env-file deploy/.env.production ps -q backend)
test -n "$CID"
docker cp {sh_single_quote(REMOTE_JSON)} "$CID":/tmp/staff_mart2026_asosiy.json
docker compose -f docker-compose.prod.yml -f docker-compose.imentor.yml --env-file deploy/.env.production exec -T backend \\
  python manage.py provision_teachers_roster --file /tmp/staff_mart2026_asosiy.json --password {sh_single_quote(DEFAULT_PASSWORD)}
rm -f {sh_single_quote(REMOTE_JSON)}
curl -sfS http://127.0.0.1:31002/api/health/ && echo " backend_ok"
"""
        code, out, err = run(client, script, timeout=900)
        print(out)
        if err:
            print(err, file=sys.stderr)
        if code != 0 or "PROVISION_OK" not in out:
            return 1
        print("Tayyor: Mart 2026 asosiy xodimlar ro'yxatdan o'tkazildi.")
        return 0
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(main())
