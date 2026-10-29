#!/bin/sh
# Выкатка версии портала на хост с общим обратным прокси (docs/runbook.md §13).
#
# Обычно запускается обёрткой /usr/local/bin/meteo-deploy из GitHub Actions. Вручную (root или
# deploy), когда infra/ версии уже лежит в /opt/meteo/<окружение>/releases/<sha>:
#   sh /opt/meteo/production/releases/<sha>/infra/deploy/deploy.sh production <sha>
# GHCR_TOKEN — токен для входа в ghcr.io (из GitHub Actions — токен задания); без него образы
# тянутся анонимно (публичные пакеты). SKIP_PULL=1 — не тянуть образы (собраны на сервере).
#
# Порядок: pull образов версии → бэкап (production) → postgres/redis → миграции → справочники →
# перезапуск web/worker/caddy/backup → ожидание healthy и /api/healthz через Caddy портала и общий
# прокси. Не поднялась — возврат на предыдущую версию (миграции не откатываются: схема обратно
# совместима в пределах поставки, runbook §2). Вывод скрипта попадает в журнал GitHub Actions —
# у публичного репозитория он открыт всем, поэтому журналы сервисов пишутся только на сервер
# (/opt/meteo/<окружение>/logs).
set -eu

ENV_NAME=${1:?окружение: staging или production}
SHA=${2:?тег образов (SHA коммита)}
BASE=${METEO_BASE:-/opt/meteo}
DIR="$BASE/$ENV_NAME"
REL="$DIR/releases/$SHA"
case "$ENV_NAME" in
  production) PROJECT=meteo ;;
  staging) PROJECT=meteo-staging ;;
  *) echo "неизвестное окружение: $ENV_NAME" >&2; exit 2 ;;
esac
[ -f "$DIR/.env" ] || { echo "нет $DIR/.env (runbook §13.2)" >&2; exit 2; }
[ -f "$REL/infra/compose/compose.prod.yml" ] || { echo "нет $REL/infra/compose/compose.prod.yml" >&2; exit 2; }
# compose читает текущий каталог: при запуске через runuser/sudo он может быть недоступен deploy (/root).
cd "$DIR"
# Caddyfile монтируется в контейнер Caddy (root без capabilities): файлы релиза должны читаться всеми,
# иначе Caddy портала перезапускается по кругу. Релиз мог быть распакован с umask 027 прежней обёрткой.
chmod -R a+rX "$REL/infra"

mkdir -p "$DIR/logs"
LOGF="$DIR/logs/$(date -u +%Y%m%dT%H%M%SZ)-$SHA.log"
log() { printf '[deploy %s %s] %s\n' "$ENV_NAME" "$(date -u +%H:%M:%S)" "$*" | tee -a "$LOGF"; }

env_value() { sed -n "s/^$1=//p" "$DIR/.env" | tail -1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"; }

# docker compose для версии: dc_at <каталог релиза> <тег образов> <аргументы compose…>
# SmartMet на этом же хосте (runbook §14): если в версии есть compose.smartmet.yml и на хосте есть сеть
# smartmet, web и worker подключаются к ней.
dc_at() {
  at_rel=$1
  at_tag=$2
  shift 2
  if [ -f "$at_rel/infra/compose/compose.smartmet.yml" ] && docker network inspect smartmet >/dev/null 2>&1; then
    set -- -f "$at_rel/infra/compose/compose.smartmet.yml" "$@"
  fi
  IMAGE_TAG=$at_tag docker compose -p "$PROJECT" --env-file "$DIR/.env" \
    -f "$at_rel/infra/compose/compose.prod.yml" -f "$at_rel/infra/compose/compose.edge.yml" "$@"
}
dc() { dc_at "$REL" "$SHA" "$@"; }

# Предыдущая версия — цель возврата. Повторная выкатка той же версии возвращает на ту, что была до неё.
PREV=
if [ -f "$DIR/.deploy.env" ]; then
  PREV=$(sed -n 's/^IMAGE_TAG=//p' "$DIR/.deploy.env")
  [ "$PREV" = "$SHA" ] && PREV=$(sed -n 's/^PREVIOUS_TAG=//p' "$DIR/.deploy.env")
fi
EDGE_ALIAS=$(env_value EDGE_ALIAS)

if [ -n "${GHCR_TOKEN:-}" ]; then
  # Отдельный каталог учётных данных Docker на время выкатки: токен задания не остаётся на сервере.
  DOCKER_CONFIG=$(mktemp -d)
  export DOCKER_CONFIG
  trap 'rm -rf "$DOCKER_CONFIG"' EXIT
  printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u github-actions --password-stdin >/dev/null
  unset GHCR_TOKEN
fi

log "версия $SHA (предыдущая: ${PREV:-нет})"
if [ "${SKIP_PULL:-0}" != "1" ]; then
  log "загрузка образов"
  dc pull --quiet web worker migrate backup >>"$LOGF" 2>&1 || { log "ОШИБКА: образы версии не загружены (CI их опубликовал?)"; exit 1; }
fi

if [ "$ENV_NAME" = production ] && [ -n "$(dc ps -q --status running backup 2>/dev/null)" ]; then
  log "резервная копия перед обновлением"
  dc exec -T backup sh -c 'BACKUP_ONCE=1 sh /backup/run.sh' >>"$LOGF" 2>&1 || { log "ОШИБКА: резервная копия не создана — обновление остановлено"; exit 1; }
fi

log "postgres, redis"
dc up -d --wait --wait-timeout 180 postgres redis >>"$LOGF" 2>&1 || { log "ОШИБКА: postgres/redis не готовы"; exit 1; }

log "миграции"
if ! dc run --rm -T migrate >>"$LOGF" 2>&1; then
  log "ОШИБКА: миграции не применены, работающая версия не тронута. Конец журнала:"
  tail -n 20 "$LOGF" | sed 's/^/    /'
  exit 1
fi

# Справочники и первый администратор (пока пользователей нет). SEED_ADMIN_* передаются явно:
# compose отдаёт контейнеру только перечисленные в compose.prod.yml переменные.
log "справочники"
if ! dc run --rm -T --no-deps -e SEED_ADMIN_EMAIL -e SEED_ADMIN_PASSWORD -e SEED_ADMIN_NAME \
  worker node dist/seed.js >>"$LOGF" 2>&1; then
  log "ОШИБКА: справочники не загружены, работающая версия не тронута (журнал: $LOGF)"
  exit 1
fi

wait_ready() {
  n=0
  while :; do
    pending=
    for s in web worker; do
      h=$(dc ps --format '{{.Health}}' "$s" 2>/dev/null || true)
      [ "$h" = healthy ] || pending="$pending $s=${h:-нет}"
    done
    c=$(dc ps --format '{{.State}}' caddy 2>/dev/null || true)
    [ "$c" = running ] || pending="$pending caddy=${c:-нет}"
    [ -z "$pending" ] && return 0
    n=$((n + 1))
    if [ "$n" -ge 60 ]; then
      log "не дождались готовности:$pending"
      return 1
    fi
    sleep 5
  done
}

smoke() {
  dc exec -T caddy wget -q -O /dev/null -T 10 http://127.0.0.1/api/healthz || {
    log "/api/healthz через Caddy портала не отвечает"
    return 1
  }
  if [ -n "$EDGE_ALIAS" ] && docker inspect edge-caddy-1 >/dev/null 2>&1; then
    docker exec edge-caddy-1 wget -q -O /dev/null -T 10 "http://$EDGE_ALIAS/api/healthz" || {
      log "общий прокси не достаёт до $EDGE_ALIAS (сеть edge, EDGE_ALIAS в .env)"
      return 1
    }
  fi
}

