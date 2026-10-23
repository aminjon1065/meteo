# Runbook метеопортала (эксплуатация)

Версия 1.1 · 17.10.2026 · English version: [runbook.en.md](runbook.en.md)

Для IT‑службы Агентства по гидрометеорологии. Среда: один хост Ubuntu 24.04 LTS, Docker Compose
(`infra/compose/compose.prod.yml`), сервисы caddy, web, worker, migrate, postgres (TimescaleDB +
PostGIS), redis, backup. Архитектура — `docs/02-architecture.md`, безопасность —
`docs/security-checklist.md`, импорт архивов — `docs/import-history.md`, работа в панели —
`docs/manuals/admin/ru.md`.

Все команды выполняются из каталога репозитория на сервере (`/opt/meteoportal`), от пользователя
с правом запускать Docker. Сокращение: `dc = docker compose --env-file .env -f infra/compose/compose.prod.yml`
(удобно добавить в `~/.bashrc`: `alias dc='docker compose --env-file .env -f infra/compose/compose.prod.yml'`).

Сервер с несколькими приложениями и выкаткой из GitHub Actions (текущий VPS `havo.tj`) — раздел 13:
там же каталоги `/opt/meteo/<окружение>`, общий прокси `/opt/edge` и команда `dc` для каждого окружения.

Требования к серверу: 4 vCPU, 8 ГБ RAM, 100 ГБ SSD (с запасом на 5 лет данных), статический IP,
домен (поддомен) с правом управлять DNS, открытые порты 80/443, исходящий доступ к SmartMet Server,
THREDDS FMI (`thredds.silam.fmi.fi`), фиду CAP и SMTP‑серверу.

| Что | Где |
|---|---|
| Код, compose, Caddyfile, скрипты | `/opt/meteoportal` (клон репозитория) |
| Секреты | `/opt/meteoportal/.env` (права 600, не в репозитории) |
| База данных | том `pgdata` (`docker volume inspect meteo_pgdata`) |
| Загрузки CMS, слои SILAM, тайлы карты | тома `uploads`, `silam`, `tiles` |
| Резервные копии | том `backups` (`/backups` в контейнере backup) + офсайт restic |
| Сертификаты TLS | тома `caddy_data`, `caddy_config` (выпускаются автоматически) |
| Логи | `dc logs <сервис>` (Docker json-file, ротация 5 × 10 МБ) |

## 1. Первичное развёртывание

### 1.1. Подготовка сервера

```bash
# Ubuntu 24.04: Docker Engine + Compose plugin (официальный репозиторий Docker)
sudo apt-get update && sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update && sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker "$USER"            # перелогиниться
sudo timedatectl set-timezone UTC          # контейнеры работают в UTC; портал показывает Asia/Dushanbe
# Межсетевой экран: только SSH, HTTP, HTTPS (PostgreSQL и Redis наружу не публикуются)
sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw allow 443/udp && sudo ufw enable
sudo mkdir -p /opt/meteoportal && sudo chown "$USER" /opt/meteoportal
git clone <адрес репозитория> /opt/meteoportal && cd /opt/meteoportal
```

Для `git clone` и `dc pull` из приватного репозитория/реестра GHCR нужен токен с правом `read:packages`
(`docker login ghcr.io`), срок ≤ 1 год, хранить в менеджере паролей.

### 1.2. DNS и TLS

1. Создайте записи `A` (и `AAAA`, если есть IPv6) для домена портала, например `portal.meteo.tj → <IP сервера>`.
   Проверка: `dig +short portal.meteo.tj`.
2. Caddy выпускает сертификат Let's Encrypt автоматически при первом запросе (ACME HTTP‑01/TLS‑ALPN —
   порты 80 и 443 должны быть доступны из интернета) и продлевает его за 30 дней до истечения.
   Адрес для уведомлений Let's Encrypt задан в `infra/compose/Caddyfile` (`email admin@meteo.tj`) — замените на адрес IT‑службы.
3. HTTP → HTTPS и HSTS включены в Caddy; дополнительных действий не нужно.
4. Staging без публичного домена: в `Caddyfile` после адреса сайта добавьте блок `tls internal`
   (самоподписанный сертификат Caddy) или используйте IP с `http://` в `SITE_ADDRESS` (без TLS — только для внутренней сети).

Проверка после запуска (раздел 1.7): `curl -I https://portal.meteo.tj/` → `200`, заголовки
`strict-transport-security`, `content-security-policy`.

### 1.3. Переменные окружения `.env`

`cp .env.example .env && chmod 600 .env`. Обязательные значения:

| Переменная | Значение | Примечание |
|---|---|---|
| `SITE_ADDRESS` | `portal.meteo.tj` | домен для Caddy; из него собираются `BETTER_AUTH_URL` и `NEXT_PUBLIC_APP_URL` (`https://…`) |
| `POSTGRES_PASSWORD` | `openssl rand -hex 24` | пароль роли `meteo`; только hex — пароль входит в `DATABASE_URL`, символы `/ + =` из base64 ломают адрес |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 48` | подписи сессий; смена завершает все сессии |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_NAME` | адрес и пароль ≥ 10 символов | первый администратор; используется один раз при seed, пока таблица пользователей пуста |
| `SMTP_URL` | `smtp://user:pass@mail.meteo.tj:587` или `smtps://…:465` | без него письма только в лог worker'а; спецсимволы в пароле — URL‑кодировать (`@` → `%40`) |
| `MAIL_FROM` | `"Метеопортал <noreply@meteo.tj>"` | домен отправителя должен проходить SPF/DKIM/DMARC (раздел 1.8) |
| `IMAGE_TAG` | `latest` или SHA коммита | версия образов из GHCR |
| `IMAGE_REPO` | `ghcr.io/aminjon1065` (по умолчанию) | реестр и владелец образов `meteoportal-*` |

Интеграции (можно задать позже, раздел 9): `SMARTMET_URL`, `SMARTMET_PRODUCER`, `SMARTMET_API_KEY`,
`SMARTMET_HOURLY_STEPS`, `SMARTMET_DAILY_DAYS`; `SILAM_NCSS_URL`, `SILAM_DATASET`, `SILAM_KEEP_RUNS`;
`CAP_FEED_URL`, `CAP_TIMEOUT_MS`. Устойчивость и уведомления: `INTEGRATION_ALERT_FAILURES` (3),
`INTEGRATION_CIRCUIT_FAILURES` (3), `INTEGRATION_CIRCUIT_COOLDOWN_MIN` (30), `INTEGRATION_CIRCUIT_MAX_COOLDOWN_MIN` (240),
`ADMIN_ALERT_EMAILS` (дополнительные адреса через запятую). Безопасность: `RATE_LIMIT_API_PER_MINUTE` (120),
`RATE_LIMIT_AUTH_PER_MINUTE` (30), `EMBED_FRAME_ANCESTORS` (кому разрешено встраивать виджеты).
Бэкапы: `RESTIC_PASSWORD` (`openssl rand -base64 32`, **сохранить в менеджере паролей отдельно от сервера**),
`RESTIC_REPOSITORY`, `RESTIC_AWS_ACCESS_KEY_ID`/`RESTIC_AWS_SECRET_ACCESS_KEY`, `BACKUP_TIME_UTC`, `BACKUP_KEEP_*`.
Пути `SILAM_DIR`, `UPLOADS_DIR`, `TILES_DIR` в продакшене задаёт compose (тома) — не менять.
Контейнеры получают только переменные, перечисленные в `infra/compose/compose.prod.yml` (`.env` целиком не
передаётся): новая переменная добавляется и в `.env.example`, и в compose. Незаданная переменная приходит
пустой строкой — приложения считают её отсутствующей. `STATION_SOURCES_KEY` должен быть одинаковым у web и worker
(он один и задаётся в `.env`).

### 1.4. Образы

