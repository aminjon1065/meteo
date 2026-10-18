import "server-only";
import { maskUrl } from "@meteo/core";
import { type BrandingSettings, EMPTY_BRANDING, getBranding } from "@meteo/db";
import { getDb } from "@/lib/db";

const TTL_MS = 60_000;
let cached: { at: number; value: BrandingSettings } | null = null;

/** Брендинг из settings с кэшем на минуту (шапка и подвал читают его на каждом запросе). */
export async function getBrandingCached(): Promise<BrandingSettings> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  try {
    const value = await getBranding(getDb());
    cached = { at: Date.now(), value };
    return value;
  } catch {
    return cached?.value ?? EMPTY_BRANDING;
  }
}

export function invalidateBranding(): void {
  cached = null;
}

export interface IntegrationEnvSummary {
  smartmet: { url: string | null; producer: string | null; apiKey: boolean };
  silam: {
    url: string | null;
    dataset: string | null;
    dir: string | null;
    keepRuns: string | null;
  };
  cap: { url: string | null; timeoutMs: string | null };
  smtp: { configured: boolean; host: string | null; from: string | null };
  publicUrl: string | null;
  uploadsDir: string | null;
}

function smtpHost(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}${u.port ? `:${u.port}` : ""}`;
  } catch {
    return "***";
  }
}

/**
 * Адреса интеграций из окружения (только чтение). В продакшене эти переменные заданы у worker;
 * если web их не видит, раздел «Настройки» показывает значения, сообщённые worker'ом при последнем
 * запуске (settings.integration.*).
 */
export function readIntegrationEnv(): IntegrationEnvSummary {
  const e = process.env;
  return {
    smartmet: {
      url: maskUrl(e.SMARTMET_URL),
      producer: e.SMARTMET_PRODUCER ?? null,
      apiKey: Boolean(e.SMARTMET_API_KEY),
    },
    silam: {
      url: maskUrl(e.SILAM_NCSS_URL),
      dataset: e.SILAM_DATASET ?? null,
      dir: e.SILAM_DIR ?? null,
      keepRuns: e.SILAM_KEEP_RUNS ?? null,
    },
    cap: { url: maskUrl(e.CAP_FEED_URL), timeoutMs: e.CAP_TIMEOUT_MS ?? null },
    smtp: {
      configured: Boolean(e.SMTP_URL),
      host: smtpHost(e.SMTP_URL),
      from: e.MAIL_FROM ?? null,
    },
    publicUrl: e.NEXT_PUBLIC_APP_URL ?? null,
    uploadsDir: e.UPLOADS_DIR ?? null,
  };
}
