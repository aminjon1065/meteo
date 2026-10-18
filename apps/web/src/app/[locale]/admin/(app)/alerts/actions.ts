"use server";

import { eq } from "@meteo/db";
import { alertEvents, alertRules } from "@meteo/db/schema";
import type { Locale } from "@meteo/i18n";
import { recordAudit } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { requireAdminSession } from "@/lib/session";
import { type RuleValues, ruleInput } from "@/lib/validation/alert-rule";
import { fieldErrorsOf } from "@/lib/validation/common";

export type RuleResult =
  | { ok: true; id: number }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

function toRow(v: RuleValues) {
  return {
    name: v.name,
    scope: v.scope,
    stationId: v.scope === "station" ? v.stationId : null,
    regionId: v.scope === "region" ? v.regionId : null,
    kind: v.kind,
    pollutantId: v.kind === "pollutant" ? v.pollutantId : null,
    scaleId: v.kind === "index" ? v.scaleId : null,
    threshold: v.threshold,
    averagingMin: v.averagingMin,
    cooldownMin: v.cooldownMin,
    channels: v.channels,
    enabled: v.enabled,
  };
}

export async function createRule(locale: Locale, raw: unknown): Promise<RuleResult> {
  const session = await requireAdminSession(locale, "alerts.manage");
  const parsed = ruleInput.safeParse(raw);
  if (!parsed.success)
    return { ok: false, message: "validation", fieldErrors: fieldErrorsOf(parsed.error) };
  const [row] = await getDb()
    .insert(alertRules)
    .values({ ...toRow(parsed.data), createdBy: session.user.id })
    .returning({ id: alertRules.id });
  if (!row) return { ok: false, message: "insert" };
  await recordAudit(session, {
    action: "alertRule.create",
    entity: "alert_rules",
    entityId: row.id,
    after: parsed.data,
  });
  return { ok: true, id: row.id };
}

export async function updateRule(locale: Locale, id: number, raw: unknown): Promise<RuleResult> {
  const session = await requireAdminSession(locale, "alerts.manage");
  const parsed = ruleInput.safeParse(raw);
  if (!parsed.success)
    return { ok: false, message: "validation", fieldErrors: fieldErrorsOf(parsed.error) };
  const db = getDb();
  const before = await db.query.alertRules.findFirst({ where: eq(alertRules.id, id) });
  if (!before) return { ok: false, message: "notFound" };
  await db.update(alertRules).set(toRow(parsed.data)).where(eq(alertRules.id, id));
  await recordAudit(session, {
    action: "alertRule.update",
    entity: "alert_rules",
    entityId: id,
    before,
    after: parsed.data,
  });
  return { ok: true, id };
}

export async function deleteRule(locale: Locale, id: number): Promise<RuleResult> {
  const session = await requireAdminSession(locale, "alerts.manage");
  const db = getDb();
  const before = await db.query.alertRules.findFirst({ where: eq(alertRules.id, id) });
  if (!before) return { ok: false, message: "notFound" };
  await db.delete(alertRules).where(eq(alertRules.id, id));
  await recordAudit(session, {
    action: "alertRule.delete",
    entity: "alert_rules",
    entityId: id,
    before,
  });
  return { ok: true, id };
}

export async function resolveEvent(locale: Locale, id: number): Promise<RuleResult> {
  const session = await requireAdminSession(locale, "alerts.manage");
  await getDb()
    .update(alertEvents)
    .set({ status: "resolved", endedAt: new Date() })
    .where(eq(alertEvents.id, id));
  await recordAudit(session, {
    action: "alertEvent.resolve",
    entity: "alert_events",
    entityId: id,
  });
  return { ok: true, id };
}