rollback() {
  if [ -n "$PREV" ] && [ -d "$DIR/releases/$PREV" ]; then
    log "возврат на предыдущую версию $PREV"
    dc_at "$DIR/releases/$PREV" "$PREV" up -d --remove-orphans >>"$LOGF" 2>&1 ||
      log "возврат не удался — нужна ручная проверка на сервере"
  else
    log "предыдущей версии нет — возвращать некуда"
  fi
}

log "перезапуск сервисов"
if ! dc up -d --remove-orphans >>"$LOGF" 2>&1 || ! wait_ready || ! smoke; then
  log "ОШИБКА: версия $SHA не поднялась; журналы сервисов — $LOGF на сервере"
  dc logs --no-color --tail 200 web worker caddy >>"$LOGF" 2>&1 || true
  rollback
  echo "$(date -u +%FT%TZ) $SHA failed" >>"$DIR/deploy.log"
  exit 1
fi

dc exec -T caddy test -s /srv/tiles/tajikistan.pmtiles ||
  log "ВНИМАНИЕ: в томе ${PROJECT}_tiles нет tajikistan.pmtiles — карта без подложки (runbook §1.5)"

{
  printf 'IMAGE_TAG=%s\n' "$SHA"
  printf 'PREVIOUS_TAG=%s\n' "$PREV"
  printf 'DEPLOYED_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} >"$DIR/.deploy.env.tmp"
mv "$DIR/.deploy.env.tmp" "$DIR/.deploy.env"
ln -sfn "releases/$SHA" "$DIR/current"
cp "$REL/infra/deploy/dc.sh" "$DIR/dc.tmp" && chmod 755 "$DIR/dc.tmp" && mv "$DIR/dc.tmp" "$DIR/dc"
echo "$(date -u +%FT%TZ) $SHA ok" >>"$DIR/deploy.log"

# Уборка: каталоги релизов — текущий, предыдущий и ещё три свежих; образы портала без контейнеров
# (staging и production делят теги — образ, занятый другим окружением, docker не удалит); журналы
# выкаток старше 90 дней. Имена релизов — SHA коммитов, поэтому разбор вывода ls безопасен.
# shellcheck disable=SC2010
ls -1t "$DIR/releases" | grep -v '\.tmp\.' | awk -v a="$SHA" -v b="$PREV" '$0 != a && $0 != b' |
  tail -n +4 | while read -r r; do rm -rf "${DIR:?}/releases/$r"; done
docker image ls --format '{{.Repository}} {{.Tag}}' |
  awk -v a="$SHA" -v b="$PREV" '$1 ~ /\/meteoportal-/ && $2 != a && $2 != b { print $1 ":" $2 }' |
  while read -r img; do docker image rm "$img" >/dev/null 2>&1 || true; done
docker image prune -f >/dev/null 2>&1 || true
find "$DIR/logs" -type f -mtime +90 -delete 2>/dev/null || true

log "готово: $SHA"
