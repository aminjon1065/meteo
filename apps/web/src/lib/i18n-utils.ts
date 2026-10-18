type LooseTranslator = ((
  key: string,
  values?: Record<string, string | number | Date>,
) => string) & {
  has: (key: string) => boolean;
};

/**
 * Перевод по динамическому ключу (коды ошибок сервера) с фолбэком.
 * Типизированный t() next-intl не принимает шаблонные строки, поэтому ослабляем тип здесь, в одном месте.
 */
export function translateOr(
  t: unknown,
  key: string,
  fallback: string,
  values?: Record<string, string | number | Date>,
): string {
  const loose = t as LooseTranslator;
  return loose.has(key) ? loose(key, values) : fallback;
}
