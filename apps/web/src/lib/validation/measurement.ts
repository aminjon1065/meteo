import { z } from "zod";
import { isoDate } from "./common";

export const manualEntryInput = z.object({
  stationId: z.coerce.number().int().positive(),
  date: isoDate,
  rows: z
    .array(
      z.object({
        time: z.string().regex(/^\d{2}:\d{2}$/, "time"),
        values: z.record(z.string(), z.string()),
      }),
    )
    .min(1)
    .max(48),
});
export type ManualEntryInput = z.input<typeof manualEntryInput>;

/** "12,5" → 12.5; пустая строка → null; иначе NaN. */
export function parseDecimal(raw: string): number | null {
  const s = raw.trim().replace(/\s+/g, "").replace(",", ".");
  if (s === "") return null;
  if (!/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(s)) return Number.NaN;
  return Number(s);
}
