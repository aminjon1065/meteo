/** Подсветка пунктов меню по адресу страницы (верхнее меню и нижняя панель на телефоне). */

/** Текущий раздел: «Главная» только на корне, остальные — по префиксу пути. */
export function isActivePath(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Пункт меню текущей страницы: из совпавших по префиксу — самый длинный адрес, чтобы на вложенном
 * разделе (/air/silam) подсвечивался он, а не родительский (/air).
 */
export function activeNavHref(pathname: string, hrefs: readonly string[]): string | null {
  let best: string | null = null;
  for (const href of hrefs) {
    if (isActivePath(pathname, href) && (best === null || href.length > best.length)) best = href;
  }
  return best;
}
