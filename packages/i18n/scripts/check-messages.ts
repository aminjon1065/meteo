/**
 * Проверяет, что наборы ключей во всех файлах messages/*.json совпадают.
 * Запускается в CI: отсутствующий перевод — ошибка сборки, а не ключ на экране.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const locales = ["tg", "ru", "en"];

function flatten(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value && typeof value === "object" && !Array.isArray(value)
      ? flatten(value as Record<string, unknown>, path)
      : [path];
  });
}

const keysByLocale = new Map<string, Set<string>>();
for (const locale of locales) {
  const raw = readFileSync(join(here, "..", "messages", `${locale}.json`), "utf8");
  keysByLocale.set(locale, new Set(flatten(JSON.parse(raw))));
}

const all = new Set<string>();
for (const keys of keysByLocale.values()) for (const k of keys) all.add(k);

let failed = false;
for (const [locale, keys] of keysByLocale) {
  const missing = [...all].filter((k) => !keys.has(k));
  if (missing.length) {
    failed = true;
    console.error(`[i18n] ${locale}.json: отсутствуют ключи:\n  ${missing.join("\n  ")}`);
  }
}
if (failed) process.exit(1);
console.info(`[i18n] OK: ${all.size} ключей, локали ${locales.join(", ")}`);
