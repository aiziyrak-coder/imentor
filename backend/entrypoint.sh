#!/usr/bin/env sh
set -e

MEDIA_DIR="${DJANGO_MEDIA_ROOT:-/app/media}"
mkdir -p "$MEDIA_DIR"

python manage.py migrate --noinput
python manage.py compilemessages || true
python manage.py collectstatic --noinput
python manage.py ensure_phone_superuser || true

exec gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers 3 --timeout 300
