import { describe, expect, it } from "vitest";
import { AUDITED_AUTH_PATHS, authAuditEvent } from "@/lib/auth-audit";

const ok = (returned: unknown = {}) => ({ error: null, returned });
const fail = (code = "INVALID_EMAIL_OR_PASSWORD") => ({
  error: { code, status: "UNAUTHORIZED" },
  returned: null,
  email: "x@meteo.tj",
});

describe("аудит входа и 2FA (FR7.7)", () => {
  it("вход: успех, ожидание второго фактора, неудача с e‑mail попытки", () => {
    expect(authAuditEvent("/sign-in/email", ok({ token: "t" }))?.action).toBe("auth.signIn");
    expect(authAuditEvent("/sign-in/email", ok({ twoFactorRedirect: true }))?.action).toBe(
      "auth.signIn.twoFactorRequired",
    );
    expect(authAuditEvent("/sign-in/email", fail())).toEqual({
      action: "auth.signIn.failed",
      details: { code: "INVALID_EMAIL_OR_PASSWORD", email: "x@meteo.tj" },
    });
  });

  it("второй фактор и управление 2FA", () => {
    expect(authAuditEvent("/two-factor/verify-totp", ok())).toEqual({
      action: "auth.twoFactor.verified",
      details: { method: "totp" },
    });
    expect(authAuditEvent("/two-factor/verify-backup-code", fail("INVALID_CODE"))?.action).toBe(
      "auth.twoFactor.failed",
    );
    expect(authAuditEvent("/two-factor/enable", ok())?.action).toBe("auth.twoFactor.enable");
    expect(authAuditEvent("/two-factor/disable", ok())?.action).toBe("auth.twoFactor.disable");
    expect(authAuditEvent("/two-factor/generate-backup-codes", ok())?.action).toBe(
      "auth.twoFactor.backupCodes",
    );
    // Неудачное включение/выключение (неверный пароль) — не событие изменения.
    expect(authAuditEvent("/two-factor/disable", fail("INVALID_PASSWORD"))).toBeNull();
  });

  it("остальные пути не аудируются", () => {
    expect(authAuditEvent("/get-session", ok())).toBeNull();
    expect(AUDITED_AUTH_PATHS.has("/get-session")).toBe(false);
    for (const p of AUDITED_AUTH_PATHS) expect(authAuditEvent(p, ok())).not.toBeNull();
  });
});
