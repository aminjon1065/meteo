#!/bin/sh
# Контейнер загрузки данных (пользователь smartmet): каталоги в томах хоста и расписание supercronic.
# Расписание собирается из файлов FMI: /smartmet/cnf/cron/cron.d/* (строки crontab без поля
# пользователя) и скрипты в cron.10min/hourly/daily/weekly/monthly — как /etc/cron.d/smartmet.cron
# из smartmet-base-international. Разовый запуск: docker compose run --rm data <команда>.
set -eu

for d in /smartmet/data /smartmet/logs/data /smartmet/tmp/data/gfs /smartmet/editor/in; do
  mkdir -p "$d"
done

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

CRON=/smartmet/cnf/cron
CRONTAB=/tmp/smartmet.crontab
parts() { echo "for s in $CRON/$1/*; do [ -f \"\$s\" ] && [ -x \"\$s\" ] && \"\$s\"; done"; }
{
  echo "*/10 * * * * $(parts cron.10min)"
  echo "1 * * * * $(parts cron.hourly)"
  echo "0 0 * * * $(parts cron.daily)"
  echo "2 2 * * 0 $(parts cron.weekly)"
  echo "2 3 1 * * $(parts cron.monthly)"
  for f in "$CRON"/cron.d/*; do
    [ -f "$f" ] && grep -v -e '^[[:space:]]*#' -e '^[[:space:]]*$' "$f" || true
  done
} > "$CRONTAB"

exec supercronic "$CRONTAB"
