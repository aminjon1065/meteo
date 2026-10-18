"use client";

import { Badge } from "@meteo/ui/components/badge";
import { Button } from "@meteo/ui/components/button";
import { Field, FieldError, FieldLabel } from "@meteo/ui/components/field";
import { Input } from "@meteo/ui/components/input";
import { Spinner } from "@meteo/ui/components/spinner";
import { RefreshCwIcon, SendIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { toast } from "sonner";
import type { TestEmailResult } from "@/app/[locale]/admin/(app)/settings/actions";
import { useRouter } from "@/i18n/navigation";
import { translateOr } from "@/lib/i18n-utils";

export interface LastSmtpTest {
  to: string;
  at: string;
  by: string;
  status: "pending" | "sent" | "failed";
  attempts: number;
  error: string | null;
  sentAt: string | null;
}

/** Отправка тестового письма через очередь и статус последней проверки. */
export function SmtpTestForm({
  defaultTo,
  action,
  last,
}: {
  defaultTo: string;
  action: (raw: unknown) => Promise<TestEmailResult>;
  last: LastSmtpTest | null;
}) {
  const t = useTranslations("settingsAdmin");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [to, setTo] = useState(defaultTo);
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await action({ to });
      if (!result.ok) {
        const message = result.fieldErrors?.to?.[0] ?? result.message;
        setError(translateOr(t, `errors.${message}`, message));
        return;
      }
      toast.success(t("smtp.queued"));
      router.refresh();
    });
  }

  const statusVariant =
    last?.status === "sent" ? "default" : last?.status === "failed" ? "destructive" : "secondary";

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end" noValidate>
        <Field className="flex-1">
          <FieldLabel htmlFor="smtp-to">{t("smtp.to")}</FieldLabel>
          <Input
            id="smtp-to"
            type="email"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            required
            aria-invalid={error ? true : undefined}
          />
          {error ? <FieldError>{error}</FieldError> : null}
        </Field>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : <SendIcon aria-hidden="true" />}
          {t("smtp.send")}
        </Button>
      </form>
      <div className="rounded-lg border bg-muted/40 p-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium">{t("smtp.lastTest")}</span>
          {last ? <Badge variant={statusVariant}>{t(`smtp.status.${last.status}`)}</Badge> : null}
        </div>
        {last ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {t("smtp.statusLine", { to: last.to, at: last.at, by: last.by })}
            {last.sentAt ? ` · ${t("smtp.sentAt", { time: last.sentAt })}` : ""}
            {last.attempts > 0 ? ` · ${t("smtp.attempts", { count: last.attempts })}` : ""}
          </p>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">{t("smtp.none")}</p>
        )}
        {last?.error ? (
          <p className="mt-1 break-words text-xs text-destructive">{last.error}</p>
        ) : null}
        {last?.status === "pending" ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={() => router.refresh()}
          >
            <RefreshCwIcon aria-hidden="true" />
            {t("smtp.refresh")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
