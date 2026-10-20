import type { Locale } from "@meteo/i18n";
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
  ok: "bg-status-fresh/15 text-status-fresh-text",
  warn: "bg-status-stale/20 text-status-stale-text",
  bad: "bg-destructive/10 text-destructive",
  muted: "bg-muted text-muted-foreground",
};

/** Плашка состояния: тон + подпись. */
function StatusPill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
        TONE_CLASS[tone],
      )}
    >
      {children}
    </span>
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

const panel = "rounded-xl border bg-card";
const panelHead = "flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3";

/**
 * Дашборд: показатели одной строкой, свежесть данных станций и статусы интеграций —
 * компактными строками, почта и последние действия — списками.
 */
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
  const prefix = locale === "tg" ? "" : `/${locale}`;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-h2">{t("dashboard")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("welcome", { name: session?.user.name ?? "" })}
          </p>
        </div>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>{t("stats.workerHeartbeat")}</span>
          <StatusPill tone={workerStatus.tone}>{workerStatus.label}</StatusPill>
          {data.heartbeatAt ? (
            <span className="num">
              {format.relativeTime(data.heartbeatAt)}
              {data.heartbeatHost ? ` · ${data.heartbeatHost}` : ""}
            </span>
          ) : null}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
        <StatCard
          icon={Radio}
          label={t("stats.stations")}
          value={data.stations}
          href={`${prefix}/admin/stations`}
        />
        <StatCard icon={Activity} label={t("stats.activeStations")} value={data.activeStations} />
        <StatCard
          icon={Database}
          label={t("stats.measurements24h")}
          value={data.measurements24h}
          href={`${prefix}/admin/measurements/browse`}
        />
        <StatCard
          icon={ClipboardCheck}
          label={t("stats.qcQueue")}
          value={data.qcQueue}
          href={`${prefix}/admin/measurements/qc`}
        />
        <StatCard
          icon={BellRing}
          label={t("stats.activeAlerts")}
          value={data.activeAlerts}
          href={`${prefix}/admin/alerts/events`}
        />
        <StatCard
          icon={Users}
          label={t("stats.users")}
          value={data.users}
          href={`${prefix}/admin/users`}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <section className={cn(panel, "xl:col-span-2")} aria-labelledby="freshness-title">
          <div className={panelHead}>
            <div>
              <h2 id="freshness-title" className="text-h3">
                {t("freshness.title")}
              </h2>
              <p className="text-caption text-muted-foreground">{t("freshness.hint")}</p>
            </div>
            <span className="flex flex-wrap gap-2">
              <StatusPill tone={data.withoutData24h === 0 ? "ok" : share >= 50 ? "bad" : "warn"}>
                {t("freshness.withoutData", { count: data.withoutData24h, total, share })}
              </StatusPill>
              {data.ingestStale > 0 ? (
                <StatusPill tone="warn">
                  {t("freshness.ingestStaleCount", {
                    count: data.ingestStale,
                    minutes: data.ingestStaleAfterMin,
                  })}
                </StatusPill>
              ) : null}
            </span>
          </div>
          {data.freshness.length === 0 ? (
            <p className="px-4 py-4 text-sm text-muted-foreground">{t("freshness.empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">{t("freshness.title")}</caption>
                <thead className="text-left text-caption text-muted-foreground">
                  <tr className="border-b">
                    <th scope="col" className="px-4 py-2 font-medium">
                      {t("freshness.station")}
                    </th>
                    <th scope="col" className="px-2 py-2 font-medium">
                      {t("freshness.region")}
                    </th>
                    <th scope="col" className="px-2 py-2 font-medium">
                      {t("freshness.lastMeasurement")}
                    </th>
                    <th scope="col" className="px-2 py-2 font-medium">
                      {t("freshness.ingest")}
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">
                      {t("freshness.state")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.freshness.map((s) => (
                    <tr key={s.id} className="border-b last:border-b-0">
                      <td className="px-4 py-1.5">
                        <Link
                          href={`/admin/stations/${s.id}`}
                          className="font-medium hover:underline"
                        >
                          {name(s.name, locale) || s.code}
                        </Link>
                        <span className="block text-caption text-muted-foreground">
                          {s.code} · {ts(`sampling.${s.sampling}` as "sampling.discrete")}
                          {s.status !== "active"
                            ? ` · ${ts(`status.${s.status}` as "status.suspended")}`
                            : ""}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground">
                        {name(s.region, locale) || "—"}
                      </td>
                      <td className="num px-2 py-1.5">
                        {s.lastAt ? (
                          <span title={dt(s.lastAt)}>{rel(s.lastAt)}</span>
                        ) : (
                          <span className="text-muted-foreground">{t("freshness.never")}</span>
                        )}
                      </td>
                      <td className="num px-2 py-1.5">
                        {s.ingestAt ? (
                          <span
                            className="inline-flex items-center gap-1.5 whitespace-nowrap"
                            title={dt(s.ingestAt)}
                          >
                            <span
                              className={cn("inline-block size-2 rounded-full", DOT[s.ingestState])}
                              aria-hidden="true"
                            />
                            {rel(s.ingestAt)}
                            <span className="text-caption text-muted-foreground">
                              {t(`freshness.source.${s.ingestSource ?? "api"}`)}
                            </span>
                          </span>
                        ) : s.sources > 0 || s.dataSource === "api" || s.dataSource === "sensor" ? (
                          <span className="text-caption text-muted-foreground">
                            {t("freshness.ingestNever")}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                        {s.sourcesFailed > 0 ? (
                          <span className="block text-caption text-destructive">
                            {t("freshness.sourcesFailed", { count: s.sourcesFailed })}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-1.5 text-right">
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                          <span
                            className={cn("inline-block size-2 rounded-full", DOT[s.state])}
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
        </section>

        <div className="flex flex-col gap-4">
          <section className={panel} aria-labelledby="integrations-title">
            <div className={panelHead}>
              <div>
                <h2 id="integrations-title" className="text-h3">
                  {t("stats.integrations")}
                </h2>
                <p className="text-caption text-muted-foreground">{t("stats.integrationsHint")}</p>
              </div>
            </div>
            <ul className="divide-y text-sm">
              {data.integrations.map((i) => {
                const status = integrationTone(i);
                const until = i.state.circuit.until ? new Date(i.state.circuit.until) : null;
                return (
                  <li key={i.key} className="grid gap-0.5 px-4 py-2.5">
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
                    <p className="num text-caption text-muted-foreground">
                      {t("integration.lastSuccess")}: {rel(i.lastSuccessAt)}
                      {i.originTime
                        ? ` · ${t("stats.modelRun", { time: utcTime(i.originTime) })}`
                        : ""}
                      {i.state.lastRunAt
                        ? ` · ${t("integration.lastRun")}: ${rel(new Date(i.state.lastRunAt))}`
                        : ""}
                    </p>
                    {i.state.lastError && i.state.status === "failed" ? (
                      <p className="text-caption break-words text-destructive">
                        {t("integration.failed", { count: i.state.consecutiveFailures })}:{" "}
                        {i.state.lastError}
                      </p>
                    ) : null}
                    {i.key === "cap" && i.cap?.errors && i.cap.errors.length > 0 ? (
                      <p className="text-caption text-muted-foreground">
                        {t("integration.capErrors", { count: i.cap.errors.length })}
                      </p>
                    ) : null}
                    {i.state.source ? (
                      <p
                        className="truncate text-caption text-muted-foreground"
                        title={i.state.source}
                      >
                        {i.state.source}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>

          <section className={panel} aria-labelledby="outbox-title">
            <div className={panelHead}>
              <h2 id="outbox-title" className="flex items-center gap-2 text-h3">
                <MailIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                {t("outbox.title")}
              </h2>
              <span className="text-caption text-muted-foreground">
                {data.outbox.smtpConfigured ? t("outbox.smtpConfigured") : t("outbox.smtpDev")}
              </span>
            </div>
            <dl className="grid grid-cols-3 divide-x text-center">
              {(
                [
                  ["pending", data.outbox.pending, false],
                  ["failed", data.outbox.failed, data.outbox.failed > 0],
                  ["sent24h", data.outbox.sent24h, false],
                ] as const
              ).map(([key, value, bad]) => (
                <div key={key} className="px-2 py-2.5">
                  <dt className="text-caption text-muted-foreground">{t(`outbox.${key}`)}</dt>
                  <dd
                    className={cn("num font-heading text-xl font-bold", bad && "text-destructive")}
                  >
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="flex flex-col gap-1 border-t px-4 py-2.5 text-caption text-muted-foreground">
              <p>
                {t("outbox.lastSent")}: {rel(data.outbox.lastSentAt)}
              </p>
              {data.outbox.lastFailed ? (
                <p className="text-destructive">
                  {t("outbox.lastFailed", {
                    to: data.outbox.lastFailed.to,
                    template: data.outbox.lastFailed.template,
                  })}
                  {data.outbox.lastFailed.error ? `: ${data.outbox.lastFailed.error}` : ""}
                </p>
              ) : null}
              <Link href="/admin/settings" className="w-fit underline-offset-4 hover:underline">
                {t("outbox.testLink")}
              </Link>
            </div>
          </section>
        </div>
      </div>

      <section className={panel} aria-labelledby="audit-title">
        <div className={panelHead}>
          <h2 id="audit-title" className="flex items-center gap-2 text-h3">
            <ScrollTextIcon className="size-4 text-muted-foreground" aria-hidden="true" />
            {t("recentAudit.title")}
          </h2>
          <Link href="/admin/audit" className="text-sm font-semibold text-brand hover:underline">
            {t("recentAudit.all")} →
          </Link>
        </div>
        {data.audit.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">{t("recentAudit.empty")}</p>
        ) : (
          <ol className="divide-y text-sm">
            {data.audit.map((a) => (
              <li key={a.id} className="grid gap-x-4 gap-y-0.5 px-4 py-2 sm:grid-cols-[1fr_auto]">
                <span>
                  <span className="font-mono text-xs">{a.action}</span>
                  <span className="text-caption text-muted-foreground">
                    {" "}
                    · {a.actorEmail ?? "—"} · {a.entity}
                    {a.entityId ? ` #${a.entityId}` : ""}
                  </span>
                </span>
                <time
                  dateTime={a.at.toISOString()}
                  className="num text-caption text-muted-foreground"
                >
                  {dt(a.at)}
                </time>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
