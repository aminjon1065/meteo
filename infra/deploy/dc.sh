#!/bin/sh
# docker compose для окружения портала на сервере (docs/runbook.md §13). Копируется при выкатке
# в /opt/meteo/<окружение>/dc и работает с последней выкаченной версией: current → releases/<sha>,
# тег образов — из .deploy.env. Примеры:
#   /opt/meteo/production/dc ps
#   /opt/meteo/production/dc logs -f --tail 100 worker
#   /opt/meteo/production/dc exec backup sh -c 'BACKUP_ONCE=1 sh /backup/run.sh'
set -eu
DIR=$(cd "$(dirname "$0")" && pwd)
case "$(basename "$DIR")" in
  production) PROJECT=meteo ;;
  staging) PROJECT=meteo-staging ;;
  *) echo "dc: запускать как /opt/meteo/<production|staging>/dc" >&2; exit 2 ;;
esac
REL=$(readlink -f "$DIR/current")
# SmartMet на этом же хосте (runbook §14) — как в deploy.sh.
if [ -f "$REL/infra/compose/compose.smartmet.yml" ] && docker network inspect smartmet >/dev/null 2>&1; then
  set -- -f "$REL/infra/compose/compose.smartmet.yml" "$@"
fi
exec docker compose -p "$PROJECT" --env-file "$DIR/.env" --env-file "$DIR/.deploy.env" \
  -f "$REL/infra/compose/compose.prod.yml" -f "$REL/infra/compose/compose.edge.yml" "$@"
