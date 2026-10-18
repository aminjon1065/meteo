import "server-only";
import { can, type Permission } from "@meteo/core";
import type { Locale } from "@meteo/i18n";
import { headers } from "next/headers";
import { redirect } from "@/i18n/navigation";
import { getAuth, type Session } from "./auth";

/**
 * Текущая сессия. `fresh` — читать из БД, минуя cookie‑кэш (5 мин): админка проверяет роль,
 * блокировку и флаг 2FA на каждом запросе, чтобы смена роли, бан или сброс 2FA действовали сразу.
 */
export async function getSession(opts: { fresh?: boolean } = {}): Promise<Session | null> {
  return getAuth().api.getSession({
    headers: await headers(),
    ...(opts.fresh ? { query: { disableCookieCache: true } } : {}),
  });
}

/**
 * Требует авторизованного пользователя с правом доступа в админку.
 * Без сессии — редирект на вход; без права — на страницу «доступ запрещён».
 */
export async function requireAdminSession(
  locale: Locale,
  permission: Permission = "admin.access",
): Promise<Session> {
  const session = await getSession({ fresh: true });
  if (!session) {
    redirect({ href: "/admin/login", locale });
  }
  const s = session as Session;
  if (!can(s.user.role, permission)) {
    redirect({ href: "/admin/forbidden", locale });
  }
  return s;
}

/**
 * Для роли admin двухфакторная аутентификация обязательна (docs/02 §10): без включённого TOTP
 * администратор попадает только на страницу настройки 2FA. Сессия в requireAdminSession читается
 * из БД (fresh), поэтому флаг актуален сразу после включения или сброса 2FA.
 */
export async function enforceAdminTwoFactor(session: Session, locale: Locale): Promise<void> {
  if (session.user.role !== "admin" || session.user.twoFactorEnabled) return;
  redirect({ href: "/admin/two-factor?required=1", locale });
}