Вариант А — готовые образы из GHCR (CI публикует `ghcr.io/<владелец>/meteoportal-{web,worker,backup}` с тегами
`latest` и SHA коммита после прохождения lint/тестов/Trivy):

```bash
docker login ghcr.io          # токен read:packages
dc pull
```

После переноса репозитория в GitHub Заказчика задайте в `.env` `IMAGE_REPO=ghcr.io/<новый владелец>`.

Вариант Б — сборка на сервере (нет доступа к GHCR или нужны локальные правки):

```bash
./infra/data/fetch-map-assets.sh   # шрифты и спрайты карты в apps/web/public/basemaps (гитигнорируются,
                                   # поэтому должны существовать ДО сборки образа web) + тайлы в infra/data/tiles
dc build
```

Сборка занимает 10–15 минут и требует ~4 ГБ свободного места. Образ `backup` собирается из `infra/backup`.

### 1.5. Тома и данные карты

Именованные тома создаются при первом `dc up`. Тайлы карты (`tajikistan.pmtiles`, ~210 МБ) не входят в образы —
их нужно положить в том `tiles`, который Caddy отдаёт по `/tiles/*`:

```bash
./infra/data/fetch-map-assets.sh                     # если ещё не выполнялся (нужен интернет, ~225 МБ)
docker volume create meteo_tiles
docker run --rm -v meteo_tiles:/t -v "$PWD/infra/data/tiles:/src:ro" alpine \
  sh -c 'cp /src/tajikistan.pmtiles /t/ && ls -la /t'
```

Тома `silam` (слои прогноза) и `uploads` (файлы CMS) заполняются приложением; `backups` — сервисом backup.
Владельцы каталогов внутри томов задаются образами (пользователь `app`), менять права вручную не нужно.

### 1.6. Запуск, миграции, справочники

```bash
dc up -d postgres redis                 # база и Redis
dc up -d migrate && dc logs -f migrate  # миграции Drizzle + SQL TimescaleDB/PostGIS; ждать Exited (0)
# справочники (вещества, шкалы, ПДК, регионы, точки прогноза) и первый администратор; SEED_ADMIN_* передаются
# явно — compose отдаёт контейнеру только перечисленные в compose.prod.yml переменные, без -e администратор не создаётся
dc run --rm -e SEED_ADMIN_EMAIL -e SEED_ADMIN_PASSWORD -e SEED_ADMIN_NAME worker node dist/seed.js
dc up -d                                # web, worker, caddy, backup
dc ps                                   # все сервисы healthy
```

Границы областей и районов (для карты предупреждений, фильтров и привязки станций) загружаются скриптом из
клона репозитория (нужны Node.js 22 и pnpm 12 на сервере или на рабочей станции с доступом к БД):

```bash
pnpm install --frozen-lockfile
DATABASE_URL=postgres://meteo:<пароль>@127.0.0.1:5432/meteo pnpm --filter @meteo/db boundaries
```

PostgreSQL наружу не публикуется: для запуска с рабочей станции откройте SSH‑туннель
(`ssh -L 5432:<ip контейнера postgres>:5432 сервер`; IP — `docker inspect meteo-postgres-1 | grep IPAddress`)
или временно опубликуйте порт только на `127.0.0.1` в override‑файле compose. Подробности и источники границ —
`infra/data/boundaries/README.md`.

### 1.7. Первый вход

1. Откройте `https://<домен>/admin`, войдите как `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.
2. Пройдите обязательную настройку 2FA (QR‑код в приложении‑аутентификаторе), **сохраните резервные коды**.
3. Создайте второго администратора (защита от потери доступа), операторов и редакторов — «Пользователи».
4. «Настройки» → «Почта» → тестовое письмо; «Брендинг» → название и контакты Агентства.
5. Удалите `SEED_ADMIN_PASSWORD` из `.env` (он больше не нужен) или смените пароль администратора в панели.

### 1.8. SMTP и домен отправителя (SPF, DKIM, DMARC)

Письма отправляет worker через SMTP‑сервер Агентства или внешний провайдер; сам портал DKIM‑подпись не ставит —
подписывает почтовый сервер (релей). Чтобы письма не попадали в спам, для домена из `MAIL_FROM` (например, `meteo.tj`)
в DNS должны быть:

| Запись | Пример | Назначение |
|---|---|---|
| SPF (`TXT` на домене) | `v=spf1 ip4:<IP почтового сервера> include:<провайдер> -all` | какие серверы вправе слать письма от домена |
| DKIM (`TXT` на `<selector>._domainkey.meteo.tj`) | публичный ключ, выданный почтовым сервером/провайдером | подпись писем; селектор и ключ генерирует релей |
| DMARC (`TXT` на `_dmarc.meteo.tj`) | `v=DMARC1; p=quarantine; rua=mailto:dmarc@meteo.tj; adkim=s; aspf=s` | политика для несовпадений и отчёты |
| PTR | обратная запись IP почтового сервера → его имя | требуется большинством получателей |

Настройка на стороне портала: `SMTP_URL=smtp://<логин>:<пароль>@<хост>:587` (STARTTLS) или `smtps://…:465`,
`MAIL_FROM` с адресом на том же домене. Проверка: `dc up -d worker`, админка → «Настройки» → «Отправить тестовое
письмо» → статус «отправлено»; письмо должно прийти с `DKIM: pass`, `SPF: pass` (видно в заголовках письма,
например «Показать оригинал» в Gmail). Типичные проблемы: самоподписанный сертификат релея (используйте
действительный сертификат или внутренний релей без TLS в доверенной сети), неверный порт (587 — STARTTLS, 465 — TLS),
пароль со спецсимволами (URL‑кодирование). Письма содержат ссылку отписки и отправляются только подтверждённым
подписчикам (double opt‑in) — это снижает жалобы на спам.

### 1.9. Чек‑лист после развёртывания

```bash
curl -fsS https://<домен>/api/healthz                      # {"status":"ok","db":"ok",...}
dc exec worker wget -qO- http://127.0.0.1:3001/healthz      # worker: {"status":"ok","queue":"ok",...}
curl -I https://<домен>/ | grep -i -E 'strict-transport|content-security'
curl -s https://<домен>/api/v1/stations | head -c 300       # JSON станций
dc exec backup cat /backups/last-backup.json                # первый бэкап выполнен при старте
dc ps                                                       # все healthy
```

В админке: дашборд — фоновый сервис «работает», интеграции SmartMet/SILAM «актуально» (CAP — после настройки
`CAP_FEED_URL`), очередь писем без ошибок. На портале: главная, карта (тайлы и подписи), `/weather`, `/warnings`.

## 2. Обновление версии

Образы собираются CI (GHCR, теги `latest` и SHA коммита); перед публикацией проходят lint, unit/E2E, Lighthouse,
`pnpm audit`, Trivy. Обновление — ~1 минута простоя web на время перезапуска (Caddy отдаёт 502 на это время).

```bash
cd /opt/meteoportal
git pull                                   # compose, Caddyfile, скрипты
dc exec backup sh -c 'BACKUP_ONCE=1 sh /backup/run.sh'   # резервная копия до обновления
dc pull                                    # или dc build при сборке на сервере
dc up -d migrate                           # миграции (идемпотентны); дождаться Exited (0)
dc run --rm worker node dist/seed.js       # справочники: новые вещества, шкалы, ПДК seed (правки администратора не трогает)
dc up -d                                   # перезапуск web/worker/backup на новых образах
dc ps                                      # healthy
curl -fsS https://<домен>/api/healthz
```

Откат: `IMAGE_TAG=<sha-предыдущего-коммита> dc up -d` (миграции не откатываются автоматически:
схема обратно совместима в пределах одной недели поставки; при необходимости восстановить БД из
бэкапа — раздел 3).

Обновление Caddy/Postgres/Redis (мажорные версии образов) — только по отдельному плану с бэкапом;
PostgreSQL major upgrade требует `pg_dump` → новая версия → `pg_restore` (раздел 3.3).

