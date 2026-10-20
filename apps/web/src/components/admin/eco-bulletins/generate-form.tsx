"use client";

import { type Locale, pick } from "@meteo/i18n";
import { Button } from "@meteo/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@meteo/ui/components/card";
import { Field, FieldError, FieldLabel } from "@meteo/ui/components/field";
import { Input } from "@meteo/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@meteo/ui/components/native-select";
import { Spinner } from "@meteo/ui/components/spinner";
import { useLocale, useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { toast } from "sonner";
import type { StationOption } from "@/app/[locale]/admin/(app)/eco-bulletins/_data";
import type { EcoBulletinResult } from "@/app/[locale]/admin/(app)/eco-bulletins/actions";
import { useRouter } from "@/i18n/navigation";
import { translateOr } from "@/lib/i18n-utils";

/** Форма «Сформировать»: дата (местные сутки) и станция города. */
export function GenerateForm({
  stations,
  defaultDate,
  maxDate,
  action,
}: {
  stations: StationOption[];
  defaultDate: string;
  maxDate: string;
  action: (raw: unknown) => Promise<EcoBulletinResult>;
}) {
  const t = useTranslations("ecoBulletin");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [date, setDate] = useState(defaultDate);
  const [stationId, setStationId] = useState<number>(stations[0]?.id ?? 0);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();
  const err = (key: string) => {
    const code = errors[key]?.[0];
    return code ? translateOr(t, `errors.${code}`, code) : undefined;
  };

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    startTransition(async () => {
      const result = await action({ date, stationId });
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        toast.error(translateOr(t, `errors.${result.message}`, result.message));
        return;
      }
      router.push(`/admin/eco-bulletins/${result.id}`);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("form.title")}</CardTitle>
        <CardDescription>{t("form.hint")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-4" noValidate>
          <Field className="w-48" data-invalid={err("date") ? true : undefined}>
            <FieldLabel htmlFor="date">{t("form.date")}</FieldLabel>
            <Input
              id="date"
              type="date"
              value={date}
              max={maxDate}
              onChange={(e) => setDate(e.target.value)}
              aria-invalid={err("date") ? true : undefined}
              required
            />
            {err("date") ? <FieldError>{err("date")}</FieldError> : null}
          </Field>
          <Field className="min-w-64 flex-1" data-invalid={err("stationId") ? true : undefined}>
            <FieldLabel htmlFor="stationId">{t("form.station")}</FieldLabel>
            <NativeSelect
              id="stationId"
              className="w-full"
              value={String(stationId)}
              onChange={(e) => setStationId(Number(e.target.value))}
              aria-invalid={err("stationId") ? true : undefined}
            >
              {stations.map((s) => (
                <NativeSelectOption key={s.id} value={String(s.id)}>
                  {s.code} — {pick(s.name, locale)}
                  {pick(s.city, locale) ? ` (${pick(s.city, locale)})` : ""}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {err("stationId") ? <FieldError>{err("stationId")}</FieldError> : null}
          </Field>
          <Button type="submit" disabled={pending || stations.length === 0}>
            {pending ? <Spinner /> : null}
            {t("generate")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
