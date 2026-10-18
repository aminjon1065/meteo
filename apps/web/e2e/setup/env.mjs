/**
 * Окружение E2E (Playwright + Lighthouse CI): отдельная база `<db>_e2e` на том же PostgreSQL,
 * production-сборка Next на порту E2E_PORT, каталоги данных внутри apps/web/e2e/.data.
 * Используется и из server.mjs (запуск сервера), и из тестов (доступ к БД).
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const WEB_DIR = resolve(here, "../..");
export const REPO_ROOT = resolve(WEB_DIR, "../..");
export const E2E_DATA_DIR = resolve(WEB_DIR, "e2e/.data");

/** Загружает корневой .env (переменные окружения процесса имеют приоритет). */
export function loadRootEnv() {
  const file = resolve(REPO_ROOT, ".env");
  if (!existsSync(file)) return;
  try {
    process.loadEnvFile(file);
  } catch {
    // нет файла или нет прав — работаем с тем, что задано в окружении
  }
}

function withDbName(databaseUrl, transform) {
  const url = new URL(databaseUrl);
  const name = url.pathname.replace(/^\//, "") || "meteo";
  url.pathname = `/${transform(name)}`;
  return url.toString();
}

/** postgres://user:pass@host:5432/meteo → postgres://user:pass@host:5432/meteo_e2e */
export function deriveE2eDatabaseUrl(databaseUrl) {
  return withDbName(databaseUrl, (name) => (name.endsWith("_e2e") ? name : `${name}_e2e`));
}

/**
 * redis://host:6379 → redis://host:6379/1: отдельная логическая база Redis для кэша API и rate limit
 * сервера E2E. Ключи кэша (`meteo:cache:*`) общие для всех экземпляров web, поэтому без этого
 * сервер E2E читал бы ответы, закэшированные dev-сервером с другой базой PostgreSQL.
 */
export function deriveE2eRedisUrl(redisUrl) {
  const url = new URL(redisUrl);
  if (!url.pathname || url.pathname === "/" || url.pathname === "/0") url.pathname = "/1";
  return url.toString();
}

/** Основная база (из которой выполняются CREATE/DROP DATABASE): суффикс _e2e снимается, если он уже есть. */
export function deriveAdminDatabaseUrl(databaseUrl) {
  return withDbName(databaseUrl, (name) => name.replace(/_e2e$/, ""));
}

export function resolveE2eEnv() {
  loadRootEnv();
  // Дочерние процессы (prepare-db из server.mjs) могут получить DATABASE_URL уже базы E2E — приводим к основной.
  const baseDatabaseUrl = deriveAdminDatabaseUrl(
    process.env.DATABASE_URL ?? "postgres://meteo:meteo@localhost:5432/meteo",
  );
  const port = Number(process.env.E2E_PORT ?? 3100);
  const baseUrl = process.env.E2E_BASE_URL ?? `http://localhost:${port}`;
  return {
    port,
    baseUrl,
    /** БД, из которой выполняются CREATE/DROP DATABASE (основная база разработки или CI). */
    adminDatabaseUrl: process.env.E2E_ADMIN_DATABASE_URL ?? baseDatabaseUrl,
    databaseUrl: process.env.E2E_DATABASE_URL ?? deriveE2eDatabaseUrl(baseDatabaseUrl),
    redisUrl:
      process.env.E2E_REDIS_URL ??
      deriveE2eRedisUrl(process.env.REDIS_URL ?? "redis://localhost:6379"),
    adminEmail: process.env.E2E_ADMIN_EMAIL ?? "admin@meteo.tj",
    adminPassword: process.env.E2E_ADMIN_PASSWORD ?? "E2E-admin-password-2026",
    authSecret:
      process.env.BETTER_AUTH_SECRET ?? "e2e-only-secret-not-for-production-0123456789abcdef",
    dataDir: E2E_DATA_DIR,
    silamDir: resolve(E2E_DATA_DIR, "silam"),
    uploadsDir: resolve(E2E_DATA_DIR, "uploads"),
    importsDir: resolve(E2E_DATA_DIR, "imports"),
  };
}

/** Переменные окружения для web-сервера и для скриптов @meteo/db (migrate/seed). */
export function serverEnv(e2e) {
  return {
    NODE_ENV: "production",
    PORT: String(e2e.port),
    DATABASE_URL: e2e.databaseUrl,
    REDIS_URL: e2e.redisUrl,
    BETTER_AUTH_SECRET: e2e.authSecret,
    BETTER_AUTH_URL: e2e.baseUrl,
    NEXT_PUBLIC_APP_URL: e2e.baseUrl,
    SILAM_DIR: e2e.silamDir,
    UPLOADS_DIR: e2e.uploadsDir,
    IMPORTS_DIR: e2e.importsDir,
    SEED_ADMIN_EMAIL: e2e.adminEmail,
    SEED_ADMIN_PASSWORD: e2e.adminPassword,
    SEED_ADMIN_NAME: "E2E Administrator",
    // Lighthouse и параллельные тесты ходят в API с одного IP — лимит выше боевого (120/мин).
    RATE_LIMIT_API_PER_MINUTE: process.env.RATE_LIMIT_API_PER_MINUTE ?? "600",
    RATE_LIMIT_AUTH_PER_MINUTE: process.env.RATE_LIMIT_AUTH_PER_MINUTE ?? "120",
    NEXT_TELEMETRY_DISABLED: "1",
  };
}
