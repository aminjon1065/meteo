/**
 * Локали портала. Таджикский (кириллица) — государственный язык и язык по умолчанию.
 * Порядок важен: он же используется для фолбэка контента (tg → ru → en).
 */
export const locales = ["tg", "ru", "en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "tg";

export const localeNames: Record<Locale, string> = {
  tg: "Тоҷикӣ",
  ru: "Русский",
  en: "English",
};

/** BCP‑47 теги для <html lang> и hreflang. */
export const localeTags: Record<Locale, string> = {
  tg: "tg-Cyrl-TJ",
  ru: "ru",
  en: "en",
};

/** Часовой пояс отображения дат на портале. */
export const displayTimeZone = "Asia/Dushanbe";

/** Локализованная строка, хранимая в БД как jsonb {"tg": "...", "ru": "...", "en": "..."}. */
export type I18nText = Partial<Record<Locale, string>>;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

/**
 * Выбирает перевод для локали с фолбэком по цепочке локалей.
 * Возвращает пустую строку, если ни одного перевода нет.
 */
export function pick(text: I18nText | null | undefined, locale: Locale): string {
  if (!text) return "";
  const own = text[locale];
  if (own?.trim()) return own;
  for (const fallback of locales) {
    const candidate = text[fallback];
    if (candidate?.trim()) return candidate;
  }
  return "";
}

/** Проверяет, что у строки есть переводы на все локали (для валидации в админке). */
export function missingLocales(text: I18nText | null | undefined): Locale[] {
  return locales.filter((l) => !text?.[l]?.trim());
}
