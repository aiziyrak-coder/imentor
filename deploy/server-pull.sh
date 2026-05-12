#!/usr/bin/env sh
# Serverda (imentor.uz) loyiha ildizidan: bash deploy/server-pull.sh
# Talab: git, docker, docker compose plugin, deploy/.env.production
#
# Kalitni ham yangilab, pull + rebuild — BITTA QATOR (yo‘lni moslang):
#   cd /opt/imentor && GAK='SIZNING_GEMINI_API_KEY' sh deploy/imentor-one-liner.sh

set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

git config --global --add safe.directory "$ROOT" 2>/dev/null || true
git fetch origin
git checkout main 2>/dev/null || git checkout -b main
git pull --ff-only origin main

docker compose -f docker-compose.prod.yml -f docker-compose.imentor.yml --env-file deploy/.env.production up -d --build
docker compose -f docker-compose.prod.yml -f docker-compose.imentor.yml --env-file deploy/.env.production ps
