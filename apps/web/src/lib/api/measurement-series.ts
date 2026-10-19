import "server-only";
import { csvCell, DUSHANBE_TZ, utcToDushanbeLocal } from "@meteo/core";
import { and, asc, eq, gte, inArray, lte, sql } from "@meteo/db";
import { measurements, pollutants, stationPollutants } from "@meteo/db/schema";
import { getDb } from "@/lib/db";

export const RANGES = ["24h", "7d", "30d", "1y"] as const;
export type Range = (typeof RANGES)[number];

const RANGE_MS: Record<Range, number> = {
  "24h": 24 * 3_600_000,
  "7d": 7 * 24 * 3_600_000,
  "30d": 30 * 24 * 3_600_000,
  "1y": 365 * 24 * 3_600_000,
};

export function isRange(v: unknown): v is Range {
  return typeof v === "string" && (RANGES as readonly string[]).includes(v);
}

export function aggregationFor(range: Range): "hour" | "day" {
  return range === "24h" || range === "7d" ? "hour" : "day";
}

export interface SeriesPoint {
  t: string;
  v: number | null;
  min: number | null;
  max: number | null;
  n: number;
}

export interface PollutantSeries {
  pollutant: { id: number; code: string; shortName: string; unit: string; decimals: number };
  points: SeriesPoint[];
}

/** Ряды измерений станции за период: часовые (24h/7d) или суточные (30d/1y) средние по местному времени. */
export async function loadSeries(
  stationId: number,
  range: Range,
  pollutantCode?: string,
  now = new Date(),
): Promise<{ from: Date; to: Date; aggregation: "hour" | "day"; series: PollutantSeries[] }> {
  const db = getDb();
  const to = now;
  const from = new Date(to.getTime() - RANGE_MS[range]);
  const aggregation = aggregationFor(range);
  const measured = await db
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
  const wanted = pollutantCode
    ? measured.filter((m) => m.code === pollutantCode.toUpperCase())
    : measured;
  if (wanted.length === 0) return { from, to, aggregation, series: [] };

  const bucket =
    aggregation === "hour"
      ? sql<Date>`time_bucket(interval '1 hour', ${measurements.time})`
      : sql<Date>`time_bucket(interval '1 day', ${measurements.time}, ${DUSHANBE_TZ})`;
  const rows = await db
    .select({
      bucket: bucket.mapWith((v) => new Date(v)),
      pollutantId: measurements.pollutantId,
      avg: sql<number>`avg(${measurements.value})`.mapWith(Number),
      min: sql<number>`min(${measurements.value})`.mapWith(Number),
      max: sql<number>`max(${measurements.value})`.mapWith(Number),
      n: sql<number>`count(${measurements.value})`.mapWith(Number),
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
        sql`${measurements.qcFlag} in (1, 4)`,
        sql`${measurements.value} is not null`,
      ),
    )
    .groupBy(sql`1`, measurements.pollutantId)
    .orderBy(sql`1`);

  const series = wanted.map((p) => ({
    pollutant: p,
    points: rows
      .filter((r) => r.pollutantId === p.id)
      .map((r) => ({
        t: r.bucket.toISOString(),
        v: round(r.avg, p.decimals),
        min: round(r.min, p.decimals),
        max: round(r.max, p.decimals),
        n: r.n,
      })),
  }));
  return { from, to, aggregation, series };
}

function round(v: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round((v + Number.EPSILON) * f) / f;
}

/** CSV с BOM для Excel: время в UTC и по Душанбе. */
export function seriesToCsv(
  stationCode: string,
  aggregation: "hour" | "day",
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
        ]
          .map(csvCell)
          .join(","),
      );
    }
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}
