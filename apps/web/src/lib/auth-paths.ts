/**
 * Эндпоинты плагина admin better-auth (/api/auth/admin/*: роль, бан, пароль, создание и удаление
 * пользователей, имперсонация) по HTTP закрыты. Админка вызывает их на сервере через auth.api.*
 * после своих проверок — 2FA администратора, защита последнего администратора, журнал аудита, —
 * а прямой запрос с cookie администратора обходил бы их.
 */
export function isBlockedAuthPath(pathname: string): boolean {
  return /^\/api\/auth\/admin(\/|$)/.test(pathname);
}
