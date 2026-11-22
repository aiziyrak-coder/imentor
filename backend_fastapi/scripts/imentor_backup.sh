#!/bin/bash
# iMentor kunlik baza zaxirasi — 14 kunlik rotatsiya.
#
# 2026-11-17 (audit): `sh` + `set -e` quvurda pg_dump yiqilsa ham "backup_ok" yozardi (pipefail yo'q edi).
# Endi: pipefail, gzip butunligi tekshiriladi va dampning oxirgi qatori (pg_dump "dump complete") bo'lmasa —
# fayl ".broken" bo'lib qoladi, eski zaxiralar O'CHIRILMAYDI va skript xato kodi bilan chiqadi.
set -euo pipefail
DIR=${IMENTOR_BACKUP_DIR:-/home/imentor/backups}
STAMP=$(date +%Y%m%d_%H%M)
OUT="$DIR/imentor_$STAMP.sql.gz"
TMP="$OUT.partial"
# pg_dump yoki docker yiqilsa ham: yarim fayl ".broken" bo'ladi, eski zaxiralar tegilmaydi.
trap 'rm -f "$TMP.tail"; [ -f "$TMP" ] && mv -f "$TMP" "$OUT.broken"; echo "backup_FAILED $STAMP (pg_dump/docker xatosi)" >&2' ERR

# Damp oxiri yozish paytida ushlanadi (faylni ikkinchi marta ochmaslik uchun).
docker exec imentor-postgres-1 pg_dump -U imentorfer imentorfer | tee >(tail -c 400 > "$TMP.tail") | gzip > "$TMP"
sleep 1

if ! gzip -t "$TMP"; then
  mv "$TMP" "$OUT.broken"
  echo "backup_FAILED $STAMP gzip buzilgan" >&2
  exit 1
fi
if ! grep -q "PostgreSQL database dump complete" "$TMP.tail"; then
  rm -f "$TMP.tail"
  mv "$TMP" "$OUT.broken"
  echo "backup_FAILED $STAMP damp oxirigacha yozilmagan" >&2
  exit 1
fi
rm -f "$TMP.tail"
mv "$TMP" "$OUT"
# Faqat yangi zaxira to'liq bo'lgandagina eskilari tozalanadi.
find "$DIR" -name "imentor_*.sql.gz" -mtime +14 -delete
echo "backup_ok $STAMP $(du -h "$OUT" | cut -f1)"
