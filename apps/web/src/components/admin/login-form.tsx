"use client";

import { Button } from "@meteo/ui/components/button";
import { Checkbox } from "@meteo/ui/components/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@meteo/ui/components/field";
import { Input } from "@meteo/ui/components/input";
import { Spinner } from "@meteo/ui/components/spinner";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";

type Stage = "credentials" | "totp" | "backup";

function errorKey(error: { code?: string; status?: number } | null | undefined): string {
  const code = error?.code ?? "";
  if (code === "BANNED_USER") return "banned";
  if (/TOO_MANY|LOCKED/.test(code) || error?.status === 429) return "tooManyAttempts";
  if (/INVALID_CODE|INVALID_BACKUP_CODE|INVALID_TWO_FACTOR/.test(code)) return "invalidCode";
  return "invalidCredentials";
}

/**
 * Вход в админку: e‑mail + пароль, затем — при включённой 2FA — код TOTP или резервный код
 * (с возможностью доверять устройству 30 дней). Администратор без 2FA после входа попадает
 * на обязательную настройку (/admin/two-factor).
 */
export function LoginForm({ next }: { next?: string }) {
  const t = useTranslations("auth");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("credentials");
  const [trustDevice, setTrustDevice] = useState(false);
  const target = next ?? "/admin";

  function finish() {
    router.push(target);
    router.refresh();
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);

    if (stage === "totp" || stage === "backup") {
      const code = String(form.get("code") ?? "").replace(/\s/g, "");
      const result =
        stage === "totp"
          ? await authClient.twoFactor.verifyTotp({ code, trustDevice })
          : await authClient.twoFactor.verifyBackupCode({ code, trustDevice });
      setPending(false);
      if (result.error) {
        setError(t(errorKey(result.error) as "invalidCode"));
        return;
      }
      finish();
      return;
    }

    const { data, error: signInError } = await authClient.signIn.email({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    });
    setPending(false);
    if (signInError) {
      setError(t(errorKey(signInError) as "invalidCredentials"));
      return;
    }
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
      setStage("totp");
      return;
    }
    finish();
  }

  const secondFactor = stage === "totp" || stage === "backup";

  return (
    <form onSubmit={onSubmit} noValidate>
      <FieldGroup>
        {secondFactor ? (
          <>
            <Field>
              <FieldLabel htmlFor="code">
                {stage === "totp" ? t("totpTitle") : t("backupCode")}
              </FieldLabel>
              <Input
                key={stage}
                id="code"
                name="code"
                inputMode={stage === "totp" ? "numeric" : "text"}
                autoComplete="one-time-code"
                autoCapitalize="off"
                spellCheck={false}
                required
                autoFocus
                className="font-mono tracking-widest"
              />
              <FieldDescription>
                {stage === "totp" ? t("totpHint") : t("backupHint")}
              </FieldDescription>
            </Field>
            <Field orientation="horizontal">
              <Checkbox
                id="trust"
                checked={trustDevice}
                onCheckedChange={(v) => setTrustDevice(Boolean(v))}
              />
              <FieldLabel htmlFor="trust" className="font-normal">
                {t("trustDevice")}
              </FieldLabel>
            </Field>
          </>
        ) : (
          <>
            <Field>
              <FieldLabel htmlFor="email">{t("email")}</FieldLabel>
              <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
            </Field>
            <Field>
              <FieldLabel htmlFor="password">{t("password")}</FieldLabel>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </Field>
          </>
        )}
        {error ? <FieldError role="alert">{error}</FieldError> : null}
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? <Spinner /> : null}
          {pending ? t("signingIn") : secondFactor ? t("verify") : t("signIn")}
        </Button>
        {secondFactor ? (
          <div className="flex flex-wrap justify-between gap-2 text-sm">
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0"
              onClick={() => {
                setError(null);
                setStage(stage === "totp" ? "backup" : "totp");
              }}
            >
              {stage === "totp" ? t("useBackupCode") : t("useTotp")}
            </Button>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 text-muted-foreground"
              onClick={() => {
                setError(null);
                setStage("credentials");
              }}
            >
              {t("back")}
            </Button>
          </div>
        ) : null}
      </FieldGroup>
    </form>
  );
}
