"use server";

import { QC_FLAG } from "@meteo/core";
import { and, computeStationIndexes, eq } from "@meteo/db";
import { measurements } from "@meteo/db/schema";
import type { Locale } from "@meteo/i18n";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { requireAdminSession } from "@/lib/session";
import { parseDecimal } from "@/lib/validation/measurement";

const keySchema = z.object({
  time: z.string().datetime(),
  stationId: z.coerce.number().int().positive(),
  pollutantId: z.coerce.number().int().positive(),
  averagingMin: z.coerce.number().int().positive(),
});
const decisionSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("confirm"), reason: z.string().trim().max(300).optional() }),
  z.object({ decision: z.literal("reject"), reason: z.string().trim().min(2).max(300) }),
  z.object({
    decision: z.literal("correct"),
    value: z.string().trim().min(1),
    reason: z.string().trim().min(2).max(300),
  }),
]);

export type QcDecisionResult = { ok: true } | { ok: false; message: string };

/** Решение оператора по подозрительному/недостоверному значению: подтвердить, отклонить или скорректировать. */
export async function resolveMeasurement(
  locale: Locale,
  rawKey: unknown,
  rawDecision: unknown,
): Promise<QcDecisionResult> {
  const session = await requireAdminSession(locale, "measurements.qc");
  const key = keySchema.safeParse(rawKey);
  const decision = decisionSchema.safeParse(rawDecision);
  if (!key.success || !decision.success) return { ok: false, message: "validation" };
  const db = getDb();
  const where = and(
    eq(measurements.time, new Date(key.data.time)),
    eq(measurements.stationId, key.data.stationId),
    eq(measurements.pollutantId, key.data.pollutantId),
    eq(measurements.averagingMin, key.data.averagingMin),
  );
  const before = await db.query.measurements.findFirst({ where });
  if (!before) return { ok: false, message: "notFound" };

  let set: Partial<typeof measurements.$inferInsert>;
  const d = decision.data;
  if (d.decision === "confirm") {
    set = {
      qcFlag: QC_FLAG.valid,
      qcLocked: true,
      qcReason: `confirmed:${before.qcReason ?? ""}`.slice(0, 200),
    };
  } else if (d.decision === "reject") {
    set = {
      qcFlag: QC_FLAG.invalid,
      qcLocked: true,
      qcReason: `rejected:${d.reason}`.slice(0, 200),
    };
  } else {
    const value = parseDecimal(d.value);
    if (value === null || Number.isNaN(value)) return { ok: false, message: "value" };
    set = {
      value,
      originalValue: before.originalValue ?? before.value,
      qcFlag: QC_FLAG.corrected,
      qcLocked: true,
      qcReason: `corrected:${d.reason}`.slice(0, 200),
    };
  }
  await db
    .update(measurements)
    .set({ ...set, updatedBy: session.user.id, updatedAt: new Date() })
    .where(where);
  await recordAudit(session, {
    action: `measurement.${d.decision}`,
    entity: "measurements",
    entityId: `${key.data.stationId}/${key.data.pollutantId}/${key.data.time}`,
    before: { value: before.value, qcFlag: before.qcFlag, qcReason: before.qcReason },
    after: { value: set.value ?? before.value, qcFlag: set.qcFlag, qcReason: set.qcReason },
  });
  const t = new Date(key.data.time).getTime();
  await computeStationIndexes(db, {
    stationIds: [key.data.stationId],
    since: new Date(t - 24 * 3_600_000),
    until: new Date(t + 3_600_000),
  }).catch(() => undefined);
  return { ok: true };
}
