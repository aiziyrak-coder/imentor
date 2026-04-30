#!/usr/bin/env python3
"""
Deploy imentor stack over SSH (password or private key).

Setup (this machine):
  pip install -r deploy/requirements-deploy.txt

Credentials — choose ONE:
  A) Environment variables (PowerShell):
     $env:SSH_HOST="209.38.239.183"
     $env:SSH_USER="root"
     $env:SSH_PASSWORD="your-password"
  B) Key file:
     $env:SSH_KEY_PATH="$env:USERPROFILE\\.ssh\\id_rsa"
  C) File deploy/.env.deploy.local (gitignored by .env*), lines KEY=value:
     SSH_HOST=...
     SSH_USER=root
     SSH_PASSWORD=...
     REMOTE_REPO_PATH=/opt/imentor
     GIT_REPO_URL=https://github.com/aiziyrak-coder/imentor.git

Run from repo root:
  python deploy/remote_deploy.py

Do not commit passwords. Rotate any password ever pasted into chat.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

def _import_paramiko():
    try:
        import paramiko

        return paramiko
    except ImportError:
        print("Install paramiko: pip install -r deploy/requirements-deploy.txt", file=sys.stderr)
        sys.exit(1)


def load_env_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.is_file():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def merge_env() -> dict[str, str]:
    path = Path(__file__).resolve().parent / ".env.deploy.local"
    out = load_env_file(path)
    for k, v in os.environ.items():
        if v is not None and str(v) != "":
            out[k] = v
    return out


def ssh_connect(cfg: dict[str, str]):
    paramiko = _import_paramiko()
    host = cfg.get("SSH_HOST") or cfg.get("IMENTOR_SSH_HOST")
    user = cfg.get("SSH_USER") or cfg.get("IMENTOR_SSH_USER") or "root"
    password = cfg.get("SSH_PASSWORD") or cfg.get("IMENTOR_SSH_PASSWORD")
    key_path = cfg.get("SSH_KEY_PATH") or cfg.get("IMENTOR_SSH_KEY_PATH")
    port = int(cfg.get("SSH_PORT") or "22")

    if not host:
        raise SystemExit("Set SSH_HOST (or IMENTOR_SSH_HOST)")

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    def try_load_key(path: Path):
        for KeyClass in (
            paramiko.RSAKey,
            paramiko.Ed25519Key,
            paramiko.ECDSAKey,
        ):
            try:
                return KeyClass.from_private_key_file(path)
            except Exception:
                continue
        return None

    pkey = None
    candidates: list[Path] = []
    if key_path:
        candidates.append(Path(key_path).expanduser())
    home = Path.home() / ".ssh"
    for name in ("id_ed25519", "id_rsa"):
        candidates.append(home / name)

    seen: set[str] = set()
    for cand in candidates:
        rp = str(cand.resolve())
        if rp in seen or not cand.is_file():
            continue
        seen.add(rp)
        pkey = try_load_key(cand)
        if pkey:
            break

    if pkey:
        client.connect(hostname=host, port=port, username=user, pkey=pkey, timeout=30)
    else:
        if not password:
            raise SystemExit(
                "Need SSH_PASSWORD or a working SSH_KEY_PATH (private key must be authorized on server)."
            )
        client.connect(hostname=host, port=port, username=user, password=password, timeout=30)
    return client


def run(
    client,
    cmd: str,
    timeout: int = 900,
) -> tuple[int, str, str]:
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    return code, out, err


def main() -> None:
    parser = argparse.ArgumentParser(description="SSH deploy imentor")
    parser.add_argument("--dry-run", action="store_true", help="Only print remote commands")
    args = parser.parse_args()

    cfg = merge_env()
    repo_root = Path(__file__).resolve().parents[1]
    nginx_local = repo_root / "deploy" / "nginx" / "imentor.conf.example"

    remote_path = cfg.get("REMOTE_REPO_PATH") or "/opt/imentor"
    git_url = cfg.get("GIT_REPO_URL") or "https://github.com/aiziyrak-coder/imentor.git"

    remote_script = f"""set -e
REMOTE_PATH="{remote_path}"
GIT_URL="{git_url}"
if [ ! -d "$REMOTE_PATH/.git" ]; then
  mkdir -p "$(dirname "$REMOTE_PATH")"
  git clone "$GIT_URL" "$REMOTE_PATH"
fi
cd "$REMOTE_PATH"
git fetch origin
git checkout main 2>/dev/null || git checkout -b main
git pull origin main
if [ ! -f deploy/.env.production ]; then
  echo "ERROR: create deploy/.env.production on server (copy from deploy/.env.production.example)" >&2
  exit 1
fi
docker compose -f docker-compose.prod.yml -f docker-compose.imentor.yml --env-file deploy/.env.production up -d --build
docker compose -f docker-compose.prod.yml -f docker-compose.imentor.yml --env-file deploy/.env.production ps
"""

    nginx_install = r"""set -e
test -f /tmp/imentor.nginx.conf
cp /tmp/imentor.nginx.conf /etc/nginx/sites-available/imentor
ln -sf /etc/nginx/sites-available/imentor /etc/nginx/sites-enabled/imentor
nginx -t
systemctl reload nginx
echo "nginx reloaded for imentor"
"""

    if args.dry_run:
        print("--- remote deploy script ---")
        print(remote_script)
        print("--- nginx ---")
        print(nginx_install)
        return

    if not nginx_local.is_file():
        raise SystemExit(f"Missing {nginx_local}")

    client = ssh_connect(cfg)
    try:
        # Upload nginx config
        sftp = client.open_sftp()
        try:
            sftp.put(str(nginx_local), "/tmp/imentor.nginx.conf")
        finally:
            sftp.close()

        code, out, err = run(client, remote_script, timeout=1200)
        print(out)
        if err:
            print(err, file=sys.stderr)
        if code != 0:
            raise SystemExit(f"Deploy script failed with exit {code}")

        code, out, err = run(client, nginx_install, timeout=120)
        print(out)
        if err:
            print(err, file=sys.stderr)
        if code != 0:
            print(
                "Warning: nginx reload failed (maybe path differs). Fix SSH user=root or adjust sudo.",
                file=sys.stderr,
            )
    finally:
        client.close()

    print("Done. Open https://imentor.uz after DNS + SSL (certbot) if needed.")


if __name__ == "__main__":
    main()
