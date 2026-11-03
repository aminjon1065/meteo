"use client";

import { Button } from "@meteo/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@meteo/ui/components/card";
import { Checkbox } from "@meteo/ui/components/checkbox";
import { Field, FieldDescription, FieldLabel } from "@meteo/ui/components/field";
import { Input } from "@meteo/ui/components/input";
import { Spinner } from "@meteo/ui/components/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@meteo/ui/components/table";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { QcRulesResult } from "@/app/[locale]/admin/(app)/qc-rules/actions";
import { useRouter } from "@/i18n/navigation";
import { translateOr } from "@/lib/i18n-utils";

interface RangeRow {
  min: string;
  max: string;
  enabled: boolean;
}

export interface QcRulesEditorProps {
  pollutants: Array<{ id: number; shortName: string; unit: string }>;
  ranges: Array<{ pollutantId: number; min: number; max: number; enabled: boolean }>;
  spike: { enabled: boolean; madMultiplier: number; minSamples: number };
  stuck: { enabled: boolean; hours: number; minRun: number };
  outlier: { enabled: boolean; z: number; minBaseline: number };
  action: (raw: unknown) => Promise<QcRulesResult>;
}

type General = {
  spike: { enabled: boolean; madMultiplier: string; minSamples: string };
  stuck: { enabled: boolean; hours: string; minRun: string };
  outlier: { enabled: boolean; z: string; minBaseline: string };
};

/** Значение поля для сервера: десятичная запятая → точка; пустая строка отклоняется валидацией. */
const toNum = (v: string) => v.trim().replace(",", ".");

