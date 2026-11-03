import "server-only";
import { accounts, auditLog, sessions, twoFactors, users, verifications } from "@meteo/db/schema";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware, getSessionFromCtx, isAPIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { admin, twoFactor } from "better-auth/plugins";
import { AUDITED_AUTH_PATHS, type AuthAuditEvent, authAuditEvent } from "./auth-audit";
import { getDb } from "./db";
import { env } from "./env";

interface AuditActor {
  id?: string | null;
  email?: string | null;
  role?: string | null;
}

/** Запись события входа/2FA в audit_log; сбой журнала не должен ломать вход. */
async function writeAuthAudit(
  headers: Headers | undefined,
  event: AuthAuditEvent,
  actor: AuditActor | null,
): Promise<void> {
  try {
    const forwarded = headers?.get("x-forwarded-for");
    await getDb()
      .insert(auditLog)
      .values({
        actorId: actor?.id ?? null,
        actorEmail: actor?.email?.slice(0, 254) ?? null,
        actorRole: actor?.role?.slice(0, 16) ?? null,
        action: event.action,
        entity: "auth",
        entityId: actor?.id ?? null,
        after: event.details ?? null,
        ip: forwarded?.split(",")[0]?.trim() ?? headers?.get("x-real-ip") ?? null,
        userAgent: headers?.get("user-agent") ?? null,
        requestId: headers?.get("x-request-id") ?? null,
      });
  } catch (error) {
    console.error("[auth] не удалось записать аудит", event.action, error);
  }
}

type SessionUser = { id: string; email: string; role?: string | null };
const actorOf = (user: SessionUser | null | undefined): AuditActor | null =>
  user ? { id: user.id, email: user.email, role: user.role ?? null } : null;

/**
 * Попыток входа и проверки кода 2FA в минуту с одного IP (защита от подбора пароля). В бою — 5;
 * больше только для E2E, где все тесты входят с 127.0.0.1 (e2e/setup/env.mjs).
 */
const signInAttemptsPerMinute = Math.max(1, Number(process.env.AUTH_SIGN_IN_PER_MINUTE) || 5);

function createAuth() {
  const e = env();
  return betterAuth({
    appName: "Meteoportal",
    baseURL: e.BETTER_AUTH_URL ?? e.NEXT_PUBLIC_APP_URL,
    secret: e.BETTER_AUTH_SECRET,
    trustedOrigins: [e.NEXT_PUBLIC_APP_URL],
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      usePlural: true,
      schema: { users, sessions, accounts, verifications, twoFactors },
    }),
    emailAndPassword: {
      enabled: true,
      // Самостоятельная регистрация закрыта: пользователей создаёт администратор.
      disableSignUp: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      requireEmailVerification: false,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    user: {
      additionalFields: {
        locale: { type: "string", defaultValue: "tg", input: false },
      },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 30,
      customRules: {
        "/sign-in/email": { window: 60, max: signInAttemptsPerMinute },
        "/two-factor/verify-totp": { window: 60, max: signInAttemptsPerMinute },
      },
    },
    hooks: {
      // Выход: сессию нужно прочитать до того, как better-auth её удалит.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-out") return;
        const session = await getSessionFromCtx(ctx).catch(() => null);
        if (session)
          await writeAuthAudit(ctx.headers, { action: "auth.signOut" }, actorOf(session.user));
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (!AUDITED_AUTH_PATHS.has(ctx.path)) return;
        const returned = ctx.context.returned;
        const apiError = isAPIError(returned) ? returned : null;
        const body = (ctx.body ?? {}) as { email?: unknown };
        const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : null;
        const event = authAuditEvent(ctx.path, {
          error: apiError
            ? {
                code: (apiError.body as { code?: string } | undefined)?.code,
                status: apiError.status,
              }
            : null,
          returned,
          email,
        });
        if (!event) return;
        const user =
          (ctx.context.newSession?.user as SessionUser | undefined) ??
          (ctx.context.session?.user as SessionUser | undefined);
        await writeAuthAudit(ctx.headers, event, actorOf(user) ?? (email ? { email } : null));
      }),
    },
    plugins: [
      admin({ defaultRole: "editor", adminRoles: ["admin"] }),
      twoFactor({ issuer: "Meteoportal" }),
      nextCookies(),
    ],
  });
}

const globalRef = globalThis as unknown as { __meteoAuth?: ReturnType<typeof createAuth> };

export function getAuth() {
  if (!globalRef.__meteoAuth) {
    globalRef.__meteoAuth = createAuth();
  }
  return globalRef.__meteoAuth;
}

export type Auth = ReturnType<typeof createAuth>;
export type Session = Auth["$Infer"]["Session"];
