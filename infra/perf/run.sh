#!/bin/sh
# Нагрузочная проверка публичного API через k6 в Docker (docs/perf.md).
# Требования: запущенная production-сборка web (например, E2E-сервер: node apps/web/e2e/setup/server.mjs)
# с RATE_LIMIT_API_PER_MINUTE=0 — иначе лимит 120/мин на IP превратит нагрузку в 429.
#
# Использование: sh infra/perf/run.sh [BASE_URL] [VUS] [DURATION]
#   BASE_URL  — адрес сервера, как его видит контейнер (по умолчанию http://host.docker.internal:3100)
#   VUS       — виртуальных пользователей на маршрут (20)
#   DURATION  — длительность (30s)
# Результаты: infra/perf/results/<timestamp>/summary.txt и summary.json.
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
BASE_URL="${1:-${BASE_URL:-http://host.docker.internal:3100}}"
VUS="${2:-${VUS:-20}}"
DURATION="${3:-${DURATION:-30s}}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$HERE/results/$STAMP"
mkdir -p "$OUT"
echo "[perf] k6 → $BASE_URL (VUS=$VUS, DURATION=$DURATION, SCENARIO=${SCENARIO:-all})"
docker run --rm -i \
  --add-host=host.docker.internal:host-gateway \
  -e BASE_URL="$BASE_URL" -e VUS="$VUS" -e DURATION="$DURATION" \
  -e STATION_SLUG="${STATION_SLUG:-e2e-dushanbe-center}" -e SCENARIO="${SCENARIO:-all}" \
  -v "$OUT:/results" \
  "${K6_IMAGE:-grafana/k6:1.4.0}" run --quiet - <"$HERE/k6-api.js"
echo "[perf] результаты: $OUT/summary.txt"
cat "$OUT/summary.txt"
