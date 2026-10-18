import { z } from "zod";
import { emptyToNull, localizedText } from "./common";

export const newsStatuses = ["draft", "published", "archived"] as const;
export type NewsStatus = (typeof newsStatuses)[number];

/** Длинный трёхъязычный текст (Markdown). */
export const localizedBody = z.object({
  tg: z.string().max(100_000, "max").optional().default(""),
  ru: z.string().max(100_000, "max").optional().default(""),
  en: z.string().max(100_000, "max").optional().default(""),
});

const anyLocale = (t: { tg?: string; ru?: string; en?: string }) =>
  Boolean(t.tg?.trim() || t.ru?.trim() || t.en?.trim());

const optionalId = z
  .preprocess(emptyToNull, z.coerce.number().int().positive().nullable())
  .default(null);

/** Значение <input type="datetime-local"> (местное время Душанбе). */
export const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "date");

export const newsInput = z.object({
  slug: z
    .string()
    .trim()
    .max(128, "max")
    .regex(/^[a-z0-9-]*$/, "format")
    .optional()
    .default(""),
  title: localizedText.refine(anyLocale, { message: "required", path: ["tg"] }),
  excerpt: localizedText.optional(),
  body: localizedBody.refine(anyLocale, { message: "required", path: ["tg"] }),
  categoryId: optionalId,
  coverId: optionalId,
  status: z.enum(newsStatuses).default("draft"),
  publishedAt: z.preprocess(emptyToNull, localDateTime.nullable()).default(null),
  pinned: z.boolean().default(false),
});
export type NewsInput = z.input<typeof newsInput>;
export type NewsValues = z.output<typeof newsInput>;

export const categoryInput = z.object({
  id: z.coerce.number().int().positive().optional(),
  slug: z
    .string()
    .trim()
    .min(1, "required")
    .max(64, "max")
    .regex(/^[a-z0-9-]+$/, "format"),
  name: localizedText.refine(anyLocale, { message: "required", path: ["tg"] }),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
});
export type CategoryInput = z.input<typeof categoryInput>;

export const bulletinInput = z.object({
  subject: localizedText.refine(anyLocale, { message: "required", path: ["tg"] }),
  body: localizedBody.refine(anyLocale, { message: "required", path: ["tg"] }),
  postId: optionalId,
});
export type BulletinInput = z.input<typeof bulletinInput>;
export type BulletinValues = z.output<typeof bulletinInput>;
