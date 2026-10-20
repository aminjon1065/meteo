"use client";

import type { EcoBulletinSettings } from "@meteo/db";
import { type Locale, pick } from "@meteo/i18n";
import { Button } from "@meteo/ui/components/button";
import { Checkbox } from "@meteo/ui/components/checkbox";
import { Field, FieldDescription, FieldLabel } from "@meteo/ui/components/field";
import { Input } from "@meteo/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@meteo/ui/components/native-select";
import { Spinner } from "@meteo/ui/components/spinner";
import { Textarea } from "@meteo/ui/components/textarea";
import { useLocale, useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { toast } from "sonner";
import type { StationOption } from "@/app/[locale]/admin/(app)/eco-bulletins/_data";
import type { EcoBulletinSettingsResult } from "@/app/[locale]/admin/(app)/eco-bulletins/actions";
import { useRouter } from "@/i18n/navigation";
import { translateOr } from "@/lib/i18n-utils";

const LANGS = ["tg", "ru"] as const;

/** Настройки экобюллетеня: расписание, уведомления, станции, подпись, причины, суммация. */
export function EcoBulletinSettingsForm({
  initial,
  stations,
  action,
}: {
  initial: EcoBulletinSettings;
  stations: StationOption[];
  action: (raw: unknown) => Promise<EcoBulletinSettingsResult>;
}) {
  const t = useTranslations("ecoBulletin");
  const tc = useTranslations("common");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [draft, setDraft] = useState<EcoBulletinSettings>(initial);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const r = await action(draft);
      if (!r.ok) {
        toast.error(translateOr(t, `errors.${r.message}`, r.message));
        return;
      }
      toast.success(t("settings.saved"));
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Checkbox
            id="scheduleEnabled"
            checked={draft.scheduleEnabled}
            onCheckedChange={(c) => setDraft({ ...draft, scheduleEnabled: Boolean(c) })}
          />
          <label htmlFor="scheduleEnabled" className="text-sm">
            {t("settings.schedule")}
          </label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="notifyOperators"
            checked={draft.notifyOperators}
            onCheckedChange={(c) => setDraft({ ...draft, notifyOperators: Boolean(c) })}
          />
          <label htmlFor="notifyOperators" className="text-sm">
            {t("settings.notify")}
          </label>
        </div>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">{t("settings.stations")}</legend>
        <p className="text-xs text-muted-foreground">{t("settings.stationsHint")}</p>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {stations.map((s) => (
            <div key={s.id} className="flex items-center gap-2">
              <Checkbox
                id={`st-${s.id}`}
                checked={draft.stationIds.includes(s.id)}
                onCheckedChange={(c) =>
                  setDraft({
                    ...draft,
                    stationIds: c
                      ? [...draft.stationIds, s.id]
                      : draft.stationIds.filter((x) => x !== s.id),
                  })
                }
              />
              <label htmlFor={`st-${s.id}`} className="text-sm">
                {s.code} — {pick(s.name, locale)}
              </label>
            </div>
          ))}
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">{t("settings.department")}</legend>
        <p className="text-xs text-muted-foreground">{t("settings.departmentHint")}</p>
        <div className="grid gap-2 md:grid-cols-2">
          {LANGS.map((l) => (
            <Field key={l}>
              <FieldLabel htmlFor={`department-${l}`} className="text-xs text-muted-foreground">
                {t(`lang.${l}`)}
              </FieldLabel>
              <Input
                id={`department-${l}`}
                lang={l}
                value={draft.department[l]}
                maxLength={120}
                onChange={(e) =>
                  setDraft({ ...draft, department: { ...draft.department, [l]: e.target.value } })
                }
              />
            </Field>
          ))}
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">{t("settings.causes")}</legend>
        <p className="text-xs text-muted-foreground">{t("settings.causesHint")}</p>
        <div className="grid gap-2 md:grid-cols-2">
          {LANGS.map((l) => (
            <Field key={l}>
              <FieldLabel htmlFor={`causes-${l}`} className="text-xs text-muted-foreground">
                {t(`lang.${l}`)}
              </FieldLabel>
              <Textarea
                id={`causes-${l}`}
                lang={l}
                rows={3}
                value={draft.causes[l]}
                maxLength={1000}
                onChange={(e) =>
                  setDraft({ ...draft, causes: { ...draft.causes, [l]: e.target.value } })
                }
              />
            </Field>
          ))}
        </div>
      </fieldset>
      <Field className="max-w-md">
        <FieldLabel htmlFor="summation">{t("settings.summation")}</FieldLabel>
        <NativeSelect
          id="summation"
          className="w-full"
          value={draft.summation}
          onChange={(e) =>
            setDraft({ ...draft, summation: e.target.value === "daily" ? "daily" : "max_single" })
          }
        >
          <NativeSelectOption value="max_single">
            {t("settings.summationMaxSingle")}
          </NativeSelectOption>
          <NativeSelectOption value="daily">{t("settings.summationDaily")}</NativeSelectOption>
        </NativeSelect>
        <FieldDescription>{t("settings.hint")}</FieldDescription>
      </Field>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : null}
          {tc("actions.save")}
        </Button>
      </div>
    </form>
  );
}
