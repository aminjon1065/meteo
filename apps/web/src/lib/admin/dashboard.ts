import "server-only";
import type { IntegrationName, IntegrationState } from "@meteo/core";
import {
  and,
  type CapSyncState,
  count,
  desc,
  eq,
  getCapSyncState,
  getIntegrationStates,
  getLastForecastRun,
  getLatestSilamRun,
  gte,
  ne,
  sql,
} from "@meteo/db";
import {
  alertEvents,
  auditLog,
  emailOutbox,
  measurements,
  QC_FLAG,
  regions,
  settings,
  stations,
  users,
} from "@meteo/db/schema";
import type { I18nText } from "@meteo/i18n";
import { getDb } from "@/lib/db";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export type FreshnessState = "fresh" | "stale" | "missing";

export interface StationFreshness {
  id: number;
  code: string;
  slug: string;
  name: I18nText;
  status: string;
  sampling: string;
  region: I18nText | null;
  lastAt: Date | null;
  state: FreshnessState;
}

export interface IntegrationRow {
  key: IntegrationName;
  state: IntegrationState;
  /** Последняя успешная загрузка данных (по таблицам прогонов), если есть. */
  lastSuccessAt: Date | null;
  originTime: Date | null;
  /** Данные старше допустимого возраста. */
  stale: boolean;
  /** Источник не настроен (CAP без CAP_FEED_URL). */
  disabled: boolean;
  cap?: CapSyncState | null;
}

export interface DashboardData {
  stations: number;
  activeStations: number;
  users: number;
  measurements24h: number;
  qcQueue: number;
  activeAlerts: number;
  heartbeatAt: Date | null;
  heartbeatHost: string | null;
  heartbeatStale: boolean;
  freshness: StationFreshness[];
  withoutData24h: number;
  integrations: IntegrationRow[];
  outbox: {
    pending: number;
    failed: number;
    sent24h: number;
    lastSentAt: Date | null;
    lastFailed: { to: string; template: string; error: string | null; at: Date } | null;
    smtpConfigured: boolean;
  };
  audit: Array<{
    id: number;
    at: Date;
    actorEmail: string | null;
    action: string;
    entity: string;
    entityId: string | null;
  }>;
}

/** Допустимый возраст данных интеграций: прогноз каждые 15 мин, SILAM раз в сутки, CAP каждые 5 мин. */
const MAX_AGE: Record<IntegrationName, number> = {
  smartmet: 3 * HOUR,
  silam: 36 * HOUR,
  cap: 30 * 60_000,
};

