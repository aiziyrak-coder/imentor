#!/usr/bin/env sh
# Run on the server (as root or with docker group) from the app directory.
# Does not install packages; requires git, docker, and docker compose plugin.

set -e
cd "$(dirname "$0")/.."
git pull --ff-only
docker compose -f docker-compose.prod.yml -f docker-compose.imentor.yml --env-file deploy/.env.production up -d --build
