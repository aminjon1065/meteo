"use client";

import type { BrandingSettings } from "@meteo/db";
import { type I18nText, type Locale, localeNames, locales } from "@meteo/i18n";
import { Button } from "@meteo/ui/components/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@meteo/ui/components/field";
import { Input } from "@meteo/ui/components/input";
import { Spinner } from "@meteo/ui/components/spinner";
import { Textarea } from "@meteo/ui/components/textarea";
import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { toast } from "sonner";
import type { SettingsResult } from "@/app/[locale]/admin/(app)/settings/actions";
import { useRouter } from "@/i18n/navigation";
import { translateOr } from "@/lib/i18n-utils";

type Text3 = Record<Locale, string>;
const toText = (t: I18nText | undefined): Text3 => ({
  tg: t?.tg ?? "",
  ru: t?.ru ?? "",
  en: t?.en ?? "",
});

interface Draft {
  siteName: Text3;
  agencyName: Text3;
  email: string;
  phone: string;
  address: Text3;
  website: string;
  footerNote: Text3;
}

function LocalizedField({
  id,
  label,
  hint,
  value,
  onChange,
  multiline,
}: {
  id: string;
  label: string;
  hint?: string;
  value: Text3;
  onChange: (v: Text3) => void;
  multiline?: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">{label}</legend>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      <div className="grid gap-2 md:grid-cols-3">
        {locales.map((l) => (
          <Field key={l}>
            <FieldLabel htmlFor={`${id}-${l}`} className="text-xs text-muted-foreground">
              {localeNames[l]}
            </FieldLabel>
            {multiline ? (
              <Textarea
                id={`${id}-${l}`}
                lang={l}
                rows={2}
                value={value[l]}
                onChange={(e) => onChange({ ...value, [l]: e.target.value })}
              />
            ) : (
              <Input
                id={`${id}-${l}`}
                lang={l}
                value={value[l]}
                onChange={(e) => onChange({ ...value, [l]: e.target.value })}
              />
            )}
          </Field>
        ))}
      </div>
    </fieldset>
  );
}

/** Форма брендинга: название портала, организация, контакты и строка подвала на трёх языках. */
export function BrandingForm({
  initial,
  action,
}: {
  initial: BrandingSettings;
  action: (raw: unknown) => Promise<SettingsResult>;
}) {
  const t = useTranslations("settingsAdmin");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Draft>({
    siteName: toText(initial.siteName),
    agencyName: toText(initial.agencyName),
    email: initial.email,
    phone: initial.phone,
    address: toText(initial.address),
    website: initial.website,
    footerNote: toText(initial.footerNote),
  });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const err = (key: string) => {
    const code = errors[key]?.[0];
    return code ? translateOr(t, `errors.${code}`, code) : undefined;
  };

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    startTransition(async () => {
      const result = await action(draft);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        toast.error(translateOr(t, `errors.${result.message}`, result.message));
        return;
      }
      toast.success(t("branding.saved"));
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      <LocalizedField
        id="siteName"
        label={t("branding.siteName")}
        hint={t("branding.siteNameHint")}
        value={draft.siteName}
        onChange={(v) => setDraft({ ...draft, siteName: v })}
      />
      <LocalizedField
        id="agencyName"
        label={t("branding.agencyName")}
        value={draft.agencyName}
        onChange={(v) => setDraft({ ...draft, agencyName: v })}
        multiline
      />
      <div className="grid gap-4 md:grid-cols-3">
        <Field data-invalid={err("email") ? true : undefined}>
          <FieldLabel htmlFor="branding-email">{t("branding.email")}</FieldLabel>
          <Input
            id="branding-email"
            type="email"
            value={draft.email}
            onChange={(e) => setDraft({ ...draft, email: e.target.value })}
            aria-invalid={err("email") ? true : undefined}
          />
          {err("email") ? <FieldError>{err("email")}</FieldError> : null}
        </Field>
        <Field>
          <FieldLabel htmlFor="branding-phone">{t("branding.phone")}</FieldLabel>
          <Input
            id="branding-phone"
            type="tel"
            value={draft.phone}
            onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
          />
        </Field>
        <Field data-invalid={err("website") ? true : undefined}>
          <FieldLabel htmlFor="branding-website">{t("branding.website")}</FieldLabel>
          <Input
            id="branding-website"
            type="url"
            placeholder="https://"
            value={draft.website}
            onChange={(e) => setDraft({ ...draft, website: e.target.value })}
            aria-invalid={err("website") ? true : undefined}
          />
          {err("website") ? <FieldError>{err("website")}</FieldError> : null}
        </Field>
      </div>
      <LocalizedField
        id="address"
        label={t("branding.address")}
        value={draft.address}
        onChange={(v) => setDraft({ ...draft, address: v })}
      />
      <LocalizedField
        id="footerNote"
        label={t("branding.footerNote")}
        hint={t("branding.footerNoteHint")}
        value={draft.footerNote}
        onChange={(v) => setDraft({ ...draft, footerNote: v })}
        multiline
      />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : null}
          {tc("actions.save")}
        </Button>
        <FieldDescription>{t("branding.publicHint")}</FieldDescription>
      </div>
    </form>
  );
}
