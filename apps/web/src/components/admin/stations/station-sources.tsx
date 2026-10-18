"use client";

import type { StationSourceRow } from "@meteo/db";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@meteo/ui/components/alert-dialog";
import { Badge } from "@meteo/ui/components/badge";
import { Button } from "@meteo/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@meteo/ui/components/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "@meteo/ui/components/field";
import { Input } from "@meteo/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@meteo/ui/components/native-select";
import { Spinner } from "@meteo/ui/components/spinner";
import { Switch } from "@meteo/ui/components/switch";
import { Textarea } from "@meteo/ui/components/textarea";
import { cn } from "@meteo/ui/lib/utils";
import { PlayIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { StationSourceResult } from "@/app/[locale]/admin/(app)/stations/actions";
import { useRouter } from "@/i18n/navigation";
import { translateOr } from "@/lib/i18n-utils";
import {
  MAPPING_TEMPLATES,
  type StationSourceInput,
  stationSourceKinds,
} from "@/lib/validation/station-source";

/** Источник без секретов — так его отдаёт страница клиенту. */
export type StationSourceView = Omit<StationSourceRow, "secret" | "privateKey"> & {
  hasSecret: boolean;
  hasPrivateKey: boolean;
};

export interface StationSourcesProps {
  stationCode: string;
  sources: StationSourceView[];
  canWrite: boolean;
  save: (raw: StationSourceInput) => Promise<StationSourceResult>;
  remove: (id: number) => Promise<StationSourceResult>;
  run: (id: number) => Promise<StationSourceResult>;
}

interface FormState {
  id: number | null;
  kind: (typeof stationSourceKinds)[number];
  enabled: boolean;
  label: string;
  host: string;
  port: string;
  username: string;
  password: string;
  privateKey: string;
  hostFingerprint: string;
  path: string;
  filePattern: string;
  mappingJson: string;
  staleAfterMin: string;
}

const DEFAULT_PORT: Record<FormState["kind"], string> = {
  sftp: "22",
  ftp: "21",
  ftps: "21",
  http: "",
};

function emptyForm(): FormState {
  return {
    id: null,
    kind: "sftp",
    enabled: true,
    label: "",
    host: "",
    port: "22",
    username: "",
    password: "",
    privateKey: "",
    hostFingerprint: "",
    path: "",
    filePattern: "*.csv",
    mappingJson: MAPPING_TEMPLATES.wide,
    staleAfterMin: "180",
  };
}

function toForm(s: StationSourceView): FormState {
  return {
    id: s.id,
    kind: s.kind,
    enabled: s.enabled,
    label: s.label ?? "",
    host: s.host,
    port: s.port === null ? "" : String(s.port),
    username: s.username ?? "",
    password: "",
    privateKey: "",
    hostFingerprint: s.hostFingerprint ?? "",
    path: s.path,
    filePattern: s.filePattern,
    mappingJson: JSON.stringify(s.mapping, null, 2),
    staleAfterMin: String(s.staleAfterMin),
  };
}

const STATUS_CLASS: Record<string, string> = {
  ok: "border-status-fresh/30 bg-status-fresh/15 text-status-fresh-text",
  failed: "border-destructive/30 bg-destructive/10 text-destructive",
  never: "bg-muted text-muted-foreground",
  disabled: "bg-muted text-muted-foreground",
};

export function StationSources({
  stationCode,
  sources,
  canWrite,
  save,
  remove,
  run,
}: StationSourcesProps) {
  const t = useTranslations("stations.sources");
  const tc = useTranslations("common");
  const format = useFormatter();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<FormState | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  const rel = (d: Date | null) => (d ? format.relativeTime(d) : "—");
  const dt = (d: Date | null) =>
    d ? format.dateTime(d, { dateStyle: "short", timeStyle: "short" }) : "—";
  const errorText = (field: string): string | undefined => {
    const message = errors[field]?.[0];
    if (!message) return undefined;
    if (message.startsWith("mapping:")) return `${t("errors.mapping")}: ${message.slice(8)}`;
    return translateOr(t, `errors.${message}`, message);
  };
  const set = (patch: Partial<FormState>) => setForm((f) => (f ? { ...f, ...patch } : f));

  const submit = () => {
    if (!form) return;
    startTransition(async () => {
      const result = await save({
        id: form.id ?? "",
        kind: form.kind,
        enabled: form.enabled,
        label: form.label,
        host: form.host,
        port: form.port,
        username: form.username,
        password: form.password,
        privateKey: form.privateKey,
        hostFingerprint: form.hostFingerprint,
        path: form.path,
        filePattern: form.filePattern,
        mappingJson: form.mappingJson,
        staleAfterMin: form.staleAfterMin,
      } as unknown as StationSourceInput);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        toast.error(translateOr(t, `errors.${result.message}`, result.message));
        return;
      }
      setErrors({});
      setForm(null);
      toast.success(t("saved"));
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2">
          {t("title")}
          {canWrite && !form ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setErrors({});
                setForm(emptyForm());
              }}
            >
              <PlusIcon aria-hidden="true" />
              {t("add")}
            </Button>
          ) : null}
        </CardTitle>
        <CardDescription>{t("hint")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {sources.length === 0 && !form ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : null}
        {sources.length > 0 ? (
          <ul className="flex flex-col divide-y rounded-lg border">
            {sources.map((s) => {
              const status = s.enabled ? s.status : "disabled";
              return (
                <li key={s.id} className="flex flex-col gap-2 p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="font-mono uppercase">
                        {s.kind}
                      </Badge>
                      <span className="font-medium">{s.label || s.host || s.path}</span>
                      <Badge
                        variant="outline"
                        className={cn("font-medium", STATUS_CLASS[status])}
                        data-testid={`source-status-${s.id}`}
                      >
                        {t(`status.${status}` as "status.ok")}
                        {status === "failed" && s.consecutiveFailures > 1
                          ? ` ×${s.consecutiveFailures}`
                          : ""}
                      </Badge>
                    </div>
                    {canWrite ? (
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={pending}
                          aria-label={t("runNow")}
                          onClick={() =>
                            startTransition(async () => {
                              const r = await run(s.id);
                              if (r.ok) toast.success(t("runQueued"));
                              else toast.error(translateOr(t, `errors.${r.message}`, r.message));
                            })
                          }
                        >
                          <PlayIcon aria-hidden="true" />
                          {t("runNow")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={pending}
                          onClick={() => {
                            setErrors({});
                            setForm(toForm(s));
                          }}
                        >
                          {tc("actions.edit")}
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive"
                                aria-label={tc("actions.delete")}
                              />
                            }
                          >
                            <Trash2Icon aria-hidden="true" />
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{t("confirmDelete")}</AlertDialogTitle>
                              <AlertDialogDescription>
                                {s.kind.toUpperCase()} · {s.host || s.path}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() =>
                                  startTransition(async () => {
                                    const r = await remove(s.id);
                                    if (r.ok) {
                                      toast.success(t("deleted"));
                                      router.refresh();
                                    } else
                                      toast.error(translateOr(t, `errors.${r.message}`, r.message));
                                  })
                                }
                              >
                                {tc("actions.delete")}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    ) : null}
                  </div>
                  <p className="font-mono text-xs text-muted-foreground break-all">
                    {s.kind === "http"
                      ? s.path
                      : `${s.username ? `${s.username}@` : ""}${s.host}${s.port ? `:${s.port}` : ""}${s.path} · ${s.filePattern}`}
                  </p>
                  <dl className="grid gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-3">
                    <div>
                      <dt className="inline">{t("lastRun")}: </dt>
                      <dd className="inline" title={dt(s.lastRunAt)}>
                        {rel(s.lastRunAt)}
                      </dd>
                    </div>
                    <div>
                      <dt className="inline">{t("lastSuccess")}: </dt>
                      <dd className="inline" title={dt(s.lastSuccessAt)}>
                        {rel(s.lastSuccessAt)}
                      </dd>
                    </div>
                    <div>
                      <dt className="inline">{t("lastData")}: </dt>
                      <dd className="inline" title={dt(s.lastDataAt)}>
                        {rel(s.lastDataAt)}
                      </dd>
                    </div>
                  </dl>
                  {s.lastSummary ? (
                    <p className="text-xs text-muted-foreground">
                      {t("summary", {
                        files: s.lastSummary.files,
                        accepted: s.lastSummary.accepted,
                        rejected: s.lastSummary.rejected,
                      })}
                      {s.lastSummary.errors.length > 0
                        ? ` · ${s.lastSummary.errors
                            .slice(0, 3)
                            .map((e) => `${e.file}${e.row ? `:${e.row}` : ""} ${e.message}`)
                            .join("; ")}`
                        : ""}
                    </p>
                  ) : null}
                  {s.lastError && s.status === "failed" ? (
                    <p className="rounded-md bg-destructive/10 p-2 text-xs text-destructive break-words">
                      {s.lastError}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}

        {form ? (
          <form
            className="grid gap-4 rounded-lg border bg-muted/30 p-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            noValidate
            data-testid="station-source-form"
          >
            <Field>
              <FieldLabel htmlFor="src-kind">{t("fields.kind")}</FieldLabel>
              <NativeSelect
                id="src-kind"
                value={form.kind}
                onChange={(e) => {
                  const kind = e.target.value as FormState["kind"];
                  set({ kind, port: DEFAULT_PORT[kind] });
                }}
              >
                {stationSourceKinds.map((k) => (
                  <NativeSelectOption key={k} value={k}>
                    {t(`kinds.${k}`)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="src-label">{t("fields.label")}</FieldLabel>
              <Input
                id="src-label"
                value={form.label}
                onChange={(e) => set({ label: e.target.value })}
                placeholder={stationCode}
              />
            </Field>
            {form.kind === "http" ? (
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="src-path">{t("fields.url")}</FieldLabel>
                <Input
                  id="src-path"
                  value={form.path}
                  onChange={(e) => set({ path: e.target.value })}
                  placeholder="https://vendor.example/export/DU-01/latest.csv"
                  aria-invalid={Boolean(errorText("path"))}
                />
                {errorText("path") ? <FieldError>{errorText("path")}</FieldError> : null}
              </Field>
            ) : (
              <>
                <Field>
                  <FieldLabel htmlFor="src-host">{t("fields.host")}</FieldLabel>
                  <Input
                    id="src-host"
                    value={form.host}
                    onChange={(e) => set({ host: e.target.value })}
                    placeholder="sftp.vendor.example"
                    aria-invalid={Boolean(errorText("host"))}
                  />
                  {errorText("host") ? <FieldError>{errorText("host")}</FieldError> : null}
                </Field>
                <Field>
                  <FieldLabel htmlFor="src-port">{t("fields.port")}</FieldLabel>
                  <Input
                    id="src-port"
                    type="number"
                    inputMode="numeric"
                    value={form.port}
                    onChange={(e) => set({ port: e.target.value })}
                    aria-invalid={Boolean(errorText("port"))}
                  />
                  {errorText("port") ? <FieldError>{errorText("port")}</FieldError> : null}
                </Field>
                <Field>
                  <FieldLabel htmlFor="src-path">{t("fields.path")}</FieldLabel>
                  <Input
                    id="src-path"
                    value={form.path}
                    onChange={(e) => set({ path: e.target.value })}
                    placeholder="/export/DU-01"
                    aria-invalid={Boolean(errorText("path"))}
                  />
                  {errorText("path") ? <FieldError>{errorText("path")}</FieldError> : null}
                </Field>
                <Field>
                  <FieldLabel htmlFor="src-pattern">{t("fields.filePattern")}</FieldLabel>
                  <Input
                    id="src-pattern"
                    value={form.filePattern}
                    onChange={(e) => set({ filePattern: e.target.value })}
                    placeholder="*.csv"
                    aria-invalid={Boolean(errorText("filePattern"))}
                  />
                  <FieldDescription>{t("hints.filePattern")}</FieldDescription>
                  {errorText("filePattern") ? (
                    <FieldError>{errorText("filePattern")}</FieldError>
                  ) : null}
                </Field>
              </>
            )}
            <Field>
              <FieldLabel htmlFor="src-username">{t("fields.username")}</FieldLabel>
              <Input
                id="src-username"
                autoComplete="off"
                value={form.username}
                onChange={(e) => set({ username: e.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="src-password">
                {form.kind === "http" ? t("fields.httpSecret") : t("fields.password")}
              </FieldLabel>
              <Input
                id="src-password"
                type="password"
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => set({ password: e.target.value })}
                placeholder={form.id ? t("hints.passwordKeep") : ""}
              />
              <FieldDescription>{t("hints.secret")}</FieldDescription>
            </Field>
            {form.kind === "sftp" ? (
              <>
                <Field className="sm:col-span-2">
                  <FieldLabel htmlFor="src-key">{t("fields.privateKey")}</FieldLabel>
                  <Textarea
                    id="src-key"
                    rows={3}
                    className="font-mono text-xs"
                    value={form.privateKey}
                    onChange={(e) => set({ privateKey: e.target.value })}
                    placeholder={
                      form.id ? t("hints.passwordKeep") : "-----BEGIN OPENSSH PRIVATE KEY-----"
                    }
                  />
                </Field>
                <Field className="sm:col-span-2">
                  <FieldLabel htmlFor="src-fp">{t("fields.hostFingerprint")}</FieldLabel>
                  <Input
                    id="src-fp"
                    value={form.hostFingerprint}
                    onChange={(e) => set({ hostFingerprint: e.target.value })}
                    placeholder="SHA256:…"
                    className="font-mono"
                  />
                  <FieldDescription>{t("hints.hostFingerprint")}</FieldDescription>
                </Field>
              </>
            ) : null}
            <Field className="sm:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <FieldLabel htmlFor="src-mapping">{t("fields.mapping")}</FieldLabel>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">{t("fields.template")}</span>
                  {(["wide", "long", "split"] as const).map((k) => (
                    <Button
                      key={k}
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => set({ mappingJson: MAPPING_TEMPLATES[k] })}
                    >
                      {t(`templates.${k}`)}
                    </Button>
                  ))}
                </div>
              </div>
              <Textarea
                id="src-mapping"
                rows={10}
                className="font-mono text-xs"
                value={form.mappingJson}
                onChange={(e) => set({ mappingJson: e.target.value })}
                aria-invalid={Boolean(errorText("mappingJson"))}
                spellCheck={false}
              />
              <FieldDescription>{t("hints.mapping")}</FieldDescription>
              {errorText("mappingJson") ? (
                <FieldError>{errorText("mappingJson")}</FieldError>
              ) : null}
            </Field>
            <Field>
              <FieldLabel htmlFor="src-stale">{t("fields.staleAfterMin")}</FieldLabel>
              <Input
                id="src-stale"
                type="number"
                inputMode="numeric"
                min={5}
                value={form.staleAfterMin}
                onChange={(e) => set({ staleAfterMin: e.target.value })}
                aria-invalid={Boolean(errorText("staleAfterMin"))}
              />
              <FieldDescription>{t("hints.staleAfterMin")}</FieldDescription>
              {errorText("staleAfterMin") ? (
                <FieldError>{errorText("staleAfterMin")}</FieldError>
              ) : null}
            </Field>
            <Field orientation="horizontal" className="self-end">
              <Switch
                id="src-enabled"
                checked={form.enabled}
                onCheckedChange={(v) => set({ enabled: v })}
              />
              <FieldLabel htmlFor="src-enabled">{t("fields.enabled")}</FieldLabel>
            </Field>
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" disabled={pending}>
                {pending ? <Spinner /> : null}
                {tc("actions.save")}
              </Button>
              <Button type="button" variant="outline" onClick={() => setForm(null)}>
                {tc("actions.cancel")}
              </Button>
            </div>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
