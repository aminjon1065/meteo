import "server-only";
import { csvCell, DUSHANBE_TZ, toDisplayValue, utcToDushanbeLocal } from "@meteo/core";
import { and, asc, eq, gte, inArray, lte, sql } from "@meteo/db";
import { measurements, pollutants, stationPollutants } from "@meteo/db/schema";
import { getDb } from "@/lib/db";
import {
  type Aggregation,
  aggregationFor,
  allowedAggregation,
  type Range,
} from "@/lib/measurement-ranges";
import { displayScaleOf, getConcentrationDisplayMode } from "@/lib/settings";

export {
  AGGREGATIONS,
  type Aggregation,
  aggregationFor,
  allowedAggregation,
  isAggregation,
  isRange,
  RANGE_AGGREGATIONS,
  RANGES,
  RAW_RANGES,
  type Range,
} from "@/lib/measurement-ranges";

const RANGE_MS: Record<Exclude<Range, "all">, number> = {
  "24h": 24 * 3_600_000,
  "7d": 7 * 24 * 3_600_000,
  "30d": 30 * 24 * 3_600_000,
  "1y": 365 * 24 * 3_600_000,
};
/** «Всё время» ограничено 10 годами: суточный ряд — до ~3650 точек. */
const ALL_MAX_MS = 10 * 365 * 24 * 3_600_000;

/** Флаги QC (packages/db/src/schema/measurements.ts) — названия для CSV. */
export const QC_FLAG_NAMES: Record<number, string> = {
  0: "raw",
  1: "valid",
  2: "suspect",
  3: "invalid",
  4: "corrected",
  5: "missing",
};

export interface SeriesPoint {
  t: string;
  /** Среднее по валидным (1) и исправленным (4) значениям; null — валидных нет. */
  v: number | null;
  min: number | null;
  max: number | null;
  /** Число значений в среднем. */
  n: number;
  /** Из них исправленных оператором (флаг 4). */
  corrected: number;
  /** Значений с флагами «подозрительное», «недостоверное», «не проверено» — в среднее не вошли. */
  excluded: number;
  /** Худший флаг среди исключённых значений (2/3/0) или null. */
  excludedFlag: number | null;
}

export interface PollutantSeries {
  /** `unit`/`decimals` — единица отображения портала (настройка администратора), значения приведены к ней. */
  pollutant: { id: number; code: string; shortName: string; unit: string; decimals: number };
  points: SeriesPoint[];
}

interface Measured {
  id: number;
  code: string;
  shortName: string;
  unit: string;
  decimals: number;
}

async function measuredPollutants(stationId: number, pollutantCode?: string): Promise<Measured[]> {
  const measured = await getDb()
    .select({
      id: pollutants.id,
      code: pollutants.code,
      shortName: pollutants.shortName,
      unit: pollutants.unit,
      decimals: pollutants.decimals,
    })
    .from(stationPollutants)
    .innerJoin(pollutants, eq(pollutants.id, stationPollutants.pollutantId))
    .where(and(eq(stationPollutants.stationId, stationId), eq(stationPollutants.active, true)))
    .orderBy(asc(pollutants.sortOrder));
  return pollutantCode ? measured.filter((m) => m.code === pollutantCode.toUpperCase()) : measured;
}

/** Начало периода; для «всё время» — первое измерение станции (не раньше 10 лет назад). */
async function rangeStart(stationId: number, range: Range, to: Date): Promise<Date> {
  if (range !== "all") return new Date(to.getTime() - RANGE_MS[range]);
  const [row] = await getDb()
    .select({ first: sql<string | null>`min(${measurements.time})` })
    .from(measurements)
    .where(eq(measurements.stationId, stationId));
  const floor = to.getTime() - ALL_MAX_MS;
  const first = row?.first ? new Date(row.first).getTime() : to.getTime() - RANGE_MS["1y"];
  return new Date(Math.max(first, floor));
}

/**
 * Ряды измерений станции за период: часовые, суточные или месячные средние (сутки и месяцы — по
 * местному времени). В среднее входят только значения с флагами 1 и 4; исключённые считаются
 * отдельно (`excluded`), чтобы CSV показывал качество каждой точки. Значения переводятся из
 * единицы хранения в единицу отображения (µg/m³ или mg/m³ как в бюллетенях).
 */
