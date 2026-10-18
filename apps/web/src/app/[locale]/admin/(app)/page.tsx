import type { Locale } from "@meteo/i18n";
import { Badge } from "@meteo/ui/components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@meteo/ui/components/card";
import { cn } from "@meteo/ui/lib/utils";
import {
  Activity,
  BellRing,
  ClipboardCheck,
  Database,
  MailIcon,
  Radio,
  ScrollTextIcon,
  Users,
} from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { StatCard } from "@/components/admin/stat-card";
import { Link } from "@/i18n/navigation";
import { type FreshnessState, type IntegrationRow, loadDashboard } from "@/lib/admin/dashboard";
import { name } from "@/lib/format";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const DOT: Record<FreshnessState, string> = {
  fresh: "bg-status-fresh",
  stale: "bg-status-stale",
  missing: "bg-status-missing",
};

type Tone = "ok" | "warn" | "bad" | "muted";
const TONE_CLASS: Record<Tone, string> = {
  ok: "border-transparent bg-status-fresh/15 text-foreground",
  warn: "border-transparent bg-status-stale/20 text-foreground",
  bad: "border-transparent bg-destructive/10 text-destructive",
  muted: "border-border bg-muted text-muted-foreground",
};

function StatusPill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <Badge variant="outline" className={cn("h-auto whitespace-normal py-0.5", TONE_CLASS[tone])}>
      {children}
    </Badge>
  );
}

/** Статус интеграции для плашки: сбой/приостановка важнее устаревания. */
function integrationTone(row: IntegrationRow): { tone: Tone; key: string } {
  if (row.disabled) return { tone: "muted", key: "disabled" };
  if (row.state.circuit.open) return { tone: "bad", key: "paused" };
  if (row.state.status === "failed") return { tone: "bad", key: "failed" };
  if (row.stale) return { tone: "warn", key: "stale" };
  if (!row.lastSuccessAt && row.state.status === "never") return { tone: "muted", key: "never" };
  return { tone: "ok", key: "ok" };
}