## 3. Бэкап и восстановление

### 3.1. Как работает бэкап

Сервис `backup` (образ `infra/backup/Dockerfile`: alpine + pg_dump 17 + restic) ежедневно в
`BACKUP_TIME_UTC` (21:00 UTC = 02:00 по Душанбе) и при старте:

1. `pg_dump -Fc` всей базы → том `backups` (`/backups/db/meteo-<UTC>.dump`), хранение `BACKUP_KEEP_DAYS` (30).
2. При заданном `RESTIC_PASSWORD` — снимок restic из дампов и томов `uploads` (файлы CMS) и
   `silam` (растровые слои) в `RESTIC_REPOSITORY` (по умолчанию локальный `/backups/restic`,
   зашифрован), политика `--keep-daily 30 --keep-monthly 12`, `prune`, `check`.
3. Статус в `/backups/last-backup.json` (`result`, `dump`, `sizeBytes`, `restic`); healthcheck
   контейнера краснеет, если файл старше 25 часов.

Офсайт‑копия (обязательна для продакшена): задать `RESTIC_REPOSITORY=s3:https://<endpoint>/<bucket>`
и `RESTIC_AWS_ACCESS_KEY_ID`/`RESTIC_AWS_SECRET_ACCESS_KEY` (любое S3‑совместимое хранилище, в том
числе MinIO в другом ЦОД Агентства) или `sftp:user@host:/path`. Пароль restic хранить отдельно от
сервера: без него копии нечитаемы.

Проверка: `dc exec backup cat /backups/last-backup.json`; `dc exec backup restic snapshots`.
Ручной запуск: `dc exec backup sh -c 'BACKUP_ONCE=1 sh /backup/run.sh'`.

### 3.2. Ежемесячный тест восстановления (обязателен)

Скрипт `infra/backup/restore-test.sh` поднимает чистый контейнер TimescaleDB, восстанавливает дамп
по процедуре TimescaleDB (`timescaledb_pre_restore()` → `pg_restore` → `timescaledb_post_restore()`),
проверяет расширения, гипертаблицу `measurements`, число строк ключевых таблиц (сравнивает с
источником) и пересчёт continuous aggregate. Нужен только Docker.

```bash
# на сервере: свежий дамп из контейнера postgres стека
SOURCE_CONTAINER=meteo-postgres-1 sh infra/backup/restore-test.sh
# или конкретный файл (например, скопированный из restic)
dc exec backup restic restore latest --target /tmp/restore --include /backups/db   # внутри контейнера
sh infra/backup/restore-test.sh /path/to/meteo-20261017T210000Z.dump
```

Результат фиксируется в журнале эксплуатации (дата, файл, `OK`). Локальный прогон 17.10.2026 на
базе разработки: см. `docs/04-delivery-plan.md`, неделя 8. По чек‑листу приёмки M8 тест выполняется
на staging при передаче системы.

### 3.3. Восстановление продакшена из бэкапа

Сценарий: повреждена БД / ошибочное удаление / переезд на новый сервер.

```bash
dc stop web worker backup                              # остановить запись
# 1. Получить дамп: локальный /backups/db/*.dump или из restic:
dc run --rm backup sh -c 'restic restore latest --target /tmp/r --include /backups/db && ls /tmp/r/backups/db'
# 2. Пересоздать базу (контейнер postgres запущен)
dc exec postgres psql -U meteo -d postgres -c "DROP DATABASE meteo WITH (FORCE);" -c "CREATE DATABASE meteo;"
dc exec postgres psql -U meteo -d meteo -c "CREATE EXTENSION IF NOT EXISTS timescaledb;" -c "SELECT timescaledb_pre_restore();"
docker cp meteo-YYYYMMDD.dump meteo-postgres-1:/tmp/restore.dump
dc exec postgres pg_restore -U meteo -d meteo --no-owner --no-privileges /tmp/restore.dump   # предупреждения «already exists» допустимы
dc exec postgres psql -U meteo -d meteo -c "SELECT timescaledb_post_restore();"
# 3. Файлы: восстановить тома uploads/silam из restic (restore --include /srv/uploads) в тома,
#    затем
dc up -d migrate && dc up -d
```

Проверить: `/api/healthz`, страница станции (история), админка → аудит. Восстановленная база
содержит сессии пользователей — завершить их в «Пользователи» при подозрении на компрометацию.

Важно: TimescaleDB предупреждает о циклических FK в `continuous_agg` при `pg_dump` — это ожидаемо;
восстанавливать всегда полный дамп, не `--data-only`.

### 3.4. Переезд на другой сервер

1. На новом сервере выполнить разделы 1.1–1.5 (тот же `.env`, тот же `RESTIC_PASSWORD`).
2. На старом: `dc stop web worker`, финальный бэкап (`BACKUP_ONCE=1`), скопировать том `backups` (или использовать офсайт restic).
3. На новом: восстановить БД и тома по разделу 3.3, `dc up -d`, проверить по разделу 1.9.
4. Переключить DNS на новый IP; Caddy выпустит сертификат автоматически. Старый сервер остановить через сутки.

## 4. Ротация секретов и ограничение доступа