/** Редактор правил QC: диапазоны допустимых значений по веществам и параметры пакетных проверок. */
export function QcRulesEditor({
  pollutants,
  ranges,
  spike,
  stuck,
  outlier,
  action,
}: QcRulesEditorProps) {
  const t = useTranslations("qcRules");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [rows, setRows] = useState<Record<number, RangeRow>>(() => {
    const out: Record<number, RangeRow> = {};
    for (const p of pollutants) {
      const r = ranges.find((x) => x.pollutantId === p.id);
      out[p.id] = r
        ? { min: String(r.min), max: String(r.max), enabled: r.enabled }
        : { min: "", max: "", enabled: false };
    }
    return out;
  });
  const [general, setGeneral] = useState<General>({
    spike: {
      enabled: spike.enabled,
      madMultiplier: String(spike.madMultiplier),
      minSamples: String(spike.minSamples),
    },
    stuck: { enabled: stuck.enabled, hours: String(stuck.hours), minRun: String(stuck.minRun) },
    outlier: {
      enabled: outlier.enabled,
      z: String(outlier.z),
      minBaseline: String(outlier.minBaseline),
    },
  });
  // Вещества без заданного диапазона не отправляются (пустая строка — «правило не создано»).
  const sent = pollutants.filter((p) => {
    const r = rows[p.id] as RangeRow;
    return r.min.trim() !== "" || r.max.trim() !== "" || ranges.some((x) => x.pollutantId === p.id);
  });

  function submit() {
    startTransition(async () => {
      const result = await action({
        ranges: sent.map((p) => {
          const r = rows[p.id] as RangeRow;
          return { pollutantId: p.id, min: toNum(r.min), max: toNum(r.max), enabled: r.enabled };
        }),
        spike: {
          enabled: general.spike.enabled,
          madMultiplier: toNum(general.spike.madMultiplier),
          minSamples: toNum(general.spike.minSamples),
        },
        stuck: {
          enabled: general.stuck.enabled,
          hours: toNum(general.stuck.hours),
          minRun: toNum(general.stuck.minRun),
        },
        outlier: {
          enabled: general.outlier.enabled,
          z: toNum(general.outlier.z),
          minBaseline: toNum(general.outlier.minBaseline),
        },
      });
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        toast.error(translateOr(t, `errors.${result.message}`, result.message));
        return;
      }
      setErrors({});
      toast.success(t("saved"));
      router.refresh();
    });
  }

  const rangeError = (pollutantId: number, field: "min" | "max") => {
    const index = sent.findIndex((p) => p.id === pollutantId);
    return index >= 0 && Boolean(errors[`ranges.${index}.${field}`]);
  };

  const numberField = <K extends keyof General, F extends Exclude<keyof General[K], "enabled">>(
    group: K,
    field: F,
    label: string,
    hint: string,
  ) => {
    const id = `qc-${group}-${String(field)}`;
    const invalid = Boolean(errors[`${group}.${String(field)}`]);
    return (
      <Field>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <Input
          id={id}
          inputMode="decimal"
          value={general[group][field] as string}
          aria-invalid={invalid || undefined}
          onChange={(e) =>
            setGeneral({ ...general, [group]: { ...general[group], [field]: e.target.value } })
          }
          className="max-w-32"
        />
        <FieldDescription>{hint}</FieldDescription>
      </Field>
    );
  };

  const enabledToggle = (group: keyof General, label: string) => (
    <div className="flex items-center gap-2">
      <Checkbox
        id={`qc-${group}-enabled`}
        checked={general[group].enabled}
        onCheckedChange={(checked) =>
          setGeneral({ ...general, [group]: { ...general[group], enabled: Boolean(checked) } })
        }
      />
      <label htmlFor={`qc-${group}-enabled`} className="text-sm font-medium">
        {label}
      </label>
    </div>
  );

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("ranges.title")}</CardTitle>
          <CardDescription>{t("ranges.hint")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("ranges.pollutant")}</TableHead>
                <TableHead>{t("ranges.min")}</TableHead>
                <TableHead>{t("ranges.max")}</TableHead>
                <TableHead className="w-28">{t("enabled")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pollutants.map((p) => {
                const r = rows[p.id] as RangeRow;
                const set = (patch: Partial<RangeRow>) =>
                  setRows({ ...rows, [p.id]: { ...r, ...patch } });
                return (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">
                      {p.shortName} <span className="text-xs text-muted-foreground">{p.unit}</span>
                    </TableCell>
                    <TableCell>
                      <Input
                        inputMode="decimal"
                        value={r.min}
                        aria-invalid={rangeError(p.id, "min") || undefined}
                        onChange={(e) => set({ min: e.target.value })}
                        aria-label={`${p.shortName} ${t("ranges.min")}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        inputMode="decimal"
                        value={r.max}
                        aria-invalid={rangeError(p.id, "max") || undefined}
                        onChange={(e) => set({ max: e.target.value })}
                        aria-label={`${p.shortName} ${t("ranges.max")}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Checkbox
                        checked={r.enabled}
                        onCheckedChange={(checked) => set({ enabled: Boolean(checked) })}
                        aria-label={`${p.shortName} ${t("enabled")}`}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("batch.title")}</CardTitle>
          <CardDescription>{t("batch.hint")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-3">
          <fieldset className="grid content-start gap-3">
            <legend className="mb-2 font-semibold">{t("spike.title")}</legend>
            {enabledToggle("spike", t("enabled"))}
            {numberField(
              "spike",
              "madMultiplier",
              t("spike.madMultiplier"),
              t("spike.madMultiplierHint"),
            )}
            {numberField("spike", "minSamples", t("spike.minSamples"), t("spike.minSamplesHint"))}
          </fieldset>
          <fieldset className="grid content-start gap-3">
            <legend className="mb-2 font-semibold">{t("stuck.title")}</legend>
            {enabledToggle("stuck", t("enabled"))}
            {numberField("stuck", "hours", t("stuck.hours"), t("stuck.hoursHint"))}
            {numberField("stuck", "minRun", t("stuck.minRun"), t("stuck.minRunHint"))}
          </fieldset>
          <fieldset className="grid content-start gap-3">
            <legend className="mb-2 font-semibold">{t("outlier.title")}</legend>
            {enabledToggle("outlier", t("enabled"))}
            {numberField("outlier", "z", t("outlier.z"), t("outlier.zHint"))}
            {numberField(
              "outlier",
              "minBaseline",
              t("outlier.minBaseline"),
              t("outlier.minBaselineHint"),
            )}
          </fieldset>
        </CardContent>
      </Card>

      <div>
        <Button onClick={submit} disabled={pending}>
          {pending ? <Spinner /> : null}
          {t("save")}
        </Button>
      </div>
    </div>
  );
}
