#!/bin/bash
# iMentor server muammolari bo'yicha Telegram ogohlantirish (2026-11-17, audit G18).
#
# Har 5 daqiqada cron'dan:  */5 * * * * /home/imentor/deploy/ops/ops-health-alert.sh >> /home/imentor/backups/ops-alert.log 2>&1
#
# Tekshiradi: iMentor konteynerlari ishlayaptimi/sog'mi, sayt /api/health/ javob beradimi (2 marta ketma-ket
# xato bo'lsa), disk band joyi, kunlik zaxira (oxirgi 26 soatda backup_ok, .broken yo'q), tiklash sinovi natijasi.
# Har muammo bo'yicha bitta xabar (6 soatda bir eslatma) va hal bo'lganda "tiklandi" xabari.
#
# Kimga: .env dagi OPS_ALERT_CHAT_ID (admin chat), bo'lmasa dars nazorati boti guruhi (core_lessonbotsetting).
# Token .env dan o'qiladi va hech qayerga yozilmaydi.
set -uo pipefail
ROOT=${IMENTOR_ROOT:-/home/imentor}
STATE=${OPS_ALERT_STATE:-$ROOT/backups/ops-alert-state}
DISK_LIMIT=${OPS_DISK_LIMIT:-90}
REMIND_SECS=$((6 * 3600))
DRY=${DRY_RUN:-0}
mkdir -p "$STATE"
NOW=$(date +%s)

env_val() { grep -E "^$1=" "$ROOT/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"'"'"'\r'; }

problems=()   # "kalit|matn"
add() { problems+=("$1|$2"); }

# 1) Konteynerlar
for c in imentor-backend_fastapi-1 imentor-frontend-1 imentor-postgres-1 imentor-redis-1 imentor-nginx-1; do
  st=$(docker inspect "$c" --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' 2>/dev/null || echo "yo'q")
  case "$st" in
    "running healthy"|"running "|running) ;;
    "running starting") ;;  # deploy paytida normal
    *) add "container_$c" "Konteyner $c holati: $st" ;;
  esac
done

# 2) Sayt javobi (2 marta ketma-ket)
PORT=$(env_val IMENTOR_HTTP_PORT); PORT=${PORT:-9050}
code=$(curl -s -o /dev/null -m 10 -w '%{http_code}' "http://127.0.0.1:$PORT/api/health/" || echo 000)
if [ "$code" != 200 ]; then
  if [ -f "$STATE/http_fail_once" ]; then add "http" "Sayt javob bermayapti: /api/health/ → $code"; fi
  touch "$STATE/http_fail_once"
else
  rm -f "$STATE/http_fail_once"
fi

# 3) Disk
used=$(df -P / | awk 'NR==2 {gsub("%","",$5); print $5}')
[ "${used:-0}" -ge "$DISK_LIMIT" ] && add "disk" "Disk ${used}% band (chegara ${DISK_LIMIT}%)"

# 4) Zaxira
B="$ROOT/backups"
last_ok=$(find "$B" -maxdepth 1 -name 'imentor_*.sql.gz' -mmin -$((26 * 60)) | head -1)
[ -z "$last_ok" ] && add "backup" "Oxirgi 26 soatda muvaffaqiyatli baza zaxirasi yo'q"
broken=$(find "$B" -maxdepth 1 -name '*.broken' -mmin -$((26 * 60)) | head -1)
[ -n "$broken" ] && add "backup_broken" "Zaxira buzildi: $(basename "$broken")"

# 5) Tiklash sinovi
if [ -f "$B/restore-test.log" ] && tail -1 "$B/restore-test.log" | grep -q '^restore_FAILED'; then
  add "restore" "Zaxirani tiklash sinovi muvaffaqiyatsiz: $(tail -1 "$B/restore-test.log" | cut -c1-200)"
fi

# ---- yuborish
send() {
  local text="$1"
  if [ "$DRY" = 1 ]; then echo "DRY: $text"; return 0; fi
  local token chat
  token=$(env_val LESSON_BOT_TOKEN)
  chat=$(env_val OPS_ALERT_CHAT_ID)
  if [ -z "$chat" ]; then
    chat=$(docker exec imentor-postgres-1 psql -U "$(env_val POSTGRES_USER)" -d "$(env_val POSTGRES_DB)" -Atc \
      "select value from core_lessonbotsetting where key='chat_id'" 2>/dev/null)
  fi
  [ -z "$token" ] || [ -z "$chat" ] && { echo "$(date '+%F %T') yuborib bo'lmadi (token/chat yo'q): $text"; return 1; }
  curl -s -m 15 -o /dev/null -w '' "https://api.telegram.org/bot${token}/sendMessage" \
    --data-urlencode "chat_id=$chat" --data-urlencode "text=$text" >/dev/null 2>&1 \
    || { echo "$(date '+%F %T') Telegram xatosi"; return 1; }
}

active=" "
for p in "${problems[@]+"${problems[@]}"}"; do
  key=${p%%|*}; msg=${p#*|}; active="$active$key "
  f="$STATE/$key"
  if [ ! -f "$f" ] || [ $((NOW - $(stat -c %Y "$f"))) -ge $REMIND_SECS ]; then
    send "⚠️ iMentor server: $msg" && touch "$f" && echo "$(date '+%F %T') alert $key"
  fi
done
# Hal bo'lganlar
for f in "$STATE"/*; do
  [ -f "$f" ] || continue
  key=$(basename "$f")
  [ "$key" = http_fail_once ] && continue
  case "$active" in *" $key "*) continue ;; esac
  send "✅ iMentor server: tiklandi ($key)" && rm -f "$f" && echo "$(date '+%F %T') resolved $key"
done
exit 0