| Секрет | Где | Как сменить | Последствия |
|---|---|---|---|
| `POSTGRES_PASSWORD` | `.env`, postgres | `dc exec postgres psql -U meteo -c "ALTER USER meteo PASSWORD '<new>';"`, обновить `.env`, `dc up -d` (web, worker, backup, migrate читают `DATABASE_URL`/`PGPASSWORD` из `.env`) | кратковременный перезапуск |
| `BETTER_AUTH_SECRET` | `.env` | новый `openssl rand -base64 48`, `dc up -d web` | все сессии и «доверенные устройства» 2FA недействительны — пользователи входят заново (резервные коды и TOTP‑ключи остаются) |
| `RESTIC_PASSWORD` | `.env` + менеджер паролей | `dc exec backup restic key add` (новый пароль), затем `restic key remove <old-id>`, обновить `.env` | старые снимки читаются новым паролем |
| `SMTP_URL`, `SMARTMET_API_KEY` | `.env` | обновить, `dc up -d worker web`; проверить тестовым письмом в «Настройки» | — |
| API‑ключи станций | админка → станция → «Сгенерировать ключ» | показывается один раз; передать оператору датчика | старый ключ перестаёт работать сразу (приём по API — в следующей версии) |
| Пароли администраторов | админка → «Пользователи» → «Сбросить пароль» | сброс завершает сессии пользователя | — |
| 2FA администратора | «Пользователи» → «Сбросить 2FA» | при следующем входе обязательная настройка заново | — |
| TLS‑сертификат | Caddy | автоматически (Let's Encrypt, за 30 дней до истечения); проверка `dc logs caddy` | — |
| Токен GHCR для `dc pull` | `docker login ghcr.io` на сервере | персональный токен с правом `read:packages`, срок ≤ 1 год | — |

Роль приложения без DDL (план): создать роль `meteo_app` с правами `SELECT/INSERT/UPDATE/DELETE`
на схему `public` и использовать её в `DATABASE_URL` web/worker; `migrate` остаётся на владельце.
Выполнять после первого стабильного релиза на сервере Заказчика.

### 4.1. Ограничение `/admin` по IP (опционально)

Если панель должна быть доступна только из сети Агентства, добавьте в `infra/compose/Caddyfile` перед блоком
`handle { reverse_proxy … }` (адреса панели — `/admin` для таджикского языка и `/ru/admin`, `/en/admin`;
API входа — `/api/auth/*`):

```caddyfile
	@adminOutside {
		path /admin* /tg/admin* /ru/admin* /en/admin* /api/auth/*
		not remote_ip 203.0.113.0/24 10.0.0.0/8
	}
	respond @adminOutside 403
```

Затем `dc exec caddy caddy reload --config /etc/caddy/Caddyfile` (или `dc restart caddy`). Публичные страницы и
`/api/v1` остаются открытыми. Учитывайте VPN и мобильный доступ администраторов.

## 5. Мониторинг и эксплуатационные проверки

| Что | Как проверить | Норма |
|---|---|---|
| Живость web | `curl -fsS https://<домен>/api/healthz` | `{"status":"ok","db":"ok"}`, код 200; 503 — нет связи с БД |
| Живость worker | `dc exec worker wget -qO- http://127.0.0.1:3001/healthz` | `status: ok`, `queue: ok`, `lastHeartbeatAt` не старше 3 минут |
| Состояние контейнеров | `dc ps` | все `healthy`/`running`; `migrate` — `exited (0)` |
| Интеграции | дашборд админки → «Интеграции» | SmartMet/SILAM/CAP «актуально»; при «сбой»/«приостановлено» — раздел 6 |
| Свежесть данных станций | дашборд → «Свежесть данных» | доля станций без данных за сутки близка к 0 % |
| Очередь писем | дашборд → «Очередь писем» | `ошибки` = 0; иначе SMTP |
| Бэкап | `dc exec backup cat /backups/last-backup.json` | `result: ok`, время < 25 ч, `restic: ok` |
| Диск | `df -h /var/lib/docker`, `docker system df` | свободно ≥ 20 %; при нехватке — `docker image prune -a` и ретенция бэкапов |
| Сертификат | `curl -vI https://<домен> 2>&1 \| grep -i expire` или `dc logs caddy \| grep -i certificate` | срок > 14 дней (продление автоматическое) |
| Ошибки в логах | `dc logs --since 24h worker \| grep -i -E '"level":(50\|60)'` (pino: 50 — error, 60 — fatal), `dc logs --since 24h web \| grep -i error` | единичные ошибки сети допустимы; повторяющиеся — разбор |

Автоматические уведомления: письма администраторам (все пользователи с ролью admin + `ADMIN_ALERT_EMAILS`)
о сбое интеграции после `INTEGRATION_ALERT_FAILURES` неудач подряд и о восстановлении. Внешний мониторинг
(рекомендуется): Uptime Kuma или аналог — HTTPS‑проверка `/api/healthz` каждую минуту и проверка
срока сертификата; при желании — проверка `last-backup.json` через `docker exec` по cron с отправкой письма.

Регламент:

- Ежедневно (автоматически): healthchecks compose, `last-backup.json`, письма о сбоях интеграций.
- Еженедельно: таблица выше целиком, дашборд админки, очередь QC (оператор).
- Ежемесячно: тест восстановления (3.2), `dc pull && dc up -d` при наличии обновлений, проверка отчётов
  CI (audit/Trivy), ротация журналов (автоматически), проверка свободного места.
- Нагрузка и лимиты: `docs/perf.md`; при 429 у легитимных интеграций — поднять `RATE_LIMIT_API_PER_MINUTE`
  в `.env` или вынести интеграцию на отдельный IP.

## 6. Инциденты по источникам данных

Общий порядок: дашборд → «Интеграции» (статус, последняя ошибка, адрес источника) → `dc logs --since 2h worker`
→ проверить источник с сервера (`curl`) → устранить → дождаться расписания или запустить задачу вручную (раздел 7).
Статусы: «сбой, подряд N» — источник отвечает ошибкой; «приостановлено до …» — circuit breaker после
`INTEGRATION_CIRCUIT_FAILURES` сбоев, пауза `INTEGRATION_CIRCUIT_COOLDOWN_MIN` минут с удвоением до
`INTEGRATION_CIRCUIT_MAX_COOLDOWN_MIN`; ручной запуск с `{"force":true}` обходит паузу; перезапуск worker'а сбрасывает её.

| Симптом | Диагностика | Действие |
|---|---|---|
| Нет прогноза / «прогноз устарел» на `/weather` | дашборд → SmartMet; `dc logs worker \| grep smartmet`; с сервера: `curl -fsS "$SMARTMET_URL/timeseries?format=json&producer=$SMARTMET_PRODUCER&latlon=38.56,68.79&param=Temperature&timesteps=2"` | недоступен SmartMet Server Агентства — обратиться к администратору SmartMet/FMI; временно переключиться на песочницу `SMARTMET_URL=https://opendata.fmi.fi` (`SMARTMET_PRODUCER=ecmwf`, без символов погоды); после восстановления `dc up -d worker` и ручной запуск `smartmet-sync` |
| Нет слоя SILAM / «прогноз SILAM устарел» | дашборд → SILAM; `curl -fsS "${SILAM_NCSS_URL}${SILAM_DATASET}/dataset.xml" \| head`; свободное место тома `silam` (`docker system df -v`) | THREDDS FMI отстаёт на 1–2 дня — норма; при смене датасета исправить `SILAM_DATASET`; при нехватке места уменьшить `SILAM_KEEP_RUNS`; ручной запуск `silam-sync` с `force` |
| Предупреждения CAP не обновляются | дашборд → CAP и `/admin/cap` → «Синхронизация» (ошибки разбора по файлам); `curl -fsS "$CAP_FEED_URL" \| head` | проверить `CAP_FEED_URL` (Atom/RSS/HTTP‑каталог/`file://`), доступность редактора SmartMet Alert, сертификат; ошибки отдельных XML — сообщить выпускающему; ручной запуск `cap-sync` с `force` |
| Письма не уходят (очередь «ошибки» растёт) | дашборд → очередь писем; `dc logs worker \| grep -i -E 'mail\|smtp'`; тест в «Настройки» | SMTP‑доступ (логин/порт/TLS), SPF/DKIM/DMARC домена, `MAIL_FROM`; после исправления `dc up -d worker` — очередь дошлёт письма сама (повторные попытки) |
| Индекс «нет данных» при наличии измерений | админка → очередь QC; `select max(time) from station_index` | значения с флагом suspect/invalid не участвуют — решить в QC; измерения старше 6 ч считаются устаревшими; пересчёт — `index-compute` каждые 10 мин (ручной запуск — раздел 7) |
| Worker «не отвечает» на дашборде | `dc ps worker`, `dc logs --since 30m worker`, Redis: `dc exec redis redis-cli ping` | `dc restart worker`; при падении Redis — `dc restart redis worker`; при переполнении памяти Redis (`maxmemory 256mb`, `noeviction`) — `dc exec redis redis-cli info memory` |
| Карта без подписей / серая | `curl -I https://<домен>/tiles/tajikistan.pmtiles` (206/200), `curl -I https://<домен>/basemaps/fonts/…` | том `tiles` пуст (раздел 1.5) или образ web собран без `basemaps` (раздел 1.4) |
| 502 от Caddy | `dc ps web`, `dc logs --since 10m web` | web перезапускается или упал: `dc restart web`; проверить `.env` (`BETTER_AUTH_SECRET` ≥ 32 символов, `DATABASE_URL`) |
| 429 у интеграции/СМИ | заголовки `X-RateLimit-*` | поднять `RATE_LIMIT_API_PER_MINUTE` (`dc up -d web`) или договориться о кэшировании на стороне клиента |
| Импорт архива | `docs/import-history.md` | `--dry-run` → отчёт → импорт; индекс пересчитывается скриптом (раздел 11) |

## 7. Ручной запуск фоновых задач

Задачи worker'а (BullMQ, очередь `meteo-jobs`) и расписание: `heartbeat` 1 мин; `mailer` 1 мин; `index-compute` 10 мин;
`threshold-eval` 10 мин; `station-pull` 10 мин; `qc-batch` 15 мин; `smartmet-sync` 15 мин; `cap-sync` 5 мин; `silam-sync` ежечасно в :20.
Задачи с интервалом выполняются также сразу после старта worker'а (`dc restart worker` — простой способ
«запустить всё сейчас»); `silam-sync` по cron — только по расписанию или вручную.

