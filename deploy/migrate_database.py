#!/usr/bin/env python3
"""
Eski serverdan (209.38.239.183) SQLite DB va media fayllarni
yangi serverga (164.90.186.193) ko'chirish.
"""
from __future__ import annotations

import io
import os
import sys
import tarfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from remote_deploy import merge_env, ssh_connect_with_retry, run, sh_single_quote

OLD_HOST = os.environ.get("OLD_SSH_HOST", "209.38.239.183")
NEW_HOST = "164.90.186.193"
REMOTE_PATH = "/opt/imentor"


def connect(host: str, password: str, user: str = "root"):
    import paramiko

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(hostname=host, port=22, username=user, password=password, timeout=30)
    return client


def probe(client, label: str) -> str:
  script = r"""set -eu
echo "=== HOST ==="
hostname
echo "=== DOCKER ==="
docker ps -a 2>/dev/null | grep -i imentor || docker ps -a 2>/dev/null | head -10 || echo NO_DOCKER
echo "=== VOLUMES ==="
docker volume ls 2>/dev/null | grep -i imentor || docker volume ls 2>/dev/null | head -10 || echo NO_VOLUMES
echo "=== REPO ==="
ls -la /opt/imentor/deploy/.env.production 2>/dev/null || ls -la /opt/salomatlik-ai 2>/dev/null || ls -la /root/imentor 2>/dev/null || echo NO_REPO
echo "=== DB SIZE ==="
for v in $(docker volume ls -q 2>/dev/null | grep -i sqlite); do
  echo "volume: $v"
  docker run --rm -v "$v":/data alpine ls -la /data/ 2>/dev/null || true
done
for v in $(docker volume ls -q 2>/dev/null | grep -i imentor); do
  echo "volume: $v"
  docker run --rm -v "$v":/v alpine sh -c 'ls -la /v/ 2>/dev/null; du -sh /v/ 2>/dev/null' || true
done
echo "=== DIRECT DB ==="
find /opt -name 'db.sqlite3' 2>/dev/null | head -5
find /var/lib/docker/volumes -name 'db.sqlite3' 2>/dev/null | head -5
"""
  code, out, err = run(client, script, timeout=120)
  result = (out or "") + ("\n" + err if err else "")
  print(f"\n{'='*60}\n{label} ({client.get_transport().getpeername()[0]})\n{'='*60}")
  print(result.encode("ascii", errors="replace").decode("ascii"))
  return result


