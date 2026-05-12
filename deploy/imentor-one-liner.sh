#!/usr/bin/env sh
# Serverda (Linux): kalitni yangilab, git pull va Docker qayta build.
#
# Agar "cannot open deploy/imentor-one-liner.sh" chiqsa — skript hali serverda yo‘q:
#   cd /opt/imentor && git fetch origin && git checkout main && git pull --ff-only origin main
# keyin yana shu faylni ishga tushiring.
#
# Bitta qator (loyiha yo‘lini moslang, masalan /opt/imentor):
#   cd /opt/imentor && GAK='SIZNING_GEMINI_API_KEY' sh deploy/imentor-one-liner.sh
#
# Eslatma: GAK shell tarixida qolishi mumkin — ish tugagach "history -c" yoki yangi kalit.

set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -z "${GAK:-}" ]; then
  echo "Xato: GAK o‘rnatilmagan. Misol: cd /opt/imentor && GAK='AIza...' sh deploy/imentor-one-liner.sh" >&2
  exit 1
fi

ENV_FILE="deploy/.env.production"
if [ ! -f "$ENV_FILE" ]; then
  echo "Xato: $ENV_FILE topilmadi. Avval deploy/.env.production.example dan nusxa oling." >&2
  exit 1
fi

if grep -q '^GEMINI_API_KEY=' "$ENV_FILE" 2>/dev/null; then
  sed -i.bak "s|^GEMINI_API_KEY=.*|GEMINI_API_KEY=${GAK}|" "$ENV_FILE"
else
  printf '\nGEMINI_API_KEY=%s\n' "$GAK" >> "$ENV_FILE"
fi

git config --global --add safe.directory "$ROOT" 2>/dev/null || true
git fetch origin
git checkout main 2>/dev/null || git checkout -b main
git pull --ff-only origin main

docker compose -f docker-compose.prod.yml -f docker-compose.imentor.yml --env-file "$ENV_FILE" up -d --build
docker compose -f docker-compose.prod.yml -f docker-compose.imentor.yml --env-file "$ENV_FILE" ps

echo "Tayyor. GEMINI_API_KEY yangilandi va stack qayta yig‘ildi."
