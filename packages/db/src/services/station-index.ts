/**
 * Расчёт индекса станций по всем включённым шкалам и чтение текущих значений.
 * Используется worker'ом (периодически) и server actions (сразу после ввода/импорта).
 */
import {
  type BreakpointRow,
  computeBreakpointIndex,
  computeIza,
  computeRatioIndex,
  DUSHANBE_TZ,
  type LevelBand,
  type LimitRow,
  type PollutantValue,
  type StationIndexResult,
  windowMean,
} from "@meteo/core";
import { and, asc, desc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import type { Database } from "../client";
import type { IndexLevelDef } from "../schema";
import * as s from "../schema";

export interface ScaleConfig {
  id: number;
  code: string;
  kind: "breakpoints" | "ratio_to_limit" | "iza";
  levels: IndexLevelDef[];
  isDefaultPublic: boolean;
  breakpoints: BreakpointRow[];
}

export interface IndexConfig {
  scales: ScaleConfig[];
  /** Среднесуточные ПДК с классом опасности. */
  dailyLimits: LimitRow[];
}

const HOUR = 3_600_000;

export async function loadIndexConfig(db: Database): Promise<IndexConfig> {
  const [scaleRows, bpRows, limitRows] = await Promise.all([
    db
      .select()
      .from(s.indexScales)
      .where(eq(s.indexScales.enabled, true))
      .orderBy(asc(s.indexScales.sortOrder)),
    db.select().from(s.indexBreakpoints),
    db
      .select({
        pollutantId: s.limitValues.pollutantId,
        value: s.limitValues.value,
        hazardClass: s.pollutants.hazardClass,
      })
      .from(s.limitValues)
      .innerJoin(s.pollutants, eq(s.pollutants.id, s.limitValues.pollutantId))
      .where(eq(s.limitValues.kind, "daily")),
  ]);
  return {
    scales: scaleRows.map((r) => ({
      id: r.id,
      code: r.code,
      kind: r.kind,
      levels: r.levels,
      isDefaultPublic: r.isDefaultPublic,
      breakpoints: bpRows
        .filter((b) => b.scaleId === r.id)
        .map((b) => ({
          pollutantId: b.pollutantId,
          level: b.level,
          lo: b.lo,
          hi: b.hi,
          averagingMin: b.averagingMin,
        })),
    })),
    dailyLimits: limitRows.map((l) => ({
      pollutantId: l.pollutantId,
      limit: l.value,
      hazardClass: l.hazardClass,
    })),
  };
}

export interface ComputeOptions {
  stationIds?: number[];
  /** Начало пересчёта; по умолчанию until − hours. */
  since?: Date;
  until?: Date;
  hours?: number;
  /** Пересчитывать ли месячный ИЗА (по умолчанию да). */
  monthly?: boolean;
}

export interface ComputeSummary {
  stations: number;
  hourlyRows: number;
  monthlyRows: number;
}

type HourlyPoint = { time: Date; value: number };

function floorHour(d: Date): Date {
  return new Date(Math.floor(d.getTime() / HOUR) * HOUR);
}

function bandsOf(levels: IndexLevelDef[]): LevelBand[] {
  return levels.map((l) => ({ level: l.level, lo: l.lo, hi: l.hi }));
}

function maxAveraging(scale: ScaleConfig): number {
  if (scale.kind === "ratio_to_limit") return 1440;
  return scale.breakpoints.reduce((m, b) => Math.max(m, b.averagingMin), 60);
}

/** Пересчитывает индексы станций за окно часов и ИЗА за затронутые месяцы. */
export async function computeStationIndexes(
  db: Database,
  opts: ComputeOptions = {},
): Promise<ComputeSummary> {
  const config = await loadIndexConfig(db);
  const until = floorHour(opts.until ?? new Date());
  const hours = opts.hours ?? 48;
  const since = floorHour(opts.since ?? new Date(until.getTime() - hours * HOUR));
  const hourlyScales = config.scales.filter((sc) => sc.kind !== "iza");
  const lookbackMin = hourlyScales.reduce((m, sc) => Math.max(m, maxAveraging(sc)), 60);

  const stationFilter = opts.stationIds?.length
    ? inArray(s.stations.id, opts.stationIds)
    : ne(s.stations.status, "decommissioned");
  const stationRows = await db.select({ id: s.stations.id }).from(s.stations).where(stationFilter);
  const stationIds = stationRows.map((r) => r.id);
  if (stationIds.length === 0) return { stations: 0, hourlyRows: 0, monthlyRows: 0 };

  // Часовые средние из сырых валидных измерений (без лага continuous aggregate).
  const hourly = await db
    .select({
      bucket: sql<Date>`time_bucket(interval '1 hour', ${s.measurements.time})`.mapWith(
        (v) => new Date(v),
      ),
      stationId: s.measurements.stationId,
      pollutantId: s.measurements.pollutantId,
      value: sql<number>`avg(${s.measurements.value})`.mapWith(Number),
    })
    .from(s.measurements)
    .where(
      and(
        inArray(s.measurements.stationId, stationIds),
        gte(s.measurements.time, new Date(since.getTime() - lookbackMin * 60_000)),
        lte(s.measurements.time, new Date(until.getTime() + HOUR)),
        sql`${s.measurements.qcFlag} in (1, 4)`,
        sql`${s.measurements.value} is not null`,
      ),
    )
    .groupBy(sql`1`, s.measurements.stationId, s.measurements.pollutantId);

  const series = new Map<number, Map<number, HourlyPoint[]>>();
  for (const row of hourly) {
    const byPollutant = series.get(row.stationId) ?? new Map<number, HourlyPoint[]>();
    const list = byPollutant.get(row.pollutantId) ?? [];
    list.push({ time: row.bucket, value: row.value });
    byPollutant.set(row.pollutantId, list);
    series.set(row.stationId, byPollutant);
  }

  const rows: Array<typeof s.stationIndex.$inferInsert> = [];
  for (const stationId of stationIds) {
    const byPollutant = series.get(stationId);
    if (!byPollutant) continue;
    for (let t = since.getTime(); t <= until.getTime(); t += HOUR) {
      const bucketStart = new Date(t);
      // Часовые точки — начала бакетов: окно (t − W, t] включает бакет t и исключает следующий.
      const windowEnd = bucketStart;
      for (const scale of hourlyScales) {
        const values: PollutantValue[] = [];
        for (const [pollutantId, points] of byPollutant) {
          const averaging =
            scale.kind === "ratio_to_limit"
              ? 1440
              : (scale.breakpoints.find((b) => b.pollutantId === pollutantId)?.averagingMin ?? 60);
          const mean = windowMean(points, windowEnd, averaging);
          if (mean !== null) values.push({ pollutantId, value: mean });
        }
        if (values.length === 0) continue;
        const result: StationIndexResult =
          scale.kind === "ratio_to_limit"
            ? computeRatioIndex(values, config.dailyLimits, bandsOf(scale.levels))
            : computeBreakpointIndex(values, scale.breakpoints);
        if (result.level === 0) continue;
        rows.push({
          time: bucketStart,
          stationId,
          scaleId: scale.id,
          value: result.value,
          level: result.level,
          dominantPollutantId: result.dominantPollutantId,
          subIndices: result.subIndices,
          computedAt: new Date(),
        });
      }
    }
  }
  const hourlyRows = await upsertIndexRows(db, rows);

  let monthlyRows = 0;
  if (opts.monthly !== false) {
    monthlyRows = await computeMonthlyIza(db, config, stationIds, since, until);
  }
  return { stations: stationIds.length, hourlyRows, monthlyRows };
}

async function computeMonthlyIza(
  db: Database,
  config: IndexConfig,
  stationIds: number[],
  since: Date,
  until: Date,
): Promise<number> {
  const izaScales = config.scales.filter((sc) => sc.kind === "iza");
  if (izaScales.length === 0) return 0;
  const monthly = await db
    .select({
      bucket:
        sql<Date>`time_bucket(interval '1 month', ${s.measurements.time}, ${DUSHANBE_TZ})`.mapWith(
          (v) => new Date(v),
        ),
      stationId: s.measurements.stationId,
      pollutantId: s.measurements.pollutantId,
      value: sql<number>`avg(${s.measurements.value})`.mapWith(Number),
    })
    .from(s.measurements)
    .where(
      and(
        inArray(s.measurements.stationId, stationIds),
        gte(s.measurements.time, new Date(since.getTime() - 35 * 24 * HOUR)),
        lte(s.measurements.time, new Date(until.getTime() + HOUR)),
        sql`${s.measurements.qcFlag} in (1, 4)`,
        sql`${s.measurements.value} is not null`,
      ),
    )
    .groupBy(sql`1`, s.measurements.stationId, s.measurements.pollutantId);

  const grouped = new Map<string, { time: Date; stationId: number; values: PollutantValue[] }>();
  for (const row of monthly) {
    const key = `${row.stationId}|${row.bucket.toISOString()}`;
    const g = grouped.get(key) ?? { time: row.bucket, stationId: row.stationId, values: [] };
    g.values.push({ pollutantId: row.pollutantId, value: row.value });
    grouped.set(key, g);
  }
  const rows: Array<typeof s.stationIndex.$inferInsert> = [];
  for (const g of grouped.values()) {
    for (const scale of izaScales) {
      const result = computeIza(g.values, config.dailyLimits, bandsOf(scale.levels));
      if (result.level === 0) continue;
      rows.push({
        time: g.time,
        stationId: g.stationId,
        scaleId: scale.id,
        value: result.value,
        level: result.level,
        dominantPollutantId: result.dominantPollutantId,
        subIndices: result.subIndices,
        computedAt: new Date(),
      });
    }
  }
  return upsertIndexRows(db, rows);
}

async function upsertIndexRows(
  db: Database,
  rows: Array<typeof s.stationIndex.$inferInsert>,
): Promise<number> {
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await db
      .insert(s.stationIndex)
      .values(chunk)
      .onConflictDoUpdate({
        target: [s.stationIndex.time, s.stationIndex.stationId, s.stationIndex.scaleId],
        set: {
          value: sql`excluded.value`,
          level: sql`excluded.level`,
          dominantPollutantId: sql`excluded.dominant_pollutant_id`,
          subIndices: sql`excluded.sub_indices`,
          computedAt: sql`excluded.computed_at`,
        },
      });
  }
  return rows.length;
}

