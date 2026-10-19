import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv({ path: resolve(process.cwd(), "../../.env"), quiet: true });
loadEnv({ quiet: true });

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  WORKER_PORT: z.coerce.number().int().positive().default(3001),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(4),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  /** smtp://user:pass@host:587 или smtps://…; без значения письма пишутся в лог (dev). */
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default("Метеопортал <noreply@meteo.tj>"),
  /** Базовый URL портала для ссылок в письмах. */
  PUBLIC_URL: z.string().url().optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
  /** SmartMet Server (плагин timeseries). По умолчанию — открытые данные FMI с глобальной моделью ECMWF. */
  SMARTMET_URL: z.string().url().default("https://opendata.fmi.fi"),
  /** Производитель данных SmartMet; пусто — выбор сервера (для opendata нужен ecmwf). */
  SMARTMET_PRODUCER: z.string().optional(),
  SMARTMET_API_KEY: z.string().optional(),
  SMARTMET_HOURLY_STEPS: z.coerce.number().int().positive().default(72),
  SMARTMET_DAILY_DAYS: z.coerce.number().int().positive().default(10),
  /** THREDDS NCSS SILAM: базовый URL сервиса grid и путь датасета. */
  SILAM_NCSS_URL: z.string().url().default("https://thredds.silam.fmi.fi/thredds/ncss/grid/"),
  SILAM_DATASET: z.string().default("silam_glob_v6_1_sfc/silam_glob_v6_1_sfc_best.ncd"),
  /** Каталог PNG‑слоёв SILAM (общий том с web). */
  SILAM_DIR: z.string().optional(),
  SILAM_KEEP_RUNS: z.coerce.number().int().positive().default(3),
  /** Источник CAP (SmartMet Alert): Atom/RSS‑фид, HTTP‑каталог XML или file://… для фикстур. */
  CAP_FEED_URL: z
    .string()
    .regex(/^(https?|file):\/\//, "ожидается http(s):// или file://")
    .optional(),
  CAP_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  /** Каталог загрузок CMS (общий том с web) — нужен только для ссылок в письмах. */
  UPLOADS_DIR: z.string().optional(),
  /** Устойчивость интеграций: сбоев подряд до уведомления администраторов и до размыкания цепи. */
  INTEGRATION_ALERT_FAILURES: z.coerce.number().int().positive().default(3),
  INTEGRATION_CIRCUIT_FAILURES: z.coerce.number().int().positive().default(3),
  /** Пауза после размыкания цепи (минуты) и её верхняя граница при повторных сбоях. */
  INTEGRATION_CIRCUIT_COOLDOWN_MIN: z.coerce.number().int().positive().default(30),
  INTEGRATION_CIRCUIT_MAX_COOLDOWN_MIN: z.coerce.number().int().positive().default(240),
  /** Дополнительные адреса для служебных уведомлений (через запятую), помимо администраторов портала. */
  ADMIN_ALERT_EMAILS: z.string().optional(),
  /** Ключ шифрования учётных данных источников станций (station_sources); иначе BETTER_AUTH_SECRET. */
  STATION_SOURCES_KEY: z.string().optional(),
  BETTER_AUTH_SECRET: z.string().optional(),
  /** Pull‑адаптер станций: таймаут соединения, предел размера файла, глубина первого прохода. */
  STATION_PULL_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  STATION_PULL_MAX_FILE_MB: z.coerce.number().positive().default(20),
  STATION_PULL_LOOKBACK_DAYS: z.coerce.number().int().positive().default(7),
  /** Через сколько минут без автоматического приёма (ingest API) уведомлять администраторов. */
  STATION_INGEST_STALE_MIN: z.coerce.number().int().positive().default(180),
});

/**
 * Разбор окружения worker'а. Пустые значения (`VAR=` в compose.prod.yml, когда переменная не задана
 * в .env) считаются незаданными — иначе `CAP_FEED_URL=` или `SILAM_DIR=` ломали бы запуск или пути.
 */
export function parseWorkerEnv(raw: Record<string, string | undefined>, cwd = process.cwd()) {
  const cleaned = Object.fromEntries(
    Object.entries(raw).filter(([, v]) => v !== undefined && v !== ""),
  );
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Некорректное окружение worker: ${issues}`);
  }
  return {
    ...parsed.data,
    PUBLIC_URL:
      parsed.data.PUBLIC_URL ?? parsed.data.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    SMARTMET_PRODUCER:
      parsed.data.SMARTMET_PRODUCER ??
      (parsed.data.SMARTMET_URL.includes("opendata.fmi.fi") ? "ecmwf" : undefined),
    SILAM_DIR: parsed.data.SILAM_DIR ?? resolve(cwd, "../../data/silam"),
  };
}

export const env = parseWorkerEnv(process.env);
