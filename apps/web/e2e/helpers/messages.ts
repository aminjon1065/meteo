import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type E2eLocale = "tg" | "ru" | "en";
const cache = new Map<E2eLocale, Record<string, unknown>>();

function load(locale: E2eLocale): Record<string, unknown> {
  let dict = cache.get(locale);
  if (!dict) {
    const file = fileURLToPath(
      new URL(`../../../../packages/i18n/messages/${locale}.json`, import.meta.url),
    );
    dict = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    cache.set(locale, dict);
  }
  return dict;
}

/** Строка интерфейса по пути "ns.key.sub" для локали (без интерполяции ICU). */
export function t(locale: E2eLocale, path: string): string {
  const value = path
    .split(".")
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined,
      load(locale),
    );
  if (typeof value !== "string") throw new Error(`[e2e] нет перевода ${locale}:${path}`);
  return value;
}

/** Префикс пути для локали: tg — без префикса. */
export function prefix(locale: E2eLocale): string {
  return locale === "tg" ? "" : `/${locale}`;
}

export const HTML_LANG: Record<E2eLocale, string> = { tg: "tg-Cyrl-TJ", ru: "ru", en: "en" };