def export_data(client) -> bytes:
    """Create tarball of sqlite db + media from old server docker volumes."""
    script = r"""set -eu
WORKDIR=/tmp/imentor-migrate-$$
mkdir -p "$WORKDIR"
cd "$WORKDIR"

# Find imentor project path
PROJ=""
for p in /opt/imentor /opt/salomatlik-ai /root/imentor /root/salomatlik-ai; do
  if [ -f "$p/docker-compose.imentor.yml" ] || [ -f "$p/docker-compose.prod.yml" ]; then
    PROJ="$p"
    break
  fi
done

SQLITE_VOL=""
MEDIA_VOL=""
if [ -n "$PROJ" ]; then
  cd "$PROJ"
  ENV_FILE="deploy/.env.production"
  [ -f "$ENV_FILE" ] || ENV_FILE=""
  if [ -n "$ENV_FILE" ]; then
    SQLITE_VOL=$(docker compose -f docker-compose.prod.yml -f docker-compose.imentor.yml --env-file "$ENV_FILE" ps -q backend 2>/dev/null | head -1)
  fi
fi

# Discover volumes by name
for v in $(docker volume ls -q 2>/dev/null); do
  case "$v" in
    *imentor*sqlite*|*sqlite*imentor*)
      SQLITE_VOL_NAME="$v"
      ;;
    *imentor*media*|*media*imentor*)
      MEDIA_VOL_NAME="$v"
      ;;
  esac
done

echo "SQLITE_VOL_NAME=${SQLITE_VOL_NAME:-}"
echo "MEDIA_VOL_NAME=${MEDIA_VOL_NAME:-}"
echo "PROJ=${PROJ:-}"

mkdir -p "$WORKDIR/data" "$WORKDIR/media"

if [ -n "${SQLITE_VOL_NAME:-}" ]; then
  docker run --rm -v "$SQLITE_VOL_NAME":/src -v "$WORKDIR/data":/dst alpine cp -a /src/. /dst/ 2>/dev/null || \
  docker run --rm -v "$SQLITE_VOL_NAME":/src alpine cat /src/db.sqlite3 > "$WORKDIR/data/db.sqlite3" 2>/dev/null || true
fi

if [ -n "${MEDIA_VOL_NAME:-}" ]; then
  docker run --rm -v "$MEDIA_VOL_NAME":/src -v "$WORKDIR/media":/dst alpine cp -a /src/. /dst/ 2>/dev/null || true
fi

# Fallback: copy from running backend container
BACKEND=$(docker ps --format '{{.Names}}' 2>/dev/null | grep -i backend | head -1 || true)
if [ -n "$BACKEND" ]; then
  if [ ! -f "$WORKDIR/data/db.sqlite3" ]; then
    docker cp "$BACKEND:/data/db.sqlite3" "$WORKDIR/data/db.sqlite3" 2>/dev/null || \
    docker cp "$BACKEND:/app/db.sqlite3" "$WORKDIR/data/db.sqlite3" 2>/dev/null || true
  fi
  if [ -z "$(ls -A "$WORKDIR/media" 2>/dev/null)" ]; then
    docker cp "$BACKEND:/app/media/." "$WORKDIR/media/" 2>/dev/null || true
  fi
fi

# More fallbacks
if [ ! -f "$WORKDIR/data/db.sqlite3" ]; then
  FOUND=$(find /var/lib/docker/volumes -name 'db.sqlite3' 2>/dev/null | head -1)
  if [ -n "$FOUND" ]; then cp "$FOUND" "$WORKDIR/data/db.sqlite3"; fi
fi

ls -la "$WORKDIR/data/" 2>/dev/null || true
ls -la "$WORKDIR/media/" 2>/dev/null | head -20 || true
du -sh "$WORKDIR/data" "$WORKDIR/media" 2>/dev/null || true

if [ ! -f "$WORKDIR/data/db.sqlite3" ]; then
  echo "ERROR: db.sqlite3 topilmadi" >&2
  exit 1
fi

tar czf /tmp/imentor-data-migrate.tar.gz -C "$WORKDIR" data media
ls -la /tmp/imentor-data-migrate.tar.gz
echo "EXPORT_OK"
"""
    code, out, err = run(client, script, timeout=300)
    print(out.encode("ascii", errors="replace").decode("ascii"))
    if err:
        print(err.encode("ascii", errors="replace").decode("ascii"), file=sys.stderr)
    if code != 0 or "EXPORT_OK" not in out:
        raise SystemExit(f"Export failed (exit {code})")

    # Download tarball via SFTP
    sftp = client.open_sftp()
    try:
        buf = io.BytesIO()
        sftp.getfo("/tmp/imentor-data-migrate.tar.gz", buf)
        buf.seek(0)
        data = buf.read()
    finally:
        sftp.close()
        run(client, "rm -f /tmp/imentor-data-migrate.tar.gz", timeout=30)

    print(f"Downloaded tarball: {len(data)} bytes")
    return data


