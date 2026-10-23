#!/bin/sh
# Подготовка хоста к выкатке портала из GitHub Actions (docs/runbook.md §13). Запускается один раз
# от root из клона/копии репозитория; повторный запуск безопасен:
#   sh infra/deploy/setup-host.sh aminjon1065/meteo
# Делает: пользователь deploy (группа docker; входит только по ключам с принудительной командой),
# /etc/meteo-deploy.conf, /usr/local/bin/meteo-deploy, каталоги /opt/meteo/{staging,production},
# сеть Docker «edge» для общего обратного прокси. Не делает: .env окружений, ключи GitHub Actions,
# общий Caddy (/opt/edge), тайлы карты — см. runbook §13.2–13.4.
set -eu
REPO=${1:?укажите репозиторий GitHub: владелец/имя}
HERE=$(cd "$(dirname "$0")" && pwd)
[ "$(id -u)" -eq 0 ] || { echo "запускать от root" >&2; exit 1; }
command -v docker >/dev/null || { echo "нет Docker (runbook §1.1)" >&2; exit 1; }

if ! id deploy >/dev/null 2>&1; then
  useradd --system --create-home --home-dir /home/deploy --shell /bin/sh deploy
fi
usermod -aG docker deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
[ -f /home/deploy/.ssh/authorized_keys ] || install -m 600 -o deploy -g deploy /dev/null /home/deploy/.ssh/authorized_keys

install -m 755 "$HERE/meteo-deploy" /usr/local/bin/meteo-deploy
printf 'REPO=%s\nMETEO_BASE=/opt/meteo\n' "$REPO" >/etc/meteo-deploy.conf
chmod 644 /etc/meteo-deploy.conf

install -d -m 755 /opt/meteo
for e in staging production; do
  install -d -m 750 -o deploy -g deploy "/opt/meteo/$e" "/opt/meteo/$e/releases" "/opt/meteo/$e/logs"
done

docker network inspect edge >/dev/null 2>&1 || docker network create edge >/dev/null
echo "готово: deploy, /usr/local/bin/meteo-deploy, /opt/meteo/{staging,production}, сеть edge"