export interface CurrentIndex {
  stationId: number;
  time: Date;
  value: number | null;
  level: number;
  dominantPollutantId: number | null;
  subIndices: Record<string, { value: number; level: number; index: number }>;
  /** Старше maxAgeHours — данные считаются устаревшими. */
  stale: boolean;
}

/** Последний индекс каждой станции по шкале (по умолчанию — публичная шкала по умолчанию). */
export async function getCurrentIndexes(
  db: Database,
  opts: { scaleCode?: string; maxAgeHours?: number; stationIds?: number[] } = {},
): Promise<{ scale: ScaleConfig | null; byStation: Map<number, CurrentIndex> }> {
  const config = await loadIndexConfig(db);
  const scale = opts.scaleCode
    ? (config.scales.find((sc) => sc.code === opts.scaleCode) ?? null)
    : (config.scales.find((sc) => sc.isDefaultPublic) ?? config.scales[0] ?? null);
  const byStation = new Map<number, CurrentIndex>();
  if (!scale) return { scale: null, byStation };
  const maxAgeHours = opts.maxAgeHours ?? 6;
  const conditions = [
    eq(s.stationIndex.scaleId, scale.id),
    gte(s.stationIndex.time, new Date(Date.now() - 7 * 24 * HOUR)),
  ];
  if (opts.stationIds?.length) conditions.push(inArray(s.stationIndex.stationId, opts.stationIds));
  const rows = await db
    .selectDistinctOn([s.stationIndex.stationId])
    .from(s.stationIndex)
    .where(and(...conditions))
    .orderBy(s.stationIndex.stationId, desc(s.stationIndex.time));
  for (const r of rows) {
    byStation.set(r.stationId, {
      stationId: r.stationId,
      time: r.time,
      value: r.value,
      level: r.level,
      dominantPollutantId: r.dominantPollutantId,
      subIndices: (r.subIndices ?? {}) as CurrentIndex["subIndices"],
      stale: Date.now() - r.time.getTime() > maxAgeHours * HOUR,
    });
  }
  return { scale, byStation };
}
