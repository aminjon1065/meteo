# Метеопортал FINTAJ

Публичный портал качества воздуха и погоды, административная панель и фоновые интеграции (SmartMet, SmartMet Alert, SILAM) для Агентства по гидрометеорологии Республики Таджикистан. Проект FINTAJ, донор — Финский метеорологический институт (FMI).

Документация: [docs/](docs/README.md) — требования, архитектура, дизайн‑система, план поставки, ADR; руководства и runbook — раздел [«Документация»](#документация) ниже.

## Стек

Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 + shadcn/ui · next-intl (tg / ru / en) · better-auth · Drizzle ORM · PostgreSQL 17 + TimescaleDB + PostGIS · Redis + BullMQ · Docker Compose + Caddy · pnpm + Turborepo · Biome.

## Структура

```
apps/web        Next.js: публичный портал, /admin, /api/v1, /embed
apps/worker     фоновые задачи (BullMQ): синхронизации, расчёт индекса, рассылки
apps/station-agent  агент станционного компьютера: один файл Node 22, отправка измерений на /api/v1/ingest
packages/core   доменная логика без I/O (RBAC, уровни, позже — индекс и QC)
packages/db     схема Drizzle, миграции, TimescaleDB/PostGIS SQL, seed
packages/i18n   локали и сообщения интерфейса
packages/ui     дизайн‑система: токены, компоненты shadcn/ui, доменные компоненты
infra/compose   docker-compose (dev) и compose.prod.yml (prod) + Caddyfile
infra/backup    скрипт резервного копирования
infra/data      fetch-map-assets.sh: экстракт тайлов Protomaps (OSM) и ассеты стиля; tiles/ — гитигнорируется
docs/           проектная документация и ADR
```

## Быстрый старт (локально)

Требования: Node.js 22, pnpm 12, Docker.

```bash
cp .env.example .env            # задайте BETTER_AUTH_SECRET (openssl rand -base64 48)
ln -s ../../.env apps/web/.env  # Next.js читает .env из папки приложения
pnpm install
pnpm infra:up                   # PostgreSQL (TimescaleDB + PostGIS) и Redis
pnpm db:migrate                 # миграции Drizzle + гипертаблицы и агрегаты
pnpm db:seed                    # справочники и первый администратор (SEED_ADMIN_*)
./infra/data/fetch-map-assets.sh # тайлы карты Таджикистана (PMTiles) и шрифты/спрайты Protomaps (~225 МБ)
pnpm dev                        # web: http://localhost:3000, worker: healthz на :3001
# или по отдельности: pnpm --filter @meteo/web dev / pnpm --filter @meteo/worker dev
```

Админка: http://localhost:3000/admin (логин из `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`). Для роли admin обязательна двухфакторная аутентификация: при первом входе откроется `/admin/two-factor` — отсканируйте QR‑код приложением‑аутентификатором и сохраните резервные коды. Пользователей создаёт администратор в `/admin/users`; проверка SMTP, адреса интеграций и брендинг — в `/admin/settings`.

## Команды

| Команда | Что делает |
|---|---|
| `pnpm dev` / `pnpm build` / `pnpm start` | через Turborepo для всех приложений |
| `pnpm lint` / `pnpm lint:fix` / `pnpm format` | Biome |
| `pnpm typecheck` / `pnpm test` | TypeScript и Vitest во всех пакетах |
| `pnpm db:generate` | сгенерировать миграцию из изменений схемы (`packages/db/drizzle`) |
| `pnpm db:migrate` / `pnpm db:seed` / `pnpm db:studio` | применить миграции, засеять, открыть Drizzle Studio |
| `pnpm --filter @meteo/i18n check:messages` | проверить полноту переводов |
| `pnpm dlx shadcn@latest add <component>` (из `apps/web`) | добавить компонент shadcn в `packages/ui` |
| `pnpm docs:build` / `pnpm docs:check` | собрать документацию в HTML/PDF (`docs/manuals/dist`) / проверить ссылки в `docs/**.md` |

## Продакшен

Один хост с Docker: `docker compose --env-file .env -f infra/compose/compose.prod.yml up -d`.
Подробности — в [docs/runbook.md](docs/runbook.md) (развёртывание, DNS/TLS/SMTP, обновление, бэкап, инциденты) и в [docs/02-architecture.md](docs/02-architecture.md) §11.

## Документация

| Документ | Для кого | Где |
|---|---|---|
| Руководство администратора (панель `/admin`) | администраторы, операторы, редакторы | [tg](docs/manuals/admin/tg.md) · [ru](docs/manuals/admin/ru.md) · [en](docs/manuals/admin/en.md) |
| Руководство пользователя портала (публичная часть, виджеты, API) | посетители, СМИ, разработчики | [tg](docs/manuals/user/tg.md) · [ru](docs/manuals/user/ru.md) · [en](docs/manuals/user/en.md) |
| Runbook (эксплуатация) | IT‑служба Агентства | [ru](docs/runbook.md) · [en](docs/runbook.en.md) |
| Обучающая сессия: план, практические задания, чек‑лист приёмки | тренер, участники | [docs/training/outline.md](docs/training/outline.md) |
| Проектная документация: требования, архитектура, дизайн‑система, план, ADR, безопасность, производительность, импорт архивов | команда разработки | [docs/README.md](docs/README.md) |

Сборка HTML и PDF (оглавление, переключатель языков, стили печати): `pnpm docs:build` → `docs/manuals/dist/index.html`;
PDF печатается через Chromium Playwright (`pnpm --filter @meteo/web exec playwright install chromium`), без него —
«Печать → Сохранить как PDF» из браузера. Проверка ссылок и якорей: `pnpm docs:check`. Скриншоты для руководств
снимаются скриптом `node docs/manuals/screenshots.mjs capture` с запущенной production‑сборки (см. шапку скрипта).
Таджикские версии — машинный черновик, требуют проверки носителем языка.

## Прогнозы (SmartMet, SILAM)

- Погода: worker забирает прогноз из SmartMet Server (плагин timeseries) каждые 15 минут. Без настроек используется песочница `https://opendata.fmi.fi` (глобальная модель ECMWF, producer `ecmwf`, без символов погоды). Для сервера Заказчика задайте `SMARTMET_URL` (и при необходимости `SMARTMET_PRODUCER`, `SMARTMET_API_KEY`).
- Качество воздуха: `silam-sync` раз в час проверяет новый прогон SILAM на THREDDS FMI (`SILAM_NCSS_URL`, `SILAM_DATASET`), качает NetCDF‑3 по bbox Таджикистана, рисует PNG‑слои в `SILAM_DIR` (по умолчанию `data/silam`; в продакшене — общий том `silam` web/worker) и считает точечные прогнозы для городов и станций.
- Символы погоды FMI SmartSymbol лежат в `apps/web/public/weather-symbols` (обновление: `infra/data/fetch-weather-symbols.sh`).
- Ручной запуск любой фоновой задачи: `pnpm --filter @meteo/worker enqueue silam-sync '{"force":true}'` (`force` также обходит circuit breaker).
- Устойчивость: запросы к SmartMet/SILAM/CAP повторяются при сбоях; после `INTEGRATION_CIRCUIT_FAILURES` неудач подряд синхронизация приостанавливается на `INTEGRATION_CIRCUIT_COOLDOWN_MIN`, администраторы (и `ADMIN_ALERT_EMAILS`) получают письмо; состояние — на дашборде админки.
- Открытые данные и API: `/data`, документация `/data/api`, спецификация `GET /api/v1/openapi.json?lang=ru`; `sitemap.xml` и `robots.txt` генерируются приложением.

## Карты (ADR-003)

Карта работает полностью на своих ресурсах: векторные тайлы `infra/data/tiles/tajikistan.pmtiles` отдаются маршрутом `/tiles/*` с поддержкой Range‑запросов (в продакшене — тем же каталогом через Caddy), шрифты и спрайты стиля Protomaps лежат в `apps/web/public/basemaps`, worker MapLibre копируется в `apps/web/public/maplibre` при `pnpm dev`/`pnpm build`. Переменные: `TILES_DIR` (каталог тайлов), `IMPORTS_DIR` (временные файлы импорта CSV).

## Соглашения

- Все пользовательские строки — через next-intl на трёх языках; CI проверяет полноту ключей.
- Время в БД — UTC; отображение — Asia/Dushanbe.
- Изменения схемы — только через миграции Drizzle; объекты TimescaleDB/PostGIS — в `packages/db/sql/*.sql` (идемпотентно).
- Права проверяются на сервере через `can(role, permission)` из `@meteo/core`.
