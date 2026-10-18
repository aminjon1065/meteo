#!/bin/sh
# Резервное копирование метеопортала (docs/runbook.md, раздел «Бэкап и восстановление»).
#
# Каждый запуск: pg_dump (custom format, сжатие) → /backups/db/meteo-<UTC>.dump; затем, если задан
# RESTIC_PASSWORD (или RESTIC_PASSWORD_FILE), снимок restic из дампов и томов /srv/uploads, /srv/silam
# в RESTIC_REPOSITORY (по умолчанию локальный репозиторий /backups/restic; офсайт — s3:/sftp:/rest:
# через переменные restic) с политикой хранения keep-daily/keep-monthly и prune. Без restic —
# tar.gz загрузок рядом с дампом (как раньше). Локальные дампы старше BACKUP_KEEP_DAYS удаляются.
#
# Переменные: PGHOST PGUSER PGPASSWORD PGDATABASE, BACKUP_KEEP_DAYS (30), BACKUP_KEEP_DAILY (30),
# BACKUP_KEEP_MONTHLY (12), BACKUP_TIME_UTC (21:00 — 02:00 по Душанбе), BACKUP_ONCE=1 (один прогон
# и выход — для ручного запуска и теста восстановления), RESTIC_REPOSITORY, RESTIC_PASSWORD[_FILE],
# AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY (для s3:).
set -eu
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
KEEP_DAILY="${BACKUP_KEEP_DAILY:-30}"
KEEP_MONTHLY="${BACKUP_KEEP_MONTHLY:-12}"
BACKUP_TIME_UTC="${BACKUP_TIME_UTC:-21:00}"
DEST="${BACKUP_DEST:-/backups}"
DUMPS="$DEST/db"
STATUS="$DEST/last-backup.json"
export RESTIC_REPOSITORY="${RESTIC_REPOSITORY:-$DEST/restic}"
mkdir -p "$DUMPS"

log() { echo "[backup] $(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

restic_enabled() {
  [ -n "${RESTIC_PASSWORD:-}" ] || [ -n "${RESTIC_PASSWORD_FILE:-}" ]
}

write_status() {
  # $1 — результат (ok|failed), $2 — файл дампа, $3 — размер, $4 — статус restic
  printf '{"time":"%s","result":"%s","dump":"%s","sizeBytes":%s,"restic":"%s","repository":"%s"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" "${3:-0}" "$4" "$RESTIC_REPOSITORY" >"$STATUS.tmp"
  mv "$STATUS.tmp" "$STATUS"
}

run_backup() {
  STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
  DUMP="$DUMPS/meteo-$STAMP.dump"
  log "start $STAMP"
  pg_dump -Fc -Z 6 -f "$DUMP"
  SIZE="$(wc -c <"$DUMP" | tr -d ' ')"
  log "db ok: $DUMP ($SIZE bytes)"

  RESTIC_STATE="skipped"
  if restic_enabled; then
    if ! restic cat config >/dev/null 2>&1; then
      log "restic: инициализация репозитория $RESTIC_REPOSITORY"
      restic init
    fi
    set -- "$DUMPS"
    [ -d /srv/uploads ] && set -- "$@" /srv/uploads
    [ -d /srv/silam ] && set -- "$@" /srv/silam
    restic backup --tag meteo --host meteoportal --exclude-caches "$@"
    restic forget --tag meteo --keep-daily "$KEEP_DAILY" --keep-monthly "$KEEP_MONTHLY" --prune
    restic check
    RESTIC_STATE="ok"
    log "restic ok: snapshots → $RESTIC_REPOSITORY"
  elif [ -d /srv/uploads ]; then
    tar -czf "$DUMPS/uploads-$STAMP.tar.gz" -C /srv uploads && log "uploads tar ok"
  fi

  find "$DUMPS" -type f -mtime +"$KEEP_DAYS" -print -delete
  write_status ok "$(basename "$DUMP")" "$SIZE" "$RESTIC_STATE"
  log "done $STAMP"
}

seconds_until() {
  # секунд до ближайшего HH:MM UTC
  target_h="${1%%:*}"; target_m="${1##*:}"
  now_s=$(( $(date -u +%H) * 3600 + $(date -u +%M) * 60 + $(date -u +%S) ))
  target_s=$(( target_h * 3600 + target_m * 60 ))
  diff=$(( target_s - now_s ))
  [ "$diff" -le 0 ] && diff=$(( diff + 86400 ))
  echo "$diff"
}

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "[backup] pg_dump отсутствует в образе" >&2
  exit 1
fi

if [ "${BACKUP_ONCE:-0}" = "1" ]; then
  run_backup
  exit 0
fi

# Первый запуск сразу (контроль, что доступы верны), далее ежедневно в BACKUP_TIME_UTC.
while true; do
  if run_backup; then :; else
    log "FAILED"
    write_status failed "" 0 "error"
  fi
  SLEEP="$(seconds_until "$BACKUP_TIME_UTC")"
  log "next run in ${SLEEP}s (at $BACKUP_TIME_UTC UTC)"
  sleep "$SLEEP"
done
