"use server";

import { asc, eq } from "@meteo/db";
import { qcRules } from "@meteo/db/schema";
import type { Locale } from "@meteo/i18n";
import { recordAudit } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { requireAdminSession } from "@/lib/session";
import { fieldErrorsOf } from "@/lib/validation/common";
import { qcRulesInput } from "@/lib/validation/qc-rules";

export type QcRulesResult =
  | { ok: true }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

type RuleRow = typeof qcRules.$inferSelect;

/** Краткий вид правил для журнала аудита: «вещество/вид → параметры, вкл/выкл». */
function summarize(rows: RuleRow[]) {
  return rows.map((r) => ({
    pollutantId: r.pollutantId,
    kind: r.kind,
    params: r.params,
    enabled: r.enabled,
  }));
}

/**
 * Сохраняет правила QC. Параметры, которых нет в форме (например, windowHours из seed),
 * сохраняются: новые значения дописываются поверх старого params.
 */
export async function saveQcRules(locale: Locale, raw: unknown): Promise<QcRulesResult> {
  const session = await requireAdminSession(locale, "qcRules.write");
  const parsed = qcRulesInput.safeParse(raw);
  if (!parsed.success)
    return { ok: false, message: "validation", fieldErrors: fieldErrorsOf(parsed.error) };
  const { ranges, spike, stuck, outlier } = parsed.data;
  const db = getDb();
  const before = await db.select().from(qcRules).orderBy(asc(qcRules.id));

  await db.transaction(async (tx) => {
    for (const r of ranges) {
      const existing = before.find((b) => b.kind === "range" && b.pollutantId === r.pollutantId);
      const params = { ...(existing?.params ?? {}), min: r.min, max: r.max };
      if (existing) {
        await tx
          .update(qcRules)
          .set({ params, enabled: r.enabled })
          .where(eq(qcRules.id, existing.id));
      } else {
        await tx
          .insert(qcRules)
          .values({ pollutantId: r.pollutantId, kind: "range", params, enabled: r.enabled });
      }
    }
    const general = [
      ["spike", spike],
      ["stuck", stuck],
      ["mad_outlier", outlier],
    ] as const;
    for (const [kind, value] of general) {
      const { enabled, ...rest } = value;
      const existing = before.find((b) => b.kind === kind && b.pollutantId === null);
      const params = { ...(existing?.params ?? {}), ...rest };
      if (existing) {
        await tx.update(qcRules).set({ params, enabled }).where(eq(qcRules.id, existing.id));
      } else {
        await tx.insert(qcRules).values({ pollutantId: null, kind, params, enabled });
      }
    }
  });

  const after = await db.select().from(qcRules).orderBy(asc(qcRules.id));
  await recordAudit(session, {
    action: "qcRules.update",
    entity: "qc_rules",
    before: summarize(before),
    after: summarize(after),
  });
  return { ok: true };
}
