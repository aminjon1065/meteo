/**
 * Прогнозы: чтение SmartMet (forecast_points) и SILAM (silam_*) для портала, API и виджетов.
 */
import { DUSHANBE_OFFSET_MINUTES, type LevelThreshold, levelForThresholds } from "@meteo/core";
import type { I18nText } from "@meteo/i18n";
import { and, asc, desc, eq, gte, inArray, isNotNull, lte, max, sql } from "drizzle-orm";
import type { Database } from "../client";
import type { ForecastParams, SilamGrid } from "../schema";
import * as s from "../schema";
import { type IndexConfig, loadIndexConfig } from "./station-index";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface ForecastLocationRow {
  id: number;
  slug: string;
  name: I18nText;
  geom: { x: number; y: number };
  regionId: number | null;
  regionName: I18nText | null;
  featured: boolean;
  sortOrder: number;
}

export async function listForecastLocations(
  db: Database,
  opts: { featuredOnly?: boolean } = {},
): Promise<ForecastLocationRow[]> {
  const rows = await db
    .select({
      id: s.forecastLocations.id,
      slug: s.forecastLocations.slug,
      name: s.forecastLocations.name,
      geom: s.forecastLocations.geom,
      regionId: s.forecastLocations.regionId,
      regionName: s.regions.name,
      featured: s.forecastLocations.featured,
      sortOrder: s.forecastLocations.sortOrder,
    })
    .from(s.forecastLocations)
    .leftJoin(s.regions, eq(s.regions.id, s.forecastLocations.regionId))
    .where(
      opts.featuredOnly
        ? and(eq(s.forecastLocations.active, true), eq(s.forecastLocations.featured, true))
        : eq(s.forecastLocations.active, true),
    )
    .orderBy(asc(s.forecastLocations.sortOrder), asc(s.forecastLocations.id));
  return rows;
}

export async function getForecastLocation(
  db: Database,
  slug: string,
): Promise<ForecastLocationRow | null> {
  const rows = await listForecastLocations(db);
  return rows.find((r) => r.slug === slug) ?? null;
}

export interface ForecastPoint {
  time: Date;
  params: ForecastParams;
}

export interface LocationForecast {
  hourly: ForecastPoint[];
  daily: ForecastPoint[];
  /** Время последней успешной синхронизации и запуска модели. */
  fetchedAt: Date | null;
  originTime: Date | null;
  producer: string | null;
}

/** Местная полночь (UTC+5) суток, содержащих момент `at`, в UTC. */
export function localMidnightUtc(at: Date): Date {
  const shifted = new Date(at.getTime() + DUSHANBE_OFFSET_MINUTES * 60_000);
  const day = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  return new Date(day - DUSHANBE_OFFSET_MINUTES * 60_000);
}

