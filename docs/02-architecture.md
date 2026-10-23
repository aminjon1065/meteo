# 02. Архитектура и системный дизайн

## 1. Принципы

1. **Один стек, один язык.** TypeScript end‑to‑end (портал, админка, фоновые задачи, домен). Команда маленькая, срок 10 недель, после сдачи сопровождает IT‑служба Агентства — чем меньше технологий, тем лучше.
2. **Деградация, а не падение.** Все внешние источники (SmartMet, CAP, SILAM, SMTP) — через фоновую синхронизацию в нашу БД. Публичный портал читает только свою БД/кэш и всегда отвечает.
3. **Таблицы вместо хардкода.** Шкалы индекса, ПДК, пороги уведомлений, мед. рекомендации, точки прогноза, регионы — данные, редактируемые в админке, а не константы в коде.
4. **Самодостаточность.** Тайлы карт, шрифты, иконки, границы — хостятся у нас. Ни один внешний сервис не нужен для отображения страницы.
5. **Передаваемость.** Один `docker compose up`, миграции при старте, runbook, CI с тестами, понятная структура монорепозитория.

## 2. Стек (версии на октябрь 2026)

| Слой | Выбор | Версия | Зачем |
|---|---|---|---|
| Runtime | Node.js LTS | 22.x | LTS до 2027, нативный fetch, стабильность |
| Язык | TypeScript | 7.x (fallback 6.x при проблемах тулинга) | Типобезопасность домена и API |
| Веб‑фреймворк | Next.js (App Router, Turbopack) | 16.4 | SSR/ISR для SEO и скорости, Server Components, Route Handlers для API, `proxy.ts` для защиты `/admin` |
| UI | React | 19.3 | Стандарт для Next |
| Стили | Tailwind CSS v4 + shadcn/ui (на Base UI, пресет base‑nova) | 4.3 / shadcn 4.21 | Дизайн‑токены через CSS‑переменные, доступные примитивы; композиция через `render`‑prop |
| i18n | next-intl | 4.x | Локализованные маршруты, форматирование чисел/дат, типизированные ключи |
| Карты | MapLibre GL JS + react-map-gl + PMTiles | 6.14 / 8.x / 4.x | Векторные карты без внешних сервисов; кластеризация GeoJSON встроена |
| Графики | Apache ECharts (`echarts/core`, tree‑shaken) | 6.1 | Большие ряды, dataZoom, цветовые полосы уровней, экспорт PNG, i18n |
| БД | PostgreSQL 17 + TimescaleDB 2.x + PostGIS 3.5 | образ `timescale/timescaledb-ha:pg17` | Гипертаблицы для измерений, continuous aggregates (час/день/месяц), сжатие; геометрии станций и границ |
| ORM | Drizzle ORM + drizzle-kit (стабильная ветка 0.45; переход на 1.0 после стабильного релиза) | 0.45 | SQL‑first, кастомные миграции для Timescale/PostGIS, лёгкий рантайм |
| Очереди/кэш | Redis 7 + BullMQ + croner | 6.x | Расписания синхронизаций, повторные попытки, rate limiting, кэш |
| Аутентификация | better-auth (email/password, admin‑плагин с ролями, 2FA TOTP, rate limit) | 1.7 | Стабильно, Drizzle‑адаптер, без OAuth‑зависимостей; самостоятельная регистрация отключена |
| Валидация | Zod | 4.x | Схемы форм, API, env |
| Формы/таблицы | react-hook-form, TanStack Table/Query | — | Админка |
| Редактор | TipTap (ProseMirror) | 3.x | Трёхъязычные новости, изображения |
| E‑mail | Nodemailer (SMTP) + React Email | 10 / 1.x | Рассылки, уведомления, шаблоны на 3 языках |
| XML/CSV | fast-xml-parser, papaparse | 5.x | CAP 1.2, импорт/экспорт |
| Изображения | sharp | 0.35 | Перекодирование загрузок, OG‑картинки |
| Логи | pino | 10 | Структурированные JSON‑логи |
| Тесты | Vitest, Playwright (+ axe), Testcontainers | 5 / 1.64 | Unit, e2e, интеграция с Postgres |
| Монорепо | pnpm workspaces + Turborepo + Biome | 12 / 2.11 / 2.4 | Общие пакеты `core`, `db`, `ui`, `i18n`; политика `minimumReleaseAge` 24 ч против атак на цепочку поставок |
| Инфраструктура | Docker Compose, Caddy 2 (TLS авто), restic (бэкапы) | — | Один хост, воспроизводимость |
| CI/CD | GitHub Actions → GHCR → деплой по SSH (`compose pull && up -d`) | — | Lint, typecheck, тесты, сборка образов, Trivy‑скан |

Обоснования альтернатив — в [adr/](adr/).

## 3. Компоненты системы

```
                 Интернет                                   Внутренняя сеть Агентства / FMI
 ┌──────────────┐   HTTPS   ┌──────────────────────────────────────────────────────────────┐
 │ Пользователи │──────────▶│ caddy (TLS, gzip/br, static: PMTiles, SILAM PNG, uploads)      │
 │ meteo.tj     │  виджеты  └──────┬───────────────────────────────────────┬───────────────┘
 └──────────────┘                  │                                       │
                                   ▼                                       ▼
                     ┌─────────────────────────┐             ┌──────────────────────────┐
                     │ web (Next.js 16)        │             │ worker (Node, BullMQ)    │
                     │ • публичный портал      │   Redis     │ • smartmet-sync (15 мин) │
                     │ • /admin (RBAC)         │◀──────────▶ │ • cap-sync (2–5 мин)     │
                     │ • /api/v1 JSON, /embed  │   очереди,  │ • silam-sync (ежедневно) │
                     │ • server actions        │   кэш       │ • index-compute, qc-batch│
                     └──────────┬──────────────┘             │ • threshold-eval, mailer │
                                │                            │ • newsletter-send        │
                                ▼                            └──────────┬───────────────┘
                     ┌─────────────────────────┐                        │
                     │ postgres 17             │◀───────────────────────┘
                     │ TimescaleDB + PostGIS   │
                     └─────────────────────────┘
                                                             ▲ HTTP              ▲ HTTP/NCSS           ▲ SMTP
                                                             │                   │                     │
                                              ┌──────────────┴───┐  ┌────────────┴─────────┐  ┌────────┴──────┐
                                              │ SmartMet Server  │  │ SILAM THREDDS (FMI)  │  │ Почтовый      │
                                              │ (timeseries, WMS)│  │ или S3 open data     │  │ сервер        │
                                              │ SmartMet Alert   │  └──────────────────────┘  └───────────────┘
                                              │ (CAP feed)       │
                                              └──────────────────┘
```

