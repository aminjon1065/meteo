/**
 * Настройки (таблица settings, key/value jsonb) и состояние внешних интеграций:
 * общие помощники для web (админка) и worker (фоновые задачи).
 */
import {
  INTEGRATION_NAMES,
  type IntegrationName,
  type IntegrationState,
  normalizeIntegrationState,
} from "@meteo/core";
import type { I18nText } from "@meteo/i18n";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "../client";
import * as s from "../schema";

export async function getSetting<T>(db: Database, key: string): Promise<T | null> {
  const rows = await db
    .select({ value: s.settings.value })
    .from(s.settings)
    .where(eq(s.settings.key, key))
    .limit(1);
  return (rows[0]?.value as T | undefined) ?? null;
}

export async function getSettingRow<T>(
  db: Database,
  key: string,
): Promise<{ value: T; updatedAt: Date; updatedBy: string | null } | null> {
  const rows = await db
    .select({
      value: s.settings.value,
      updatedAt: s.settings.updatedAt,
      updatedBy: s.settings.updatedBy,
    })
    .from(s.settings)
    .where(eq(s.settings.key, key))
    .limit(1);
  const row = rows[0];
  return row ? { value: row.value as T, updatedAt: row.updatedAt, updatedBy: row.updatedBy } : null;
}

export async function setSetting(
  db: Database,
  key: string,
  value: unknown,
  updatedBy: string | null = null,
): Promise<void> {
  await db
    .insert(s.settings)
    .values({ key, value: value as Record<string, unknown>, updatedBy })
    .onConflictDoUpdate({
      target: s.settings.key,
      set: { value: value as Record<string, unknown>, updatedBy, updatedAt: sql`now()` },
    });
}

// ---------------------------------------------------------------------------
// Состояние интеграций (пишет worker, читает дашборд админки)
// ---------------------------------------------------------------------------

export function integrationKey(name: IntegrationName): string {
  return `integration.${name}`;
}

export async function getIntegrationState(
  db: Database,
  name: IntegrationName,
): Promise<IntegrationState> {
  return normalizeIntegrationState(name, await getSetting(db, integrationKey(name)));
}

export async function getIntegrationStates(
  db: Database,
): Promise<Record<IntegrationName, IntegrationState>> {
  const rows = await db
    .select({ key: s.settings.key, value: s.settings.value })
    .from(s.settings)
    .where(
      inArray(
        s.settings.key,
        INTEGRATION_NAMES.map((n) => integrationKey(n)),
      ),
    );
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  return Object.fromEntries(
    INTEGRATION_NAMES.map((n) => [n, normalizeIntegrationState(n, byKey.get(integrationKey(n)))]),
  ) as Record<IntegrationName, IntegrationState>;
}

export async function setIntegrationState(db: Database, state: IntegrationState): Promise<void> {
  await setSetting(db, integrationKey(state.name), state);
}

// ---------------------------------------------------------------------------
// Брендинг и проверка SMTP
// ---------------------------------------------------------------------------

export interface BrandingSettings {
  /** Название портала (пусто — из переводов интерфейса). */
  siteName: I18nText;
  /** Полное название организации для подвала. */
  agencyName: I18nText;
  email: string;
  phone: string;
  address: I18nText;
  website: string;
  /** Дополнительная строка подвала (например, лицензия или контакты службы поддержки). */
  footerNote: I18nText;
}

export const BRANDING_KEY = "branding";

export const EMPTY_BRANDING: BrandingSettings = {
  siteName: {},
  agencyName: {},
  email: "",
  phone: "",
  address: {},
  website: "",
  footerNote: {},
};

export async function getBranding(db: Database): Promise<BrandingSettings> {
  const raw = await getSetting<Partial<BrandingSettings>>(db, BRANDING_KEY);
  return { ...EMPTY_BRANDING, ...(raw ?? {}) };
}

export interface SmtpTestState {
  outboxId: number;
  to: string;
  at: string;
  by: string;
}

export const SMTP_TEST_KEY = "smtp.lastTest";

export interface AdminRecipient {
  email: string;
  name: string;
  locale: string;
}

/** Активные администраторы — получатели служебных уведомлений (сбои интеграций). */
export async function listAdminRecipients(db: Database): Promise<AdminRecipient[]> {
  return db
    .select({ email: s.users.email, name: s.users.name, locale: s.users.locale })
    .from(s.users)
    .where(and(eq(s.users.role, "admin"), sql`coalesce(${s.users.banned}, false) = false`));
}
