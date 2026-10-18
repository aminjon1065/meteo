# Чек-лист безопасности метеопортала

Статус на 17.10.2026 (неделя 8 плана, hardening). Основание — `docs/02-architecture.md` §10.
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
| 2.2 | Обязательная TOTP-2FA для admin, резервные коды, блокировка после 10 неверных кодов, «доверять устройству 30 дней» | ✅ | неделя 7; E2E `e2e/auth.setup.ts` проходит мастер включения 2FA |
| 2.3 | RBAC на сервере (server actions / route handlers), матрица прав в `@meteo/core/authz` | ✅ | неделя 1–7; `/admin` без cookie → редирект на вход (proxy), полная проверка в layout админки с чтением сессии из БД |
| 2.4 | Rate limit входа и проверки кода | ✅ | better-auth: 5/мин на `/sign-in/email` и `/two-factor/verify-totp`, 30/мин на остальное (в памяти процесса) + внешний лимит `/api/auth/*` 30/мин на IP в Redis (см. 4.1) |
| 2.5 | IP-allowlist для `/admin` | ⬜ | опционально в Caddy после согласования с IT-службой Агентства (пример в `docs/runbook.md`) |

## 3. Ввод и загрузки

| № | Пункт | Статус | Где / как проверено |
|---|---|---|---|
| 3.1 | Zod на всех границах (формы, API, server actions) | ✅ | `apps/web/src/lib/validation/*`, API-схемы `src/lib/api/schemas.ts` |
| 3.2 | Загрузки: тип по сигнатуре файла (PNG/JPEG/WebP/GIF/PDF), лимит 10 МБ, имя файла — UUID, хранение вне web-root (`UPLOADS_DIR`), только для роли с `content.write` | ✅ | `apps/web/src/app/api/admin/media/route.ts`, `@meteo/core/image-meta`; SVG и прочие типы → 415 |
| 3.3 | Раздача загрузок | ✅ | `/uploads/*`: путь проверяется регулярным выражением (нет обхода каталога — E2E), `nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, PDF только как вложение (`Content-Disposition: attachment`) — и в Next-маршруте, и в Caddy. Перекодирование изображений через sharp из §10 архитектуры не реализовано: sharp удалён из образов (неделя 5), риск покрыт проверкой сигнатуры + sandbox |
| 3.4 | Markdown новостей | ✅ | собственный безопасный рендерер `@meteo/core/markdown` (без raw HTML, `<script>` экранируется — проверено на неделе 6) |
| 3.5 | Импорт CSV/XLSX | ✅ | разбор без внешних зависимостей (`@meteo/core/csv`, `/xlsx`), лимиты строк, ошибки построчно; XLSX читается как ZIP без выполнения формул/макросов |

## 4. API и устойчивость

| № | Пункт | Статус | Где / как проверено |
|---|---|---|---|
| 4.1 | Rate limit `/api/v1/*` (120/мин на IP) и `/api/auth/*` (30/мин) | ✅ | `src/lib/security/limits.ts` + `rate-limit.ts`: счётчики в Redis (Lua INCR+PEXPIRE, общие для всех экземпляров), при недоступном Redis — память процесса; ответ 429 с `Retry-After`, заголовки `X-RateLimit-*`. Настройка `RATE_LIMIT_API_PER_MINUTE`, `RATE_LIMIT_AUTH_PER_MINUTE` (0 — выключить для нагрузочных проверок). Unit-тесты `src/__tests__/rate-limit.test.ts` |
| 4.2 | Кэш публичного API | ✅ | `src/lib/cache.ts`: Redis с TTL = `s-maxage` (станции/индекс 60 с, прогноз 300 с, слои SILAM 600 с), заголовок `X-Cache`; результаты — `docs/perf.md` |
| 4.3 | CORS | ✅ | только `GET` публичного API с `Access-Control-Allow-Origin: *`; админское API и auth — same-origin (`trustedOrigins`) |
| 4.4 | Health-check без секретов | ✅ | `/api/healthz`, `worker /healthz` |

## 5. Данные и секреты

| № | Пункт | Статус | Где / как проверено |
|---|---|---|---|
| 5.1 | Параметризованные запросы (Drizzle), `audit_log` append-only (триггер) | ✅ | неделя 1–4 |
| 5.2 | Роль БД без DDL для приложения | ⬜ | сейчас web/worker/migrate используют одну роль `meteo` (владелец). Разделение ролей — после выдачи сервера (runbook, раздел «Ротация секретов», п. «роль приложения») |
| 5.3 | Секреты только в `.env` на сервере, не в репозитории | ✅ | `.gitignore`, `.env.example`; CI использует собственные значения; ротация описана в `docs/runbook.md` |
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
| 6.7 | Секреты в CI | ✅ | только `GITHUB_TOKEN` для GHCR; пароли E2E — тестовые значения в workflow |

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