На сервере (в контейнере worker нет `pnpm`, но есть `bullmq` и `ioredis`):

```bash
dc exec worker node -e "const R=require('ioredis'),{Queue}=require('bullmq');const q=new Queue('meteo-jobs',{connection:new R(process.env.REDIS_URL,{maxRetriesPerRequest:null})});q.add(process.argv[1],JSON.parse(process.argv[2]||'{}'),{jobId:process.argv[1]+':manual:'+Date.now()}).then(j=>{console.log('job',j.id);return q.close()}).then(()=>process.exit(0))" silam-sync '{"force":true}'
```

Замените `silam-sync '{"force":true}'` на нужную задачу и параметры:

| Задача | Параметры | Когда |
|---|---|---|
| `smartmet-sync` | `{"force":true}`; `{"slugs":["dushanbe"]}` — только указанные точки | после смены `SMARTMET_*`, добавления точки прогноза |
| `silam-sync` | `{"force":true}` — перекачать текущий прогон, обойти circuit breaker | после сбоя THREDDS, смены датасета |
| `cap-sync` | `{"force":true}`; `{"url":"file:///…/feed.atom","force":true}` — разовый источник (например, фикстуры `infra/data/cap`) | после смены `CAP_FEED_URL`, для проверки |
| `station-pull` | `{}`; `{"sourceId":5,"force":true}` — один источник SFTP/FTP/HTTP, даже выключенный, с перечитыванием свежего файла | после настройки источника в карточке станции (кнопка «Проверить сейчас» делает то же) |
| `index-compute` | `{}` | после массового импорта или правки шкал (панель делает это сама) |
| `qc-batch`, `threshold-eval`, `mailer` | `{}` | ускорить обработку очереди |

На машине разработчика то же делает `pnpm --filter @meteo/worker enqueue <задача> '<json>'`. Результат — в
`dc logs -f worker` (строки `job completed` / `job failed`) и на дашборде.

## 8. Добавление станции, точки прогноза, языка, региона предупреждений

### 8.1. Станция

Админка → «Станции» → «Добавить» (код, координаты, область, вещества и единицы ввода) — `docs/manuals/admin/ru.md`, раздел 4.
Данные: ручной ввод, импорт CSV в админке, импорт архива (раздел 11) или автоматический приём со станции (раздел 9.4). Станция появится на карте и в API через минуту,
индекс — после первых валидных измерений; точечный прогноз SILAM для её координат — при следующем `silam-sync`
(или ручной запуск с `force`).

### 8.2. Точка прогноза (город/район)

Точки прогноза не редактируются в панели — добавляются в таблицу `forecast_locations`:

```bash
dc exec postgres psql -U meteo -d meteo -c "
insert into forecast_locations (slug, name, geom, region_id, kind, sort_order, featured, active)
values ('panjakent', '{\"tg\":\"Панҷакент\",\"ru\":\"Пенджикент\",\"en\":\"Panjakent\"}',
        ST_SetSRID(ST_MakePoint(67.6094, 39.4953), 4326),
        (select id from regions where code = 'SU'), 'city', 9, false, true);"
```

`slug` — латиница, используется в адресах `/weather/<slug>`, API и виджетах; `featured=true` выводит точку в блок
«Крупные города» и на главную; `smartmet_place` (необязательно) — имя места в SmartMet, если нужен прогноз по
названию, а не по координатам; `active=false` временно скрывает точку. Затем ручной запуск `smartmet-sync` с
`{"slugs":["panjakent"]}` и `silam-sync` с `force` (или подождать расписания). Sitemap обновляется автоматически.

### 8.3. Язык интерфейса

`packages/i18n`: новый `messages/<lang>.json`, `locales` и `localeTags` в `src/index.ts`, маршрутизация
`apps/web/src/i18n/routing.ts`, проверка `pnpm --filter @meteo/i18n check:messages`; контент в БД хранится
как jsonb `{tg, ru, en}` — новый язык требует доработки форм админки (отдельная задача разработчика). Это изменение
кода с новым релизом, а не настройка сервера.

### 8.4. Регионы предупреждений

Таблица `warning_regions` (код как в geocode CAP‑сообщений SmartMet Alert, название, геометрия) заполнена из областей
(`DU`, `RRP`, `SU`, `KT`, `GB`). Если редактор SmartMet Alert использует другие коды — добавьте строки с нужными
кодами и геометрией (можно скопировать из `regions`/`districts`):

```sql
insert into warning_regions (code, name, geom)
select 'TJ-SU', name, geom from regions where code = 'SU';
```

Сообщения без совпадающего geocode привязываются по пересечению полигона CAP с регионами.

## 9. Подключение внешних источников через `.env`

После любого изменения `.env`: `dc up -d worker web` (пересоздаются только затронутые сервисы), затем проверка на
дашборде и ручной запуск задачи (раздел 7).

### 9.1. SmartMet Server (прогноз погоды)

| Переменная | Значение |
|---|---|
| `SMARTMET_URL` | адрес сервера с плагином timeseries, например `https://smartmet.meteo.tj` (по умолчанию песочница `https://opendata.fmi.fi`) |
| `SMARTMET_PRODUCER` | producer модели на сервере Агентства (уточнить у администратора SmartMet); для opendata — `ecmwf` |
| `SMARTMET_API_KEY` | если сервер требует ключ (передаётся запросом) |
| `SMARTMET_HOURLY_STEPS` / `SMARTMET_DAILY_DAYS` | горизонт почасового (72) и суточного (10) прогноза |

Проверка с сервера: `curl -fsS "$SMARTMET_URL/timeseries?format=json&producer=$SMARTMET_PRODUCER&latlon=38.56,68.79&param=Temperature,WindSpeedMS,SmartSymbol&timesteps=3"`.
Символы погоды появляются, если producer отдаёт `SmartSymbol`/`WeatherSymbol3`. Точки запрашиваются по координатам
из `forecast_locations` (или по `smartmet_place`).

### 9.2. SILAM (прогноз качества воздуха)

| Переменная | Значение |
|---|---|
| `SILAM_NCSS_URL` | базовый адрес NetCDF Subset Service, по умолчанию `https://thredds.silam.fmi.fi/thredds/ncss/grid/` |
| `SILAM_DATASET` | путь датасета, по умолчанию глобальный `silam_glob_v6_1_sfc/silam_glob_v6_1_sfc_best.ncd`; при появлении регионального домена для Центральной Азии (D4) — заменить |
| `SILAM_KEEP_RUNS` | сколько прогонов хранить в томе `silam` (3; ~50–100 МБ на прогон) |

Проверка: `curl -fsS "${SILAM_NCSS_URL}${SILAM_DATASET}/dataset.xml" | grep -o 'name="[^"]*"' | head`. Задача
раз в час проверяет новый прогон, качает NetCDF по bbox Таджикистана, рисует PNG‑слои и считает точечные
прогнозы для городов и станций.

### 9.3. SmartMet Alert (CAP)

| Переменная | Значение |
|---|---|
| `CAP_FEED_URL` | Atom/RSS‑фид редактора (`https://alert.meteo.tj/cap/feed.atom`), HTTP‑каталог с `*.xml` или `file:///…` (фикстуры `infra/data/cap` для проверки); без значения задача пропускается, дашборд показывает «источник не настроен» |
| `CAP_TIMEOUT_MS` | таймаут запроса (15000) |

Проверка: `curl -fsS "$CAP_FEED_URL" | head -20`; затем ручной запуск `cap-sync` с `force` и `/admin/cap` →
«Синхронизация». Сообщения со статусом `Test`/`Exercise` видны только в панели. Коды регионов в `<geocode>` должны
совпадать с `warning_regions.code` (раздел 8.4); иначе привязка — по пересечению полигонов. Словарь переводов
`event` — `/admin/cap/events`.