/** Дата "YYYY-MM-DD" по местному времени. */
export function localDateKey(at: Date): string {
  return new Date(at.getTime() + DUSHANBE_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

/** Часовой прогноз (с текущего часа) и суточные агрегаты (с текущих местных суток) для точки. */
export async function getLocationForecast(
  db: Database,
  locationId: number,
  opts: { hours?: number; days?: number; now?: Date } = {},
): Promise<LocationForecast> {
  const now = opts.now ?? new Date();
  const fromHour = new Date(Math.floor(now.getTime() / HOUR) * HOUR);
  const fromDay = localMidnightUtc(now);
  const [hourly, daily, meta] = await Promise.all([
    db
      .select({ time: s.forecastPoints.time, params: s.forecastPoints.params })
      .from(s.forecastPoints)
      .where(
        and(
          eq(s.forecastPoints.locationId, locationId),
          eq(s.forecastPoints.stepMin, 60),
          gte(s.forecastPoints.time, fromHour),
        ),
      )
      .orderBy(asc(s.forecastPoints.time))
      .limit(opts.hours ?? 72),
    db
      .select({ time: s.forecastPoints.time, params: s.forecastPoints.params })
      .from(s.forecastPoints)
      .where(
        and(
          eq(s.forecastPoints.locationId, locationId),
          eq(s.forecastPoints.stepMin, 1440),
          gte(s.forecastPoints.time, fromDay),
        ),
      )
      .orderBy(asc(s.forecastPoints.time))
      .limit(opts.days ?? 10),
    db
      .select({
        fetchedAt: max(s.forecastRuns.fetchedAt),
        originTime: max(s.forecastRuns.originTime),
        producer: max(s.forecastRuns.producer),
      })
      .from(s.forecastPoints)
      .innerJoin(s.forecastRuns, eq(s.forecastRuns.id, s.forecastPoints.runId))
      .where(eq(s.forecastPoints.locationId, locationId))
      .then((r) => r[0]),
  ]);
  return {
    hourly,
    daily,
    fetchedAt: meta?.fetchedAt ?? null,
    originTime: meta?.originTime ?? null,
    producer: meta?.producer ?? null,
  };
}

export interface WeatherSummary {
  locationId: number;
  /** Ближайший часовой шаг (текущий час). */
  now: ForecastPoint | null;
  /** Суточные агрегаты текущих и следующих суток (если провайдер их отдал). */
  today: ForecastPoint | null;
  tomorrow: ForecastPoint | null;
  /** Часовые точки текущих местных суток — для агрегатов «сегодня», когда суточной точки нет. */
  todayHourly: ForecastPoint[];
}

/** Краткая сводка по нескольким точкам (главная, список городов, виджеты). */
export async function getWeatherSummaries(
  db: Database,
  locationIds: number[],
  now = new Date(),
): Promise<Map<number, WeatherSummary>> {
  const out = new Map<number, WeatherSummary>();
  if (locationIds.length === 0) return out;
  const hour = new Date(Math.floor(now.getTime() / HOUR) * HOUR);
  const today = localMidnightUtc(now);
  const tomorrow = new Date(today.getTime() + DAY);
  const rows = await db
    .select({
      locationId: s.forecastPoints.locationId,
      time: s.forecastPoints.time,
      stepMin: s.forecastPoints.stepMin,
      params: s.forecastPoints.params,
    })
    .from(s.forecastPoints)
    .where(
      and(
        inArray(s.forecastPoints.locationId, locationIds),
        gte(s.forecastPoints.time, today),
        lte(s.forecastPoints.time, tomorrow),
      ),
    )
    .orderBy(asc(s.forecastPoints.time));
  for (const id of locationIds) {
    out.set(id, { locationId: id, now: null, today: null, tomorrow: null, todayHourly: [] });
  }
  for (const r of rows) {
    const entry = out.get(r.locationId);
    if (!entry) continue;
    const point = { time: r.time, params: r.params };
    if (r.stepMin === 60) {
      // Ближайший шаг ≥ текущего часа (строки упорядочены по времени).
      if (!entry.now && r.time.getTime() >= hour.getTime()) entry.now = point;
      if (r.time.getTime() < tomorrow.getTime()) entry.todayHourly.push(point);
    } else if (r.stepMin === 1440) {
      if (r.time.getTime() === today.getTime()) entry.today = point;
      if (r.time.getTime() === tomorrow.getTime()) entry.tomorrow = point;
    }
  }
  return out;
}

/** Последняя успешная синхронизация провайдера (для статуса в админке и API). */
export async function getLastForecastRun(db: Database, provider: "smartmet" | "silam") {
  return db
    .select()
    .from(s.forecastRuns)
    .where(and(eq(s.forecastRuns.provider, provider), eq(s.forecastRuns.status, "ok")))
    .orderBy(desc(s.forecastRuns.fetchedAt))
    .limit(1)
    .then((r) => r[0] ?? null);
}

// ---------------------------------------------------------------------------
// SILAM
// ---------------------------------------------------------------------------

export interface SilamRunInfo {
  id: number;
  originTime: Date;
  fetchedAt: Date;
  hours: number;
  grid: SilamGrid | null;
}

export async function getLatestSilamRun(db: Database): Promise<SilamRunInfo | null> {
  return db
    .select({
      id: s.silamRuns.id,
      originTime: s.silamRuns.originTime,
      fetchedAt: s.silamRuns.fetchedAt,
      hours: s.silamRuns.hours,
      grid: s.silamRuns.grid,
    })
    .from(s.silamRuns)
    .where(eq(s.silamRuns.status, "ok"))
    .orderBy(desc(s.silamRuns.originTime))
    .limit(1)
    .then((r) => r[0] ?? null);
}

export interface SilamLayer {
  pollutantId: number;
  code: string;
  time: Date;
  file: string;
  stats: { min: number; max: number; mean: number } | null;
}

/** Каталог растровых слоёв прогона (по веществам и часам). */
export async function getSilamLayers(db: Database, runId: number): Promise<SilamLayer[]> {
  return db
    .select({
      pollutantId: s.silamFields.pollutantId,
      code: s.pollutants.code,
      time: s.silamFields.time,
      file: s.silamFields.file,
      stats: s.silamFields.stats,
    })
    .from(s.silamFields)
    .innerJoin(s.pollutants, eq(s.pollutants.id, s.silamFields.pollutantId))
    .where(eq(s.silamFields.runId, runId))
    .orderBy(asc(s.pollutants.sortOrder), asc(s.silamFields.time));
}

export interface SilamPointRow {
  pollutantId: number;
  time: Date;
  value: number;
  level: number;
}

/** Часовой точечный прогноз SILAM для города или станции (последний прогон). */
export async function getSilamPointForecast(
  db: Database,
  target: { locationId: number } | { stationId: number },
  opts: { runId?: number; from?: Date; to?: Date } = {},
): Promise<{ run: SilamRunInfo | null; rows: SilamPointRow[] }> {
  const run = opts.runId
    ? await db
        .select({
          id: s.silamRuns.id,
          originTime: s.silamRuns.originTime,
          fetchedAt: s.silamRuns.fetchedAt,
          hours: s.silamRuns.hours,
          grid: s.silamRuns.grid,
        })
        .from(s.silamRuns)
        .where(eq(s.silamRuns.id, opts.runId))
        .then((r) => r[0] ?? null)
    : await getLatestSilamRun(db);
  if (!run) return { run: null, rows: [] };
  const targetCond =
    "locationId" in target
      ? eq(s.silamPointForecast.locationId, target.locationId)
      : eq(s.silamPointForecast.stationId, target.stationId);
  const conds = [eq(s.silamPointForecast.runId, run.id), targetCond];
  if (opts.from) conds.push(gte(s.silamPointForecast.time, opts.from));
  if (opts.to) conds.push(lte(s.silamPointForecast.time, opts.to));
  const rows = await db
    .select({
      pollutantId: s.silamPointForecast.pollutantId,
      time: s.silamPointForecast.time,
      value: s.silamPointForecast.value,
      level: s.silamPointForecast.level,
    })
    .from(s.silamPointForecast)
    .where(and(...conds))
    .orderBy(asc(s.silamPointForecast.time));
  return { run, rows };
}

/** Пороги уровней публичной шкалы по веществу: часовые, иначе с минимальным осреднением. */
export function publicThresholds(config: IndexConfig): Map<number, LevelThreshold[]> {
  const scale = config.scales.find((sc) => sc.isDefaultPublic) ?? config.scales[0];
  const out = new Map<number, LevelThreshold[]>();
  if (!scale) return out;
  const byPollutant = new Map<number, Map<number, LevelThreshold[]>>();
  for (const b of scale.breakpoints) {
    const byAvg = byPollutant.get(b.pollutantId) ?? new Map<number, LevelThreshold[]>();
    const list = byAvg.get(b.averagingMin) ?? [];
    list.push({ level: b.level, lo: b.lo, hi: b.hi });
    byAvg.set(b.averagingMin, list);
    byPollutant.set(b.pollutantId, byAvg);
  }
  for (const [pid, byAvg] of byPollutant) {
    const avg = byAvg.has(60) ? 60 : Math.min(...byAvg.keys());
    out.set(
      pid,
      [...(byAvg.get(avg) ?? [])].sort((a, b) => a.level - b.level),
    );
  }
  return out;
}

export interface SilamDaySummary {
  /** "YYYY-MM-DD" по местному времени */
  date: string;
  level: number;
  dominantPollutantId: number | null;
  /** Среднесуточные концентрации по веществам */
  means: Record<string, number>;
  hours: number;
}

/**
 * Суточная сводка: среднее за местные сутки по каждому веществу, уровень — по порогам
 * публичной шкалы, уровень дня — худший из веществ.
 */
export function summarizeSilamDays(
  rows: SilamPointRow[],
  thresholds: Map<number, LevelThreshold[]>,
): SilamDaySummary[] {
  const byDay = new Map<string, Map<number, { sum: number; n: number }>>();
  for (const r of rows) {
    const key = localDateKey(r.time);
    const byPollutant = byDay.get(key) ?? new Map<number, { sum: number; n: number }>();
    const acc = byPollutant.get(r.pollutantId) ?? { sum: 0, n: 0 };
    acc.sum += r.value;
    acc.n += 1;
    byPollutant.set(r.pollutantId, acc);
    byDay.set(key, byPollutant);
  }
  const out: SilamDaySummary[] = [];
  for (const [date, byPollutant] of [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    let level = 0;
    let dominant: number | null = null;
    let dominantIndex = -1;
    const means: Record<string, number> = {};
    let hours = 0;
    for (const [pid, acc] of byPollutant) {
      const mean = acc.sum / acc.n;
      means[String(pid)] = Math.round(mean * 100) / 100;
      hours = Math.max(hours, acc.n);
      const th = thresholds.get(pid) ?? [];
      const lvl = levelForThresholds(mean, th);
      // Доминирующее — с наибольшей относительной позицией внутри порогов.
      const band = th.find((t) => t.level === lvl);
      const rel = band ? lvl + (band.hi ? (mean - band.lo) / (band.hi - band.lo) : 0.99) : lvl;
      if (rel > dominantIndex) {
        dominantIndex = rel;
        dominant = pid;
      }
      if (lvl > level) level = lvl;
    }
    out.push({ date, level, dominantPollutantId: dominant, means, hours });
  }
  return out;
}

/** Сводка «качество воздуха завтра» для нескольких городов (главная). */
export async function getSilamTomorrow(
  db: Database,
  locationIds: number[],
  now = new Date(),
): Promise<{ run: SilamRunInfo | null; byLocation: Map<number, SilamDaySummary | null> }> {
  const byLocation = new Map<number, SilamDaySummary | null>();
  const run = await getLatestSilamRun(db);
  if (!run || locationIds.length === 0) return { run, byLocation };
  const tomorrow = new Date(localMidnightUtc(now).getTime() + DAY);
  const [rows, config] = await Promise.all([
    db
      .select({
        locationId: s.silamPointForecast.locationId,
        pollutantId: s.silamPointForecast.pollutantId,
        time: s.silamPointForecast.time,
        value: s.silamPointForecast.value,
        level: s.silamPointForecast.level,
      })
      .from(s.silamPointForecast)
      .where(
        and(
          eq(s.silamPointForecast.runId, run.id),
          inArray(s.silamPointForecast.locationId, locationIds),
          gte(s.silamPointForecast.time, tomorrow),
          lte(s.silamPointForecast.time, new Date(tomorrow.getTime() + DAY - HOUR)),
          isNotNull(s.silamPointForecast.locationId),
        ),
      ),
    loadIndexConfig(db),
  ]);
  const thresholds = publicThresholds(config);
  const grouped = new Map<number, SilamPointRow[]>();
  for (const r of rows) {
    if (r.locationId === null) continue;
    const list = grouped.get(r.locationId) ?? [];
    list.push(r);
    grouped.set(r.locationId, list);
  }
  for (const id of locationIds) {
    const list = grouped.get(id);
    const days = list ? summarizeSilamDays(list, thresholds) : [];
    byLocation.set(id, days[0] ?? null);
  }
  return { run, byLocation };
}

/** Количество часов прогноза SILAM, доступных в последнем прогоне, начиная с момента `from`. */
export async function countSilamHoursFrom(
  db: Database,
  runId: number,
  from: Date,
): Promise<number> {
  const r = await db
    .select({ n: sql<number>`count(distinct ${s.silamFields.time})::int` })
    .from(s.silamFields)
    .where(and(eq(s.silamFields.runId, runId), gte(s.silamFields.time, from)))
    .then((x) => x[0]);
  return r?.n ?? 0;
}
