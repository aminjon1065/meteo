"use server";

import { asc, computeStationIndexes, eq } from "@meteo/db";
import {
  healthAdvice,
  indexBreakpoints,
  indexScales,
  limitValues,
  pollutants,
} from "@meteo/db/schema";
import type { Locale } from "@meteo/i18n";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { requireAdminSession } from "@/lib/session";
import { localizedText } from "@/lib/validation/common";

export type SimpleResult =
  | { ok: true }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

const levelDef = z.object({
  level: z.coerce.number().int().min(1).max(5),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/),
  label: localizedText,
  lo: z.coerce.number().optional(),
  hi: z.coerce.number().nullable().optional(),
});

const scaleInput = z.object({
  name: localizedText,
  description: localizedText.optional(),
  isDefaultPublic: z.boolean(),
  enabled: z.boolean(),
  sortOrder: z.coerce.number().int().min(0).max(100),
  levels: z.array(levelDef).min(1),
  /** Для интервальных шкал: по веществу — нижние границы уровней 1..5 и период осреднения. */
  breakpoints: z.array(
    z.object({
      pollutantId: z.coerce.number().int().positive(),
      averagingMin: z.coerce.number().int().positive(),
      /** 5 нижних границ (уровень 1 обычно 0); пустой массив — вещество не участвует. */
      lows: z.array(z.coerce.number()).max(5),
    }),
  ),
});

export async function saveScale(locale: Locale, id: number, raw: unknown): Promise<SimpleResult> {
  const session = await requireAdminSession(locale, "scales.write");
  const parsed = scaleInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "validation" };
  const input = parsed.data;
  const db = getDb();
  const before = await db.query.indexScales.findFirst({ where: eq(indexScales.id, id) });
  if (!before) return { ok: false, message: "notFound" };

  // Валидация порогов: строго возрастающие границы.
  for (const bp of input.breakpoints) {
    if (bp.lows.length === 0) continue;
    if (bp.lows.length !== 5) return { ok: false, message: "fiveLevels" };
    for (let i = 1; i < bp.lows.length; i++) {
      if (!((bp.lows[i] as number) > (bp.lows[i - 1] as number)))
        return { ok: false, message: "monotonic" };
    }
  }
  await db.transaction(async (tx) => {
    await tx
      .update(indexScales)
      .set({
        name: input.name,
        description: input.description ?? null,
        isDefaultPublic: input.isDefaultPublic,
        enabled: input.enabled,
        sortOrder: input.sortOrder,
        levels: input.levels.map((l) => ({
          level: l.level,
          color: l.color,
          label: l.label,
          lo: l.lo,
          hi: l.hi ?? null,
        })),
      })
      .where(eq(indexScales.id, id));
    if (input.isDefaultPublic) {
      await tx
        .update(indexScales)
        .set({ isDefaultPublic: false })
        .where(eq(indexScales.isDefaultPublic, true));
      await tx.update(indexScales).set({ isDefaultPublic: true }).where(eq(indexScales.id, id));
    }
    if (before.kind === "breakpoints") {
      await tx.delete(indexBreakpoints).where(eq(indexBreakpoints.scaleId, id));
      const rows = input.breakpoints.flatMap((bp) =>
        bp.lows.length === 5
          ? bp.lows.map((lo, i) => ({
              scaleId: id,
              pollutantId: bp.pollutantId,
              level: i + 1,
              lo,
              hi: i < 4 ? (bp.lows[i + 1] as number) : null,
              averagingMin: bp.averagingMin,
            }))
          : [],
      );
      if (rows.length) await tx.insert(indexBreakpoints).values(rows);
    }
  });
  await recordAudit(session, {
    action: "scale.update",
    entity: "index_scales",
    entityId: id,
    before: {
      name: before.name,
      isDefaultPublic: before.isDefaultPublic,
      enabled: before.enabled,
      levels: before.levels,
    },
    after: input,
  });
  await computeStationIndexes(db, { hours: 48 }).catch(() => undefined);
  return { ok: true };
}

