import "server-only";
import { can, type Permission } from "@meteo/core";
import type { Locale } from "@meteo/i18n";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
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
 * Для роли admin двухфакторная аутентификация обязательна (docs/02 §10): без включённого TOTP
 * администратор может только настроить 2FA. Проверка выполняется и для страниц (layout админки),
 * и для каждого server action / route handler — иначе администратор без 2FA мог бы вызывать
 * изменяющие действия напрямую, минуя страницу настройки.
 */
export function adminTwoFactorMissing(session: Session): boolean {
  return session.user.role === "admin" && !session.user.twoFactorEnabled;
}

/**
 * Требует авторизованного пользователя с правом доступа в админку.
 * Без сессии — редирект на вход; без права — на страницу «доступ запрещён»;
 * администратор без 2FA — на обязательную настройку 2FA.
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
  if (adminTwoFactorMissing(s)) {
    redirect({ href: "/admin/two-factor?required=1", locale });
  }
  return s;
}

/** Совместимость: отдельная проверка 2FA для layout админки (requireAdminSession уже делает её). */
export async function enforceAdminTwoFactor(session: Session, locale: Locale): Promise<void> {
  if (!adminTwoFactorMissing(session)) return;
  redirect({ href: "/admin/two-factor?required=1", locale });
}

/**
 * Проверка сессии для route handlers админки (/api/admin/*): сессия из БД (без cookie‑кэша),
 * право по матрице ролей и обязательная 2FA администратора. Возвращает сессию или готовый
 * ответ 401/403.
 */
export async function requireApiSession(
  permission: Permission,
): Promise<{ session: Session; response?: never } | { session?: never; response: NextResponse }> {
  const session = await getSession({ fresh: true });
  if (!session) {
    return { response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  if (!can(session.user.role, permission)) {
    return { response: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  if (adminTwoFactorMissing(session)) {
    return {
      response: NextResponse.json({ error: "two_factor_required" }, { status: 403 }),
    };
  }
  return { session };
}