| Компонент | Ответственность | Масштаб |
|---|---|---|
| `web` | SSR‑портал, админка, публичный JSON API `/api/v1`, встраиваемые виджеты `/embed/*`, server actions для мутаций | 1–2 реплики за Caddy |
| `worker` | Все периодические и фоновые задачи; идемпотентные, с ретраями и алертами о сбоях | 1 реплика |
| `migrate` | Одноразовый сервис: `drizzle-kit migrate` + seed справочников при деплое | — |
| `postgres` | Данные; гипертаблица измерений; агрегаты; геометрии | 1 инстанс, ежедневные бэкапы |
| `redis` | BullMQ, кэш ответов API (TTL 60 с), rate limiting, сессии better-auth (опционально) | 1 инстанс |
| `caddy` | TLS (Let's Encrypt), security headers, сжатие, статика с range‑запросами (PMTiles), проксирование | 1 |
| `backup` | Ночной `pg_dump` + тома (uploads, silam) → restic в локальное хранилище + офсайт (S3‑совместимое) | cron |
| внешние | SmartMet Server/Alert (FMI/Агентство), SILAM THREDDS/S3 (FMI), SMTP (Агентство) | — |

Среды: `local` (compose, seed‑данные), `staging` (сервер Заказчика или VPS, тот же compose, другой `.env`), `production`.

## 4. Структура монорепозитория

```
meteo/
├── apps/
│   ├── web/                 # Next.js: src/app/[locale]/(public)/…, src/app/[locale]/admin/…, src/app/api/…, src/proxy.ts
│   └── worker/              # BullMQ worker + Job Schedulers; сборка esbuild (dist/index.js, migrate.js, seed.js)
├── packages/
│   ├── core/                # Доменная логика без I/O: authz (RBAC), levels; далее — aqi, qc, cap, smartmet, silam
│   ├── db/                  # Drizzle‑схема, drizzle/ (миграции), sql/ (TimescaleDB/PostGIS, идемпотентно), seed
│   ├── ui/                  # Дизайн‑система: tokens.css, globals.css, компоненты shadcn (Base UI), доменные компоненты
│   └── i18n/                # locales, messages/{tg,ru,en}.json, pick() для jsonb‑переводов, проверка полноты ключей
├── infra/
│   ├── compose/             # docker-compose.yml (dev), compose.prod.yml (prod), Caddyfile
│   ├── backup/              # run.sh: pg_dump + архив загрузок, ротация
│   └── data/                # сборка PMTiles‑экстракта, границы, символы погоды (неделя 2+)
├── docs/                    # эта документация, руководства (tg/ru/en), runbook, ADR
├── .github/workflows/       # ci.yml: lint, i18n‑check, typecheck, test, build; миграции на TimescaleDB; образы в GHCR; deploy.yml: выкатка по SSH
├── biome.json, turbo.json, tsconfig.base.json, pnpm-workspace.yaml, .env.example
```

## 5. Модель данных

Соглашения: время — `timestamptz` в UTC; справочные названия и CMS‑контент — `jsonb` вида `{"tg": "...", "ru": "...", "en": "..."}` с фолбэком tg → ru → en (slug новости общий для всех языков); геометрии — PostGIS (SRID 4326).

### 5.1. География и станции

| Таблица | Ключевые поля |
|---|---|
| `regions` | `id`, `code`, `name jsonb`, `geom MultiPolygon`, `centroid` |
| `districts` | `id`, `region_id`, `code`, `name jsonb`, `geom` |
| `stations` | `id`, `code` (уникальный), `slug`, `name jsonb`, `kind` (air / meteo / combined), `geom Point`, `elevation_m`, `region_id`, `district_id`, `status` (active / suspended / decommissioned), `commissioned_at`, `decommissioned_at`, `data_source` (manual / import / api / sensor), `sampling` (continuous / discrete), `description jsonb`, `photo`, `api_key_hash` (для автоматической отправки), `created_at`, `updated_at` |
| `station_pollutants` | `station_id`, `pollutant_id`, `unit`, `active` — что именно измеряет станция |
| `forecast_locations` | `id`, `slug`, `name jsonb`, `geom Point`, `region_id`, `kind` (city / district / station), `smartmet_place`, `order`, `featured` — точки, для которых забираем прогноз SmartMet и SILAM |
| `warning_regions` | `id`, `code` (как в SmartMet Alert), `name jsonb`, `geom` — регионы предупреждений CAP |

### 5.2. Измерения (TimescaleDB)

```sql
create table measurements (
  time           timestamptz      not null,
  station_id     integer          not null references stations(id),
  pollutant_id   smallint         not null references pollutants(id),
  averaging_min  smallint         not null default 60,  -- 20 = разовая проба, 60 = час, 1440 = сутки
  value          double precision,                      -- нормализовано: µg/m³ (CO — mg/m³)
  original_value double precision,                      -- до ручной коррекции
  qc_flag        smallint         not null default 0,   -- 0 raw, 1 valid, 2 suspect, 3 invalid, 4 corrected, 5 missing
  qc_reason      text,
  source         smallint         not null,             -- 1 manual, 2 import, 3 api, 4 sensor
  batch_id       uuid,
  created_by     integer, updated_by integer,
  created_at     timestamptz default now(), updated_at timestamptz default now(),
  primary key (time, station_id, pollutant_id, averaging_min)
);
select create_hypertable('measurements', 'time', chunk_time_interval => interval '1 month');
alter table measurements set (timescaledb.compress, timescaledb.compress_segmentby = 'station_id, pollutant_id');
select add_compression_policy('measurements', interval '3 months');
-- continuous aggregates (только qc_flag in (1,4)): measurements_hourly, measurements_daily, measurements_monthly
-- поля: avg, min, max, count, последний qc
```

| Таблица | Назначение |
|---|---|
| `pollutants` | `id`, `code` (seed: PM25, PM10, NO2, SO2, CO, O3 + вещества бюллетеней Агентства NO, CH2O, C6H5OH, HF, TSP, CO2 (ppm), TVOC (ppb)), `name jsonb` (терминология Агентства: зарачаҳои 10 мкр., дуоксиди нитроген, фториди гидроген …), `unit`, `decimals`, `order`, `molar_mass` (для конверсии ppb ↔ µg/m³), `hazard_class` |
| `station_index` | `time`, `station_id`, `scale_id`, `value`, `level` (1–5), `dominant_pollutant_id`, `sub_indices jsonb` — предрассчитанный индекс станции по каждой шкале (час); `indicators jsonb` (только шкала `RATIO_TO_LIMIT`) — показатели методики Агентства: `no2so2Sum`, `maxSingle` {id → {value, ratio}}, `highPollution`, `extremeHighPollution`, `flagged` (миграция 0008) |
| `index_scales` | `id`, `code` (NATIONAL_OPERATIONAL, IZA, WHO), `name jsonb`, `kind` (breakpoints / ratio_to_limit / iza), `levels jsonb` (цвет, подписи), `is_default_public` |
| `index_breakpoints` | `scale_id`, `pollutant_id`, `level`, `lo`, `hi`, `averaging_min` — табличные пороги |
| `limit_values` | `pollutant_id`, `kind` (daily / max_single / annual), `value`, `source` — ПДК для ИЗА и «кратности ПДК»; seed — таблица норм ежедневного бюллетеня Агентства (`source` = «ПДК Агентства по гидрометеорологии (бюллетень от 19.10.2026)»), правки администратора — `source` = `admin:<email>` и не перезаписываются seed/миграциями |
| `health_advice` | `scale_id`, `level`, `audience` (general / children / pregnant / elderly / respiratory / cardio), `text jsonb` (tg/ru/en, markdown) |
| `qc_rules` | `pollutant_id`, `rule` (range / spike / stuck / mad_outlier), `params jsonb`, `enabled` |
| `import_batches` | `id`, `station_id`, `file`, `rows_total`, `rows_ok`, `rows_rejected`, `report jsonb`, `status`, `created_by` |

### 5.3. Уведомления и подписки (реализовано, неделя 4)

Правила (`alert_rules`): концентрация вещества со скользящим средним 1/8/24 ч или уровень индекса по шкале; область действия — все станции / станция / область; каналы — портал и e‑mail; пауза `cooldown_min`. Задача worker `threshold-eval` каждые 10 минут открывает `alert_events` по последнему доступному часу данных (не старше 6 ч), обновляет пик, закрывает при возврате ниже порога и ставит письма подписчикам в `email_outbox` (dedup по событию и подписчику). Портальный канал — баннер на главной и странице станции, `GET /api/v1/exceedances`. Подписка — двойное подтверждение (`/subscribe` → письмо с токеном → `/subscribe/confirm`), отписка по токену из каждого письма; письма отправляет задача `mailer` через SMTP (`SMTP_URL`), без него — в лог (режим разработки).

| Таблица | Поля |
|---|---|
| `alert_rules` | `id`, `name`, `scope` (all / station / region), `station_id`, `region_id`, `pollutant_id` или `scale_id`, `comparator`, `threshold`, `averaging_min`, `min_duration_min`, `cooldown_min`, `channels` (portal, email), `enabled` |
| `alert_events` | `id`, `rule_id`, `station_id`, `started_at`, `ended_at`, `peak_value`, `level`, `status` (active / resolved), `notified_at` |
| `subscribers` | `id`, `email`, `locale`, `status` (pending / confirmed / unsubscribed), `confirm_token`, `unsubscribe_token`, `topics jsonb` (станции/регионы, newsletter), `created_at` |
| `email_outbox` | `id`, `to`, `template`, `payload jsonb`, `status`, `attempts`, `sent_at`, `error` — исходящая очередь с идемпотентностью |

### 5.4. Прогнозы и внешние данные

| Таблица | Поля |
|---|---|
| `forecast_runs` | `id`, `provider` (smartmet / silam), `producer`, `origin_time`, `fetched_at`, `status` |
| `forecast_points` | `run_id`, `location_id`, `time`, `params jsonb` (температура, ветер, осадки, символ, …) — SmartMet |
| `silam_point_forecast` | `run_id`, `location_id`/`station_id`, `time`, `pollutant_id`, `value`, `level` |
| `silam_fields` | `run_id`, `pollutant_id`, `time`, `png_path`, `bounds`, `stats jsonb` — карта растровых слоёв |
| `cap_alerts` | `identifier` (уникален с `sent`), `sender`, `sent`, `status`, `msg_type`, `scope`, `source`, `note`, `refs` (строка `<references>`), `superseded_by`, `source_url`, `raw_xml`, `received_at` (реализовано, неделя 6) |
| `cap_infos` | `alert_id`, `language`, `locale` (tg/ru/en), `categories jsonb`, `event`, `response_types`, `urgency`, `severity`, `certainty`, `event_codes`, `effective`, `onset`, `expires`, `headline`, `description`, `instruction`, `web`, `contact`, `parameters jsonb`; индексы по `expires` и `event` |
| `cap_areas` | `info_id`, `area_desc`, `geom` (polygon/circle), `warning_region_id` (geocode → `warning_regions`, иначе по пересечению), `geocodes jsonb`, `altitude`, `ceiling`; GiST по `geom` |
| `cap_event_translations` | `event` (как в CAP, уникален), `name jsonb` — словарь переводов типов событий |

### 5.5. Контент и администрирование

| Таблица | Поля |
|---|---|
| `news_posts` | `id`, `slug` (один на все языки), `category_id`, `title/excerpt/body jsonb` (tg/ru/en; `body` — Markdown), `cover_id` → `media`, `status` (draft / published / archived), `published_at` (будущая дата — отложенная публикация), `pinned`, `author_id`, `updated_by` (реализовано, неделя 6; вместо TipTap — Markdown с предпросмотром и собственным безопасным рендерером `packages/core/src/markdown.ts`) |
| `news_categories` | `id`, `slug`, `name jsonb`, `sort_order` |
| `bulletins` | `id`, `subject jsonb`, `body jsonb` (Markdown), `post_id`, `status` (draft / queued / sent), `queued_at`, `sent_at`, `recipients`, `created_by` — письма ставятся в `email_outbox` (dedup `bulletin:{id}:{subscriber}`), шаблон `bulletin` у задачи `mailer` |
| `eco_bulletins` | `id`, `date` (местные сутки), `station_id` (станция бюллетеня города), `status` (draft / published), `data jsonb` (снимок расчёта: таблица станции, сводка по городам, суммация, превышения, ВЗ/ЭВЗ), `gamma` (γ‑фон — ручной ввод), `generated_by` (manual / scheduler), `files jsonb` (сохранённые DOCX/PDF), `post_id` → `news_posts`, `mail_bulletin_id` → `bulletins`, `published_at/by`, `notified_at`, `created_by`, `updated_by`; уникально по (`date`, `station_id`) — реализовано 20.10.2026, см. §13 |
| `media` | `id`, `path` (внутри `UPLOADS_DIR`, `{ГГГГ}/{ММ}/{uuid}.{ext}`), `original_name`, `mime` (по сигнатуре файла: PNG/JPEG/WebP/GIF/PDF, до 10 МБ), `size`, `width`, `height`, `alt jsonb`, `uploaded_by`; раздача `/uploads/*` (web‑роут, в продакшене Caddy) |
| `users` / `sessions` / `accounts` / `two_factors` | better-auth (плагины admin и twoFactor); `users.role` ∈ {admin, operator, editor}, `locale`, `banned`/`ban_reason`/`ban_expires`, `two_factor_enabled`; `two_factors` — секрет TOTP и резервные коды (реализовано, неделя 7: `/admin/users` — создание, роль, пароль, блокировка, завершение сессий, сброс 2FA, удаление; `/admin/two-factor` — включение TOTP с QR и резервными кодами) |
| `audit_log` | `id`, `at`, `actor_id` (без внешнего ключа — миграция 0005: удаление пользователя не трогает журнал, e‑mail хранится в `actor_email`), `actor_role`, `action`, `entity`, `entity_id`, `before jsonb`, `after jsonb`, `ip`, `user_agent`, `request_id` — append‑only (триггер запрещает UPDATE/DELETE) |
| `settings` | `key`, `value jsonb`, `updated_by` — ключи (реализовано, неделя 7): `branding` (название, организация, контакты, строка подвала — tg/ru/en; читают шапка, подвал, «О портале», кэш 60 с), `smtp.lastTest` (последняя проверка SMTP: id письма в `email_outbox`, адрес, кто и когда), `integration.{smartmet,silam,cap}` (состояние устойчивости: статус последнего запуска, серия сбоев, circuit breaker, отправленные уведомления — пишет worker), `cap.sync` (ETag/статус cap-sync), `worker.heartbeat`, `site`. Адреса интеграций и SMTP задаются только окружением и в админке показываются для чтения |

## 6. Движок индекса качества воздуха (`packages/core/aqi`)

Чистые функции без I/O, табличные входы, 100 % покрытие тестами на граничных значениях.

### 6.1. Оперативный пятиуровневый индекс (основной публичный)

- Вход: часовые значения (или последняя проба) по каждому веществу; таблица порогов `index_breakpoints`.
- Под‑индекс вещества = уровень 1–5 по интервалу; индекс станции = **максимум** под‑индексов; «доминирующее вещество» = аргмакс.
- Значения по умолчанию (seed) — пороги финского индекса FMI/HSY (µg/m³, часовые): 

| Уровень | Цвет | PM2.5 | PM10 | NO2 | SO2 | O3 | CO (8 ч, mg/m³) |
|---|---|---|---|---|---|---|---|
| 1 Хороший | зелёный | < 10 | < 20 | < 40 | < 20 | < 60 | < 4 |
| 2 Удовлетворительный | жёлтый | 10–25 | 20–50 | 40–70 | 20–80 | 60–100 | 4–8 |
| 3 Умеренный | оранжевый | 25–50 | 50–100 | 70–150 | 80–250 | 100–140 | 8–20 |
| 4 Плохой | красный | 50–75 | 100–200 | 150–200 | 250–350 | 140–180 | 20–30 |
| 5 Очень плохой | фиолетовый | > 75 | > 200 | > 200 | > 350 | > 180 | > 30 |

Пороги CO и адаптация под национальные нормы — на согласование с Заказчиком (D6).

### 6.2. Национальный индекс (ИЗА, кратность ПДК) — методика подтверждена бюллетенями Агентства (19.10.2026)

- `ratio_to_limit` (seed: шкала `RATIO_TO_LIMIT`, включена, не публичная по умолчанию): q / ПДК — «кратность ПДК», уровни 1–5 по интервалам кратности (≤1, 1–2, 2–3, 3–5, >5 — настраивается). Как в ежедневных бюллетенях Агентства: среднесуточная концентрация (скользящие 24 ч, полнота ≥ 25 %) к ПДКс.с.; максимальная разовая (максимум часовых значений за те же 24 ч) к ПДКм.р. Дополнительно в `station_index.indicators` (`computeAgencyIndicators` в `packages/core/src/aqi.ts`): **суммация NO₂+SO₂** — сумма кратностей ПДКс.с. (есть, когда станция измеряет оба вещества), **ВЗ** — ≥ 10 ПДКм.р. хотя бы по одному веществу, **ЭВЗ** — ≥ 50 ПДКм.р., `flagged` — вещества со случаями. Показываются на странице станции (карточка «Кратность ПДК по методике Агентства») и в `GET /api/v1/index/current?scale=RATIO_TO_LIMIT` (поле `indicators`). Сравнение с предыдущим днём и форму 4а портал не воспроизводит — динамику даёт график.
- Единицы отображения: концентрации хранятся в единице вещества (µg/m³; CO — mg/m³; CO₂ — ppm; ЛОС — ppb), на выводе переводятся в единицу из настройки администратора `settings.display.concentrationUnit` (`native` по умолчанию или `mg/m³` как в бюллетенях; при переводе µg → mg точность +3 знака). Применяется на страницах станций, главной, виджете, `/air/index`, в API (`unit`, `units`) и CSV; `packages/core/src/units.ts` (`displayScaleFor`, `toDisplayValue`).
- `iza`: комплексный ИЗА по РД 52.04.186‑89: `ИЗА = Σ (q̄ᵢ / ПДКсс,ᵢ)^Cᵢ`, где `Cᵢ` зависит от класса опасности (1 кл. — 1,7; 2 кл. — 1,3; 3 кл. — 1,0; 4 кл. — 0,9); ИЗА₅ — по пяти веществам с наибольшим вкладом; градации: низкий < 5, повышенный 5–6, высокий 7–13, очень высокий ≥ 14. Считается по среднемесячным значениям (а также справочно по суткам/неделям с пометкой).
- Seed ПДК — таблица норм ежедневного бюллетеня Агентства (ПДКс.с. / ПДКм.р., мг/м³): CO 3 / 5; SO2 0,05 / 0,5; NO 0,06 / 0,4 (в таджикской версии ПДКс.с. 0,07 — уточнить); NO2 0,04 / 0,085; O3 0,03 / 0,16; PM10 0,06 / 0,3; PM2.5 0,035 / 0,16; CH2O 0,003 / 0,035; фенол 0,003 / 0,01; HF 0,005 / 0,02; взвешенные частицы (пыль, TSP) 0,15 / 0,5 (ГН); ЛОС (TVOC) 300 / 900 ppb; CO₂ — без норматива. Классы опасности: NO 3, CH2O 2, фенол 2, HF 2, пыль 3. Миграция `0008_agency_limits` правит ПДКм.р. NO2 (200 → 85 µg/m³) и подпись источника только у строк с источником seed по умолчанию; названия PM/NO₂/SO₂ приводятся к терминологии Агентства.

### 6.3. Шкала по рекомендациям ВОЗ (опциональная)

Пять уровней на основе AQG‑2021 и промежуточных целей (24‑часовые): PM2.5 ≤ 15 / 15–25 / 25–37,5 / 37,5–75 / > 75; PM10 ≤ 45 / 45–75 / 75–100 / 100–150 / > 150; NO2 ≤ 25 / 25–50 / 50–120 / 120–200 / > 200; SO2 ≤ 40 / 40–125 / 125–250 / 250–350 / > 350; O3 (8 ч) ≤ 100 / 100–120 / 120–160 / 160–240 / > 240; CO (24 ч) ≤ 4 / 4–7 / 7–10 / 10–20 / > 20 mg/m³. Интервалы кроме PM2.5/PM10 — черновик для экспертов.

### 6.4. Расчёт и хранение (реализовано, неделя 3)

Чистый движок — `packages/core/src/aqi.ts` (`computeBreakpointIndex`, `computeRatioIndex`, `computeIza`, `windowMean`; интервалы полуоткрытые [lo, hi), непрерывный индекс = уровень + доля внутри интервала). Оркестрация — `packages/db/src/services/station-index.ts`: часовые средние из сырых валидных измерений (без лага continuous aggregate), скользящие окна по `averaging_min` каждого вещества (60 / 480 / 1440 мин, минимальная полнота 25 %), upsert в `station_index`; ИЗА — по среднемесячным в местном времени, строка с временем начала месяца. Запуск: задача worker `index-compute` каждые 10 минут за 48 часов (при старте — за 30 дней) и синхронно из server actions после ручного ввода и импорта (только затронутые станции и часы). Чтение: `getCurrentIndexes()` — последний индекс по шкале, старше 6 часов считается устаревшим (уровень 0 на карте и в карточках).

### 6.5. Шкала US AQI (EPA) и шестой уровень (реализовано 20.10.2026)

Третья интервальная шкала `US_AQI` (seed; `is_default_public = false`, включается и назначается публичной в админке «Шкалы и пороги») — для преемственности с airquality.meteo.tj. Шесть категорий EPA 0–50 / 51–100 / 101–150 / 151–200 / 201–300 / 301–500 с цветами EPA и подписями tg/ru/en в `index_scales.levels` (`lo`/`hi` — границы AQI для справки); пороги EPA 2024 в единицах портала: PM2.5 (24 ч) 0 / 9,1 / 35,5 / 55,5 / 125,5 / 225,5 и PM10 (24 ч) 0 / 55 / 155 / 255 / 355 / 425 µg/m³; O3 (8 ч) 0 / 108 / 139 / 169 / 208 / 393, NO2 (1 ч) 0 / 102 / 190 / 679 / 1223 / 2352, SO2 (1 ч) 0 / 94 / 199 / 487 / 799 / 1585 µg/m³ (ppb → µg/m³ при 25 °C); CO (8 ч) 0 / 5,2 / 10,9 / 14,3 / 17,8 / 34,9 mg/m³. Значение индекса — как у остальных интервальных шкал (уровень + доля внутри интервала); число AQI 0–500 не вычисляется. Рекомендации EPA по категориям (общее население) — в `health_advice`. Для шести уровней расширены `AQ_LEVELS`/`AqLevel` (1–6, `AQ_LEVEL_MAX`, `clampAqLevel`; `AQ_LEVELS_FIVE` — легенда по умолчанию), токены `--aq-6` (бордовый #7E0023), `AqBadge`, легенда и таблица порогов на «Об индексе» (уровни публичной шкалы), редактор шкалы (столбцов границ столько, сколько уровней; ошибка `allLevels`), OpenAPI (`level` 0–6), сообщения `levels.6`. Отличие от airquality.meteo.tj: сайт применяет таблицу PM2.5 2012 г. (12,0 / 35,4 / 55,4 / 150,4 / 250,4) к 10‑минутным значениям, портал — таблицу 2024 г. к среднему за 24 ч, поэтому числа и категории могут немного отличаться; пороги редактируются в админке.

## 7. Контроль качества данных (`packages/core/qc`)

| Правило | Логика | Результат |
|---|---|---|
| `range` | значение вне физически возможного диапазона (PM2.5: 0–2000; отрицательные; NaN) | `invalid` |
| `future_time` / `duplicate` | время в будущем; дубликат ключа | отклонение при вводе |
| `spike` | скачок > N × медианного абсолютного отклонения за 24 ч | `suspect` |
| `stuck` | одно и то же значение > 12 ч подряд (только непрерывные станции) | `suspect` |
| `mad_outlier` | \|z\| > 5 относительно скользящего окна 30 дней той же станции/вещества/часа суток | `suspect` |
| `unit_sanity` | ppb/ppm → µg/m³ по молярной массе и стандартным T/P при импорте | нормализация |

Поток (реализовано, неделя 4): ввод/импорт → правило диапазона сразу (`valid`/`invalid`) → задача worker `qc-batch` каждые 15 минут за 48 часов (скачки по MAD соседей, «залипание» для непрерывных станций, выбросы относительно 30‑дневной медианы/MAD станции; правила и параметры — в `qc_rules`) → очередь QC в админке (`/admin/measurements/qc`, контекст «до → после») → решение оператора: подтвердить / скорректировать (хранится `original_value`) / отклонить; решение ставит `qc_locked`, пишется в `audit_log`, индекс станции пересчитывается. Публика и агрегаты видят только `valid` и `corrected`.

## 8. Интеграции

Устойчивость (реализовано, неделя 7; `packages/core/src/resilience.ts` — чистая логика с тестами, `apps/worker/src/resilience.ts` — I/O): HTTP‑запросы `smartmet-sync`, `silam-sync` и `cap-sync` идут через `fetchWithRetry` (повторы при сетевых ошибках, таймаутах и статусах 408/425/429/5xx с экспоненциальной задержкой и джиттером); каждый запуск выполняется под `runIntegration`: после `INTEGRATION_CIRCUIT_FAILURES` (3) неудачных запусков подряд цепь размыкается на `INTEGRATION_CIRCUIT_COOLDOWN_MIN` (30 мин, удваивается при повторных сбоях до `INTEGRATION_CIRCUIT_MAX_COOLDOWN_MIN` = 4 ч), запуски по расписанию пропускаются, затем одна пробная попытка (half‑open); ручной запуск с `force: true` цепь игнорирует. Сбой пробрасывается как `UnrecoverableError` BullMQ (без повторов задачи — следующая попытка по расписанию). Состояние (`status`, `consecutiveFailures`, `circuit`, `lastError`, `source` без учётных данных, сводка успешного запуска) хранится в `settings.integration.<name>` и показывается на дашборде админки. При `INTEGRATION_ALERT_FAILURES` (3) сбоях подряд всем активным администраторам (плюс `ADMIN_ALERT_EMAILS`) ставится письмо шаблона `integration` (одно на серию, `dedup_key`), при восстановлении — письмо о восстановлении. Портал при любом сбое показывает последние данные с пометкой «устарело» (станции > 6 ч, SmartMet > 3 ч, SILAM > 36 ч, CAP > 30 мин).

### 8.1. SmartMet Server (M2) — реализовано (неделя 5)

- Протокол: HTTP, плагин **timeseries** (`packages/core/src/smartmet.ts` — построение запросов и разбор ответа, чистые функции с тестами). Часовой ряд: `GET {SMARTMET_URL}/timeseries?producer=…&latlon={lat},{lon}&param=time,origintime,Temperature,WindSpeedMS,WindDirection,WindUMS,WindVMS,WindGust,Humidity,Pressure,DewPoint,Precipitation1h,TotalCloudCover,SmartSymbol,WeatherSymbol3&timestep=60&timesteps=72&starttime={текущий час}&format=json&tz=UTC`. Суточные агрегаты одним запросом: `max_t/min_t(Temperature/0h/24h)`, `sum_t(Precipitation1h/0h/24h)`, `max_t(WindSpeedMS/0h/24h)`, `mean_t(TotalCloudCover/0h/24h)`, `max_t(SmartSymbol/9h/15h)` с `timestep=1440` от местной полуночи.
- Фолбэки разбора: ветер из компонент U/V, если `WindSpeedMS/WindDirection` пусты; символ погоды — `SmartSymbol` → `WeatherSymbol3` (таблица соответствия) → вывод из осадков/облачности (`deriveSymbol`); ночной вариант (+100) по местному часу. На песочнице `opendata.fmi.fi` (producer `ecmwf`) доступны только T, RH, P, осадки и ветер — символы остаются пустыми (нейтральная иконка); на сервере Заказчика SmartSymbol приходит от сервера.
- Задача `smartmet-sync` каждые 15 мин (и при старте): все активные `forecast_locations` → `forecast_points` (upsert по точке/времени/шагу) + строка `forecast_runs` (ok/partial/failed, `meta` с ошибками по точкам); параллелизм 3, таймаут 10 с, ретраи BullMQ; точки старше 48 ч и записи о запусках старше 7 дней удаляются. Конфигурация: `SMARTMET_URL`, `SMARTMET_PRODUCER` (для opendata по умолчанию `ecmwf`), `SMARTMET_API_KEY`, `SMARTMET_HOURLY_STEPS`, `SMARTMET_DAILY_DAYS`. Статус — на дашборде админки («Интеграции»).
- Символы погоды: набор FMI SmartSymbol (MIT), 90 SVG light/dark в `apps/web/public/weather-symbols` (`infra/data/fetch-weather-symbols.sh`); ключи переводов `weatherSymbols.*` (tg/ru/en), `packages/core/src/weather-symbols.ts`.
- Портал: `/weather` (карточки крупных городов + список остальных), `/weather/{slug}` (сейчас, лента 24 ч, график ECharts температура+осадки на 72 ч, таблица на 9–10 дней, блок прогноза SILAM), карточка «Погода сегодня» на главной. Сводка «сегодня» считается из суточной точки провайдера, а при её отсутствии (начало ряда позже полуночи) — из часовых точек текущих суток.
- Вывод на meteo.tj: `GET /api/v1/forecast/{slug}?hours=&days=` (JSON, CORS, кэш 5 мин) и `/embed/forecast?location=dushanbe&lang=tg` (iframe‑виджет; `lang` переключает локаль, для `/embed/*` не ставится `X-Frame-Options`).
- WMS плагин (если включён у Заказчика): слои температуры/осадков/ветра на карте как опция через конфигурацию — не реализовано, по запросу.

### 8.2. SmartMet Alert — CAP (M3) — реализовано (неделя 6)

- Источник: `CAP_FEED_URL` — Atom‑ или RSS‑фид со ссылками на CAP 1.2 XML (или встроенным `<content>`), HTML‑каталог со ссылками на `*.xml`, одиночный CAP, а для локальной проверки — `file://…` (файл фида или каталог с `*.xml`; фикстуры в `infra/data/cap`). Адрес редактора SmartMet Alert Агентства уточняется (D3); без переменной задача пропускается со статусом «источник не настроен».
- Задача `cap-sync` каждые 5 мин (и при старте): ETag/If‑Modified‑Since (условные заголовки только после успешного прогона), таймаут `CAP_TIMEOUT_MS` (15 с), параллелизм 4; уже загруженные ссылки пропускаются по `source_url`; разбор и валидация обязательных полей — `packages/core/src/cap.ts` (`fast-xml-parser`, тесты на фикстурах `packages/core/src/__tests__/fixtures/cap`); идемпотентный upsert по `identifier+sent` (`ingestCapAlert`). Статус последнего запуска — `settings.cap.sync` (дашборд админки, раздел «CAP‑сообщения»); ручной запуск `pnpm --filter @meteo/worker enqueue cap-sync '{"force":true}'`.
- Семантика: `msgType=Update/Cancel` помечают сообщения из `<references>` как `superseded_by` (работает и при обратном порядке доставки — по `refs ~ identifier`); `expires` → автоматическое скрытие (окно действия `onset → effective → sent … expires`, для публикации нужен хотя бы один не истёкший `info`); `status≠Actual` и `Test/Exercise` не публикуются, но видны в админке вместе с исходным XML.
- Геометрия: `polygon`/`circle` → `cap_areas.geom` (MultiPolygon 4326; круг — кольцо из 48 вершин), `geocode` → `warning_regions.code` (seed копирует коды и границы областей до получения кодов Агентства), без геокода — регионы по пересечению ≥ 5 % площади. Цвет по `severity` как в MeteoAlarm: Minor → жёлтый, Moderate → оранжевый, Severe/Extreme → красный (`CAP_SEVERITY_STYLES`, токены `--aq-2/3/4`).
- Локализация: блок `info` выбирается по языку с фолбэком tg → ru → en → первый; для сообщений без `info` на языке портала название события берётся из словаря `cap_event_translations` (`event` → tg/ru/en, редактируется в админке; строки создаются автоматически при первой встрече).
- Отображение: `/warnings` (матрица «регион × 5 дней», карточки выбранного дня: действующие и ожидаемые, фильтр по региону, легенда), слой «Предупреждения» на `/map` (GeoJSON `/api/v1/alerts?format=geojson&active=1`, заливка цветом severity, попап), баннер и карточка на главной, блок на `/weather/{slug}` (по геометрии области/региона и коду области точки); `GET /api/v1/alerts?active=1&region=&lang=&days=` и `/api/v1/alerts/{id}/xml`, виджет `/embed/alerts?region=&lang=` для раздела «Метео алерт» meteo.tj.
- `@fmidev/smartmet-alert-client` не используется — собственный рендер (ADR‑005).

### 8.3. SILAM (M5) — реализовано (неделя 5)

- Источник по умолчанию: THREDDS FMI `silam_glob_v6_1_sfc/silam_glob_v6_1_sfc_best.ncd` (глобальный, 0,2° ≈ 20 км, FMRC «best»), сервис **NetCDF Subset (NCSS)** с bbox Таджикистана (66,5–75,5° в.д., 36,5–41,5° с.ш.) и форматом NetCDF‑3: ~4 МБ на прогон (7 переменных × 122 часа × 46×26 ячеек). Переменные: `cnc_PM2_5`, `cnc_PM10` (kg/m³ → µg/m³) и `vmr_NO2_gas`, `vmr_SO2_gas`, `vmr_O3_gas`, `vmr_CO_gas` (объёмная доля → µg/m³ через `air_dens` и молярную массу; CO — в mg/m³). Конфигурация: `SILAM_NCSS_URL`, `SILAM_DATASET`, `SILAM_DIR`, `SILAM_KEEP_RUNS`. Если FMI предоставит региональный домен или SmartMet WMS — переключение конфигурацией.
- Задача `silam-sync` ежечасно (`20 * * * *`) и при старте: дешёвая проверка `time_run` по одному шагу → если прогон уже загружен, выход; иначе полная выгрузка от местной полуночи на 121 ч. `packages/core/src/silam.ts` (чистые функции, тесты): разбор осей, пересчёт единиц, билинейная интерполяция, растеризация уровней **в проекции Web Mercator** (строки равномерны по меркаторовой y, поэтому картинка ложится на карту без искажений по широте), увеличение ×8 (368×208 px). PNG пишет собственный минимальный энкодер (`apps/worker/src/png.ts`, RGBA + deflate, ~1 КБ на кадр) — без нативных зависимостей. Файлы: `{SILAM_DIR}/{YYYYMMDDHH}/{вещество}/{час}.png` → `silam_fields` (+ min/max/mean); точечные значения для `forecast_locations` и публичных станций → `silam_point_forecast` с уровнем по часовым порогам публичной шкалы. Хранятся `SILAM_KEEP_RUNS` (3) последних прогонов, старые удаляются вместе с файлами. Ручной запуск: `pnpm --filter @meteo/worker enqueue silam-sync '{"force":true}'`.
- Карта (`/map`): `image`‑источник MapLibre с 4 углами сетки под подписями подложки, панель слоёв — выбор вещества, ползунок по часам, кнопки «предыдущий/следующий/воспроизвести» (кадры вещества предзагружаются), подпись максимума по стране и времени прогона; легенда уровней. Каталог слоёв — `GET /api/v1/silam/layers`; PNG отдаёт `/silam/{run}/{code}/{hour}.png` (web‑роут из `SILAM_DIR`, в продакшене — Caddy из тома `silam`).
- Суточная сводка (среднее за местные сутки по веществу, уровень дня — худшее вещество): блок «Прогноз качества воздуха» на `/weather/{slug}`, карточка «Качество воздуха завтра» на главной, блок «Прогноз SILAM» на странице станции; `GET /api/v1/silam/{slug}`. Слой пыли (`dust_glob01_v6_1`) — опция на будущее.

### 8.4. Данные станций (M1/M7)

- Ручной ввод (реализовано, неделя 2): сетка «станция × время × вещество» по местному времени Душанбе; единицы ввода задаются в карточке станции (`station_pollutants.input_unit`), значения приводятся к единице вещества (`packages/core/units.ts`), правило диапазона из `qc_rules` ставит флаг `invalid`; повторный ввод обновляет значение (upsert по ключу).
- Импорт CSV (реализовано, неделя 2): два шага — проверка файла (отчёт по строкам, пакет `import_batches` в статусе pending, разобранные строки во временном файле `IMPORTS_DIR`) и применение (вставка пачками по 500 в транзакции, статус applied). Шаблон — `/templates/measurements-template.csv`; столбцы time, station, pollutant, value, unit; разделитель и десятичная запятая определяются автоматически. XLSX — при необходимости позже.
- Автоматический приём (реализовано, неделя 10; универсально, без привязки к вендору — реестр оборудования D5 ещё не получен). Общий код: `packages/core/src/ingest.ts` (синонимы кодов веществ вендоров, флаги качества, нормализация записей `{time, pollutant, value, unit?, flag?, averagingMin?}` с конверсией единиц и правилом диапазона QC), `packages/core/src/station-feed.ts` (разбор файлов экспорта CSV/TSV по маппингу колонок `FeedMapping`: разделитель, кодировка, заголовок, широкий/длинный формат, дата и время в одной или двух колонках, статусы строк), `packages/db/src/services/ingest.ts` (`ingestMeasurements`: идемпотентный upsert по ключу время/станция/вещество/осреднение, строки с `qc_locked` не перезаписываются, отметка `stations.last_ingest_*`, пересчёт индекса за затронутый период). Три пути приёма:
  1. `POST /api/v1/ingest/{code}` (`apps/web/src/app/api/v1/ingest/[code]/route.ts`): `Authorization: Bearer <ключ станции>` (сверка с `stations.api_key_hash`, станция должна быть активной), JSON‑массив до 1000 записей, время ISO с зоной или местное, вещества — коды или синонимы, единица по умолчанию — `station_pollutants.input_unit`; ответ — принято/отклонено/обновлено и причины по записям (200 — принята хотя бы одна, 422 — ни одной); отдельный лимит `ingest` (код станции + IP, `RATE_LIMIT_INGEST_PER_MINUTE` = 60); запись аудита `measurements.ingest` от имени `station:<код>` (роль `station`); после записи — задача `threshold-eval` через очередь BullMQ (без Redis — прямой вызов после ответа). Схемы — `apps/web/src/lib/api/schemas.ts` (`IngestRequestSchema`, `IngestResponseSchema`), описание в OpenAPI (`securitySchemes.stationApiKey`) и на `/data/api`.
  2. Агент станционного компьютера `apps/station-agent` — один файл `station-agent.mjs` (Node 22, без зависимостей; собирается esbuild из `src/agent.ts` и парсера `@meteo/core/station-feed`) + `config.json`: следит за папкой экспорта вендорского ПО, разбирает новые строки тем же маппингом, шлёт пакетами на ingest с повторами (сеть/5xx/429 — экспоненциальная задержка, 401/403 — стоп, 413 — деление пакета), ведёт журнал отправленного (`state.json`: по файлу — размер, mtime, отпечаток заголовка, последняя отправленная строка — дописанные файлы досылаются частично, переписанные — целиком); режимы `--once` (Task Scheduler/cron), служба (NSSM/systemd), `--check`, `--dry-run`; README ru/en с примерами конфигов для типичных форматов экспорта.
  3. Pull‑адаптер в worker — задача `station-pull` каждые 10 минут (и при старте, под замком): источники в таблице `station_sources` (станция, тип sftp/ftp/ftps/http, адрес, учётные данные зашифрованы AES‑256‑GCM ключом `STATION_SOURCES_KEY` (иначе `BETTER_AUTH_SECRET`) или ссылкой `env:ИМЯ` на переменную worker'а, отпечаток ключа хоста SFTP, каталог/URL, маска файлов, маппинг, порог «нет данных», статус/время последнего успеха/ошибка, реестр обработанных файлов по mtime/size/ETag), редактируются в карточке станции (кнопка «Проверить сейчас» ставит задачу в очередь); новые и изменившиеся файлы разбираются тем же парсером и пишутся тем же `ingestMeasurements` (источник `sensor`), аудит `measurements.pull`. Письма администраторам (шаблон `stationData`, те же получатели, что у сбоев интеграций): источник без принятых данных дольше `stale_after_min` и станция с приёмом по API без данных дольше `STATION_INGEST_STALE_MIN` (180 мин); при возобновлении — письмо о восстановлении. Карточка станции показывает «Автоматический приём данных» (когда, по какому каналу, принято/отклонено, период), дашборд — колонку «Автоматический приём» и счётчик станций без приёма дольше порога.
  4. Источник типа `json` (реализовано 20.10.2026) — JSON API сети датчиков: `packages/core/src/station-json.ts` (`JsonFeedMapping`: путь к массиву записей, поле кода станции и соответствие кодам портала `stations`, поле времени с зоной/форматом/округлением `roundMin`, поля веществ с единицами и множителем, статусы записей, `averagingMin`, `history` — URL ряда за прошедшие часы с `{hours}`), `apps/worker/src/station-pull/json.ts` (запрос свежих записей; при первом запуске, ручной проверке или пропуске больше двух интервалов у какой‑то станции — догрузка истории до `maxHours` (72 ч); раскладка записей по станциям портала по коду; курсор времени последней принятой записи на станцию в `files`, поэтому повторные ответы не создают дублей и не продлевают `last_data_at`; неизвестные коды и неактивные станции пропускаются со счётчиком `skipped` и пометкой в сводке). Один источник обслуживает несколько станций: заводится в карточке одной («якорь»), остальные получают `last_ingest_source = pull` и попадают под контроль «долго нет данных» по `STATION_INGEST_STALE_MIN` (расширен `checkStationDataStaleness`). Первое применение — сеть PM‑датчиков Агентства (airquality.meteo.tj, открытый API подрядчика wwcs.tj: `/services/airquality/stations` — последняя запись каждой станции, `/services/airquality/history?hours=N` — 10‑минутный ряд всех станций; 9 станций, PM2.5/PM10 в µg/m³, местное время UTC+5 без смещения); станции и источник создаёт `packages/db/src/scripts/import-wwcs-stations.ts` (`pnpm --filter @meteo/db import-wwcs`, runbook §9.4; источник создаётся включённым — это основной канал данных сети PM‑датчиков Агентства на портале, подключение штатное). Форма источника в карточке станции: тип «JSON API», адрес, описание полей (шаблон wwcs.tj); прогон без очереди — `pnpm --filter @meteo/worker pull-source <id> [--force]`. Адреса `file://` допускаются только при `STATION_PULL_ALLOW_FILE_URLS=1` (E2E `e2e/admin/station-json-source.spec.ts`, прогон маппинга на сохранённом ответе).
- Исторические данные: разовый импорт скриптом из форматов Заказчика (D5).

### 8.5. Публичная карта (FR6.3) — реализовано (18.10.2026)

- Компонент `apps/web/src/components/map/station-map.tsx` (MapLibre GL 6, подложка Protomaps из самостоятельно размещённых PMTiles — `basemap.ts`), ленивое монтирование `station-map.lazy.tsx`, панель слоёв `map-view.tsx` на `/map`; та же карта без панели — на главной (компактно) и на `/air` (`components/air/station-map-section.tsx`), на странице станции — с центром на станции.
- Слои снизу вверх: подложка → заливка областей (`regions-fill`) → растр SILAM (`silam-raster`) → контуры районов (`districts-line`, с зума 8; GeoJSON районов запрашивается при первом приближении к зуму 7) → контуры областей (`regions-line`) → предупреждения CAP (`warnings-fill`, `warnings-line`) → станции (кластеры и маркеры, поверх подписей подложки). Оверлеи вставляются под первый symbol‑слой стиля в порядке списка `OVERLAY_ORDER`, поэтому порядок не зависит от того, какой слой включили первым. Смена темы (`setStyle` без diff) пересоздаёт стиль — оверлеи восстанавливает обработчик `style.load`; обработчики кликов и наведения регистрируются один раз (делегируются по id слоя).
- Границы регионов: `GET /api/v1/regions` и `GET /api/v1/districts` (§9). Наведение — подсветка через feature-state и подпись области на языке интерфейса, клик — попап с названием, числом станций и ссылкой на `/air`; клики по станциям и предупреждениям границы не перехватывают. Чекбокс «Границы регионов» включён по умолчанию, «Уровни по областям» (заливка цветом худшего текущего уровня индекса среди станций области, без данных — бледно‑серый) — выключен. Пока геометрии не загружены, API отдаёт пустую коллекцию и слой пуст.
- Источник границ: `infra/data/load-boundaries.ts` (GADM 4.1 по умолчанию, geoBoundaries через `--source=geoboundaries`; ST_MakeValid → ST_SimplifyPreserveTopology 0,002° → upsert по коду; таксономия COD‑AB в `infra/data/boundaries/`). Лицензия GADM не допускает распространение без разрешения — для продакшена рекомендуется geoBoundaries (ODbL, как и тайлы OSM), решение за Заказчиком (D9).
- Диагностика без WebGL: контейнер карты несёт `data-map-layers` (видимые логические слои: `stations silam warnings regions regions-fill districts`) и экземпляр карты (`__maplibreMap`) — их используют E2E (`apps/web/e2e/public/map.spec.ts`), фикстуры E2E задают прямоугольные границы областей и один район.

## 9. Публичный API (`/api/v1`, JSON)

| Эндпоинт | Описание | Кэш |
|---|---|---|
| `GET /stations` | список станций с текущим индексом, координатами, статусом | 60 с |
| `GET /stations/{slug}` | карточка станции, последние значения по веществам | 60 с |
| `GET /stations/{slug}/measurements?range=24h\|7d\|30d\|1y&pollutant=&format=json\|csv` | ряды: часовые (24h/7d) или суточные по местному времени (30d/1y) средние с min/max/n; CSV с BOM и временем UTC + местным (реализовано) | 60 с |
| `GET /index/current?scale=` | текущий индекс всех публичных станций: уровень, значение, доминирующее вещество, под‑индексы, признак устаревания; `units` — единицы отображения по веществам; для `scale=RATIO_TO_LIMIT` — `indicators` (суммация NO₂+SO₂, максимальные разовые с кратностью ПДКм.р., ВЗ/ЭВЗ) (реализовано) | 60 с |
| `GET /forecast/{location}?hours=&days=` | прогноз SmartMet: часовой ряд и суточные агрегаты, время запуска модели (реализовано) | 300 с |
| `GET /silam/{location}` / `GET /silam/layers` | точечный прогноз SILAM с суточной сводкой / каталог растровых слоёв последнего прогона (реализовано) | 600 с |
| `GET /alerts?active=1&region=&lang=&days=&format=geojson` / `GET /alerts/{id}/xml` | CAP‑предупреждения: нормализованный JSON (info на языке с фолбэком, цвет, регионы, ссылка на XML) или GeoJSON для карты; исходный CAP XML (реализовано) | 60 с |
| `GET /news?locale=&page=&category=` / `GET /news/rss.xml?locale=` | опубликованные новости (JSON) и RSS 2.0 (реализовано) | 300 с |
| `GET /regions` / `GET /districts` | административные границы: области (Душанбе, РРП) и районы как GeoJSON FeatureCollection с упрощённой геометрией (`ST_SimplifyPreserveTopology` 0,002°, 5 знаков), `name` tg/ru/en, числом публичных станций и худшим текущим уровнем индекса (`level`, 0 — нет данных); ETag и 304 на `If-None-Match`; без загруженных границ — пустая коллекция (реализовано) | 600 с |
| `POST /ingest/{code}` | приём измерений от станции: `Authorization: Bearer <ключ станции>`, JSON‑массив до 1000 записей, ответ с числами принятых/отклонённых и причинами по записям; идемпотентно (реализовано, см. §8.4) | — |
| `POST /subscribe`, `GET /confirm`, `GET /unsubscribe` | подписки (double opt‑in) | — |

OpenAPI 3.1 генерируется из Zod‑схем (`apps/web/src/lib/api/schemas.ts` → `openapi.ts`, zod `toJSONSchema`) и отдаётся на `GET /api/v1/openapi.json?lang=tg|ru|en` (заголовки и описания эндпоинтов локализованы через `apiDocs.*`, описания полей — на английском); документация с деревом схем, параметрами и примерами — `/data/api`, обзор наборов данных, лицензии (CC BY 4.0) и виджетов — `/data` (реализовано, неделя 7). CORS: allowlist (meteo.tj + `*` для GET без учётных данных). Rate limit: 120 req/мин/IP на публичные (`RATE_LIMIT_API_PER_MINUTE`), отдельно 60 req/мин на станцию + IP для `/ingest` (`RATE_LIMIT_INGEST_PER_MINUTE`). SEO: `sitemap.xml` (статические разделы на трёх языках с hreflang, станции, точки прогноза, опубликованные новости) и `robots.txt` (закрыты `/admin`, `/embed`, `/api/auth`, `/api/admin`) — `apps/web/src/app/sitemap.ts`, `robots.ts`.

## 10. Безопасность

Реализовано на неделе 8 (hardening); подробный чек-лист со статусами и способами проверки — `docs/security-checklist.md`.

- **Транспорт:** TLS 1.2+/HSTS и HTTP→HTTPS в Caddy; security headers для всех ответов в `next.config.ts` (`X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, без `X-Powered-By`).
- **CSP с nonce (реализовано):** `apps/web/src/proxy.ts` генерирует nonce на каждый запрос страницы и передаёт его Next.js заголовком запроса (`content-security-policy`) — все скрипты Next получают атрибут `nonce`, инлайн‑скрипт темы (next-themes) берёт nonce из `x-nonce` в root layout. Политика (`src/lib/security/csp.ts`): `script-src 'self' 'nonce-…' 'strict-dynamic'` (dev: `'unsafe-eval'`), `style-src 'self' 'unsafe-inline'` (SSR‑стили React, MapLibre, ECharts), `img-src 'self' data: blob:` и `worker-src 'self' blob:` (MapLibre, слои SILAM, next/image), `connect-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'` + `X-Frame-Options: DENY`; для iframe‑виджетов `/embed/*` — `frame-ancestors 'self' https://meteo.tj https://*.meteo.tj` (`EMBED_FRAME_ANCESTORS`); `upgrade-insecure-requests` при https. Все страницы рендерятся динамически (nonce не совместим со статической генерацией). Nonce внедряется без клонирования `NextRequest`: клон получает host из заголовка `Host`, и Next в production считает rewrite next-intl внешним (цикл 307) — proxy пересобирает ответ next-intl через `NextResponse.rewrite/next({ request: { headers } })`.
- **Аутентификация:** better-auth — Argon2id, сессии в httpOnly/SameSite cookies, политика паролей (≥ 10 символов). Реализовано (неделя 7): обязательный TOTP‑2FA для роли admin — layout админки (`enforceAdminTwoFactor`) пускает администратора без 2FA только на `/admin/two-factor` (включение: пароль → QR/ключ → резервные коды → код из приложения; флаг перепроверяется в БД, минуя 5‑минутный cookie‑кэш сессии); вход: пароль → код TOTP или резервный код, «доверять устройству 30 дней»; блокировка учётной записи после 10 неудачных кодов (15 мин) и rate limit 5/мин на вход и проверку кода; смена роли, сброс пароля и блокировка завершают все сессии пользователя (принудительный выход); нельзя понизить, заблокировать или удалить последнего активного администратора; все действия — в `audit_log`.
- **Авторизация:** RBAC на сервере (server actions / route handlers), матрица прав по сущностям; `/admin` закрыт в `proxy.ts`; опциональный IP‑allowlist для `/admin` в Caddy (runbook).
- **Rate limiting (реализовано):** `/api/v1/*` — 120 запросов/мин на IP, `/api/auth/*` — 30/мин (плюс внутренние лимиты better-auth 5/мин на вход и код 2FA). Счётчики в Redis (Lua `INCR`+`PEXPIRE`, общие для всех экземпляров web; при недоступном Redis — память процесса), ответ 429 с `Retry-After` и заголовки `X-RateLimit-Limit/Remaining/Reset`. Пороги — `RATE_LIMIT_API_PER_MINUTE`, `RATE_LIMIT_AUTH_PER_MINUTE` (0 — выключить).
- **Ввод:** Zod на всех границах; загрузки — проверка типа по сигнатуре файла (PNG/JPEG/WebP/GIF/PDF), лимит 10 МБ, имена UUID, хранение вне web‑root (`UPLOADS_DIR`), раздача с `nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, PDF только как вложение (Next‑маршрут и Caddy). Перекодирование через sharp не применяется (sharp исключён из образов на неделе 5). Markdown — собственный безопасный рендерер; импорт CSV/XLSX — без внешних библиотек (`@meteo/core/csv`, `/xlsx`).
- **Данные:** параметризованные запросы (Drizzle); `audit_log` append‑only; секреты только в `.env` на сервере (не в репозитории), ротация описана в `docs/runbook.md`. Роль БД приложения без DDL — после первого релиза на сервере Заказчика (runbook §4).
- **Поставка (реализовано в CI):** `pnpm audit --prod --audit-level=high`, Trivy для файловой системы (lockfile, misconfig Dockerfile/compose, секреты) и для образов web/worker/backup перед публикацией в GHCR; pinned‑версии и политика pnpm `minimumReleaseAge` 24 ч; образы non‑root (`app`, `backup`, redis `999`); в `compose.prod.yml` — read‑only root FS с tmpfs (web, worker, migrate, redis, backup, caddy), `cap_drop: ALL` (+`NET_BIND_SERVICE` у Caddy), `no-new-privileges`, лимиты памяти и PID, ротация логов; postgres — без read‑only (сокеты/статистика). Dependabot — после переноса репозитория Заказчику.
- **Резервные копии (реализовано):** образ `infra/backup` (pg_dump 17 + restic): ежедневно в 02:00 по Душанбе `pg_dump -Fc` + снимок restic (дампы, тома uploads/silam) с шифрованием в локальный репозиторий тома `backups` или S3/SFTP, хранение 30 дневных + 12 месячных, `prune`/`check`, статус `last-backup.json` и healthcheck контейнера; тест восстановления в чистую БД — `infra/backup/restore-test.sh` (процедура TimescaleDB pre/post_restore), ежемесячно по runbook.

## 11. Наблюдаемость и эксплуатация

- `GET /healthz` (web, worker); дашборд админки (реализовано, неделя 7): свежесть данных по станциям (последнее измерение, доля станций без данных за сутки), очередь QC и активные превышения, состояние интеграций SmartMet / SILAM / CAP (последняя загрузка, запуск модели, серия сбоев, circuit breaker, адрес источника), heartbeat worker'а, очередь писем (`pending`/`failed`/за сутки, последняя ошибка, настроен ли SMTP), последние записи аудита. Метрики Prometheus (`/metrics`) — по запросу, не реализовано.
- Раздел «Настройки» (`/admin/settings`): проверка SMTP тестовым письмом через `email_outbox` (статус строки очереди на странице), адреса интеграций из окружения только для чтения (учётные данные скрыты; если переменная не видна web, показывается адрес из состояния worker'а), брендинг (название, организация, контакты, строка подвала на трёх языках) — с аудитом.
- Уведомления о сбоях интеграций — e‑mail администраторам при N сбоях подряд и при восстановлении (см. §8).
- Логи JSON (pino) → Docker → ротация; опционально Loki/Grafana или Uptime Kuma (один контейнер) для внешних проверок.
- Ошибки: опционально self‑hosted GlitchTip (совместим с Sentry SDK) — если позволят ресурсы сервера.
- Требования к серверу: Ubuntu 24.04 LTS, 4 vCPU, 8 ГБ RAM, 100 ГБ SSD (с запасом на 5 лет данных), статический IP, домен, открытые 80/443.
- Runbook покрывает: первичное развёртывание, обновление, миграции, бэкап/восстановление, ротацию секретов, добавление станции/языка, инциденты по каждому внешнему источнику, администрирование SmartMet Server/Alert (совместно с FMI‑документацией).

## 12. Производительность

- Публичные страницы: Server Components + кэш данных (`revalidate` 60 с) + Redis‑кэш API; карта и графики грузятся лениво (отдельные чанки).
- Ряды: continuous aggregates → запрос года по станции = 365 строк; 24 ч — часовые; 7 дн — часовые; 30 дн — часовые/суточные по выбору; CSV стримится.
- Статика: PMTiles Таджикистана (экстракт сборки Protomaps до z14, ~210 МБ) отдаётся маршрутом `/tiles/[name]` с Range‑запросами (в продакшене тот же каталог через Caddy); шрифты и спрайты стиля Protomaps и worker MapLibre — в `public/`; шрифты интерфейса self‑hosted (`next/font`); изображения AVIF/WebP через `next/image`.
- Бюджеты (Lighthouse CI в CI): главная — LCP ≤ 2,5 с, CLS ≤ 0,1, JS ≤ 250 КБ gz; карта — ≤ 600 КБ gz с MapLibre. Реализовано (неделя 8): `apps/web/lighthouserc.cjs` — главная, страница станции, `/weather` на production‑сборке, пороги performance ≥ 80, accessibility ≥ 95, SEO ≥ 90; job `e2e` в CI.
- **Кэш API (реализовано):** `apps/web/src/lib/cache.ts` — ответы `/api/v1/stations`, `/api/v1/index/current`, `/api/v1/forecast/{slug}`, `/api/v1/silam/layers` кэшируются в Redis с TTL = `s-maxage` (60/60/300/600 с; без Redis — память процесса), заголовок `X-Cache: HIT|MISS`. Нагрузочная проверка (k6, `infra/perf`) и результаты — `docs/perf.md`.

## 13. Ежедневный экологический бюллетень (формат Агентства) — реализовано 20.10.2026

Инициатива вне ТЗ: сотрудники Управления мониторинга окружающей среды ежедневно вручную набирают в Word
три документа — «Экологический бюллетень г. Душанбе» (ru) / «Шарҳи ҳолати ифлосшавии ҳаво» (tg),
сводку по городам республики «Загрязнение атмосферного воздуха» (ru) / «ИҲА» (tg) и форму 4а
(«Намунаи 4а», превышения ПДК по городам). Портал готовит их автоматически по измерениям.

### 13.1. Расчёт (`packages/core/src/bulletin.ts`, `packages/db/src/services/bulletin.ts`)

- Период — местные сутки Asia/Dushanbe (`localDayRangeUtc`); учитываются только измерения с `qc_flag` 1 и 4.
  Записи с осреднением < 24 ч — разовые/часовые (из них среднесуточная = среднее, максимальная разовая = максимум,
  число разовых превышений ПДКм.р.); записи 1440 мин — готовые суточные средние (максимума нет).
- Кратности `q̄/ПДКс.с.` и `q_max/ПДКм.р.` из `limit_values` (единицы хранения); «выше нормы» — по округлённому
  до двух знаков значению, как оно печатается. Число случаев: `>ПДК` — «1» (среднесуточная) / «1-2» (и две разовые);
  вторая колонка — случаи ≥ 5 ПДК. ВЗ — разовое значение ≥ 10 ПДКм.р., ЭВЗ — ≥ 50 ПДКм.р.
- Суммация NO2+SO2 — по методике Агентства: Σ среднесуточных концентраций к **ПДКм.р.** (именно так получаются
  0,59 → 0,66 из образца за 19.10.2026); вариант к ПДКс.с. (правило суммации РД 52.04.186‑89) — настройка
  `settings.ecoBulletin.summation`.
- Сравнение с предыдущими сутками — по напечатанным кратностям (1,30 и 1,3 — «на уровне»); группы «повышение /
  понижение / на уровне» плюс суммация.
- Сводка по городам: публичные станции группируются по городу — Душанбе (область `DU`) целиком, иначе район станции
  (для городов республиканского подчинения это и есть город: «Шаҳри Хуҷанд» → «Хуҷанд»), без района — область.
  Значения станций города объединяются (среднее по всем пробам, максимум по всем); города без данных за оба дня
  в сводку не попадают. Форма 4а — вещества с превышением ПДКс.с. или ПДКм.р. по каждому городу.
- Единицы в документах — мг/м³ (µg/m³ ÷ 1000; ppm/ppb как есть) с запятой‑разделителем; точность как у Агентства
  (0,079; 0,0016; 0,00003).
- Результат расчёта сохраняется снимком в `eco_bulletins.data` (`EcoBulletinData`): документы всегда рендерятся
  из снимка, поэтому опубликованный бюллетень не меняется при поступлении новых данных.

### 13.2. Текст и форматы

- Шаблоны фраз tg/ru — редактируемый файл `packages/core/src/bulletin-phrases.ts` (заголовки, шапки таблиц, фразы
  «наблюдалось повышение … с X до Y», «случаи превышения … из‑за метеорологических условий и антропогенных
  факторов», ВЗ/ЭВЗ, γ‑фон, примечания с расшифровкой сокращений, названия веществ в именительном / родительном /
  дательном падежах с синонимами кодов). Фраза о причинах и подпись отдела переопределяются в настройках админки.
- Генератор `bulletin-text.ts` строит модель документа (`bulletin-doc.ts`: абзацы и таблицы с объединением ячеек),
  рендереры: HTML (`bulletin-html.ts`, фрагмент для предпросмотра и печатная страница A4) и DOCX
  (`packages/core/src/docx.ts` — собственный генератор WordprocessingML + ZIP на `node:zlib`, без зависимостей;
  Times New Roman, A4, повторяемая шапка таблицы, vMerge/gridSpan, экспорт `@meteo/core/docx`).
- PDF: `apps/web/src/lib/pdf.ts` рендерит печатную HTML‑страницу через Chromium Playwright, если пакет
  `@playwright/test` доступен (разработка, E2E, сборка документации). В production‑образе его нет — кнопка
  «PDF» открывает печатную HTML‑версию с автоматическим диалогом печати («Сохранить как PDF»); при публикации
  сохраняются только DOCX. Чтобы получать PDF на сервере, достаточно установить Chromium в образ web.

### 13.3. Админка, worker, публичная часть

- `/admin/eco-bulletins` (права `ecoBulletin.read|write|publish`: администратор, оператор, редактор): форма
  «дата + станция» → расчёт и черновик; журнал; `/admin/eco-bulletins/{id}` — предпросмотр трёх документов на
  tg/ru, поле «γ‑фон», «Пересчитать», скачивание `/api/admin/eco-bulletins/{id}/{city|summary|form4a}-{tg|ru}.{docx|pdf|html}`,
  «Опубликовать» (файлы в `UPLOADS_DIR/eco-bulletins/{id}/`, опубликованная новость рубрики «Бюллетени» с текстом
  и ссылками, по желанию — рассылка подписчикам через `bulletins` → `email_outbox`), удаление черновика;
  `/admin/eco-bulletins/settings` — расписание, уведомления, станции для автоматического черновика, подпись,
  фраза о причинах, метод суммации (`settings.ecoBulletin`). Все действия — в `audit_log`
  (`ecoBulletin.generate|recompute|gamma|publish|delete`, `settings.ecoBulletin.update`).
- Worker `eco-bulletin-draft`: ежедневно в 08:00 по Душанбе (BullMQ cron с `tz`) готовит черновики за прошедшие
  сутки по станциям из настроек (по умолчанию — все публичные автоматические) и ставит операторам и администраторам
  одно письмо‑дайджест шаблона `ecoBulletinDraft` на дату (список станций, превышения, ссылки; dedup по дате и адресу). Ручной запуск:
  `pnpm --filter @meteo/worker enqueue eco-bulletin-draft '{"date":"2026-10-19","force":true}'`.
- Публичная часть: архив `/air/bulletins` (опубликованные по датам, DOCX/PDF tg/ru), страница
  `/air/bulletins/{id}` (предпросмотр трёх документов, hreflang), файлы `/api/v1/eco-bulletins/{id}/{file}`;
  ссылки с главной (карточка «Качество воздуха сейчас»), со страницы станции, из подвала и в sitemap.
- Проверка: vitest (`packages/core/src/__tests__/bulletin.test.ts`, `docx.test.ts`, шаблон письма в worker),
  E2E `apps/web/e2e/admin/eco-bulletin.spec.ts` (формирование → γ‑фон → DOCX/HTML → публикация → архив).