def import_data(client, tarball: bytes) -> None:
    # Upload tarball
    sftp = client.open_sftp()
    try:
        buf = io.BytesIO(tarball)
        sftp.putfo(buf, "/tmp/imentor-data-migrate.tar.gz")
    finally:
        sftp.close()

    script = f"""set -eu
cd {sh_single_quote(REMOTE_PATH)}

echo "== Stop backend (keep frontend) =="
docker compose -f docker-compose.prod.yml -f docker-compose.imentor.yml --env-file deploy/.env.production stop backend 2>/dev/null || true

echo "== Extract backup =="
WORKDIR=/tmp/imentor-restore-$$
rm -rf "$WORKDIR"
mkdir -p "$WORKDIR"
tar xzf /tmp/imentor-data-migrate.tar.gz -C "$WORKDIR"
ls -la "$WORKDIR/data/"
du -sh "$WORKDIR/data/db.sqlite3" "$WORKDIR/media" 2>/dev/null || true

echo "== Find volume names =="
SQLITE_VOL=$(docker volume ls -q | grep imentor_sqlite | head -1)
MEDIA_VOL=$(docker volume ls -q | grep imentor_media | head -1)
echo "SQLITE_VOL=$SQLITE_VOL"
echo "MEDIA_VOL=$MEDIA_VOL"

if [ -z "$SQLITE_VOL" ] || [ -z "$MEDIA_VOL" ]; then
  echo "Volumes not found, creating stack first..."
  docker compose -f docker-compose.prod.yml -f docker-compose.imentor.yml --env-file deploy/.env.production up -d --build
  sleep 10
  SQLITE_VOL=$(docker volume ls -q | grep imentor_sqlite | head -1)
  MEDIA_VOL=$(docker volume ls -q | grep imentor_media | head -1)
fi

echo "== Restore SQLite =="
docker run --rm -v "$SQLITE_VOL":/dst -v "$WORKDIR/data":/src alpine sh -c 'rm -rf /dst/* && cp -a /src/. /dst/'

echo "== Restore media =="
docker run --rm -v "$MEDIA_VOL":/dst -v "$WORKDIR/media":/src alpine sh -c 'rm -rf /dst/* && cp -a /src/. /dst/ 2>/dev/null || true'

echo "== Restart stack =="
docker compose -f docker-compose.prod.yml -f docker-compose.imentor.yml --env-file deploy/.env.production up -d --build
sleep 15

echo "== Verify =="
docker compose -f docker-compose.prod.yml -f docker-compose.imentor.yml --env-file deploy/.env.production ps
curl -sfS --max-time 15 http://127.0.0.1:31002/api/health/ && echo " health_ok"

# Count users if possible
docker compose -f docker-compose.prod.yml -f docker-compose.imentor.yml --env-file deploy/.env.production exec -T backend python manage.py shell -c "
from django.contrib.auth import get_user_model
U = get_user_model()
print('users:', U.objects.count())
" 2>/dev/null || echo "user count skipped"

rm -rf "$WORKDIR" /tmp/imentor-data-migrate.tar.gz
echo "IMPORT_OK"
"""
    code, out, err = run(client, script, timeout=600)
    print(out.encode("ascii", errors="replace").decode("ascii"))
    if err:
        print(err.encode("ascii", errors="replace").decode("ascii"), file=sys.stderr)
    if code != 0 or "IMPORT_OK" not in out:
        raise SystemExit(f"Import failed (exit {code})")


def main():
    cfg = merge_env()
    password = cfg.get("OLD_SSH_PASSWORD") or cfg.get("SSH_PASSWORD") or cfg.get("IMENTOR_SSH_PASSWORD")
    if not password:
        raise SystemExit("OLD_SSH_PASSWORD yoki SSH_PASSWORD kerak (deploy/.env.deploy.local)")

    print("1) Eski serverni tekshirish...")
    old = None
    try:
        old = connect(OLD_HOST, password)
        probe(old, "OLD SERVER")
    except Exception as e:
        print(f"Eski serverga ulanish xatosi ({OLD_HOST}): {e}")
        print("Boshqa parol yoki server o'chirilgan bo'lishi mumkin.")
        if old:
            old.close()
        sys.exit(1)

    print("\n2) Ma'lumotlarni eksport qilish...")
    tarball = export_data(old)
    old.close()

  # Verify tarball
    with tarfile.open(fileobj=io.BytesIO(tarball), mode="r:gz") as tf:
        names = tf.getnames()
        print(f"Tarball ichida: {names[:20]}...")
        for m in tf.getmembers():
            if m.name.endswith("db.sqlite3"):
                print(f"  db.sqlite3 size: {m.size} bytes")

    print("\n3) Yangi serverga import qilish...")
    new = connect(NEW_HOST, password)
    probe(new, "NEW SERVER (before import)")
    import_data(new, tarball)
    new.close()

    print("\nTayyor: ma'lumotlar bazasi va media ko'chirildi.")


if __name__ == "__main__":
    main()
