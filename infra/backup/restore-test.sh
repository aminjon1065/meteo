#!/bin/sh
# Тест восстановления из бэкапа в чистую БД (docs/runbook.md). Нужен только Docker.
#
#   sh infra/backup/restore-test.sh                 # свежий дамп из контейнера разработки meteo-postgres
#   sh infra/backup/restore-test.sh path/to/meteo-*.dump
#   SOURCE_CONTAINER=meteo-postgres-1 sh infra/backup/restore-test.sh   # прод: имя контейнера postgres
#
# Шаги: 1) pg_dump -Fc из источника (если файл не передан); 2) чистый контейнер timescale/timescaledb-ha:pg17;
# 3) CREATE EXTENSION timescaledb → timescaledb_pre_restore() → pg_restore → timescaledb_post_restore();
# 4) проверки: расширения, гипертаблица, число строк в ключевых таблицах (сравнение с источником),
# пересчёт continuous aggregate; 5) контейнер удаляется (KEEP=1 — оставить). Код выхода 0 — тест пройден.
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$HERE/.restore-test"
IMAGE="${PG_IMAGE:-timescale/timescaledb-ha:pg17}"
SOURCE_CONTAINER="${SOURCE_CONTAINER:-meteo-postgres}"
PGUSER_SRC="${PGUSER_SRC:-meteo}"
PGDATABASE_SRC="${PGDATABASE_SRC:-meteo}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="meteo-restore-test-$STAMP"
mkdir -p "$WORK"

log() { echo "[restore-test] $*"; }
fail() { echo "[restore-test] FAIL: $*" >&2; exit 1; }
cleanup() {
  if [ "${KEEP:-0}" != "1" ]; then docker rm -f "$TARGET" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

DUMP="${1:-}"
SOURCE_COUNTS=""
if [ -z "$DUMP" ]; then
  DUMP="$WORK/meteo-$STAMP.dump"
  log "дамп из контейнера $SOURCE_CONTAINER → $DUMP"
  docker exec "$SOURCE_CONTAINER" pg_dump -U "$PGUSER_SRC" -d "$PGDATABASE_SRC" -Fc -Z 6 >"$DUMP"
  SOURCE_COUNTS="$(docker exec "$SOURCE_CONTAINER" psql -U "$PGUSER_SRC" -d "$PGDATABASE_SRC" -At -c \
    "select (select count(*) from stations)||' '||(select count(*) from measurements)||' '||(select count(*) from users)||' '||(select count(*) from news_posts)||' '||(select count(*) from cap_alerts)")"
fi
[ -s "$DUMP" ] || fail "дамп $DUMP пуст или не найден"
log "размер дампа: $(wc -c <"$DUMP" | tr -d ' ') байт"

log "чистый контейнер $TARGET ($IMAGE)"
docker run -d --name "$TARGET" -e POSTGRES_USER=meteo -e POSTGRES_PASSWORD=restore -e POSTGRES_DB=postgres \
  "$IMAGE" postgres -c shared_preload_libraries=timescaledb -c timescaledb.telemetry_level=off >/dev/null
i=0
until docker exec "$TARGET" pg_isready -U meteo -d postgres >/dev/null 2>&1; do
  i=$((i + 1)); [ "$i" -gt 60 ] && fail "PostgreSQL не поднялся за 60 с"; sleep 1
done
sleep 2
psql_t() { docker exec -i "$TARGET" psql -U meteo -v ON_ERROR_STOP=1 -At "$@"; }

log "восстановление (timescaledb_pre_restore → pg_restore → timescaledb_post_restore)"
psql_t -d postgres -c "CREATE DATABASE meteo"
psql_t -d meteo -c "CREATE EXTENSION IF NOT EXISTS timescaledb" -c "SELECT timescaledb_pre_restore()" >/dev/null
docker cp "$DUMP" "$TARGET:/tmp/restore.dump"
# pg_restore возвращает 1 из-за предупреждений вида «extension already exists» — проверяем результат по данным ниже.
docker exec "$TARGET" pg_restore -U meteo -d meteo --no-owner --no-privileges /tmp/restore.dump 2>"$WORK/pg_restore-$STAMP.log" || true
ERRORS="$(grep -ci "error" "$WORK/pg_restore-$STAMP.log" || true)"
log "pg_restore: ошибок в журнале $ERRORS (см. $WORK/pg_restore-$STAMP.log)"
psql_t -d meteo -c "SELECT timescaledb_post_restore()" >/dev/null

log "проверки"
EXT="$(psql_t -d meteo -c "select string_agg(extname||' '||extversion, ', ' order by extname) from pg_extension where extname in ('timescaledb','postgis')")"
echo "  расширения: $EXT"
echo "$EXT" | grep -q timescaledb || fail "нет расширения timescaledb"
echo "$EXT" | grep -q postgis || fail "нет расширения postgis"
HT="$(psql_t -d meteo -c "select count(*) from timescaledb_information.hypertables where hypertable_name='measurements'")"
[ "$HT" = "1" ] || fail "measurements не является гипертаблицей после восстановления"
CA="$(psql_t -d meteo -c "select count(*) from timescaledb_information.continuous_aggregates")"
echo "  гипертаблица measurements: да; continuous aggregates: $CA"
TARGET_COUNTS="$(psql_t -d meteo -c "select (select count(*) from stations)||' '||(select count(*) from measurements)||' '||(select count(*) from users)||' '||(select count(*) from news_posts)||' '||(select count(*) from cap_alerts)")"
echo "  строки (stations measurements users news_posts cap_alerts): $TARGET_COUNTS"
if [ -n "$SOURCE_COUNTS" ]; then
  echo "  источник:                                                 $SOURCE_COUNTS"
  [ "$SOURCE_COUNTS" = "$TARGET_COUNTS" ] || fail "число строк отличается от источника"
fi
MEAS="$(echo "$TARGET_COUNTS" | cut -d' ' -f2)"
if [ "$MEAS" -gt 0 ]; then
  psql_t -d meteo -c "CALL refresh_continuous_aggregate('measurements_hourly', NULL, NULL)" >/dev/null
  HOURLY="$(psql_t -d meteo -c "select count(*) from measurements_hourly")"
  [ "$HOURLY" -gt 0 ] || fail "continuous aggregate measurements_hourly пуст после refresh"
  echo "  measurements_hourly после refresh: $HOURLY строк"
fi
ADMIN="$(psql_t -d meteo -c "select count(*) from users where role='admin'")"
echo "  администраторов: $ADMIN"
log "OK — восстановление из $DUMP в чистую БД успешно ($(date -u +%Y-%m-%dT%H:%M:%SZ))"
