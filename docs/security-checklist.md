# Чек-лист безопасности метеопортала

Статус на 19.10.2026 (неделя 8 плана, hardening; дополнено по итогам независимого ревью перед
деплоем — `docs/review-2026-10.md`). Основание — `docs/02-architecture.md` §10.
Обозначения: ✅ выполнено и проверено, 🔶 выполнено частично / зависит от среды Заказчика, ⬜ не делалось.

## 1. Транспорт и заголовки

| № | Пункт | Статус | Где / как проверено |
|---|---|---|---|
| 1.1 | TLS 1.2+/HSTS, HTTP→HTTPS | 🔶 | Caddy (`infra/compose/Caddyfile`): автоматический Let's Encrypt, `Strict-Transport-Security max-age=31536000; includeSubDomains`. Проверить после выдачи домена (D8): `curl -I https://<домен>`. Preload HSTS — после 1 месяца стабильной работы |
| 1.2 | Content Security Policy с nonce | ✅ | `apps/web/src/proxy.ts` + `src/lib/security/csp.ts`: nonce на каждый запрос, `script-src 'self' 'nonce-…' 'strict-dynamic'` (dev: + `'unsafe-eval'`), `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`. Next.js проставляет nonce своим скриптам (читает из заголовка запроса). Unit-тесты `src/__tests__/csp.test.ts`, E2E `e2e/public/security.spec.ts` (нет `<script src>` без nonce), на главной, карте и странице станции E2E проверяют отсутствие сообщений браузера о нарушении политики |
| 1.3 | Инлайн-стили | 🔶 | `style-src 'self' 'unsafe-inline'`: React выводит `style=""` при SSR (цвета уровней, CSS-переменные sidebar/toast), MapLibre и ECharts задают стили из JS. Nonce для стилей не применим; риск — только CSS-инъекция, скрипты по-прежнему заблокированы |
| 1.4 | MapLibre / ECharts / изображения | ✅ | `img-src 'self' data: blob:` (спрайты, растровые слои SILAM, next/image), `worker-src 'self' blob:` (worker MapLibre лежит в `/maplibre`, same-origin), `connect-src 'self'` (PMTiles range-запросы, API), `font-src 'self' data:` |
| 1.5 | iframe-виджеты `/embed/*` | ✅ | `frame-ancestors 'self' https://meteo.tj https://*.meteo.tj` (переменная `EMBED_FRAME_ANCESTORS`), без `X-Frame-Options`; остальные страницы — `frame-ancestors 'none'` + `X-Frame-Options: DENY` |
| 1.6 | Остальные заголовки | ✅ | `next.config.ts` для всех ответов: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: geolocation=(self), camera=(), microphone=(), payment=()`, `Cross-Origin-Opener-Policy: same-origin`; `X-Powered-By` отключён; Caddy дублирует HSTS/nosniff/Referrer/Permissions и убирает `Server` |
| 1.7 | `upgrade-insecure-requests` | ✅ | добавляется в CSP, когда `NEXT_PUBLIC_APP_URL` начинается с https (продакшен) |

## 2. Аутентификация и авторизация

| № | Пункт | Статус | Где / как проверено |
|---|---|---|---|
| 2.1 | better-auth: Argon2id, httpOnly/SameSite cookies, пароль ≥ 10 символов, самостоятельная регистрация закрыта | ✅ | `apps/web/src/lib/auth.ts` (неделя 1/7) |
| 2.2 | Обязательная TOTP-2FA для admin, резервные коды, блокировка после 10 неверных кодов, «доверять устройству 30 дней» | ✅ | неделя 7; E2E `e2e/auth.setup.ts` проходит мастер включения 2FA. Ревью 10.2026: требование 2FA проверяется не только в layout, но и в каждом server action и route handler админки (`requireAdminSession` / `requireApiSession` в `src/lib/session.ts`) |
| 2.3 | RBAC на сервере (server actions / route handlers), матрица прав в `@meteo/core/authz` | ✅ | неделя 1–7; `/admin` без cookie → редирект на вход (proxy), полная проверка в layout админки с чтением сессии из БД; route handlers `/api/admin/*` — сессия из БД без cookie‑кэша (`requireApiSession`). Адрес возврата `?next=` после входа — только путь админки (`src/lib/security/redirects.ts`) |
| 2.4 | Rate limit входа и проверки кода | ✅ | better-auth: 5/мин на `/sign-in/email` и `/two-factor/verify-totp`, 30/мин на остальное (в памяти процесса) + внешний лимит `/api/auth/*` 30/мин на IP в Redis (см. 4.1) |
| 2.5 | IP-allowlist для `/admin` | ⬜ | опционально в Caddy после согласования с IT-службой Агентства (пример в `docs/runbook.md`) |

## 3. Ввод и загрузки

| № | Пункт | Статус | Где / как проверено |
|---|---|---|---|
| 3.1 | Zod на всех границах (формы, API, server actions) | ✅ | `apps/web/src/lib/validation/*`, API-схемы `src/lib/api/schemas.ts` |
| 3.2 | Загрузки: тип по сигнатуре файла (PNG/JPEG/WebP/GIF/PDF), лимит 10 МБ, имя файла — UUID, хранение вне web-root (`UPLOADS_DIR`), только для роли с `content.write` | ✅ | `apps/web/src/app/api/admin/media/route.ts`, `@meteo/core/image-meta`; SVG и прочие типы → 415 |
| 3.6 | Экспорт CSV (подписчики, ряды измерений): защита от инъекции формул | ✅ | ячейки, начинающиеся с `=`, `+`, `-`, `@`, табуляции, получают ведущий апостроф (`@meteo/core` `csvCell`), числа не трогаются; unit‑тесты `packages/core/src/__tests__/csv.test.ts` |
| 3.7 | Исходный XML CAP (`/api/v1/alerts/{id}/xml`, `/api/admin/cap/{id}/xml`) | ✅ | внешний документ отдаётся с `Content-Security-Policy: default-src 'none'; sandbox` и `nosniff` — XSLT/скрипты из XML не выполняются в origin портала; E2E `e2e/public/security.spec.ts` |
| 3.8 | Форма подписки без входа | ✅ | лимит 10 запросов/мин на IP для server action `/subscribe` (proxy, `RATE_LIMIT_SUBSCRIBE_PER_MINUTE`); изменения уже подтверждённой подписки применяются только по ссылке из письма; письмо подтверждения — не чаще раза в час на адрес |
| 3.3 | Раздача загрузок | ✅ | `/uploads/*`: путь проверяется регулярным выражением (нет обхода каталога — E2E), `nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, PDF только как вложение (`Content-Disposition: attachment`) — и в Next-маршруте, и в Caddy. Перекодирование изображений через sharp из §10 архитектуры не реализовано: sharp удалён из образов (неделя 5), риск покрыт проверкой сигнатуры + sandbox |
| 3.4 | Markdown новостей | ✅ | собственный безопасный рендерер `@meteo/core/markdown` (без raw HTML, `<script>` экранируется — проверено на неделе 6) |
| 3.5 | Импорт CSV/XLSX | ✅ | разбор без внешних зависимостей (`@meteo/core/csv`, `/xlsx`), лимиты строк, ошибки построчно; XLSX читается как ZIP без выполнения формул/макросов |

## 4. API и устойчивость

| № | Пункт | Статус | Где / как проверено |
|---|---|---|---|
| 4.5 | Приём данных станций `/api/v1/ingest/{code}` | ✅ | ключ сравнивается по SHA‑256 в БД, тело читается потоком с обрывом при превышении 2 МБ (`src/lib/security/body.ts`), ≤ 1000 записей, данные старше 730 дней и из будущего (> 1 ч) отклоняются; лимит 60/мин на станцию + IP |
| 4.6 | IP клиента за Caddy | ✅ | Caddy выставляет `X-Forwarded-For` и `X-Real-IP` из адреса соединения (`header_up`, `infra/compose/Caddyfile`); порт web наружу не публикуется, поэтому заголовок клиента подделать нельзя |
| 4.1 | Rate limit `/api/v1/*` (120/мин на IP) и `/api/auth/*` (30/мин) | ✅ | `src/lib/security/limits.ts` + `rate-limit.ts`: счётчики в Redis (Lua INCR+PEXPIRE, общие для всех экземпляров), при недоступном Redis — память процесса; ответ 429 с `Retry-After`, заголовки `X-RateLimit-*`. Настройка `RATE_LIMIT_API_PER_MINUTE`, `RATE_LIMIT_AUTH_PER_MINUTE` (0 — выключить для нагрузочных проверок). Unit-тесты `src/__tests__/rate-limit.test.ts` |
| 4.2 | Кэш публичного API | ✅ | `src/lib/cache.ts`: Redis с TTL = `s-maxage` (станции/индекс 60 с, прогноз 300 с, слои SILAM 600 с), заголовок `X-Cache`; результаты — `docs/perf.md` |
| 4.3 | CORS | ✅ | только `GET` публичного API с `Access-Control-Allow-Origin: *`; админское API и auth — same-origin (`trustedOrigins`) |
| 4.4 | Health-check без секретов | ✅ | `/api/healthz` (БД обязательна → 503; Redis — поле `redis`: ok / error / not-configured, статус `degraded` при ошибке), `worker /healthz` |

## 5. Данные и секреты

| № | Пункт | Статус | Где / как проверено |
|---|---|---|---|
| 5.1 | Параметризованные запросы (Drizzle), `audit_log` append-only (триггер) | ✅ | неделя 1–4 |
| 5.2 | Роль БД без DDL для приложения | ⬜ | сейчас web/worker/migrate используют одну роль `meteo` (владелец). Разделение ролей — после выдачи сервера (runbook, раздел «Ротация секретов», п. «роль приложения») |
| 5.3 | Секреты только в `.env` на сервере, не в репозитории | ✅ | `.gitignore`, `.env.example`; CI использует собственные значения; ротация описана в `docs/runbook.md`. Контейнеры получают только переменные, перечисленные в `compose.prod.yml` (`${VAR:-}`); пустое значение приложения считают незаданным |
| 5.5 | Учётные данные источников станций (SFTP/FTP/HTTP) | ✅ | AES‑256‑GCM (`STATION_SOURCES_KEY`, один ключ у web и worker) или ссылка `env:ИМЯ`; клиенту отдаётся только признак наличия; worker отклоняет адреса loopback/link‑local/`.internal` и, в Docker, подсети своих интерфейсов (сервисы compose) — по написанию и после DNS; HTTP‑перенаправления проверяются на каждом шаге, `Authorization` на другой origin не уходит (`apps/worker/src/station-pull/{target,http-fetch}.ts`, 24.10.2026) |
| 5.4 | Резервные копии: pg_dump + restic (шифрование репозитория), ежедневно, 30 дневных + 12 месячных, тест восстановления | ✅ | `infra/backup/run.sh`, образ `infra/backup/Dockerfile`, `infra/backup/restore-test.sh` (прогнан локально 17.10.2026 — см. runbook); офсайт-репозиторий — после выдачи хранилища Заказчиком |

## 6. Поставка и среда выполнения

| № | Пункт | Статус | Где / как проверено |
|---|---|---|---|
| 6.1 | `pnpm audit --prod --audit-level=high` в CI | ✅ | job `security` в `.github/workflows/ci.yml`. 17.10.2026: nodemailer обновлён 7.0 → 10.1 (5 high / 7 moderate advisories закрыты), CLI `shadcn` перенесён в devDependencies (неисправимый `braces` вне production). Остаток: 2 moderate/low advisories `esbuild` через необязательные peer-зависимости better-auth (`drizzle-kit`, `vitest`) — dev-сервер esbuild не используется в продакшене, в образы не попадают (`pnpm deploy --prod --no-optional`) |
| 6.2 | Trivy: файловая система (lockfile, Dockerfile/compose misconfig, секреты) и образы web/worker/backup (HIGH/CRITICAL с исправлением) | ✅ | job `security` и `docker` в CI; образы сканируются до публикации в GHCR |
| 6.3 | Pinned-версии, политика pnpm `minimumReleaseAge` 24 ч | ✅ | `pnpm-workspace.yaml`, lockfile |
| 6.4 | Dependabot | ⬜ | включить после переноса репозитория в GitHub Заказчика (`.github/dependabot.yml`, еженедельно, группировка minor/patch) |
| 6.5 | Образы non-root | ✅ | web/worker/backup — пользователь `app`/`backup`; redis — `user: 999:1000`; postgres — пользователь образа |
| 6.6 | Read-only root FS, `cap_drop: ALL`, `no-new-privileges`, лимиты памяти/PID, ротация логов | ✅ | `infra/compose/compose.prod.yml`: web (tmpfs `/tmp`, `.next/cache`), worker, migrate, redis, backup — read-only; Caddy — read-only + `NET_BIND_SERVICE`; postgres — без read-only (сокеты/статистика), с `no-new-privileges`. Проверка: `docker compose … config` |
| 6.7 | Секреты в CI | ✅ | `GITHUB_TOKEN` для GHCR; пароли E2E — тестовые значения в workflow; выкатка — `DEPLOY_SSH_KEY` в окружениях GitHub `staging`/`production` (у production — обязательное одобрение), ключ на сервере открывает только принудительную команду `meteo-deploy <окружение>` (без shell и проброса портов); `.env` окружений — только на сервере (`docs/runbook.md` §13) |

## 7. Наблюдаемость инцидентов

- Журнал аудита всех действий в админке (`/admin/audit`), письма администраторам о сбоях интеграций (неделя 7).
- Логи JSON (pino) → Docker json-file с ротацией 5×10 МБ.
- Рекомендуется (после выдачи сервера): Uptime Kuma на `/api/healthz`, уведомление о `backup.result != ok` из `last-backup.json`.

## 8. Что проверить при приёмке на сервере Заказчика

1. `curl -I https://<домен>/` — HSTS, CSP с nonce, `X-Frame-Options: DENY`; `curl -I https://<домен>/embed/aqi` — `frame-ancestors` c meteo.tj.
2. `curl -s -o /dev/null -w '%{http_code}' https://<домен>/api/v1/stations` ×130 за минуту → последние ответы 429.
3. `docker compose exec backup sh -c 'cat /backups/last-backup.json'` — `result: ok`, `restic: ok`; `sh infra/backup/restore-test.sh` на staging.
4. `docker compose config` без предупреждений; `docker inspect` web/worker — `ReadonlyRootfs: true`, `CapDrop: ALL`.
5. CI на последнем коммите зелёный: audit, Trivy, E2E, Lighthouse.
