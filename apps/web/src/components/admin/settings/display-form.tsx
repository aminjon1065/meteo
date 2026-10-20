"use client";

import type { ConcentrationDisplayMode } from "@meteo/core";
import type { DisplaySettings } from "@meteo/db";
import { Button } from "@meteo/ui/components/button";
import { Field, FieldDescription, FieldLabel } from "@meteo/ui/components/field";
import { NativeSelect, NativeSelectOption } from "@meteo/ui/components/native-select";
import { Spinner } from "@meteo/ui/components/spinner";
import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { toast } from "sonner";
import type { SettingsResult } from "@/app/[locale]/admin/(app)/settings/actions";
import { useRouter } from "@/i18n/navigation";
import { translateOr } from "@/lib/i18n-utils";

/** Единицы отображения концентраций: единица вещества (µg/m³; CO — mg/m³) или mg/m³ как в бюллетенях Агентства. */
export function DisplayForm({
  initial,
  action,
}: {
  initial: DisplaySettings;
  action: (raw: unknown) => Promise<SettingsResult>;
}) {
  const t = useTranslations("settingsAdmin");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [unit, setUnit] = useState<ConcentrationDisplayMode>(initial.concentrationUnit);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await action({ concentrationUnit: unit });
      if (!result.ok) {
        toast.error(translateOr(t, `errors.${result.message}`, result.message));
        return;
      }
      toast.success(t("display.saved"));
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <Field>
        <FieldLabel htmlFor="display-concentration-unit">
          {t("display.concentrationUnit")}
        </FieldLabel>
        <NativeSelect
          id="display-concentration-unit"
          value={unit}
          onChange={(e) => setUnit(e.target.value as ConcentrationDisplayMode)}
          className="max-w-md"
        >
          <NativeSelectOption value="native">{t("display.options.native")}</NativeSelectOption>
          <NativeSelectOption value="mg/m³">{t("display.options.mg")}</NativeSelectOption>
        </NativeSelect>
        <FieldDescription>{t("display.hint")}</FieldDescription>
      </Field>
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
