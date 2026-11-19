#!/usr/bin/env bash
# Временное зеркало ленты SmartMet Alert Агентства (https://alert.meteo.tj) в ленты портала (runbook §14.6).
#
# Пока у alert.meteo.tj фейковый сертификат ingress-nginx, портал не может читать её напрямую
# (CAP_FEED_URL=https://alert.meteo.tj/capfeed.php). Скрипт (cron, раз в 5 минут) забирает последний
# выпуск редактора Агентства и кладёт его в каталоги наших alert-web: /smartmet/editor/smartalert
# (alert.havo.tj → havo.tj) и /smartmet/editor/smartalert-test (staging). Отмены доходят так же:
# в новом выпуске Агентства отменённого сообщения нет, и портал снимает его с публикации.
#
# Подлинность сервера проверяется по отпечатку открытого ключа (--pinnedpubkey), а не по цепочке
# сертификата: подменить сообщения по дороге нельзя. Ключ сменился (перезапуск ingress-nginx) -
# загрузка падает, уже показанные сообщения действуют до своего срока. Новый отпечаток:
#   echo | openssl s_client -connect alert.meteo.tj:443 -servername alert.meteo.tj 2>/dev/null \
#     | openssl x509 -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64
# и AGENCY_ALERT_PIN=sha256//<отпечаток> в /etc/cron.d/smartalert-mirror.
#
# Пока зеркало работает, с других редакторов в /smartmet/editor/smartalert не публикуют: выпуск
# с более поздней меткой закроет выпуск Агентства. Когда сертификат станет настоящим:
# CAP_FEED_URL=https://alert.meteo.tj/capfeed.php в .env production и staging, зеркало убрать
# (rm /etc/cron.d/smartalert-mirror).
#
# Установка (root):
#   install -m 755 infra/smartmet/alert/mirror-agency.sh /opt/smartmet/alert/mirror-agency.sh
#   echo '*/5 * * * * root /opt/smartmet/alert/mirror-agency.sh 2>&1 | logger -t smartalert-mirror' \
#     > /etc/cron.d/smartalert-mirror
# Журнал (пишется только при новом выпуске или ошибке): journalctl -t smartalert-mirror
set -euo pipefail

SRC=${AGENCY_ALERT_URL:-https://alert.meteo.tj}
PIN=${AGENCY_ALERT_PIN:-sha256//VezSztUt3rZP7gZ3BgbVbaTI++wclZ2BflUV3XmBnc4=}
DESTS=${MIRROR_DESTS:-/smartmet/editor/smartalert /smartmet/editor/smartalert-test}
OWNER=${MIRROR_OWNER:-101010:101010}
LOCK=${MIRROR_LOCK:-/run/smartalert-mirror.lock}

exec 9>"$LOCK"
flock -n 9 || exit 0

fetch() { curl -sSf -k --pinnedpubkey "$PIN" --max-time 60 "$@"; }

# Последний выпуск в каталоге ленты: publishedCap/<год>/<месяц>/<YYYYMMDDHHmmss>.
latest_of() { find "$1/publishedCap" -mindepth 3 -maxdepth 3 -type d 2>/dev/null | sort | tail -n 1; }

has_active() { [ -n "$(find "$1" -maxdepth 1 \( -name '*_ALERT_*' -o -name '*_UPDATE_*' \) -print -quit)" ]; }

# Выпуск через секунду после данного: «2026/11/20261119091844» → «2026/11/20261119091845».
next_release() {
  local s=${1##*/} t
  t=$(date -u -d "${s:0:4}-${s:4:2}-${s:6:2} ${s:8:2}:${s:10:2}:${s:12:2}" +%s)
  date -u -d "@$((t + 1))" +%Y/%m/%Y%m%d%H%M%S
}

# Каталог выпуска появляется целиком: готовим рядом и переименовываем (одна файловая система).
install_release() {
  local dest=$1 rel=$2 from=$3 inc
  inc=$(mktemp -d "$dest/.incoming-mirror-XXXXXX")
  if [ -n "$from" ]; then cp "$from"/*.xml "$inc"/; fi
  chmod 755 "$inc"
  find "$inc" -type f -exec chmod 644 {} +
  chown -R "$OWNER" "$inc"
  mkdir -p "$dest/publishedCap/${rel%/*}"
  chown "$OWNER" "$dest/publishedCap/${rel%%/*}" "$dest/publishedCap/${rel%/*}"
  mv "$inc" "$dest/publishedCap/$rel"
  echo "$dest: выпуск $rel, сообщений: $(find "$dest/publishedCap/$rel" -name '*.xml' | wc -l)"
}

# list.php Агентства: JSON-массив путей файлов ALERT/UPDATE последнего выпуска
# ("data\/\/publishedCap\/2026\/11\/20261119091844\/…xml"); null - действующих сообщений нет (всё отменено).
# Ошибка PHP (нет каталога, сбой NFS) начинается с <br /><b>Warning</b> - тогда ничего не трогаем.
body=$(fetch "$SRC/list.php" | tr -d '\\\r\n')
files=
case "$body" in
  null | "[]") ;;
  "["*"]")
    files=$(printf '%s' "$body" | grep -o 'publishedCap/[0-9]\{4\}/[0-9]\{2\}/[0-9]\{14\}/[A-Za-z0-9._-]*\.xml' || true)
    if [ -z "$files" ]; then
      echo "list.php: в ответе нет файлов выпуска: ${body:0:200}"
      exit 1
    fi
    ;;
  *)
    echo "list.php: неожиданный ответ: ${body:0:200}"
    exit 1
    ;;
esac

release=
if [ -n "$files" ]; then
  release=$(printf '%s\n' "$files" | cut -d/ -f2-4 | sort -u)
  if [ "$(printf '%s\n' "$release" | wc -l)" -ne 1 ]; then
    echo "list.php: файлы из разных выпусков: $(printf '%s ' "$release")"
    exit 1
  fi
fi

# Какие каталоги ленты отстают: нет этого выпуска; или у Агентства всё отменено, а у нас последний
# выпуск ещё с действующими сообщениями.
need=()
for dest in $DESTS; do
  [ -d "$dest" ] || continue
  find "$dest" -maxdepth 1 -name '.incoming-mirror-*' -mmin +60 -exec rm -rf {} + 2>/dev/null || true
  if [ -n "$release" ]; then
    [ -d "$dest/publishedCap/$release" ] || need+=("$dest")
  else
    last=$(latest_of "$dest")
    if [ -n "$last" ] && has_active "$last"; then need+=("$dest"); fi
  fi
done
[ "${#need[@]}" -gt 0 ] || exit 0

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
if [ -n "$release" ]; then
  for f in $files; do
    name=${f##*/}
    fetch -o "$tmp/$name" "$SRC/data/$f"
    if ! grep -q 'urn:oasis:names:tc:emergency:cap:1.2' "$tmp/$name"; then
      echo "не CAP 1.2: $name"
      exit 1
    fi
  done
fi

for dest in "${need[@]}"; do
  if [ -n "$release" ]; then
    install_release "$dest" "$release" "$tmp"
  else
    # Пустой выпуск сразу после последнего: новый выпуск Агентства всё равно будет позже него.
    install_release "$dest" "$(next_release "$(latest_of "$dest")")" ""
  fi
done
