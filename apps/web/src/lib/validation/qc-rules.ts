import { z } from "zod";

/**
 * Правила автоматического QC (packages/core/src/qc.ts, packages/db/src/services/qc.ts):
 * диапазон допустимых значений по веществу — проверяется при вводе, импорте и приёме по API;
 * скачки, «залипание» и выбросы относительно 30‑дневной базы — задача qc-batch.
 * Диапазон не удаляется, а выключается: seed при выкатке восстанавливает недостающие.
 */
/** Число из формы: строка с точкой или число; пустое значение — ошибка, а не 0. */
const numeric = z.union([z.number(), z.string().trim().min(1)]).pipe(z.coerce.number());
const finite = numeric.pipe(z.number().finite());
const integer = (min: number, max: number) => numeric.pipe(z.number().int().min(min).max(max));

export const qcRangeInput = z
  .object({
    pollutantId: z.coerce.number().int().positive(),
    min: finite,
    max: finite,
    enabled: z.boolean(),
  })
  .refine((r) => r.min < r.max, { message: "minMax", path: ["max"] });

export const qcRulesInput = z.object({
  ranges: z.array(qcRangeInput).max(200),
  spike: z.object({
    enabled: z.boolean(),
    /** Порог: во сколько MAD значение отличается от медианы соседних значений. */
    madMultiplier: numeric.pipe(z.number().min(1).max(50)),
    /** Минимум значений ряда для проверки. */
    minSamples: integer(3, 1000),
  }),
  stuck: z.object({
    enabled: z.boolean(),
    /** Сколько часов неизменное значение считается «залипанием» (только непрерывные станции). */
    hours: numeric.pipe(z.number().min(1).max(168)),
    /** Минимум одинаковых значений подряд. */
    minRun: integer(2, 1000),
  }),
  outlier: z.object({
    enabled: z.boolean(),
    /** Порог робастного z‑значения относительно 30‑дневной медианы и MAD. */
    z: numeric.pipe(z.number().min(1).max(50)),
    /** Минимум значений в 30‑дневной базе. */
    minBaseline: integer(5, 100_000),
  }),
});
export type QcRulesInput = z.input<typeof qcRulesInput>;
