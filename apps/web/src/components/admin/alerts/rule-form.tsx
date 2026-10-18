"use client";

import type { I18nText, Locale } from "@meteo/i18n";
import { pick } from "@meteo/i18n";
import { Button } from "@meteo/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@meteo/ui/components/card";
import { Checkbox } from "@meteo/ui/components/checkbox";
import { Field, FieldDescription, FieldError, FieldLabel } from "@meteo/ui/components/field";
import { Input } from "@meteo/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@meteo/ui/components/native-select";
import { Spinner } from "@meteo/ui/components/spinner";
import { Switch } from "@meteo/ui/components/switch";
import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { RuleResult } from "@/app/[locale]/admin/(app)/alerts/actions";
import { useRouter } from "@/i18n/navigation";
import { translateOr } from "@/lib/i18n-utils";

export interface RuleFormValues {
  name: string;
  scope: "all" | "station" | "region";
  stationId: string;
  regionId: string;
  kind: "pollutant" | "index";
  pollutantId: string;
  scaleId: string;
  threshold: string;
  averagingMin: string;
  cooldownMin: string;
  channels: Array<"portal" | "email">;
  enabled: boolean;
}

export interface RuleFormProps {
  options: {
    stations: Array<{ id: number; code: string; name: I18nText }>;
    regions: Array<{ id: number; name: I18nText }>;
    pollutants: Array<{ id: number; shortName: string; unit: string }>;
    scales: Array<{ id: number; code: string; name: I18nText }>;
  };
  initial?: Partial<RuleFormValues>;
  action: (raw: unknown) => Promise<RuleResult>;
  onDelete?: () => Promise<RuleResult>;
}

