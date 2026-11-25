#!/usr/bin/env sh
set -e

MEDIA_DIR="${DJANGO_MEDIA_ROOT:-/app/media}"
mkdir -p "$MEDIA_DIR"

# docker compose run backend_fastapi alembic ... — bir martalik buyruqlar
if [ "$#" -gt 0 ]; then
  exec "$@"
fi

if [ "${RUN_MIGRATIONS:-1}" = "1" ]; then
  alembic upgrade head
fi

# unoserver — doimiy LibreOffice demoni (PPTX/PPT/ODP → PDF).
# Fon rejimida ishga tushiriladi; ishga tushmasa ilova eski `soffice --convert-to`
# usuliga avtomatik qaytadi, shuning uchun bu yerda xatolik butun konteynerni
# yiqitmasligi kerak.
if [ "${UNOSERVER_ENABLED:-1}" = "1" ]; then
  UNOSERVER_PORT="${UNOSERVER_PORT:-2003}"
  export HOME="${HOME:-/tmp}"
  mkdir -p /tmp/unoserver-home
  HOME=/tmp/unoserver-home \
    /usr/bin/python3 -m unoserver.server \
      --port "$UNOSERVER_PORT" \
      --interface 127.0.0.1 \
      >/tmp/unoserver.log 2>&1 &
  echo "unoserver ishga tushirildi (port $UNOSERVER_PORT, log: /tmp/unoserver.log)"
fi

WORKERS="${GUNICORN_WORKERS:-3}"
TIMEOUT="${GUNICORN_TIMEOUT:-300}"
# Ishchi jarayon shuncha so'rovdan keyin qayta tug'iladi (xotira oqishiga qarshi).
# 1000 juda kam edi: gavjum soatda to'rtala ishchi soatiga 40 marta qayta
# tug'ilib, o'sha lahzada kelgan so'rov 502 olardi — bir kunda 3170 ta
# (2026-10-09). Xotira 94 GB dan 2.4 GB ishlatiladi, ya'ni tez-tez
# yangilashning hojati yo'q. Jitter katta: hammasi BIR VAQTDA qayta
# tug'ilmasin.
# 2026-11-25: 20000 (+5000) ham kam chiqdi. Monitor rejimidagi jonli testlar bilan gavjum soatda bir ishchi
# ~15 so'rov/soniya oladi — har ishchi 22–28 daqiqada qayta tug'ilardi; yopilishi 1–3,5 daqiqa (uzoq AI
# so'rovlari tugashini kutadi), shu vaqtda o'rniga yangisi turmaydi. Konteyner qayta ishga tushgach hamma
# ishchi bir xil sanaydi: 10:54–10:58 da oltitadan uchtasi birga yopildi — "server bilan aloqa yo'q".
# Endi 100000 (+60000): gavjum soatda 2–3 soatda bir, tarqoq.
MAX_REQ="${GUNICORN_MAX_REQUESTS:-100000}"
MAX_REQ_JITTER="${GUNICORN_MAX_REQUESTS_JITTER:-60000}"

exec gunicorn app.main:app \
  --bind 0.0.0.0:8000 \
  --worker-class uvicorn.workers.UvicornWorker \
  --workers "$WORKERS" \
  --timeout "$TIMEOUT" \
  --max-requests "$MAX_REQ" \
  --max-requests-jitter "$MAX_REQ_JITTER" \
  --graceful-timeout 30
