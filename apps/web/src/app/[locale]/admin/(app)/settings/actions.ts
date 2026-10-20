"use server";

import { randomBytes } from "node:crypto";
import {
  BRANDING_KEY,
  DISPLAY_KEY,
  getBranding,
  getDisplaySettings,
  SMTP_TEST_KEY,
  type SmtpTestState,
  setSetting,
} from "@meteo/db";
import { emailOutbox } from "@meteo/db/schema";
import type { Locale } from "@meteo/i18n";
import { recordAudit } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { requireAdminSession } from "@/lib/session";
import { invalidateBranding, invalidateDisplaySettings } from "@/lib/settings";
import { fieldErrorsOf } from "@/lib/validation/common";
import { brandingInput, displayInput, testEmailInput } from "@/lib/validation/settings";

export type SettingsResult =
  | { ok: true }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

export async function saveBranding(locale: Locale, raw: unknown): Promise<SettingsResult> {
  const session = await requireAdminSession(locale, "settings.write");
  const parsed = brandingInput.safeParse(raw);
  if (!parsed.success)
    return { ok: false, message: "validation", fieldErrors: fieldErrorsOf(parsed.error) };
  const db = getDb();
  const before = await getBranding(db);
  await setSetting(db, BRANDING_KEY, parsed.data, session.user.id);
  invalidateBranding();
  await recordAudit(session, {
    action: "settings.branding.update",
    entity: "settings",
    entityId: BRANDING_KEY,
    before,
    after: parsed.data,
  });
  return { ok: true };
}

/**
 * Единицы отображения концентраций (страницы станций, API, CSV). Хранение не меняется —
 * значения пересчитываются при выводе; кэш настроек web обновляется в течение минуты.
 */
export async function saveDisplaySettings(locale: Locale, raw: unknown): Promise<SettingsResult> {
  const session = await requireAdminSession(locale, "settings.write");
  const parsed = displayInput.safeParse(raw);
  if (!parsed.success)
    return { ok: false, message: "validation", fieldErrors: fieldErrorsOf(parsed.error) };
  const db = getDb();
  const before = await getDisplaySettings(db);
  await setSetting(db, DISPLAY_KEY, parsed.data, session.user.id);
  invalidateDisplaySettings();
  await recordAudit(session, {
    action: "settings.display.update",
    entity: "settings",
    entityId: DISPLAY_KEY,
    before,
    after: parsed.data,
  });
  return { ok: true };
}

export type TestEmailResult =
  | { ok: true; outboxId: number }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

/**
 * Проверка почты: письмо шаблона «test» ставится в email_outbox, отправляет его worker (mailer,
 * раз в минуту). Результат виден на странице настроек по статусу строки очереди.
 */
export async function sendTestEmail(locale: Locale, raw: unknown): Promise<TestEmailResult> {
  const session = await requireAdminSession(locale, "settings.write");
  const parsed = testEmailInput.safeParse(raw);
  if (!parsed.success)
    return { ok: false, message: "validation", fieldErrors: fieldErrorsOf(parsed.error) };
  const db = getDb();
  const at = new Date();
  const [row] = await db
    .insert(emailOutbox)
    .values({
      to: parsed.data.to,
      locale,
      template: "test",
      payload: {
        requestedBy: session.user.email,
        at: at.toLocaleString(locale === "en" ? "en-GB" : "ru-RU", {
          timeZone: "Asia/Dushanbe",
          dateStyle: "medium",
          timeStyle: "short",
        }),
      },
      dedupKey: `test:${at.getTime()}:${randomBytes(4).toString("hex")}`,
    })
    .returning({ id: emailOutbox.id });
  if (!row) return { ok: false, message: "insert" };
  const state: SmtpTestState = {
    outboxId: row.id,
    to: parsed.data.to,
    at: at.toISOString(),
    by: session.user.email,
  };
  await setSetting(db, SMTP_TEST_KEY, state, session.user.id);
  await recordAudit(session, {
    action: "settings.smtp.test",
    entity: "settings",
    entityId: SMTP_TEST_KEY,
    after: state,
  });
  return { ok: true, outboxId: row.id };
}
