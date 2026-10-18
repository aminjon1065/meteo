/**
 * «Долго нет данных»: письма администраторам, когда pull‑источник или станция с автоматическим
 * приёмом (ingest API, агент) не приносит значений дольше порога, и письмо о восстановлении.
 * Один раз на эпизод (dedup_key в email_outbox; отметки alerted_at / stale_alerted_at).
 */
import { and, emailOutbox, eq, inArray, isNotNull, sql } from "@meteo/db";
import { stationSources, stations } from "@meteo/db/schema";
import { db } from "../db";
import { env } from "../env";
import { logger } from "../logger";
import { adminAlertRecipients } from "../resilience";

export interface StaleCheckSummary {
  alerted: number;
  recovered: number;
}

interface StaleEvent {
  kind: "stale" | "recovered";
  station: { id: number; code: string; slug: string; name: unknown };
  channel: "api" | "pull";
  since: Date;
  at: Date;
  minutes: number;
  error?: string | null;
}

async function queueStationDataMail(event: StaleEvent): Promise<void> {
  const to = await adminAlertRecipients();
  if (to.length === 0) {
    logger.warn({ station: event.station.code, kind: event.kind }, "no admin recipients");
    return;
  }
  const payload = {
    kind: event.kind,
    stationId: event.station.id,
    stationName: event.station.name,
    code: event.station.code,
    channel: event.channel,
    since: event.since.toISOString(),
    at: event.at.toISOString(),
    minutes: event.minutes,
    error: event.error ?? null,
    stationUrl: `${env.PUBLIC_URL}/admin/stations/${event.station.id}`,
  };
  const stamp = event.kind === "stale" ? event.since.toISOString() : event.at.toISOString();
  await db
    .insert(emailOutbox)
    .values(
      to.map((r) => ({
        to: r.email,
        locale: r.locale,
        template: "stationData",
        payload,
        dedupKey: `stationData:${event.kind}:${event.station.id}:${stamp}:${r.email}`,
      })),
    )
    .onConflictDoNothing();
  logger.info(
    {
      station: event.station.code,
      kind: event.kind,
      channel: event.channel,
      recipients: to.length,
    },
    "station data alert queued",
  );
}

export async function checkStationDataStaleness(now = new Date()): Promise<StaleCheckSummary> {
  const summary: StaleCheckSummary = { alerted: 0, recovered: 0 };

  // 1. Pull‑источники: порог у каждого свой.
  const sources = await db
    .select({
      id: stationSources.id,
      staleAfterMin: stationSources.staleAfterMin,
      lastDataAt: stationSources.lastDataAt,
      createdAt: stationSources.createdAt,
      alertedAt: stationSources.alertedAt,
      lastError: stationSources.lastError,
      status: stationSources.status,
      station: {
        id: stations.id,
        code: stations.code,
        slug: stations.slug,
        name: stations.name,
      },
    })
    .from(stationSources)
    .innerJoin(stations, eq(stations.id, stationSources.stationId))
    .where(and(eq(stationSources.enabled, true), eq(stations.status, "active")));
  const stationsWithSources = new Set<number>();
  for (const src of sources) {
    stationsWithSources.add(src.station.id);
    const since = src.lastDataAt ?? src.createdAt;
    if (src.alertedAt && src.lastDataAt && src.lastDataAt > src.alertedAt) {
      await queueStationDataMail({
        kind: "recovered",
        station: src.station,
        channel: "pull",
        since: src.alertedAt,
        at: src.lastDataAt,
        minutes: src.staleAfterMin,
      });
      await db.update(stationSources).set({ alertedAt: null }).where(eq(stationSources.id, src.id));
      summary.recovered += 1;
      continue;
    }
    const stale = now.getTime() - since.getTime() > src.staleAfterMin * 60_000;
    if (stale && (!src.alertedAt || src.alertedAt < since)) {
      await queueStationDataMail({
        kind: "stale",
        station: src.station,
        channel: "pull",
        since,
        at: now,
        minutes: src.staleAfterMin,
        error: src.status === "failed" ? src.lastError : null,
      });
      await db.update(stationSources).set({ alertedAt: now }).where(eq(stationSources.id, src.id));
      summary.alerted += 1;
    }
  }

  // 2. Станции с приёмом по API (логгер/агент): общий порог STATION_INGEST_STALE_MIN.
  const threshold = env.STATION_INGEST_STALE_MIN;
  const pushRows = await db
    .select({
      id: stations.id,
      code: stations.code,
      slug: stations.slug,
      name: stations.name,
      lastIngestAt: stations.lastIngestAt,
      staleAlertedAt: stations.staleAlertedAt,
    })
    .from(stations)
    .where(
      and(
        eq(stations.status, "active"),
        inArray(stations.dataSource, ["api", "sensor"]),
        isNotNull(stations.lastIngestAt),
        sql`${stations.lastIngestSource} = 'api'`,
      ),
    );
  for (const st of pushRows) {
    if (stationsWithSources.has(st.id) || !st.lastIngestAt) continue;
    const station = { id: st.id, code: st.code, slug: st.slug, name: st.name };
    if (st.staleAlertedAt && st.lastIngestAt > st.staleAlertedAt) {
      await queueStationDataMail({
        kind: "recovered",
        station,
        channel: "api",
        since: st.staleAlertedAt,
        at: st.lastIngestAt,
        minutes: threshold,
      });
      await db.update(stations).set({ staleAlertedAt: null }).where(eq(stations.id, st.id));
      summary.recovered += 1;
      continue;
    }
    const stale = now.getTime() - st.lastIngestAt.getTime() > threshold * 60_000;
    if (stale && (!st.staleAlertedAt || st.staleAlertedAt < st.lastIngestAt)) {
      await queueStationDataMail({
        kind: "stale",
        station,
        channel: "api",
        since: st.lastIngestAt,
        at: now,
        minutes: threshold,
      });
      await db.update(stations).set({ staleAlertedAt: now }).where(eq(stations.id, st.id));
      summary.alerted += 1;
    }
  }
  return summary;
}
