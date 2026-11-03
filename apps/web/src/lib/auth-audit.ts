/**
 * Журнал аудита входа и 2FA (FR7.7, docs/02 §10 «все действия — в audit_log»). Вход, выход и
 * управление 2FA идут через клиент better-auth напрямую, минуя server actions, поэтому пишутся
 * из хуков better-auth (lib/auth.ts).
 *
 * События (entity = "auth"):
 *  - auth.signIn — вход по паролю без 2FA;
 *  - auth.signIn.twoFactorRequired — пароль верный, ждём второй фактор;
 *  - auth.signIn.failed — неверный пароль, блокировка, превышение попыток (e‑mail из формы);
 *  - auth.twoFactor.verified / auth.twoFactor.failed — код TOTP или резервный код (вход с 2FA или
 *    подтверждение при настройке);
 *  - auth.twoFactor.enable / auth.twoFactor.disable / auth.twoFactor.backupCodes;
 *  - auth.signOut.
 */
export interface AuthAuditEvent {
  action: string;
  /** Подробности без секретов: способ, код ошибки, e‑mail попытки. */
  details?: Record<string, unknown>;
}

interface ResultInfo {
  /** Эндпоинт завершился ошибкой (APIError). */
  error: { code?: string; status?: number | string } | null;
  /** Ответ эндпоинта: из него берётся только флаг twoFactorRedirect, сам ответ не логируется. */
  returned: unknown;
  /** E‑mail из тела запроса входа. */
  email?: string | null;
}

/** Событие аудита для пути better-auth или null (путь не аудируется). */
export function authAuditEvent(path: string, info: ResultInfo): AuthAuditEvent | null {
  const failed = info.error !== null;
  const errorDetails = info.error
    ? { code: info.error.code ?? String(info.error.status ?? "") }
    : {};
  switch (path) {
    case "/sign-in/email": {
      if (failed)
        return {
          action: "auth.signIn.failed",
          details: { ...errorDetails, email: info.email ?? null },
        };
      const twoFactor =
        typeof info.returned === "object" &&
        info.returned !== null &&
        "twoFactorRedirect" in info.returned &&
        Boolean((info.returned as { twoFactorRedirect?: unknown }).twoFactorRedirect);
      return twoFactor
        ? { action: "auth.signIn.twoFactorRequired" }
        : { action: "auth.signIn", details: { method: "password" } };
    }
    case "/two-factor/verify-totp":
    case "/two-factor/verify-backup-code": {
      const method = path.endsWith("totp") ? "totp" : "backup-code";
      return failed
        ? { action: "auth.twoFactor.failed", details: { method, ...errorDetails } }
        : { action: "auth.twoFactor.verified", details: { method } };
    }
    case "/two-factor/enable":
      return failed ? null : { action: "auth.twoFactor.enable" };
    case "/two-factor/disable":
      return failed ? null : { action: "auth.twoFactor.disable" };
    case "/two-factor/generate-backup-codes":
      return failed ? null : { action: "auth.twoFactor.backupCodes" };
    default:
      return null;
  }
}

export const AUDITED_AUTH_PATHS = new Set([
  "/sign-in/email",
  "/two-factor/verify-totp",
  "/two-factor/verify-backup-code",
  "/two-factor/enable",
  "/two-factor/disable",
  "/two-factor/generate-backup-codes",
]);
