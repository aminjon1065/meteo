"use client";

import type { I18nText, Locale } from "@meteo/i18n";
import { pick } from "@meteo/i18n";
import { Alert, AlertDescription, AlertTitle } from "@meteo/ui/components/alert";
import { Button } from "@meteo/ui/components/button";
import { Checkbox } from "@meteo/ui/components/checkbox";
import { Field, FieldDescription, FieldLabel } from "@meteo/ui/components/field";
import { Input } from "@meteo/ui/components/input";
import { Spinner } from "@meteo/ui/components/spinner";
import { MailCheckIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { toast } from "sonner";
import type { SubscribeResult } from "@/app/[locale]/(public)/subscribe/actions";
import { translateOr } from "@/lib/i18n-utils";

export function SubscribeForm({
  stations,
  action,
  initialStation,
}: {
  stations: Array<{ id: number; name: I18nText }>;
  action: (raw: unknown) => Promise<SubscribeResult>;
  initialStation?: number;
}) {
  const t = useTranslations("subscribe");
  const locale = useLocale() as Locale;
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [all, setAll] = useState(!initialStation);
  const [selected, setSelected] = useState<number[]>(initialStation ? [initialStation] : []);
  const [newsletter, setNewsletter] = useState(false);
  const [consent, setConsent] = useState(false);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    startTransition(async () => {
      let r: SubscribeResult;
      try {
        r = await action({
          email: String(form.get("email") ?? ""),
          locale,
          all,
          stations: selected,
          newsletter,
          consent,
          website: String(form.get("website") ?? ""),
        });
      } catch {
        // Лимит запросов (429 от proxy) или сбой сети: сообщение вместо аварийной страницы.
        toast.error(t("errors.rateLimited"));
        return;
      }
      if (!r.ok) {
        toast.error(translateOr(t, `errors.${r.message}`, r.message));
        return;
      }
      setDone(true);
    });
  }

  if (done) {
    return (
      <Alert>
        <MailCheckIcon />
        <AlertTitle>{t("doneTitle")}</AlertTitle>
        <AlertDescription>{t("doneText")}</AlertDescription>
      </Alert>
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-5">
      <Field>
        <FieldLabel htmlFor="email">{t("email")}</FieldLabel>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        className="hidden"
        aria-hidden="true"
      />
      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">{t("topics")}</legend>
        <div className="flex items-center gap-2">
          <Checkbox id="all" checked={all} onCheckedChange={(c) => setAll(Boolean(c))} />
          <label htmlFor="all" className="text-sm">
            {t("allStations")}
          </label>
        </div>
        {!all ? (
          <div className="grid gap-1.5 pl-6 sm:grid-cols-2">
            {stations.map((s) => (
              <div key={s.id} className="flex items-center gap-2">
                <Checkbox
                  id={`st-${s.id}`}
                  checked={selected.includes(s.id)}
                  onCheckedChange={(c) =>
                    setSelected(c ? [...selected, s.id] : selected.filter((x) => x !== s.id))
                  }
                />
                <label htmlFor={`st-${s.id}`} className="text-sm">
                  {pick(s.name, locale)}
                </label>
              </div>
            ))}
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <Checkbox
            id="newsletter"
            checked={newsletter}
            onCheckedChange={(c) => setNewsletter(Boolean(c))}
          />
          <label htmlFor="newsletter" className="text-sm">
            {t("newsletter")}
          </label>
        </div>
      </fieldset>
      <div className="flex items-start gap-2">
        <Checkbox id="consent" checked={consent} onCheckedChange={(c) => setConsent(Boolean(c))} />
        <label htmlFor="consent" className="text-sm text-muted-foreground">
          {t("consent")}
        </label>
      </div>
      <FieldDescription>{t("doubleOptIn")}</FieldDescription>
      <Button type="submit" disabled={pending || !consent} className="w-fit">
        {pending ? <Spinner /> : null}
        {t("submit")}
      </Button>
    </form>
  );
}
