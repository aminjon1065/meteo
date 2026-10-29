#!/bin/sh
# Контейнер загрузки данных: каталоги в томах хоста, задания cron, crond на переднем плане.
# Разовый запуск задания: docker compose run --rm data <команда>
set -eu

for d in /smartmet/data /smartmet/logs/data /smartmet/tmp/data/gfs /smartmet/editor/in; do
  mkdir -p "$d"
done
chown smartmet:smartmet /smartmet/data /smartmet/logs /smartmet/logs/data /smartmet/tmp \
  /smartmet/tmp/data /smartmet/tmp/data/gfs /smartmet/editor /smartmet/editor/in

if [ "$#" -gt 0 ]; then
  exec runuser -u smartmet -- "$@"
fi

# mkcron в конце перезапускает crond через init.d — в контейнере его нет, ошибка ожидаема.
/smartmet/bin/mkcron >/dev/null 2>&1 || true
exec crond -n