### 9.4. Автоматический приём данных со станций (ingest API, агент, SFTP/FTP/HTTP)

Три способа подключить станцию мониторинга воздуха, не зависящие от вендора оборудования (`docs/02-architecture.md` §8.4):

| Способ | Когда подходит | Что нужно на стороне станции |
|---|---|---|
| **Агент станции** `apps/station-agent` | вендорское ПО пишет CSV/TSV в папку на станционном компьютере | Node.js 22, один файл `station-agent.mjs` + `config.json`, исходящий HTTPS |
| **Прямая отправка** на `POST /api/v1/ingest/{код}` | логгер/контроллер сам умеет слать HTTP‑запросы с JSON | исходящий HTTPS, ключ станции |
| **Pull‑источник** (SFTP/FTP/FTPS/HTTP) | данные уже выкладываются на сервер вендора или Агентства | доступ worker'а к этому серверу (исходящий TCP 22/21/443 с портала) |
| **Источник «JSON API»** (несколько станций через один адрес) | сеть датчиков отдаёт JSON по HTTP(S) — основной канал данных сети PM‑датчиков Агентства (airquality.meteo.tj, API wwcs.tj) | исходящий HTTPS с портала к API |

**Сетевые требования.** Агент и логгеры: только исходящий HTTPS (TCP 443) с станционного компьютера на адрес портала
(из DMZ Агентства или через прокси; входящих портов не нужно). Pull‑источники: исходящий доступ с сервера портала к
серверу вендора (SFTP 22, FTP 21 + пассивные порты, HTTPS 443); если сервер вендора ограничивает доступ по IP, в
whitelist добавляется внешний IP сервера портала. Ключ станции и пароли источников — секреты: ключ показывается один
раз, в БД хранится хэш; пароли источников шифруются ключом `STATION_SOURCES_KEY` (`.env`, `openssl rand -base64 32`;
без него используется `BETTER_AUTH_SECRET` — при ротации секрета пароли придётся ввести заново) или задаются ссылкой
`env:ИМЯ` на переменную окружения worker'а.

**Шаг за шагом (агент или прямая отправка):**

1. Админка → «Станции» → карточка станции: отметьте измеряемые вещества и единицы ввода (значения в других единицах
   отклоняются с причиной `pollutantNotConfigured`/`unit`), укажите источник данных «API» или «Автоматический датчик»
   (тогда дашборд и письма следят за отсутствием приёма), «Сгенерировать ключ» в блоке «Ключ API станции» — скопируйте
   ключ сразу.
2. На станционном компьютере: установите Node.js 22 LTS, скопируйте `apps/station-agent/station-agent.mjs` и подходящий
   конфиг из `apps/station-agent/examples/`, заполните `portalUrl`, `stationCode`, `watchDir`, `mapping`
   (разделитель, колонка времени и формат, колонки веществ) и ключ (`apiKey` или переменная из `apiKeyEnv`).
3. Проверка: `node station-agent.mjs --config config.json --check` (папка и формат свежего файла), затем `--dry-run`
   и `--once`. Ошибки разбора пишутся с номерами строк; причины отклонений портала — в ответе и в логе агента.
4. Служба: Windows — `service\install-task.cmd` (Планировщик заданий, каждые 5 минут, `--once`) или
   `service\nssm-install.cmd` (постоянная служба NSSM); Linux — `service/meteo-station-agent.service` (systemd).
   Подробно — `apps/station-agent/README.ru.md`.
5. Проверка на портале: карточка станции → «Автоматический приём данных» (время, канал, принято/отклонено, период),
   дашборд → колонка «Автоматический приём»; журнал аудита — записи `measurements.ingest` от `station:<код>`.
   Прямая отправка без агента: `curl -X POST "$PORTAL/api/v1/ingest/DU-01" -H "Authorization: Bearer $KEY"
   -H "Content-Type: application/json" -d '[{"time":"2026-10-18T07:00:00Z","pollutant":"PM25","value":42.5}]'`
   (описание формата — `/data/api`).

**Шаг за шагом (pull‑источник):**

1. `.env`: задайте `STATION_SOURCES_KEY`, при необходимости `STATION_PULL_TIMEOUT_MS`, `STATION_PULL_MAX_FILE_MB`,
   `STATION_PULL_LOOKBACK_DAYS` (глубина первого прохода), затем `dc up -d worker web`.
2. Карточка станции → «Источники файлов» → «Добавить источник»: тип, сервер/порт, пользователь и пароль (или приватный
   ключ SSH и отпечаток ключа хоста `SHA256:…` из `ssh-keyscan host | ssh-keygen -lf -`), каталог и маска файлов,
   описание колонок (шаблоны «столбец на вещество» / «вещество в строке» / «дата и время раздельно»; формат тот же, что
   у агента), порог «уведомить, если нет данных дольше N минут».
3. «Проверить сейчас» → через минуту в карточке появятся статус, время успеха/данных и сводка (файлов, принято,
   отклонено, первые ошибки); в логе worker'а — строки `station-pull: file processed` / `source failed`.
4. Дальше worker забирает новые и изменившиеся файлы каждые 10 минут (повторная обработка безопасна: upsert по ключу
   время/вещество/осреднение). Смена адреса или маски обнуляет реестр обработанных файлов.

**Контроль.** Письмо администраторам (шаблон `stationData`, получатели — как у сбоев интеграций) уходит, когда источник
не принёс ни одного значения дольше своего порога или станция с приёмом по API молчит дольше `STATION_INGEST_STALE_MIN`
(180 мин); при возобновлении — письмо о восстановлении. Лимит `POST /api/v1/ingest` — `RATE_LIMIT_INGEST_PER_MINUTE`
(60 запросов в минуту на станцию + IP, до 1000 записей в запросе). Отзыв доступа станции — «Обновить ключ» в карточке
(старый ключ перестаёт действовать сразу) или статус «приостановлена» (ответ 403).

**Сеть PM‑датчиков Агентства (airquality.meteo.tj, API подрядчика wwcs.tj) — источник типа «JSON API», основной
канал данных этой сети на портале (подключение штатное, отдельного согласия не требует).**
Тип источника `json` опрашивает JSON API сети датчиков: один запрос за свежими записями всех станций
(`GET https://wwcs.tj/services/airquality/stations` — массив `{stationID, siteName, latitude, longitude, altitude,
timestamp, PM25, PM10, temperature, humidity, wind_speed, wind_dir, aqi}`, время местное UTC+5 без смещения, данные
каждые 10 минут) и при первом запуске, ручной проверке или пропуске у какой‑то станции — ряд за прошедшие часы
(`…/airquality/history?hours=N`, до 72 ч, ≈ 0,35 МБ). Записи раскладываются по станциям портала по полю `stationID`
(код в источнике = код станции портала; иначе соответствие задаётся в `stations` описания полей); по каждой станции
ведётся курсор времени последней принятой записи, поэтому повторные ответы не создают дублей и не продлевают
`last_data_at` — «зависшая» станция через порог даёт письмо «нет данных». Приостановленные станции и неизвестные коды
пропускаются с пометкой в сводке (`stationInactive:suspended`, `unknownStation`). Температура и влажность из API не
принимаются (портал хранит только вещества); `aqi` сайта не используется — индекс считает портал.

1. **Станции и источник** создаёт идемпотентный скрипт: сначала `pnpm --filter @meteo/db import-wwcs -- --dry-run`,
   затем `pnpm --filter @meteo/db import-wwcs`. Создаются 9 станций (код = `stationID`, названия tg/ru/en с сайта
   airquality.meteo.tj, координаты и высота из API, регион и район по координатам через PostGIS, автоматический датчик,
   непрерывный ряд, PM2.5 и PM10 в µg/m³) и один источник `json` «WWCS airquality API» в карточке станции DYU01_ECO
   (**включён**, порог «нет данных» 60 мин, история 24 ч): worker опросит API в ближайшем цикле `station-pull`
   (каждые 10 минут и при старте) и догрузит ряд за сутки. Станция здания Агентства DYU006_ECO создаётся
   **приостановленной** (датчик выдаёт 450–575 µg/m³ при фоне 2–30 у соседей — см. описание станции); после ремонта
   датчика снимите приостановку в карточке — данные начнут приниматься со следующего цикла. Ключи: `--disabled`
   (создать источник выключенным), `--anchor КОД`, `--stale-min N`, `--history-hours N`, `--suspend A,B`, `--update`
   (обновить координаты/названия существующих), `--file stations.json` (сохранённый ответ без сети), `--no-source`.
