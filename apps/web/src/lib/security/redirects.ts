/**
 * Безопасный адрес возврата после входа (`?next=`): только внутренний путь админки.
 * `//host`, `/\host` (браузеры читают обратный слэш как `/`) и абсолютные URL отбрасываются —
 * иначе страница входа превращается в открытый редирект.
 */
const ADMIN_NEXT = /^\/(?:(?:tg|ru|en)\/)?admin(?:$|[/?#])/;

export function safeAdminNext(next: string | null | undefined): string | undefined {
  if (!next) return undefined;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: управляющие символы в пути отклоняем намеренно
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return undefined;
  if (!next.startsWith("/") || next.startsWith("//")) return undefined;
  return ADMIN_NEXT.test(next) ? next : undefined;
}
