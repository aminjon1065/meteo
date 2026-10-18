import { z } from "zod";
import { localizedText } from "./common";

const optionalEmail = z
  .string()
  .trim()
  .max(254)
  .refine((v) => v === "" || z.email().safeParse(v).success, "email");

const optionalUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === "" || /^https?:\/\/\S+$/i.test(v), "url");

/** Брендинг портала: название, организация, контакты и строка подвала. */
export const brandingInput = z.object({
  siteName: localizedText,
  agencyName: localizedText,
  email: optionalEmail,
  phone: z.string().trim().max(64),
  address: localizedText,
  website: optionalUrl,
  footerNote: localizedText,
});
export type BrandingInput = z.input<typeof brandingInput>;
export type BrandingValues = z.output<typeof brandingInput>;

export const testEmailInput = z.object({
  to: z.string().trim().toLowerCase().pipe(z.email("email")),
});
