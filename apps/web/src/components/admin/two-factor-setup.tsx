"use client";

import { Badge } from "@meteo/ui/components/badge";
import { Button } from "@meteo/ui/components/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@meteo/ui/components/field";
import { Input } from "@meteo/ui/components/input";
import { Spinner } from "@meteo/ui/components/spinner";
import { CopyIcon, DownloadIcon, ShieldCheckIcon, ShieldIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { renderSVG } from "uqr";
import { useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";

type Step = "idle" | "scan" | "done";

function secretFromUri(uri: string): string {
  try {
    const secret = new URL(uri).searchParams.get("secret") ?? "";
    return secret.replace(/(.{4})/g, "$1 ").trim();
  } catch {
    return "";
  }
}

function errorKey(error: { code?: string; message?: string } | null | undefined): string {
  const code = error?.code ?? "";
  if (/INVALID_PASSWORD|PASSWORD/.test(code)) return "errors.password";
  if (/INVALID_CODE|INVALID_BACKUP/.test(code)) return "errors.invalidCode";
  if (/ALREADY_ENABLED/.test(code)) return "errors.alreadyEnabled";
  if (/TOO_MANY|LOCKED/.test(code)) return "errors.tooManyAttempts";
  return "errors.unknown";
}

/**
 * Включение TOTP‑2FA через better-auth: пароль → секрет (QR и ключ) и резервные коды →
 * подтверждение кодом из приложения. Для уже включённой 2FA — новые резервные коды и
 * отключение (недоступно администраторам: для них 2FA обязательна).
 */
export function TwoFactorSetup({ enabled, mandatory }: { enabled: boolean; mandatory: boolean }) {
  const t = useTranslations("twoFactor");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState<Step>("idle");
  const [password, setPassword] = useState("");
  const [totpUri, setTotpUri] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const qr = useMemo(
    () => (totpUri ? renderSVG(totpUri, { ecc: "M", border: 2 }) : null),
    [totpUri],
  );

  function begin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const { data, error: e } = await authClient.twoFactor.enable({
        password,
        issuer: "Meteoportal",
      });
      if (e || !data || data.method !== "totp") {
        setError(t(errorKey(e) as "errors.unknown"));
        return;
      }
      setTotpUri(data.totpURI);
      setBackupCodes(data.backupCodes);
      setPassword("");
      setStep("scan");
    });
  }

  function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const { error: e } = await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, "") });
      if (e) {
        setError(t(errorKey(e) as "errors.unknown"));
        return;
      }
      setStep("done");
      toast.success(t("done"));
      router.refresh();
    });
  }

  function regenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const { data, error: e } = await authClient.twoFactor.generateBackupCodes({ password });
      if (e || !data) {
        setError(t(errorKey(e) as "errors.unknown"));
        return;
      }
      setBackupCodes(data.backupCodes);
      setPassword("");
      toast.success(t("codesRegenerated"));
    });
  }

  function disable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const { error: e } = await authClient.twoFactor.disable({ password });
      if (e) {
        setError(t(errorKey(e) as "errors.unknown"));
        return;
      }
      setPassword("");
      toast.success(t("disabled"));
      router.refresh();
    });
  }

  async function copyCodes() {
    await navigator.clipboard.writeText(backupCodes.join("\n"));
    toast.success(t("codesCopied"));
  }

  function downloadCodes() {
    const blob = new Blob([`${t("backupCodes")} — Meteoportal\n\n${backupCodes.join("\n")}\n`], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "meteoportal-backup-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t("codesDownloaded"));
  }

  const codesBlock =
    backupCodes.length > 0 ? (
      <section className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3">
        <h3 className="text-sm font-medium">{t("backupCodes")}</h3>
        <p className="text-xs text-muted-foreground">{t("backupHint")}</p>
        <ul className="grid grid-cols-2 gap-1 font-mono text-sm sm:grid-cols-3">
          {backupCodes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={copyCodes}>
            <CopyIcon aria-hidden="true" />
            {t("copy")}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={downloadCodes}>
            <DownloadIcon aria-hidden="true" />
            {t("download")}
          </Button>
        </div>
      </section>
    ) : null;

  if (enabled && step !== "scan") {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-2">
          <ShieldCheckIcon className="size-5 text-status-fresh" aria-hidden="true" />
          <Badge>{t("enabled")}</Badge>
        </div>
        {codesBlock}
        <form onSubmit={regenerate} className="flex flex-col gap-3" noValidate>
          <h2 className="text-sm font-medium">{t("regenerate")}</h2>
          <p className="text-xs text-muted-foreground">{t("regenerateHint")}</p>
          <Field>
            <FieldLabel htmlFor="tf-pw-regen">{t("password")}</FieldLabel>
            <Input
              id="tf-pw-regen"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          {error ? <FieldError>{error}</FieldError> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="outline" disabled={pending || !password}>
              {pending ? <Spinner /> : null}
              {t("regenerate")}
            </Button>
            {mandatory ? (
              <span className="self-center text-xs text-muted-foreground">
                {t("disableForbidden")}
              </span>
            ) : (
              <Button
                type="button"
                variant="destructive"
                disabled={pending || !password}
                onClick={(e) => disable(e as unknown as FormEvent<HTMLFormElement>)}
              >
                {t("disable")}
              </Button>
            )}
          </div>
        </form>
      </div>
    );
  }

  if (step === "scan") {
    return (
      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold">{t("stepScan")}</h2>
          <p className="text-sm text-muted-foreground">{t("scanHint")}</p>
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
            {qr ? (
              <div
                className="size-48 shrink-0 rounded-lg bg-white p-2 [&_svg]:size-full"
                role="img"
                aria-label={t("qrAlt")}
                // biome-ignore lint/security/noDangerouslySetInnerHtml: SVG строится библиотекой uqr из otpauth‑URI без пользовательского HTML
                dangerouslySetInnerHTML={{ __html: qr }}
              />
            ) : null}
            <div className="flex min-w-0 flex-col gap-1 text-sm">
              <span className="text-xs font-medium text-muted-foreground uppercase">
                {t("secret")}
              </span>
              <code className="break-all rounded-md border bg-muted/40 p-2 font-mono text-xs">
                {totpUri ? secretFromUri(totpUri) : ""}
              </code>
            </div>
          </div>
        </section>
        {codesBlock}
        <form onSubmit={verify} className="flex flex-col gap-3" noValidate>
          <h2 className="text-base font-semibold">{t("stepVerify")}</h2>
          <Field>
            <FieldLabel htmlFor="tf-code">{t("code")}</FieldLabel>
            <Input
              id="tf-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]*"
              maxLength={8}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              autoFocus
              className="max-w-40 font-mono text-lg tracking-widest"
            />
            <FieldDescription>{t("codeHint")}</FieldDescription>
          </Field>
          {error ? <FieldError>{error}</FieldError> : null}
          <Button type="submit" disabled={pending || code.replace(/\s/g, "").length < 6}>
            {pending ? <Spinner /> : null}
            {t("verify")}
          </Button>
        </form>
      </div>
    );
  }

  return (
    <form onSubmit={begin} className="flex flex-col gap-4" noValidate>
      <div className="flex items-center gap-2">
        <ShieldIcon className="size-5 text-muted-foreground" aria-hidden="true" />
        <Badge variant="secondary">{t("disabledState")}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">{t("intro")}</p>
      <Field>
        <FieldLabel htmlFor="tf-pw">{t("stepPassword")}</FieldLabel>
        <Input
          id="tf-pw"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoFocus
        />
      </Field>
      {error ? <FieldError>{error}</FieldError> : null}
      <Button type="submit" disabled={pending || !password} className="w-fit">
        {pending ? <Spinner /> : null}
        {t("start")}
      </Button>
    </form>
  );
}
