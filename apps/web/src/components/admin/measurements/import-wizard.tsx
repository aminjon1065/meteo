"use client";

import { type I18nText, type Locale, pick } from "@meteo/i18n";
import { Alert, AlertDescription, AlertTitle } from "@meteo/ui/components/alert";
import { Button } from "@meteo/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@meteo/ui/components/card";
import { Field, FieldDescription, FieldLabel } from "@meteo/ui/components/field";
import { Input } from "@meteo/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@meteo/ui/components/native-select";
import { Spinner } from "@meteo/ui/components/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@meteo/ui/components/table";
import { CheckCircle2Icon, DownloadIcon, TriangleAlertIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { toast } from "sonner";
import type {
  ImportApplyResult,
  ImportPreviewResult,
} from "@/app/[locale]/admin/(app)/measurements/actions";
import { Link } from "@/i18n/navigation";
import { translateOr } from "@/lib/i18n-utils";

export interface ImportWizardProps {
  stations: Array<{ code: string; name: I18nText }>;
  preview: (formData: FormData) => Promise<ImportPreviewResult>;
  apply: (batchId: string) => Promise<ImportApplyResult>;
  reject: (batchId: string) => Promise<ImportApplyResult>;
}

type Preview = Extract<ImportPreviewResult, { ok: true }>;

export function ImportWizard({ stations, preview, apply, reject }: ImportWizardProps) {
  const t = useTranslations("measurements");
  const locale = useLocale() as Locale;
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<Preview | null>(null);
  const [done, setDone] = useState<number | null>(null);

  function describeError(message: string): string {
    const [code, detail] = message.split(":", 2);
    return translateOr(t, `import.errors.${code}`, message, { detail: detail ?? "" });
  }

  function onPreview(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await preview(formData);
      if (!r.ok) {
        toast.error(translateOr(t, `import.results.${r.message}`, r.message));
        return;
      }
      setResult(r);
      setDone(null);
    });
  }

  function onApply() {
    if (!result) return;
    startTransition(async () => {
      const r = await apply(result.batchId);
      if (!r.ok) {
        toast.error(translateOr(t, `import.results.${r.message}`, r.message));
        return;
      }
      toast.success(t("import.applied", { count: r.inserted }));
      setDone(r.inserted);
      setResult(null);
    });
  }

  function onReject() {
    if (!result) return;
    startTransition(async () => {
      await reject(result.batchId);
      toast.info(t("import.rejected"));
      setResult(null);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("import.file")}</CardTitle>
          <CardDescription>{t("import.format")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onPreview} className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="file">{t("import.chooseFile")}</FieldLabel>
              <Input id="file" name="file" type="file" accept=".csv,text/csv" required />
            </Field>
            <Field>
              <FieldLabel htmlFor="station">{t("import.defaultStation")}</FieldLabel>
              <NativeSelect id="station" name="station" defaultValue="">
                <NativeSelectOption value="">{t("import.anyStation")}</NativeSelectOption>
                {stations.map((s) => (
                  <NativeSelectOption key={s.code} value={s.code}>
                    {s.code} · {pick(s.name, locale)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <FieldDescription>
                <a
                  href="/templates/measurements-template.csv"
                  download
                  className="inline-flex items-center gap-1 underline"
                >
                  <DownloadIcon className="size-3.5" aria-hidden="true" />
                  {t("import.template")}
                </a>
              </FieldDescription>
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={pending}>
                {pending && !result ? <Spinner /> : null}
                {t("import.preview")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {result ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("import.reportTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <dl className="grid gap-3 sm:grid-cols-4">
              {(["total", "ok", "rejected", "invalidRange"] as const).map((k) => (
                <div key={k} className="rounded-lg border p-3">
                  <dt className="text-xs text-muted-foreground">{t(`import.summary.${k}`)}</dt>
                  <dd className="text-2xl font-semibold tabular-nums">{result.report[k]}</dd>
                </div>
              ))}
            </dl>
            {result.report.errors.length > 0 ? (
              <div className="overflow-hidden rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-24">{t("import.row")}</TableHead>
                      <TableHead>{t("import.message")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.report.errors.slice(0, 50).map((e, i) => (
                      <TableRow key={`${e.row}-${i}`}>
                        <TableCell className="tabular-nums">{e.row || "—"}</TableCell>
                        <TableCell>{describeError(e.message)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : null}
            {result.report.sample.length > 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("import.sampleHint", { count: result.report.sample.length })}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button onClick={onApply} disabled={pending || result.report.ok === 0}>
                {pending ? <Spinner /> : null}
                {t("import.apply", { count: result.report.ok })}
              </Button>
              <Button variant="outline" onClick={onReject} disabled={pending}>
                {t("import.cancel")}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {done !== null ? (
        <Alert>
          <CheckCircle2Icon />
          <AlertTitle>{t("import.applied", { count: done })}</AlertTitle>
          <AlertDescription>
            <Link href="/admin/measurements/browse" className="underline">
              {t("cards.browse.title")}
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}
      {result && result.report.ok === 0 ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>{t("import.nothingToApply")}</AlertTitle>
        </Alert>
      ) : null}
    </div>
  );
}
