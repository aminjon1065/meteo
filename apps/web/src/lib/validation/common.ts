import { z } from "zod";

/** Пустая строка из формы → null (для необязательных чисел и дат). */
export const emptyToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

export const localizedText = z.object({
  tg: z.string().trim().max(500).optional().default(""),
  ru: z.string().trim().max(500).optional().default(""),
  en: z.string().trim().max(500).optional().default(""),
});
export type LocalizedTextInput = z.input<typeof localizedText>;

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date");

/** Превращает zod‑ошибки в { "path.to.field": ["msg"] } для форм. */
export function fieldErrorsOf(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    const list = out[key] ?? [];
    list.push(issue.message);
    out[key] = list;
  }
  return out;
}
