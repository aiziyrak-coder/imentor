#!/bin/bash
# iMentor zaxirasini tiklash sinovi (2026-11-17, audit D4).
#
# Oxirgi kunlik zaxira ALOHIDA vaqtinchalik konteynerga (imentor-restore-test) tiklanadi, asosiy
# jadvallardagi qatorlar soni production bilan solishtiriladi, keyin konteyner va uning diski o'chiriladi.
# Production bazasiga faqat o'qish so'rovlari (count) yuboriladi.
#
# Ishga tushirish (oyiga bir marta cron yoki qo'lda):
#   nice -n 19 ionice -c3 /home/imentor/backend_fastapi/scripts/imentor_restore_test.sh
# Natija: $DIR/restore-test.log ga bitta qator "restore_ok ..." yoki "restore_FAILED ...", chiqish kodi 0/1.
set -euo pipefail
DIR=${IMENTOR_BACKUP_DIR:-/home/imentor/backups}
NAME=imentor-restore-test
IMAGE=$(docker inspect imentor-postgres-1 --format '{{.Config.Image}}')
DUMP=${1:-$(ls -t "$DIR"/imentor_*.sql.gz | head -1)}
STAMP=$(date +%Y%m%d_%H%M)
# Bitta zaxira ham olinmagan bo'lsa yoki fayl buzilgan bo'lsa — darhol xato.
[ -s "$DUMP" ] || { echo "restore_FAILED $STAMP zaxira topilmadi"; exit 1; }

cleanup() { docker rm -f -v "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

# Tarmoqsiz, port ochilmagan, faqat shu sinov uchun. Parol kerak emas (tarmoq yo'q).
docker run -d --name "$NAME" --network none \
  -e POSTGRES_USER=imentorfer -e POSTGRES_DB=imentorfer -e POSTGRES_HOST_AUTH_METHOD=trust \
  "$IMAGE" >/dev/null
for _ in $(seq 1 60); do
  docker exec "$NAME" pg_isready -U imentorfer -d imentorfer >/dev/null 2>&1 && break
  sleep 2
done
sleep 3

START=$(date +%s)
# ON_ERROR_STOP: birinchi SQL xatoda to'xtaydi — tiklanmaydigan zaxira darhol ko'rinadi.
gunzip -c "$DUMP" | docker exec -i "$NAME" psql -q -v ON_ERROR_STOP=1 -U imentorfer -d imentorfer >/dev/null
SECS=$(( $(date +%s) - START ))

TABLES="auth_user core_staffprofile core_hemislesson core_livetestsession core_livetestsubmission core_studentresult core_preparedcontent core_bookchunk core_monitorroom alembic_version"
q() { docker exec "$1" psql -U imentorfer -d imentorfer -Atc "$2" 2>/dev/null || echo "ERR"; }
FAIL=0
REPORT=""
for t in $TABLES; do
  if [ "$t" = alembic_version ]; then
    # Zaxiradan keyin migratsiya bo'lgan bo'lishi mumkin — farq xato emas, faqat qayd.
    r=$(q "$NAME" "select version_num from alembic_version"); p=$(q imentor-postgres-1 "select version_num from alembic_version")
    [ "$r" = ERR ] && { FAIL=1; REPORT="$REPORT alembic:ERR!"; } || REPORT="$REPORT alembic:$r(prod $p)"
    continue
  fi
  r=$(q "$NAME" "select count(*) from $t")
  p=$(q imentor-postgres-1 "select count(*) from $t")
  if [ "$p" = ERR ]; then
    FAIL=1; REPORT="$REPORT $t:prod-ERR!"
  elif [ "$r" = ERR ]; then
    # Jadval zaxiradan KEYIN yaratilgan (yangi migratsiya) — xato emas.
    REPORT="$REPORT $t:zaxiradan-keyin-yaratilgan"
  elif [ "$r" -gt "$p" ] || [ $(( r * 100 )) -lt $(( p * 90 )) ]; then
    # Zaxira 03:00 da olingan: tiklangan soni prod'dan oshmasligi va 90% dan kam bo'lmasligi kerak.
    FAIL=1; REPORT="$REPORT $t:$r/$p!"
  else
    REPORT="$REPORT $t:$r/$p"
  fi
done
NT=$(q "$NAME" "select count(*) from information_schema.tables where table_schema='public'")
NP=$(q imentor-postgres-1 "select count(*) from information_schema.tables where table_schema='public'")
# Jadvallar soni: zaxiradan keyingi migratsiyalar qo'shgan bo'lishi mumkin — kam bo'lsa faqat qayd,
# lekin tiklangan bazada umuman jadval bo'lmasa — xato.
[ "$NT" = ERR ] || [ "${NT:-0}" -lt 10 ] && { FAIL=1; REPORT="$REPORT jadvallar-yo'q!"; }

LINE="$STAMP $(basename "$DUMP") ${SECS}s jadvallar=$NT/$NP$REPORT"
if [ "$FAIL" = 0 ]; then
  echo "restore_ok $LINE" | tee -a "$DIR/restore-test.log"
else
  echo "restore_FAILED $LINE" | tee -a "$DIR/restore-test.log"
  exit 1
fi
