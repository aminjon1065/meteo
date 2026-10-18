"use server";

import { isRole } from "@meteo/core";
import { and, count, eq, ne } from "@meteo/db";
import { twoFactors, users } from "@meteo/db/schema";
import { isLocale, type Locale } from "@meteo/i18n";
import { APIError } from "better-auth/api";
import { headers } from "next/headers";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { requireAdminSession } from "@/lib/session";
import { fieldErrorsOf } from "@/lib/validation/common";

export type UserActionResult =
  | { ok: true }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

const password = z.string().min(10, "password").max(128, "password");
const roleSchema = z.string().refine(isRole, "role");

const createUserInput = z.object({
  name: z.string().trim().min(2, "name").max(120, "name"),
  email: z.string().trim().toLowerCase().pipe(z.email("email")),
  password,
  role: roleSchema,
  locale: z.string().refine(isLocale, "locale"),
});

/** Код ошибки better-auth → ключ сообщения формы. */
function authError(error: unknown): UserActionResult {
  if (error instanceof APIError) {
    const code = (error.body as { code?: string } | undefined)?.code ?? "";
    if (code.includes("USER_ALREADY_EXISTS")) return { ok: false, message: "emailTaken" };
    if (code.includes("PASSWORD")) return { ok: false, message: "password" };
    if (code.includes("NOT_ALLOWED")) return { ok: false, message: "forbidden" };
    if (code.includes("YOURSELF")) return { ok: false, message: "self" };
    return { ok: false, message: error.body?.message ?? "unknown" };
  }
  throw error;
}

async function target(userId: string) {
  const row = await getDb()
    .select({ id: users.id, email: users.email, role: users.role, banned: users.banned })
    .from(users)
    .where(eq(users.id, userId))
    .then((r) => r[0] ?? null);
  return row;
}

/** Последнего активного администратора нельзя понизить, заблокировать или удалить. */
async function isLastAdmin(userId: string): Promise<boolean> {
  const row = await target(userId);
  if (!row || row.role !== "admin") return false;
  const others = await getDb()
    .select({ n: count() })
    .from(users)
    .where(and(eq(users.role, "admin"), ne(users.id, userId), eq(users.banned, false)));
  return (others[0]?.n ?? 0) === 0;
}

export async function createUser(locale: Locale, raw: unknown): Promise<UserActionResult> {
  const session = await requireAdminSession(locale, "users.manage");
  const parsed = createUserInput.safeParse(raw);
  if (!parsed.success)
    return { ok: false, message: "validation", fieldErrors: fieldErrorsOf(parsed.error) };
  const v = parsed.data;
  try {
    const created = await getAuth().api.createUser({
      headers: await headers(),
      body: {
        email: v.email,
        password: v.password,
        name: v.name,
        role: v.role as "admin",
        data: { locale: v.locale },
      },
    });
    await recordAudit(session, {
      action: "user.create",
      entity: "users",
      entityId: created.user.id,
      after: { email: v.email, name: v.name, role: v.role, locale: v.locale },
    });
    return { ok: true };
  } catch (error) {
    return authError(error);
  }
}

export async function setUserRole(
  locale: Locale,
  userId: string,
  role: string,
): Promise<UserActionResult> {
  const session = await requireAdminSession(locale, "users.manage");
  if (!isRole(role)) return { ok: false, message: "validation" };
  if (userId === session.user.id) return { ok: false, message: "self" };
  const before = await target(userId);
  if (!before) return { ok: false, message: "notFound" };
  if (before.role === role) return { ok: true };
  if (role !== "admin" && (await isLastAdmin(userId))) return { ok: false, message: "lastAdmin" };
  try {
    const h = await headers();
    const auth = getAuth();
    await auth.api.setRole({ headers: h, body: { userId, role: role as "admin" } });
    // Смена роли меняет права — все сессии пользователя завершаются принудительно.
    await auth.api.revokeUserSessions({ headers: h, body: { userId } });
    await recordAudit(session, {
      action: "user.role.change",
      entity: "users",
      entityId: userId,
      before: { email: before.email, role: before.role },
      after: { email: before.email, role, sessionsRevoked: true },
    });
    return { ok: true };
  } catch (error) {
    return authError(error);
  }
}