const limitsInput = z.object({
  rows: z.array(
    z.object({
      pollutantId: z.coerce.number().int().positive(),
      daily: z.coerce.number().positive().nullable(),
      maxSingle: z.coerce.number().positive().nullable(),
      annual: z.coerce.number().positive().nullable(),
      hazardClass: z.coerce.number().int().min(1).max(4).nullable(),
    }),
  ),
});

export async function saveLimits(locale: Locale, raw: unknown): Promise<SimpleResult> {
  const session = await requireAdminSession(locale, "scales.write");
  const parsed = limitsInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "validation" };
  const db = getDb();
  const before = await db.select().from(limitValues);
  await db.transaction(async (tx) => {
    for (const row of parsed.data.rows) {
      await tx
        .update(pollutants)
        .set({ hazardClass: row.hazardClass })
        .where(eq(pollutants.id, row.pollutantId));
      for (const [kind, value] of [
        ["daily", row.daily],
        ["max_single", row.maxSingle],
        ["annual", row.annual],
      ] as const) {
        if (value === null) {
          await tx
            .delete(limitValues)
            .where(eq(limitValues.pollutantId, row.pollutantId) && eq(limitValues.kind, kind));
        } else {
          await tx
            .insert(limitValues)
            .values({
              pollutantId: row.pollutantId,
              kind,
              value,
              source: `admin:${session.user.email}`,
            })
            .onConflictDoUpdate({
              target: [limitValues.pollutantId, limitValues.kind],
              set: { value, source: `admin:${session.user.email}` },
            });
        }
      }
    }
  });
  await recordAudit(session, {
    action: "limits.update",
    entity: "limit_values",
    before,
    after: parsed.data.rows,
  });
  await computeStationIndexes(db, { hours: 48 }).catch(() => undefined);
  return { ok: true };
}

const adviceInput = z.object({
  scaleId: z.coerce.number().int().positive(),
  level: z.coerce.number().int().min(1).max(5),
  entries: z.array(
    z.object({
      audience: z.enum(["general", "children", "pregnant", "elderly", "respiratory", "cardio"]),
      title: localizedText,
      text: localizedText,
    }),
  ),
});

export async function saveHealthAdvice(locale: Locale, raw: unknown): Promise<SimpleResult> {
  const session = await requireAdminSession(locale, "healthAdvice.write");
  const parsed = adviceInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "validation" };
  const { scaleId, level, entries } = parsed.data;
  const db = getDb();
  await db.transaction(async (tx) => {
    for (const e of entries) {
      const empty = !(e.text.tg?.trim() || e.text.ru?.trim() || e.text.en?.trim());
      if (empty) {
        await tx
          .delete(healthAdvice)
          .where(
            eq(healthAdvice.scaleId, scaleId) &&
              eq(healthAdvice.level, level) &&
              eq(healthAdvice.audience, e.audience),
          );
        continue;
      }
      await tx
        .insert(healthAdvice)
        .values({ scaleId, level, audience: e.audience, title: e.title, text: e.text })
        .onConflictDoUpdate({
          target: [healthAdvice.scaleId, healthAdvice.level, healthAdvice.audience],
          set: { title: e.title, text: e.text },
        });
    }
  });
  await recordAudit(session, {
    action: "healthAdvice.update",
    entity: "health_advice",
    entityId: `${scaleId}/${level}`,
    after: entries,
  });
  return { ok: true };
}

/** Справочник веществ для редакторов. */
export async function listPollutants() {
  return getDb()
    .select({
      id: pollutants.id,
      code: pollutants.code,
      shortName: pollutants.shortName,
      unit: pollutants.unit,
      hazardClass: pollutants.hazardClass,
    })
    .from(pollutants)
    .orderBy(asc(pollutants.sortOrder));
}
