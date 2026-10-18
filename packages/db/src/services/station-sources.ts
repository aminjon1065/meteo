/**
 * Источники данных станций pull‑типа (station_sources): выборки для админки и worker'а,
 * отметки запусков. Сетевую часть (SFTP/FTP/HTTP) выполняет задача station-pull в worker'е.
 */
import type { I18nText } from "@meteo/i18n";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Database } from "../client";
import type { StationSourceRunSummary, StationSourceStatus } from "../schema";
import * as s from "../schema";

export type StationSourceRow = typeof s.stationSources.$inferSelect;

export interface StationSourceWithStation extends StationSourceRow {
  station: {
    id: number;
    code: string;
    slug: string;
    name: I18nText;
    status: "active" | "suspended" | "decommissioned";
    sampling: "continuous" | "discrete";
  };
}

export interface ListStationSourcesOptions {
  stationId?: number;
  ids?: number[];
  /** Только включённые источники активных (не выведенных) станций. */
  runnable?: boolean;
}

export async function listStationSources(
  db: Database,
  opts: ListStationSourcesOptions = {},
): Promise<StationSourceWithStation[]> {
  const conditions = [];
  if (opts.stationId !== undefined) conditions.push(eq(s.stationSources.stationId, opts.stationId));
  if (opts.ids?.length) conditions.push(inArray(s.stationSources.id, opts.ids));
  if (opts.runnable) {
    conditions.push(eq(s.stationSources.enabled, true));
    conditions.push(ne(s.stations.status, "decommissioned"));
  }
  const rows = await db
    .select({
      source: s.stationSources,
      station: {
        id: s.stations.id,
        code: s.stations.code,
        slug: s.stations.slug,
        name: s.stations.name,
        status: s.stations.status,
        sampling: s.stations.sampling,
      },
    })
    .from(s.stationSources)
    .innerJoin(s.stations, eq(s.stations.id, s.stationSources.stationId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(s.stationSources.stationId), asc(s.stationSources.id));
  return rows.map((r) => ({ ...r.source, station: { ...r.station, name: r.station.name } }));
}

/** Итог запуска по источнику: успех/сбой, сводка, реестр файлов. */
export async function markStationSourceRun(
  db: Database,
  id: number,
  patch: {
    at: Date;
    status: StationSourceStatus;
    error?: string | null;
    summary?: StationSourceRunSummary | null;
    files?: Record<string, s.StationSourceFileState>;
    /** Принято хотя бы одно значение. */
    gotData?: boolean;
  },
): Promise<void> {
  const set: Partial<typeof s.stationSources.$inferInsert> = {
    status: patch.status,
    lastRunAt: patch.at,
  };
  if (patch.status === "ok") {
    set.lastSuccessAt = patch.at;
    set.consecutiveFailures = 0;
    set.lastError = null;
    if (patch.gotData) set.lastDataAt = patch.at;
  } else if (patch.status === "failed") {
    set.lastError = (patch.error ?? "error").slice(0, 2000);
    set.lastErrorAt = patch.at;
    set.consecutiveFailures = sql`${s.stationSources.consecutiveFailures} + 1` as unknown as number;
  }
  if (patch.summary !== undefined) set.lastSummary = patch.summary;
  if (patch.files !== undefined) set.files = patch.files;
  await db.update(s.stationSources).set(set).where(eq(s.stationSources.id, id));
}

/** Обрезает реестр файлов до последних N по времени обработки. */
export function trimFileRegistry(
  files: Record<string, s.StationSourceFileState>,
  keep = 300,
): Record<string, s.StationSourceFileState> {
  const entries = Object.entries(files);
  if (entries.length <= keep) return files;
  entries.sort((a, b) => (a[1].at < b[1].at ? 1 : a[1].at > b[1].at ? -1 : 0));
  return Object.fromEntries(entries.slice(0, keep));
}