export async function loadSeries(
  stationId: number,
  range: Range,
  pollutantCode?: string,
  now = new Date(),
  aggregationIn?: Aggregation,
): Promise<{ from: Date; to: Date; aggregation: Aggregation; series: PollutantSeries[] }> {
  const db = getDb();
  const to = now;
  const aggregation =
    aggregationIn && allowedAggregation(range, aggregationIn)
      ? aggregationIn
      : aggregationFor(range);
  const [from, mode, wanted] = await Promise.all([
    rangeStart(stationId, range, to),
    getConcentrationDisplayMode(),
    measuredPollutants(stationId, pollutantCode),
  ]);
  if (wanted.length === 0) return { from, to, aggregation, series: [] };

  const bucket =
    aggregation === "hour"
      ? sql<Date>`time_bucket(interval '1 hour', ${measurements.time})`
      : aggregation === "day"
        ? sql<Date>`time_bucket(interval '1 day', ${measurements.time}, ${DUSHANBE_TZ})`
        : sql<Date>`time_bucket(interval '1 month', ${measurements.time}, ${DUSHANBE_TZ})`;
  const good = sql`${measurements.qcFlag} in (1, 4)`;
  const rows = await db
    .select({
      bucket: bucket.mapWith((v) => new Date(v)),
      pollutantId: measurements.pollutantId,
      avg: sql<number | null>`avg(${measurements.value}) filter (where ${good})`,
      min: sql<number | null>`min(${measurements.value}) filter (where ${good})`,
      max: sql<number | null>`max(${measurements.value}) filter (where ${good})`,
      n: sql<number>`count(${measurements.value}) filter (where ${good})`.mapWith(Number),
      corrected: sql<number>`count(*) filter (where ${measurements.qcFlag} = 4)`.mapWith(Number),
      excluded: sql<number>`count(*) filter (where not ${good})`.mapWith(Number),
      // Худший исключённый флаг: недостоверное (3) > подозрительное (2) > не проверено (0).
      excludedFlag: sql<
        number | null
      >`max(case ${measurements.qcFlag} when 3 then 3 when 2 then 2 when 0 then 1 end)`,
    })
    .from(measurements)
    .where(
      and(
        eq(measurements.stationId, stationId),
        inArray(
          measurements.pollutantId,
          wanted.map((w) => w.id),
        ),
        gte(measurements.time, from),
        lte(measurements.time, to),
        sql`${measurements.value} is not null`,
      ),
    )
    .groupBy(sql`1`, measurements.pollutantId)
    .orderBy(sql`1`);

  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const series = wanted.map((p) => {
    const scale = displayScaleOf(p, mode);
    return {
      pollutant: { ...p, unit: scale.unit, decimals: scale.decimals },
      points: rows
        .filter((r) => r.pollutantId === p.id)
        .map((r) => {
          const worst = num(r.excludedFlag);
          return {
            t: r.bucket.toISOString(),
            v: toDisplayValue(num(r.avg), scale),
            min: toDisplayValue(num(r.min), scale),
            max: toDisplayValue(num(r.max), scale),
            n: r.n,
            corrected: r.corrected,
            excluded: r.excluded,
            excludedFlag: worst === null ? null : worst === 1 ? 0 : worst,
          };
        }),
    };
  });
  return { from, to, aggregation, series };
}

/**
 * Флаг качества точки ряда для CSV: valid — все значения прошли QC; corrected — среди них есть
 * исправленные оператором; если валидных нет — худший флаг исключённых (invalid/suspect/raw).
 */
export function pointQcFlag(p: SeriesPoint): string {
  if (p.n > 0) return p.corrected > 0 ? "corrected" : "valid";
  return QC_FLAG_NAMES[p.excludedFlag ?? 5] ?? "missing";
}

/** CSV средних с BOM для Excel: время в UTC и по Душанбе, флаг качества и число исключённых значений. */
export function seriesToCsv(
  stationCode: string,
  aggregation: Aggregation,
  series: PollutantSeries[],
): string {
  const header = [
    "time_utc",
    "time_local",
    "station",
    "pollutant",
    "value",
    "unit",
    "aggregation",
    "samples",
    "min",
    "max",
    "qc_flag",
    "excluded",
  ];
  const lines = [header.join(",")];
  for (const s of series) {
    for (const p of s.points) {
      const local = utcToDushanbeLocal(new Date(p.t));
      lines.push(
        [
          p.t,
          `${local.date} ${local.time}`,
          stationCode,
          s.pollutant.code,
          p.v ?? "",
          s.pollutant.unit,
          aggregation,
          p.n,
          p.min ?? "",
          p.max ?? "",
          pointQcFlag(p),
          p.excluded,
        ]
          .map(csvCell)
          .join(","),
      );
    }
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}

/**
 * Исходные значения станции за период (до 30 суток) с флагом QC каждого значения — для CSV
 * «как измерено». Включены и исключённые из средних значения: по флагу их можно отфильтровать.
 */
export async function rawToCsv(
  stationId: number,
  stationCode: string,
  range: Range,
  pollutantCode?: string,
  now = new Date(),
): Promise<string> {
  const to = now;
  const [from, mode, wanted] = await Promise.all([
    rangeStart(stationId, range, to),
    getConcentrationDisplayMode(),
    measuredPollutants(stationId, pollutantCode),
  ]);
  const header = [
    "time_utc",
    "time_local",
    "station",
    "pollutant",
    "value",
    "unit",
    "averaging_min",
    "qc_flag",
  ];
  const lines = [header.join(",")];
  if (wanted.length > 0) {
    const rows = await getDb()
      .select({
        time: measurements.time,
        pollutantId: measurements.pollutantId,
        averagingMin: measurements.averagingMin,
        value: measurements.value,
        qcFlag: measurements.qcFlag,
      })
      .from(measurements)
      .where(
        and(
          eq(measurements.stationId, stationId),
          inArray(
            measurements.pollutantId,
            wanted.map((w) => w.id),
          ),
          gte(measurements.time, from),
          lte(measurements.time, to),
          sql`${measurements.value} is not null`,
        ),
      )
      .orderBy(asc(measurements.time), asc(measurements.pollutantId));
    const byId = new Map(wanted.map((p) => [p.id, { p, scale: displayScaleOf(p, mode) }]));
    for (const r of rows) {
      const entry = byId.get(r.pollutantId);
      if (!entry) continue;
      const local = utcToDushanbeLocal(r.time);
      lines.push(
        [
          r.time.toISOString(),
          `${local.date} ${local.time}`,
          stationCode,
          entry.p.code,
          toDisplayValue(r.value, entry.scale) ?? "",
          entry.scale.unit,
          r.averagingMin,
          QC_FLAG_NAMES[r.qcFlag] ?? String(r.qcFlag),
        ]
          .map(csvCell)
          .join(","),
      );
    }
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}
