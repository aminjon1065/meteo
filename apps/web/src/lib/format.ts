import type { I18nText, Locale } from "@meteo/i18n";
import { pick } from "@meteo/i18n";

/** Локализованное имя из jsonb с фолбэком; удобно в server components. */
export function name(text: I18nText | null | undefined, locale: string): string {
  return pick(text, locale as Locale);
}