export async function loadDashboard(now = new Date()): Promise<DashboardData> {
  const db = getDb();
  const since24h = new Date(now.getTime() - DAY);
  const [
    stationsAll,
    stationsActive,
    usersAll,
    m24,
    qcQueue,
    activeAlerts,
    heartbeat,
    smartmet,
    silam,
    cap,
    states,
    stationRows,
    lastByStation,
    outboxByStatus,
    outboxSent24h,
    outboxLastSent,
    outboxLastFailed,
    audit,
  ] = await Promise.all([
    db.select({ n: count() }).from(stations),
    db.select({ n: count() }).from(stations).where(eq(stations.status, "active")),
    db.select({ n: count() }).from(users),
    db.select({ n: count() }).from(measurements).where(gte(measurements.time, since24h)),
    db
      .select({ n: count() })
      .from(measurements)
      .where(and(eq(measurements.qcFlag, QC_FLAG.suspect), eq(measurements.qcLocked, false))),
    db.select({ n: count() }).from(alertEvents).where(eq(alertEvents.status, "active")),
    db
      .select({ value: settings.value })
      .from(settings)
      .where(sql`${settings.key} = 'worker.heartbeat'`),
    getLastForecastRun(db, "smartmet"),
    getLatestSilamRun(db),
    getCapSyncState(db),
    getIntegrationStates(db),
    db
      .select({
        id: stations.id,
        code: stations.code,
        slug: stations.slug,
        name: stations.name,
        status: stations.status,
        sampling: stations.sampling,
        region: regions.name,
        regionOrder: regions.sortOrder,
      })
      .from(stations)
      .leftJoin(regions, eq(regions.id, stations.regionId))
      .where(ne(stations.status, "decommissioned"))
      .orderBy(regions.sortOrder, stations.code),
    db
      .select({ stationId: measurements.stationId, lastAt: sql<Date>`max(${measurements.time})` })
      .from(measurements)
      .groupBy(measurements.stationId),
    db
      .select({ status: emailOutbox.status, n: count() })
      .from(emailOutbox)
      .groupBy(emailOutbox.status),
    db
      .select({ n: count() })
      .from(emailOutbox)
      .where(and(eq(emailOutbox.status, "sent"), gte(emailOutbox.sentAt, since24h))),
    db
      .select({ sentAt: emailOutbox.sentAt })
      .from(emailOutbox)
      .where(eq(emailOutbox.status, "sent"))
      .orderBy(desc(emailOutbox.sentAt))
      .limit(1),
    db
      .select({
        to: emailOutbox.to,
        template: emailOutbox.template,
        error: emailOutbox.lastError,
        at: emailOutbox.createdAt,
      })
      .from(emailOutbox)
      .where(eq(emailOutbox.status, "failed"))
      .orderBy(desc(emailOutbox.createdAt))
      .limit(1),
    db
      .select({
        id: auditLog.id,
        at: auditLog.at,
        actorEmail: auditLog.actorEmail,
        action: auditLog.action,
        entity: auditLog.entity,
        entityId: auditLog.entityId,
      })
      .from(auditLog)
      .orderBy(desc(auditLog.id))
      .limit(8),
  ]);

  const hb = heartbeat[0]?.value as { at?: string; host?: string } | undefined;
  const hbAt = hb?.at ? new Date(hb.at) : null;

  const lastMap = new Map(lastByStation.map((r) => [r.stationId, new Date(r.lastAt)]));
  const freshness: StationFreshness[] = stationRows.map((s) => {
    const lastAt = lastMap.get(s.id) ?? null;
    const state: FreshnessState = !lastAt
      ? "missing"
      : now.getTime() - lastAt.getTime() <= DAY
        ? "fresh"
        : "stale";
    return {
      id: s.id,
      code: s.code,
      slug: s.slug,
      name: s.name,
      status: s.status,
      sampling: s.sampling,
      region: s.region,
      lastAt,
      state,
    };
  });
  const order: Record<FreshnessState, number> = { missing: 0, stale: 1, fresh: 2 };
  freshness.sort(
    (a, b) =>
      order[a.state] - order[b.state] || (a.lastAt?.getTime() ?? 0) - (b.lastAt?.getTime() ?? 0),
  );

  const capAt = cap?.at ? new Date(cap.at) : null;
  const capDisabled = cap?.status === "disabled" || (!cap && !states.cap.lastRunAt);
  const integrations: IntegrationRow[] = [
    {
      key: "smartmet",
      state: states.smartmet,
      lastSuccessAt: smartmet?.fetchedAt ?? null,
      originTime: smartmet?.originTime ?? null,
      stale: !smartmet || now.getTime() - smartmet.fetchedAt.getTime() > MAX_AGE.smartmet,
      disabled: false,
    },
    {
      key: "silam",
      state: states.silam,
      lastSuccessAt: silam?.fetchedAt ?? null,
      originTime: silam?.originTime ?? null,
      stale: !silam || now.getTime() - silam.fetchedAt.getTime() > MAX_AGE.silam,
      disabled: false,
    },
    {
      key: "cap",
      state: states.cap,
      lastSuccessAt:
        cap?.status === "ok" || cap?.status === "not-modified" || cap?.status === "partial"
          ? capAt
          : states.cap.lastSuccessAt
            ? new Date(states.cap.lastSuccessAt)
            : null,
      originTime: null,
      stale: capDisabled
        ? false
        : !capAt || cap?.status === "failed" || now.getTime() - capAt.getTime() > MAX_AGE.cap,
      disabled: capDisabled,
      cap,
    },
  ];

  const byStatus = Object.fromEntries(outboxByStatus.map((r) => [r.status, r.n]));
  const lastFailed = outboxLastFailed[0];
  return {
    stations: stationsAll[0]?.n ?? 0,
    activeStations: stationsActive[0]?.n ?? 0,
    users: usersAll[0]?.n ?? 0,
    measurements24h: m24[0]?.n ?? 0,
    qcQueue: qcQueue[0]?.n ?? 0,
    activeAlerts: activeAlerts[0]?.n ?? 0,
    heartbeatAt: hbAt,
    heartbeatHost: hb?.host ?? null,
    heartbeatStale: hbAt ? now.getTime() - hbAt.getTime() > 3 * 60_000 : true,
    freshness,
    withoutData24h: freshness.filter((f) => f.state !== "fresh").length,
    integrations,
    outbox: {
      pending: byStatus.pending ?? 0,
      failed: byStatus.failed ?? 0,
      sent24h: outboxSent24h[0]?.n ?? 0,
      lastSentAt: outboxLastSent[0]?.sentAt ?? null,
      lastFailed: lastFailed ? { ...lastFailed, at: lastFailed.at } : null,
      smtpConfigured: Boolean(process.env.SMTP_URL),
    },
    audit,
  };
}