export async function setUserPassword(
  locale: Locale,
  userId: string,
  newPassword: string,
): Promise<UserActionResult> {
  const session = await requireAdminSession(locale, "users.manage");
  const parsed = password.safeParse(newPassword);
  if (!parsed.success) return { ok: false, message: "password" };
  const before = await target(userId);
  if (!before) return { ok: false, message: "notFound" };
  try {
    const h = await headers();
    const auth = getAuth();
    await auth.api.setUserPassword({ headers: h, body: { userId, newPassword: parsed.data } });
    if (userId !== session.user.id)
      await auth.api.revokeUserSessions({ headers: h, body: { userId } });
    await recordAudit(session, {
      action: "user.password.reset",
      entity: "users",
      entityId: userId,
      after: { email: before.email, sessionsRevoked: userId !== session.user.id },
    });
    return { ok: true };
  } catch (error) {
    return authError(error);
  }
}

export async function banUser(
  locale: Locale,
  userId: string,
  reason: string,
  days: number | null,
): Promise<UserActionResult> {
  const session = await requireAdminSession(locale, "users.manage");
  if (userId === session.user.id) return { ok: false, message: "self" };
  const before = await target(userId);
  if (!before) return { ok: false, message: "notFound" };
  if (await isLastAdmin(userId)) return { ok: false, message: "lastAdmin" };
  const banReason = reason.trim().slice(0, 300) || undefined;
  const banExpiresIn =
    days && Number.isFinite(days) && days > 0 ? Math.round(days * 86_400) : undefined;
  try {
    const h = await headers();
    const auth = getAuth();
    await auth.api.banUser({ headers: h, body: { userId, banReason, banExpiresIn } });
    await auth.api.revokeUserSessions({ headers: h, body: { userId } });
    await recordAudit(session, {
      action: "user.ban",
      entity: "users",
      entityId: userId,
      before: { email: before.email, banned: before.banned },
      after: { email: before.email, banned: true, reason: banReason ?? null, days: days ?? null },
    });
    return { ok: true };
  } catch (error) {
    return authError(error);
  }
}

export async function unbanUser(locale: Locale, userId: string): Promise<UserActionResult> {
  const session = await requireAdminSession(locale, "users.manage");
  const before = await target(userId);
  if (!before) return { ok: false, message: "notFound" };
  try {
    await getAuth().api.unbanUser({ headers: await headers(), body: { userId } });
    await recordAudit(session, {
      action: "user.unban",
      entity: "users",
      entityId: userId,
      before: { email: before.email, banned: before.banned },
      after: { email: before.email, banned: false },
    });
    return { ok: true };
  } catch (error) {
    return authError(error);
  }
}

export async function revokeUserSessions(
  locale: Locale,
  userId: string,
): Promise<UserActionResult> {
  const session = await requireAdminSession(locale, "users.manage");
  const before = await target(userId);
  if (!before) return { ok: false, message: "notFound" };
  try {
    await getAuth().api.revokeUserSessions({ headers: await headers(), body: { userId } });
    await recordAudit(session, {
      action: "user.sessions.revoke",
      entity: "users",
      entityId: userId,
      after: { email: before.email },
    });
    return { ok: true };
  } catch (error) {
    return authError(error);
  }
}

/** Сброс 2FA (потеря устройства): секрет и резервные коды удаляются, сессии завершаются. */
export async function resetUserTwoFactor(
  locale: Locale,
  userId: string,
): Promise<UserActionResult> {
  const session = await requireAdminSession(locale, "users.manage");
  const before = await target(userId);
  if (!before) return { ok: false, message: "notFound" };
  const db = getDb();
  await db.delete(twoFactors).where(eq(twoFactors.userId, userId));
  await db.update(users).set({ twoFactorEnabled: false }).where(eq(users.id, userId));
  try {
    await getAuth().api.revokeUserSessions({ headers: await headers(), body: { userId } });
  } catch (error) {
    return authError(error);
  }
  await recordAudit(session, {
    action: "user.twoFactor.reset",
    entity: "users",
    entityId: userId,
    after: { email: before.email, twoFactorEnabled: false },
  });
  return { ok: true };
}

export async function removeUser(locale: Locale, userId: string): Promise<UserActionResult> {
  const session = await requireAdminSession(locale, "users.manage");
  if (userId === session.user.id) return { ok: false, message: "self" };
  const before = await target(userId);
  if (!before) return { ok: false, message: "notFound" };
  if (await isLastAdmin(userId)) return { ok: false, message: "lastAdmin" };
  try {
    await getAuth().api.removeUser({ headers: await headers(), body: { userId } });
    await recordAudit(session, {
      action: "user.delete",
      entity: "users",
      entityId: userId,
      before: { email: before.email, role: before.role },
    });
    return { ok: true };
  } catch (error) {
    return authError(error);
  }
}