2. **Управление источником** — карточка станции DYU01_ECO → «Источники данных» → «WWCS airquality API»: «Проверить
   сейчас» ставит внеочередной запуск (с историей за 24 ч без учёта курсоров), переключатель «Включён» останавливает
   опрос, не удаляя настройки; изменение адреса обнуляет курсоры (следующий запуск снова возьмёт историю).
3. **Проверка.** Прогон без очереди: `pnpm --filter @meteo/worker pull-source <id источника> [--force]` (итог JSON в
   stdout: `files` — запросов, `accepted`, `rejected`; `--force` перечитывает историю без учёта курсоров). В логе
   worker'а — `station-pull: json history fetched`, `json station processed` (по станции: принято/обновлено),
   `json source done`; в карточке — статус «работает» и сводка «запросов N, станций 8, принято …, отклонено …»;
   у остальных станций — блок «Автоматический приём данных» с каналом «забор данных»; публично — `/api/v1/stations`
   (уровень у 8 станций) и `/air`. Первый прогон 20.10.2026: 2 запроса, 2134 значения за 24 ч по 8 станциям за 2 с;
   повторный — 0 новых (курсор), история не запрашивается; worker выполнил задачу при старте и по расписанию.
4. **Переменные окружения не нужны**: адреса заданы в источнике, авторизации у API нет. Общие ограничения —
   `STATION_PULL_TIMEOUT_MS`, `STATION_PULL_MAX_FILE_MB`. `STATION_PULL_ALLOW_FILE_URLS=1` разрешает адреса
   `file://` для прогона маппинга на сохранённом ответе и для E2E — в продакшене не задавать.
5. **Контроль качества и устаревание.** Значения датчика DYU006_ECO лежат в диапазоне правила `range` (0–2000 µg/m³)
   и меняются от записи к записи, поэтому правила `range`/`stuck`/`spike` их не отбраковывают (для портала они
   неотличимы от пылевой бури) — отсюда приостановка станции до ремонта датчика; после ремонта снимите приостановку
   в карточке и нажмите «Проверить сейчас». «Залипание» (одно значение ≥ 12 ч подряд, для 10‑минутного ряда — 73
   точки) и одиночные скачки 10‑минутного ряда правила ловят (unit‑тесты `qc.test.ts`). Устаревание: индекс
   станции старше 6 ч → уровень «нет данных» на карте и в `/air` (так выглядит Куляб, если его датчик замолчал).
6. **Шкала US AQI (EPA)** — третья табличная шкала `US_AQI` (шесть категорий, цвета EPA, рекомендации), по умолчанию
   не публичная. Показать её посетителям: «Шкалы и пороги» → «Индекс US AQI (EPA)» → «Публичная шкала по умолчанию»
   → «Сохранить» (индекс пересчитывается, легенда и страница «Об индексе» переключатся на шесть уровней). Пороги
   EPA 2024 в единицах портала; airquality.meteo.tj использует таблицу PM2.5 2012 г. и 10‑минутные значения —
   числа могут немного отличаться (docs/02-architecture.md §6.5).

## 10. Восстановление доступа администратора и сброс 2FA

Выбирайте первый подходящий вариант:

1. **Есть другой администратор** — он в «Пользователи» выполняет «Сбросить пароль» и/или «Сбросить 2FA»; это штатный путь.
2. **Администратор один, но есть оператор/редактор** — временно повысить его до администратора в БД, он
   восстановит доступ через панель, затем вернуть роль (всё фиксируется в аудите):

   ```bash
   dc exec postgres psql -U meteo -d meteo -c "update users set role = 'admin' where email = 'operator@meteo.tj';"
   dc exec postgres psql -U meteo -d meteo -c "delete from sessions where user_id = (select id from users where email = 'operator@meteo.tj');"
   # после восстановления: update users set role = 'operator' where email = 'operator@meteo.tj';
   ```

   При первом входе новому администратору потребуется настроить 2FA.
3. **Ни один пользователь не может войти** — сброс через БД (нужен доступ к серверу):

   ```bash
   # 3а. Сброс 2FA и сессий администратора
   dc exec postgres psql -U meteo -d meteo -c "
     update users set two_factor_enabled = false where email = 'admin@meteo.tj';
     delete from two_factors where user_id = (select id from users where email = 'admin@meteo.tj');
     delete from sessions where user_id = (select id from users where email = 'admin@meteo.tj');"
   # 3б. Новый пароль: хэш считается тем же алгоритмом, что в приложении (better-auth, scrypt)
   HASH=$(dc exec -T worker node -e "import('better-auth/crypto').then(async m => process.stdout.write(await m.hashPassword(process.argv[1])))" 'Новый-пароль-12345')
   dc exec postgres psql -U meteo -d meteo -c "
     update accounts set password = '$HASH'
     where provider_id = 'credential' and user_id = (select id from users where email = 'admin@meteo.tj');"
   # 3в. Снять блокировку, если была
   dc exec postgres psql -U meteo -d meteo -c "update users set banned = false, ban_reason = null, ban_expires = null where email = 'admin@meteo.tj';"
   ```

   Войти с новым паролем, пройти настройку 2FA заново, сменить временный пароль, записать действие в журнал
   эксплуатации (в аудите приложения прямые изменения в БД не отражаются).

Не удаляйте пользователей через БД: журнал аудита хранит только ссылку по e‑mail, а связанные записи
(сессии, 2FA) удаляются каскадно только через панель.

## 11. Импорт архивов измерений

Исторические данные (CSV/XLSX Агентства) загружаются скриптом `packages/db/src/scripts/import-history.ts` по маппингу
колонок — формат, маппинг и отчёт описаны в `docs/import-history.md`. Скрипт не входит в образы: запускайте его из клона
репозитория на сервере (`pnpm install --frozen-lockfile`, Node.js 22) или с рабочей станции через SSH‑туннель к PostgreSQL:

```bash
DATABASE_URL=postgres://meteo:<пароль>@127.0.0.1:5432/meteo \
  pnpm db:import-history -- --file ~/archive/du-2023.xlsx --mapping ~/archive/mapping.json --dry-run
DATABASE_URL=… pnpm db:import-history -- --file ~/archive/du-2023.xlsx --mapping ~/archive/mapping.json
```

Повторный запуск идемпотентен; индекс за затронутые месяцы пересчитывается скриптом. Перед большим импортом —
бэкап (раздел 3.1), после — проверка страницы станции за период.

## 12. Приёмка и передача

При передаче системы Заказчику: `.env` и пароль restic переданы по акту через менеджер паролей; минимум два
администратора с настроенной 2FA; тест восстановления (3.2) выполнен на staging с записью в журнале; внешний
мониторинг `/api/healthz` настроен; DNS/TLS и почта (SPF/DKIM/DMARC) проверены письмом из «Настроек»; документация —
`docs/manuals` (HTML/PDF: `pnpm docs:build`).

## 13. Хост с несколькими приложениями и выкатка из GitHub Actions

Так развёрнут портал на VPS Hostinger KVM 4 (`46.202.155.70`, Ubuntu 26.04, 4 vCPU / 16 ГБ / 200 ГБ), домен
`havo.tj` в Cloudflare. На сервере живут и другие приложения, поэтому порты 80/443 занимает общий обратный прокси
(`/opt/edge`, `infra/edge/`), а у портала два окружения со своими базами и томами:

