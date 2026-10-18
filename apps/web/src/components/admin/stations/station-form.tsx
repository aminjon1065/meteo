"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CONCENTRATION_UNITS, slugify } from "@meteo/core";
import { type I18nText, type Locale, locales, pick } from "@meteo/i18n";
import { Button } from "@meteo/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@meteo/ui/components/card";
import { Checkbox } from "@meteo/ui/components/checkbox";
import { Field, FieldDescription, FieldError, FieldLabel } from "@meteo/ui/components/field";
import { Input } from "@meteo/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@meteo/ui/components/native-select";
import { Spinner } from "@meteo/ui/components/spinner";
import { Switch } from "@meteo/ui/components/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@meteo/ui/components/tabs";
import { Textarea } from "@meteo/ui/components/textarea";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { Controller, type FieldPath, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { StationActionResult } from "@/app/[locale]/admin/(app)/stations/actions";
import { LocationPickerLazy } from "@/components/map/location-picker.lazy";
import { useRouter } from "@/i18n/navigation";
import { translateOr } from "@/lib/i18n-utils";
import {
  type StationInput,
  type StationValues,
  stationDataSources,
  stationInput,
  stationKinds,
  stationSamplings,
  stationStatuses,
} from "@/lib/validation/station";

export interface StationFormOptions {
  regions: Array<{ id: number; name: I18nText }>;
  districts: Array<{ id: number; regionId: number; name: I18nText }>;
  pollutants: Array<{
    id: number;
    code: string;
    shortName: string;
    unit: string;
    molarMass: number | null;
  }>;
}

export interface StationFormProps {
  options: StationFormOptions;
  initial?: Partial<StationInput> & { id?: number };
  action: (raw: StationInput) => Promise<StationActionResult>;
}

const emptyText = { tg: "", ru: "", en: "" };

export function StationForm({ options, initial, action }: StationFormProps) {
  const t = useTranslations("stations");
  const tc = useTranslations("common");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [langTab, setLangTab] = useState<Locale>(locale);

  const form = useForm<StationInput, unknown, StationValues>({
    resolver: zodResolver(stationInput),
    defaultValues: {
      code: "",
      slug: "",
      name: { ...emptyText },
      description: { ...emptyText },
      address: { ...emptyText },
      kind: "air",
      status: "active",
      lat: 38.5598 as unknown as number,
      lon: 68.787 as unknown as number,
      elevationM: "" as unknown as number,
      regionId: "" as unknown as number,
      districtId: "" as unknown as number,
      commissionedAt: "",
      decommissionedAt: "",
      dataSource: "manual",
      sampling: "discrete",
      isPublic: true,
      pollutants: [],
      ...initial,
    },
  });
  const { register, control, handleSubmit, setError, watch, setValue, formState } = form;
  const regionId = Number(watch("regionId"));
  const lat = Number(watch("lat"));
  const lon = Number(watch("lon"));
  const selectedPollutants = watch("pollutants") ?? [];
  const districts = useMemo(
    () => options.districts.filter((d) => !regionId || d.regionId === regionId),
    [options.districts, regionId],
  );

  function errorText(path: string): string | undefined {
    const err = path
      .split(".")
      .reduce<unknown>(
        (acc, key) =>
          acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined,
        formState.errors,
      );
    const message = (err as { message?: string } | undefined)?.message;
    if (!message) return undefined;
    return translateOr(t, `errors.${message}`, message);
  }

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      const result = await action(values as unknown as StationInput);
      if (!result.ok) {
        for (const [path, messages] of Object.entries(result.fieldErrors ?? {})) {
          setError(path as FieldPath<StationInput>, { message: messages[0] });
        }
        toast.error(translateOr(t, `errors.${result.message}`, result.message));
        return;
      }
      toast.success(t("saved"));
      router.push(`/admin/stations/${result.id}`);
      router.refresh();
    });
  });

  function togglePollutant(pollutantId: number, checked: boolean, unit: string) {
    const current = selectedPollutants.filter((p) => p.pollutantId !== pollutantId);
    setValue(
      "pollutants",
      checked
        ? [
            ...current,
            { pollutantId, inputUnit: unit as (typeof CONCENTRATION_UNITS)[number], active: true },
          ]
        : current,
      { shouldDirty: true },
    );
  }

  function setPollutantUnit(pollutantId: number, unit: string) {
    setValue(
      "pollutants",
      selectedPollutants.map((p) =>
        p.pollutantId === pollutantId
          ? { ...p, inputUnit: unit as (typeof CONCENTRATION_UNITS)[number] }
          : p,
      ),
      { shouldDirty: true },
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-6 lg:grid-cols-[2fr_1fr]" noValidate>
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{t("sections.basic")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="code">{t("fields.code")}</FieldLabel>
              <Input
                id="code"
                {...register("code")}
                placeholder="DU-01"
                aria-invalid={Boolean(errorText("code"))}
              />
              <FieldDescription>{t("hints.code")}</FieldDescription>
              {errorText("code") ? <FieldError>{errorText("code")}</FieldError> : null}
            </Field>
            <Field>
              <FieldLabel htmlFor="slug">{t("fields.slug")}</FieldLabel>
              <Input
                id="slug"
                {...register("slug")}
                placeholder={slugify(pick(watch("name") as I18nText, "en") || "")}
                aria-invalid={Boolean(errorText("slug"))}
              />
              <FieldDescription>{t("hints.slug")}</FieldDescription>
              {errorText("slug") ? <FieldError>{errorText("slug")}</FieldError> : null}
            </Field>
            <Field>
              <FieldLabel htmlFor="kind">{t("fields.kind")}</FieldLabel>
              <NativeSelect id="kind" {...register("kind")}>
                {stationKinds.map((k) => (
                  <NativeSelectOption key={k} value={k}>
                    {t(`kind.${k}`)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="status">{t("fields.status")}</FieldLabel>
              <NativeSelect id="status" {...register("status")}>
                {stationStatuses.map((s) => (
                  <NativeSelectOption key={s} value={s}>
                    {t(`status.${s}`)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Controller
              control={control}
              name="isPublic"
              render={({ field }) => (
                <Field orientation="horizontal" className="sm:col-span-2">
                  <Switch
                    id="isPublic"
                    checked={Boolean(field.value)}
                    onCheckedChange={(v) => field.onChange(v)}
                  />
                  <FieldLabel htmlFor="isPublic">{t("fields.isPublic")}</FieldLabel>
                </Field>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("sections.names")}</CardTitle>
            <CardDescription>{t("hints.names")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={langTab} onValueChange={(v) => setLangTab(v as Locale)}>
              <TabsList>
                {locales.map((l) => (
                  <TabsTrigger key={l} value={l}>
                    {l.toUpperCase()}
                  </TabsTrigger>
                ))}
              </TabsList>
              {locales.map((l) => (
                <TabsContent key={l} value={l} className="grid gap-4 pt-2">
                  <Field>
                    <FieldLabel htmlFor={`name-${l}`}>{t("fields.name")}</FieldLabel>
                    <Input
                      id={`name-${l}`}
                      lang={l}
                      {...register(`name.${l}`)}
                      aria-invalid={l === "tg" && Boolean(errorText("name.tg"))}
                    />
                    {l === "tg" && errorText("name.tg") ? (
                      <FieldError>{errorText("name.tg")}</FieldError>
                    ) : null}
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`address-${l}`}>{t("fields.address")}</FieldLabel>
                    <Input id={`address-${l}`} lang={l} {...register(`address.${l}`)} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`description-${l}`}>{t("fields.description")}</FieldLabel>
                    <Textarea
                      id={`description-${l}`}
                      lang={l}
                      rows={3}
                      {...register(`description.${l}`)}
                    />
                  </Field>
                </TabsContent>
              ))}
            </Tabs>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("sections.location")}</CardTitle>
            <CardDescription>{t("hints.location")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="h-80 overflow-hidden rounded-xl border">
              <LocationPickerLazy
                lat={Number.isFinite(lat) ? lat : null}
                lon={Number.isFinite(lon) ? lon : null}
                locale={locale}
                className="h-full w-full"
                onChange={({ lat: la, lon: lo }) => {
                  setValue("lat", la as unknown as number, {
                    shouldDirty: true,
                    shouldValidate: true,
                  });
                  setValue("lon", lo as unknown as number, {
                    shouldDirty: true,
                    shouldValidate: true,
                  });
                }}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field>
                <FieldLabel htmlFor="lat">{t("fields.lat")}</FieldLabel>
                <Input
                  id="lat"
                  type="number"
                  step="0.00001"
                  inputMode="decimal"
                  {...register("lat")}
                  aria-invalid={Boolean(errorText("lat"))}
                />
                {errorText("lat") ? <FieldError>{errorText("lat")}</FieldError> : null}
              </Field>
              <Field>
                <FieldLabel htmlFor="lon">{t("fields.lon")}</FieldLabel>
                <Input
                  id="lon"
                  type="number"
                  step="0.00001"
                  inputMode="decimal"
                  {...register("lon")}
                  aria-invalid={Boolean(errorText("lon"))}
                />
                {errorText("lon") ? <FieldError>{errorText("lon")}</FieldError> : null}
              </Field>
              <Field>
                <FieldLabel htmlFor="elevationM">{t("fields.elevationM")}</FieldLabel>
                <Input
                  id="elevationM"
                  type="number"
                  step="1"
                  inputMode="numeric"
                  {...register("elevationM")}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="regionId">{t("fields.region")}</FieldLabel>
                <NativeSelect id="regionId" {...register("regionId")}>
                  <NativeSelectOption value="">—</NativeSelectOption>
                  {options.regions.map((r) => (
                    <NativeSelectOption key={r.id} value={String(r.id)}>
                      {pick(r.name, locale)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="districtId">{t("fields.district")}</FieldLabel>
                <NativeSelect
                  id="districtId"
                  {...register("districtId")}
                  disabled={districts.length === 0}
                >
                  <NativeSelectOption value="">—</NativeSelectOption>
                  {districts.map((d) => (
                    <NativeSelectOption key={d.id} value={String(d.id)}>
                      {pick(d.name, locale)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                {districts.length === 0 ? (
                  <FieldDescription>{t("hints.noDistricts")}</FieldDescription>
                ) : null}
              </Field>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{t("sections.operation")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Field>
              <FieldLabel htmlFor="dataSource">{t("fields.dataSource")}</FieldLabel>
              <NativeSelect id="dataSource" {...register("dataSource")}>
                {stationDataSources.map((s) => (
                  <NativeSelectOption key={s} value={s}>
                    {t(`dataSource.${s}`)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="sampling">{t("fields.sampling")}</FieldLabel>
              <NativeSelect id="sampling" {...register("sampling")}>
                {stationSamplings.map((s) => (
                  <NativeSelectOption key={s} value={s}>
                    {t(`sampling.${s}`)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <FieldDescription>{t("hints.sampling")}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="commissionedAt">{t("fields.commissionedAt")}</FieldLabel>
              <Input id="commissionedAt" type="date" {...register("commissionedAt")} />
            </Field>
            <Field>
              <FieldLabel htmlFor="decommissionedAt">{t("fields.decommissionedAt")}</FieldLabel>
              <Input
                id="decommissionedAt"
                type="date"
                {...register("decommissionedAt")}
                aria-invalid={Boolean(errorText("decommissionedAt"))}
              />
              {errorText("decommissionedAt") ? (
                <FieldError>{errorText("decommissionedAt")}</FieldError>
              ) : null}
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("sections.pollutants")}</CardTitle>
            <CardDescription>{t("hints.pollutants")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {options.pollutants.map((p) => {
              const selected = selectedPollutants.find((s) => s.pollutantId === p.id);
              const isParticle = p.molarMass === null;
              const units = isParticle
                ? CONCENTRATION_UNITS.filter((u) => u === "µg/m³" || u === "mg/m³")
                : CONCENTRATION_UNITS;
              return (
                <div key={p.id} className="flex items-center gap-3">
                  <Checkbox
                    id={`pollutant-${p.id}`}
                    checked={Boolean(selected)}
                    onCheckedChange={(checked) => togglePollutant(p.id, Boolean(checked), p.unit)}
                  />
                  <label htmlFor={`pollutant-${p.id}`} className="flex-1 text-sm font-medium">
                    {p.shortName}
                  </label>
                  <NativeSelect
                    aria-label={`${p.shortName} unit`}
                    disabled={!selected}
                    value={selected?.inputUnit ?? p.unit}
                    onChange={(e) => setPollutantUnit(p.id, e.target.value)}
                    className="w-28"
                  >
                    {units.map((u) => (
                      <NativeSelectOption key={u} value={u}>
                        {u}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <div className="flex gap-2">
          <Button type="submit" disabled={pending} className="flex-1">
            {pending ? <Spinner /> : null}
            {tc("actions.save")}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.push("/admin/stations")}>
            {tc("actions.cancel")}
          </Button>
        </div>
      </div>
    </form>
  );
}