export default async function AdminDashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const [t, ts, format, session, data] = await Promise.all([
    getTranslations("admin"),
    getTranslations("stations"),
    getFormatter(),
    getSession(),
    loadDashboard(),
  ]);
  const dt = (d: Date) => format.dateTime(d, { dateStyle: "short", timeStyle: "short" });
  const rel = (d: Date | null) => (d ? format.relativeTime(d) : "—");
  const utcTime = (d: Date) =>
    format.dateTime(d, {
      timeZone: "UTC",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });

  const workerStatus = data.heartbeatAt
    ? data.heartbeatStale
      ? { label: t("stats.workerStale"), tone: "bad" as const }
      : { label: t("stats.workerOk"), tone: "ok" as const }
    : { label: t("stats.workerUnknown"), tone: "muted" as const };
  const total = data.freshness.length;
  const share = total ? Math.round((data.withoutData24h / total) * 100) : 0;

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("dashboard")}</h1>
        <p className="text-muted-foreground">{t("welcome", { name: session?.user.name ?? "" })}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <StatCard icon={Radio} label={t("stats.stations")} value={data.stations} />
        <StatCard icon={Activity} label={t("stats.activeStations")} value={data.activeStations} />
        <StatCard icon={Database} label={t("stats.measurements24h")} value={data.measurements24h} />
        <StatCard icon={ClipboardCheck} label={t("stats.qcQueue")} value={data.qcQueue} />
        <StatCard icon={BellRing} label={t("stats.activeAlerts")} value={data.activeAlerts} />
        <StatCard icon={Users} label={t("stats.users")} value={data.users} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
              {t("freshness.title")}
              <StatusPill tone={data.withoutData24h === 0 ? "ok" : share >= 50 ? "bad" : "warn"}>
                {t("freshness.withoutData", { count: data.withoutData24h, total, share })}
              </StatusPill>
            </CardTitle>
            <CardDescription>{t("freshness.hint")}</CardDescription>
          </CardHeader>
          <CardContent className="px-0 sm:px-6">
            {data.freshness.length === 0 ? (
              <p className="px-6 text-sm text-muted-foreground sm:px-0">{t("freshness.empty")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">{t("freshness.title")}</caption>
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr className="border-b">
                      <th scope="col" className="px-6 py-2 font-medium sm:px-2">
                        {t("freshness.station")}
                      </th>
                      <th scope="col" className="px-2 py-2 font-medium">
                        {t("freshness.region")}
                      </th>
                      <th scope="col" className="px-2 py-2 font-medium">
                        {t("freshness.lastMeasurement")}
                      </th>
                      <th scope="col" className="px-6 py-2 text-right font-medium sm:px-2">
                        {t("freshness.state")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.freshness.map((s) => (
                      <tr key={s.id} className="border-b last:border-b-0">
                        <td className="px-6 py-2 sm:px-2">
                          <Link
                            href={`/admin/stations/${s.id}`}
                            className="font-medium hover:underline"
                          >
                            {name(s.name, locale) || s.code}
                          </Link>
                          <span className="block text-xs text-muted-foreground">
                            {s.code} · {ts(`sampling.${s.sampling}` as "sampling.discrete")}
                            {s.status !== "active"
                              ? ` · ${ts(`status.${s.status}` as "status.suspended")}`
                              : ""}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-muted-foreground">
                          {name(s.region, locale) || "—"}
                        </td>
                        <td className="px-2 py-2 tabular-nums">
                          {s.lastAt ? (
                            <>
                              <span>{rel(s.lastAt)}</span>
                              <span className="block text-xs text-muted-foreground">
                                {dt(s.lastAt)}
                              </span>
                            </>
                          ) : (
                            <span className="text-muted-foreground">{t("freshness.never")}</span>
                          )}
                        </td>
                        <td className="px-6 py-2 text-right sm:px-2">
                          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                            <span
                              className={cn("inline-block size-2.5 rounded-full", DOT[s.state])}
                              aria-hidden="true"
                            />
                            {t(`freshness.${s.state}`)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2 text-base">
                {t("stats.workerHeartbeat")}
                <StatusPill tone={workerStatus.tone}>{workerStatus.label}</StatusPill>
              </CardTitle>
              <CardDescription>
                {data.heartbeatAt
                  ? `${format.relativeTime(data.heartbeatAt)} · ${data.heartbeatHost ?? ""}`
                  : "—"}
              </CardDescription>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <MailIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                {t("outbox.title")}
              </CardTitle>
              <CardDescription>
                {data.outbox.smtpConfigured ? t("outbox.smtpConfigured") : t("outbox.smtpDev")}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <dl className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg border p-2">
                  <dt className="text-xs text-muted-foreground">{t("outbox.pending")}</dt>
                  <dd className="text-xl font-semibold tabular-nums">{data.outbox.pending}</dd>
                </div>
                <div
                  className={cn(
                    "rounded-lg border p-2",
                    data.outbox.failed > 0 && "border-destructive/40",
                  )}
                >
                  <dt className="text-xs text-muted-foreground">{t("outbox.failed")}</dt>
                  <dd
                    className={cn(
                      "text-xl font-semibold tabular-nums",
                      data.outbox.failed > 0 && "text-destructive",
                    )}
                  >
                    {data.outbox.failed}
                  </dd>
                </div>
                <div className="rounded-lg border p-2">
                  <dt className="text-xs text-muted-foreground">{t("outbox.sent24h")}</dt>
                  <dd className="text-xl font-semibold tabular-nums">{data.outbox.sent24h}</dd>
                </div>
              </dl>
              <p className="text-xs text-muted-foreground">
                {t("outbox.lastSent")}: {rel(data.outbox.lastSentAt)}
              </p>
              {data.outbox.lastFailed ? (
                <p className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                  {t("outbox.lastFailed", {
                    to: data.outbox.lastFailed.to,
                    template: data.outbox.lastFailed.template,
                  })}
                  {data.outbox.lastFailed.error ? `: ${data.outbox.lastFailed.error}` : ""}
                </p>
              ) : null}
              <Link
                href="/admin/settings"
                className="text-xs text-muted-foreground underline-offset-4 hover:underline"
              >
                {t("outbox.testLink")}
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("stats.integrations")}</CardTitle>
            <CardDescription>{t("stats.integrationsHint")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y text-sm">
              {data.integrations.map((i) => {
                const status = integrationTone(i);
                const until = i.state.circuit.until ? new Date(i.state.circuit.until) : null;
                return (
                  <li key={i.key} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{t(`stats.${i.key}`)}</span>
                      <StatusPill tone={status.tone}>
                        {status.key === "paused" && until
                          ? t("integration.paused", { time: dt(until) })
                          : status.key === "failed"
                            ? t("integration.failed", { count: i.state.consecutiveFailures })
                            : t(`integration.${status.key}` as "integration.ok")}
                      </StatusPill>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t("integration.lastSuccess")}: {rel(i.lastSuccessAt)}
                      {i.originTime
                        ? ` · ${t("stats.modelRun", { time: utcTime(i.originTime) })}`
                        : ""}
                      {i.state.lastRunAt
                        ? ` · ${t("integration.lastRun")}: ${rel(new Date(i.state.lastRunAt))}`
                        : ""}
                    </p>
                    {i.state.lastError && i.state.status === "failed" ? (
                      <p className="break-words text-xs text-destructive">
                        {t("integration.failed", { count: i.state.consecutiveFailures })}:{" "}
                        {i.state.lastError}
                      </p>
                    ) : null}
                    {i.key === "cap" && i.cap?.errors && i.cap.errors.length > 0 ? (
                      <p className="text-xs text-muted-foreground">
                        {t("integration.capErrors", { count: i.cap.errors.length })}
                      </p>
                    ) : null}
                    {i.state.source ? (
                      <p className="truncate text-xs text-muted-foreground" title={i.state.source}>
                        {i.state.source}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2 text-base">
              <span className="flex items-center gap-2">
                <ScrollTextIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                {t("recentAudit.title")}
              </span>
              <Link
                href="/admin/audit"
                className="text-xs font-normal text-muted-foreground underline-offset-4 hover:underline"
              >
                {t("recentAudit.all")}
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.audit.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("recentAudit.empty")}</p>
            ) : (
              <ol className="flex flex-col divide-y text-sm">
                {data.audit.map((a) => (
                  <li key={a.id} className="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-xs">{a.action}</span>
                      <time dateTime={a.at.toISOString()} className="text-xs text-muted-foreground">
                        {dt(a.at)}
                      </time>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {a.actorEmail ?? "—"} · {a.entity}
                      {a.entityId ? ` #${a.entityId}` : ""}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