export function RuleForm({ options, initial, action, onDelete }: RuleFormProps) {
  const t = useTranslations("alerts");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [v, setV] = useState<RuleFormValues>({
    name: "",
    scope: "all",
    stationId: "",
    regionId: "",
    kind: "pollutant",
    pollutantId: String(options.pollutants[0]?.id ?? ""),
    scaleId: String(options.scales[0]?.id ?? ""),
    threshold: "",
    averagingMin: "60",
    cooldownMin: "180",
    channels: ["portal", "email"],
    enabled: true,
    ...initial,
  });
  const set = (patch: Partial<RuleFormValues>) => setV({ ...v, ...patch });
  const err = (field: string) => {
    const m = errors[field]?.[0];
    return m ? translateOr(t, `errors.${m}`, m) : undefined;
  };

  function submit() {
    startTransition(async () => {
      const result = await action(v);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        toast.error(translateOr(t, `errors.${result.message}`, result.message));
        return;
      }
      toast.success(t("saved"));
      router.push("/admin/alerts");
      router.refresh();
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("form.condition")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="name">{t("fields.name")}</FieldLabel>
            <Input
              id="name"
              value={v.name}
              onChange={(e) => set({ name: e.target.value })}
              aria-invalid={Boolean(err("name"))}
            />
            {err("name") ? <FieldError>{err("name")}</FieldError> : null}
          </Field>
          <Field>
            <FieldLabel htmlFor="kind">{t("fields.kind")}</FieldLabel>
            <NativeSelect
              id="kind"
              value={v.kind}
              onChange={(e) => set({ kind: e.target.value as RuleFormValues["kind"] })}
            >
              <NativeSelectOption value="pollutant">{t("kind.pollutant")}</NativeSelectOption>
              <NativeSelectOption value="index">{t("kind.index")}</NativeSelectOption>
            </NativeSelect>
          </Field>
          {v.kind === "pollutant" ? (
            <Field>
              <FieldLabel htmlFor="pollutantId">{t("fields.pollutant")}</FieldLabel>
              <NativeSelect
                id="pollutantId"
                value={v.pollutantId}
                onChange={(e) => set({ pollutantId: e.target.value })}
                aria-invalid={Boolean(err("pollutantId"))}
              >
                {options.pollutants.map((p) => (
                  <NativeSelectOption key={p.id} value={String(p.id)}>
                    {p.shortName} ({p.unit})
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              {err("pollutantId") ? <FieldError>{err("pollutantId")}</FieldError> : null}
            </Field>
          ) : (
            <Field>
              <FieldLabel htmlFor="scaleId">{t("fields.scale")}</FieldLabel>
              <NativeSelect
                id="scaleId"
                value={v.scaleId}
                onChange={(e) => set({ scaleId: e.target.value })}
              >
                {options.scales.map((s) => (
                  <NativeSelectOption key={s.id} value={String(s.id)}>
                    {pick(s.name, locale) || s.code}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          )}
          <Field>
            <FieldLabel htmlFor="threshold">
              {v.kind === "index" ? t("fields.thresholdLevel") : t("fields.threshold")}
            </FieldLabel>
            <Input
              id="threshold"
              inputMode="decimal"
              value={v.threshold}
              onChange={(e) => set({ threshold: e.target.value })}
              aria-invalid={Boolean(err("threshold"))}
            />
            <FieldDescription>
              {v.kind === "index" ? t("hints.thresholdLevel") : t("hints.threshold")}
            </FieldDescription>
            {err("threshold") ? <FieldError>{err("threshold")}</FieldError> : null}
          </Field>
          {v.kind === "pollutant" ? (
            <Field>
              <FieldLabel htmlFor="averagingMin">{t("fields.averaging")}</FieldLabel>
              <NativeSelect
                id="averagingMin"
                value={v.averagingMin}
                onChange={(e) => set({ averagingMin: e.target.value })}
              >
                {["60", "480", "1440"].map((m) => (
                  <NativeSelectOption key={m} value={m}>
                    {t(`averaging.${m}` as "averaging.60")}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          ) : null}
          <Field>
            <FieldLabel htmlFor="scope">{t("fields.scope")}</FieldLabel>
            <NativeSelect
              id="scope"
              value={v.scope}
              onChange={(e) => set({ scope: e.target.value as RuleFormValues["scope"] })}
            >
              <NativeSelectOption value="all">{t("scope.all")}</NativeSelectOption>
              <NativeSelectOption value="station">{t("scope.station")}</NativeSelectOption>
              <NativeSelectOption value="region">{t("scope.region")}</NativeSelectOption>
            </NativeSelect>
          </Field>
          {v.scope === "station" ? (
            <Field>
              <FieldLabel htmlFor="stationId">{t("fields.station")}</FieldLabel>
              <NativeSelect
                id="stationId"
                value={v.stationId}
                onChange={(e) => set({ stationId: e.target.value })}
                aria-invalid={Boolean(err("stationId"))}
              >
                <NativeSelectOption value="">—</NativeSelectOption>
                {options.stations.map((s) => (
                  <NativeSelectOption key={s.id} value={String(s.id)}>
                    {s.code} · {pick(s.name, locale)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              {err("stationId") ? <FieldError>{err("stationId")}</FieldError> : null}
            </Field>
          ) : null}
          {v.scope === "region" ? (
            <Field>
              <FieldLabel htmlFor="regionId">{t("fields.region")}</FieldLabel>
              <NativeSelect
                id="regionId"
                value={v.regionId}
                onChange={(e) => set({ regionId: e.target.value })}
                aria-invalid={Boolean(err("regionId"))}
              >
                <NativeSelectOption value="">—</NativeSelectOption>
                {options.regions.map((r) => (
                  <NativeSelectOption key={r.id} value={String(r.id)}>
                    {pick(r.name, locale)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              {err("regionId") ? <FieldError>{err("regionId")}</FieldError> : null}
            </Field>
          ) : null}
        </CardContent>
      </Card>
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("form.delivery")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            {(["portal", "email"] as const).map((ch) => (
              <div key={ch} className="flex items-center gap-2">
                <Checkbox
                  id={`ch-${ch}`}
                  checked={v.channels.includes(ch)}
                  onCheckedChange={(checked) =>
                    set({
                      channels: checked
                        ? [...new Set([...v.channels, ch])]
                        : v.channels.filter((c) => c !== ch),
                    })
                  }
                />
                <label htmlFor={`ch-${ch}`} className="text-sm">
                  {t(`channels.${ch}`)}
                </label>
              </div>
            ))}
            {err("channels") ? <FieldError>{err("channels")}</FieldError> : null}
            <Field>
              <FieldLabel htmlFor="cooldownMin">{t("fields.cooldown")}</FieldLabel>
              <Input
                id="cooldownMin"
                type="number"
                value={v.cooldownMin}
                onChange={(e) => set({ cooldownMin: e.target.value })}
              />
              <FieldDescription>{t("hints.cooldown")}</FieldDescription>
            </Field>
            <Field orientation="horizontal">
              <Switch
                id="enabled"
                checked={v.enabled}
                onCheckedChange={(c) => set({ enabled: Boolean(c) })}
              />
              <FieldLabel htmlFor="enabled">{t("fields.enabled")}</FieldLabel>
            </Field>
          </CardContent>
        </Card>
        <div className="flex flex-wrap gap-2">
          <Button onClick={submit} disabled={pending} className="flex-1">
            {pending ? <Spinner /> : null}
            {t("save")}
          </Button>
          <Button variant="outline" onClick={() => router.push("/admin/alerts")}>
            {t("back")}
          </Button>
          {onDelete ? (
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const r = await onDelete();
                  if (r.ok) {
                    toast.success(t("deleted"));
                    router.push("/admin/alerts");
                    router.refresh();
                  } else toast.error(r.message);
                })
              }
            >
              {t("delete")}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