| Окружение | Адрес | Каталог | Проект compose | Имя в сети `edge` |
|---|---|---|---|---|
| production | `https://havo.tj` (`www` → перенаправление) | `/opt/meteo/production` | `meteo` | `meteo-prod` |
| staging | `https://staging.havo.tj` | `/opt/meteo/staging` | `meteo-staging` | `meteo-staging` |

Путь запроса: посетитель → Cloudflare (TLS, кэш, защита) → общий Caddy `edge-caddy-1` (Origin Certificate,
реальный IP клиента из `CF-Connecting-IP`) → Caddy портала (HTTP `:80` только в сети `edge`, статика тайлов,
SILAM, загрузок) → web. Режим «за общим прокси» включает `infra/compose/compose.edge.yml` поверх `compose.prod.yml`.

### 13.1. Подготовка хоста (однократно)

```bash
# из копии репозитория на сервере, от root
sh infra/deploy/setup-host.sh aminjon1065/meteo   # пользователь deploy, /usr/local/bin/meteo-deploy, /opt/meteo/*, сеть edge
sh infra/deploy/harden-host.sh                    # администратор сервера: SSH только по ключам, fail2ban, автообновления
```

`harden-host.sh` отключает вход по паролю — перед запуском проверьте вход по ключу (команда в шапке скрипта).
Межсетевой экран — в hPanel (VPS → Межсетевой экран: TCP 22, 80, 443, UDP 443): Docker публикует порты в обход ufw.

Общий прокси: содержимое `infra/edge/` → `/opt/edge` (`compose.yml`, `conf/Caddyfile`, `conf/sites/*.caddy`,
`certs/` с правами 700), затем `docker compose -f /opt/edge/compose.yml up -d`. Как подключить другое приложение —
`infra/edge/README.md`.

### 13.2. Окружения портала

`/opt/meteo/<окружение>/.env` (владелец `deploy`, права 600) — как в 1.3, плюс `EDGE_ALIAS` (имя в сети `edge`,
таблица выше) и `IMAGE_REPO`; `IMAGE_TAG` не задаётся — его ведёт выкатка. Тайлы карты кладутся в тома
`meteo_tiles` и `meteo-staging_tiles` (как в 1.5; на сервере достаточно `SKIP_ASSETS=1 ./infra/data/fetch-map-assets.sh`).

| Что | Где |
|---|---|
| Версии (только `infra/` коммита) | `releases/<sha>/`; хранятся текущая, предыдущая и ещё три |
| Текущая версия | `current` → `releases/<sha>`, тег образов — `.deploy.env` (`IMAGE_TAG`, `PREVIOUS_TAG`) |
| История и журналы выкаток | `deploy.log`, `logs/<время>-<sha>.log` (90 дней) |
| docker compose окружения | `./dc` — вместо `dc` из начала документа: `/opt/meteo/production/dc ps`, `… logs -f worker` |

### 13.3. GitHub (однократно)

1. Settings → Environments: `staging` (Deployment branches: только `main`) и `production` (Required reviewers —
   ответственные за выпуск; Deployment branches: только `main`).
2. В каждом окружении секрет `DEPLOY_SSH_KEY` — приватный ключ своей пары ed25519. Публичные ключи — в
   `/home/deploy/.ssh/authorized_keys` с принудительной командой, ключ одного окружения не выкатывает другое:

   ```
   restrict,command="/usr/local/bin/meteo-deploy staging" ssh-ed25519 AAAA… gha-meteo-staging
   restrict,command="/usr/local/bin/meteo-deploy production" ssh-ed25519 AAAA… gha-meteo-production
   ```

3. Необязательно: переменные `DEPLOY_HOST` и `DEPLOY_KNOWN_HOSTS` (значения по умолчанию — в `deploy.yml`; при
   переезде на другой сервер задать их). Пакеты `meteoportal-*` в GHCR можно оставить приватными: выкатка входит
   в реестр токеном задания.

Ротация ключа выкатки: новая пара → публичный ключ в `authorized_keys` (строка как выше) → секрет окружения →
удалить старую строку.

### 13.4. Cloudflare и TLS

- DNS: `A` для `havo.tj`, `www`, `staging` → `46.202.155.70`, проксирование включено (оранжевое облако);
  `AAAA` → `2a02:4780:41:1d30::1` — по желанию.
- SSL/TLS → Overview: **Full (strict)**; Edge Certificates: Always Use HTTPS.
- Сертификат между Cloudflare и сервером — Origin Certificate (15 лет). Ключ и CSR созданы на сервере
  (`/opt/edge/certs/havo.tj.key`, `havo.tj.csr`), ключ сервер не покидает: SSL/TLS → Origin Server → Create
  Certificate → «Use my private key and CSR» → вставить CSR, имена `havo.tj`, `*.havo.tj` → сохранить выданный
  сертификат в `/opt/edge/certs/havo.tj.pem` → `docker compose -f /opt/edge/compose.yml exec caddy caddy reload --config /etc/caddy/Caddyfile`.
- Выключить Rocket Loader и Email Address Obfuscation: они вставляют свои скрипты, которые блокирует CSP портала.
- Bot Fight Mode / WAF не должны показывать проверку логгерам станций и проверке здоровья: правило Skip для
  `/api/v1/ingest/*` и `/api/healthz` (иначе приём данных по API и внешняя проверка в GitHub Actions получают 403).
- Ограничения бесплатного тарифа: тело запроса ≤ 100 МБ (загрузки CMS, импорт CSV), ответ ≤ 100 с.

### 13.5. Выкатка, проверка, возврат

1. Push в `main` → CI (lint, typecheck, unit, E2E, Lighthouse, миграции, `pnpm audit`, Trivy) → образы
   `ghcr.io/aminjon1065/meteoportal-{web,worker,backup}:<sha>`.
2. **Deploy → staging** — сразу; **Deploy → production** — тот же образ после Review deployments → Approve.
3. На сервере `deploy.sh`: pull образов → бэкап (production) → postgres/redis → миграции → справочники →
   перезапуск → ожидание healthy и `/api/healthz` через Caddy портала и общий прокси. Если версия не поднялась —
   автоматический возврат на предыдущую (миграции не откатываются, см. раздел 2). Затем GitHub проверяет
   `https://<адрес>/api/healthz` снаружи, через Cloudflare.
4. Повторная выкатка или возврат на прежнюю версию — Actions → Deploy → Run workflow: окружение и полный SHA
   коммита `main` (его образы уже в GHCR).

Журнал GitHub Actions у публичного репозитория открыт всем, поэтому скрипт выкатки печатает только шаги, а журналы
миграций и сервисов пишет на сервер (`/opt/meteo/<окружение>/logs`). Несколько выкаток одного окружения не идут
одновременно (блокировка на сервере и `concurrency` в `deploy.yml`).

### 13.6. После первой выкатки

1. Вход `https://havo.tj/admin` администратором из `.env` окружения (`grep SEED_ADMIN /opt/meteo/production/.env`
   на сервере), настройка 2FA, второй администратор (1.7); затем удалить `SEED_ADMIN_PASSWORD` из `.env`.
2. Границы областей и районов (1.6) — с рабочей станции через SSH‑туннель к PostgreSQL окружения:

   ```bash
   PG=$(ssh root@46.202.155.70 "docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' meteo-postgres-1" | awk '{print $1}')
   ssh -N -L 15432:$PG:5432 root@46.202.155.70 &
   DATABASE_URL=postgres://meteo:<POSTGRES_PASSWORD окружения>@127.0.0.1:15432/meteo pnpm --filter @meteo/db boundaries
   kill %1
   ```

3. Пароль restic (`RESTIC_PASSWORD` из `.env` production) — в менеджер паролей; офсайт‑репозиторий — раздел 3.
