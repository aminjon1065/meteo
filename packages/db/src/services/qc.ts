/**
 * Пакетный контроль качества: скачки, «залипание», робастные выбросы относительно 30‑дневной базы.
 * Меняет только незаблокированные строки с флагом raw/valid → suspect; решения оператора не трогает.
 */
import {
  detectOutliers,
  detectSpikes,
  detectStuck,
  QC_FLAG,
  QC_REASON,
  type QcSample,
} from "@meteo/core";
import { and, eq, gte, inArray, ne, sql } from "drizzle-orm";
import type { Database } from "../client";
import * as s from "../schema";

export interface QcBatchOptions {
  hours?: number;
  stationIds?: number[];
  now?: Date;
}

export interface QcBatchSummary {
  checked: number;
  flagged: number;
  byReason: Record<string, number>;
}

type Row = {
  time: Date;
  stationId: number;
  pollutantId: number;
  averagingMin: number;
  value: number;
};

export async function runQcBatch(db: Database, opts: QcBatchOptions = {}): Promise<QcBatchSummary> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - (opts.hours ?? 48) * 3_600_000);
  const rules = await db.select().from(s.qcRules).where(eq(s.qcRules.enabled, true));
  const spikeRule = rules.find((r) => r.kind === "spike");
  const stuckRule = rules.find((r) => r.kind === "stuck");
  const outlierRule = rules.find((r) => r.kind === "mad_outlier");
  if (!spikeRule && !stuckRule && !outlierRule) return { checked: 0, flagged: 0, byReason: {} };

  const stationWhere = opts.stationIds?.length
    ? inArray(s.stations.id, opts.stationIds)
    : ne(s.stations.status, "decommissioned");
  const stationRows = await db
    .select({ id: s.stations.id, sampling: s.stations.sampling })
    .from(s.stations)
    .where(stationWhere);
  const sampling = new Map(stationRows.map((r) => [r.id, r.sampling]));
  const stationIds = [...sampling.keys()];
  if (stationIds.length === 0) return { checked: 0, flagged: 0, byReason: {} };

  const recent = await db
    .select({
      time: s.measurements.time,
      stationId: s.measurements.stationId,
      pollutantId: s.measurements.pollutantId,
      averagingMin: s.measurements.averagingMin,
      value: s.measurements.value,
    })
    .from(s.measurements)
    .where(
      and(
        inArray(s.measurements.stationId, stationIds),
        gte(s.measurements.time, since),
        inArray(s.measurements.qcFlag, [QC_FLAG.raw, QC_FLAG.valid]),
        eq(s.measurements.qcLocked, false),
        sql`${s.measurements.value} is not null`,
      ),
    )
    .orderBy(s.measurements.stationId, s.measurements.pollutantId, s.measurements.time);

  const groups = new Map<string, Row[]>();
  for (const r of recent) {
    if (r.value === null) continue;
    const key = `${r.stationId}|${r.pollutantId}`;
    const list = groups.get(key) ?? [];
    list.push({ ...r, value: r.value });
    groups.set(key, list);
  }

  // Базовые статистики за 30 дней: медиана и MAD по станции и веществу.
  const baselineRows = outlierRule
    ? await db.execute<{
        station_id: number;
        pollutant_id: number;
        med: number;
        mad: number;
        n: number;
      }>(sql`
        with base as (
          select station_id, pollutant_id, value
          from measurements
          where station_id in (${sql.join(
            stationIds.map((id) => sql`${id}`),
            sql`, `,
          )}) and time >= ${new Date(now.getTime() - 30 * 24 * 3_600_000).toISOString()}::timestamptz
            and qc_flag in (1, 4) and value is not null
        ),
        med as (
          select station_id, pollutant_id, percentile_cont(0.5) within group (order by value) as med, count(*) as n
          from base group by 1, 2
        )
        select b.station_id, b.pollutant_id, med.med::float8 as med,
               (percentile_cont(0.5) within group (order by abs(b.value - med.med)))::float8 as mad, med.n::int as n
        from base b join med on med.station_id = b.station_id and med.pollutant_id = b.pollutant_id
        group by 1, 2, med.med, med.n
      `)
    : [];
  const baselines = new Map(
    baselineRows.map((b) => [
      `${b.station_id}|${b.pollutant_id}`,
      { median: Number(b.med), mad: Number(b.mad), n: Number(b.n) },
    ]),
  );

  const flagged = new Map<string, { row: Row; reason: string }>();
  const byReason: Record<string, number> = {};
  const mark = (row: Row, reason: string) => {
    const key = `${row.time.toISOString()}|${row.stationId}|${row.pollutantId}|${row.averagingMin}`;
    if (flagged.has(key)) return;
    flagged.set(key, { row, reason });
    byReason[reason] = (byReason[reason] ?? 0) + 1;
  };

  for (const [key, rows] of groups) {
    const samples: QcSample[] = rows.map((r) => ({ time: r.time, value: r.value }));
    const stationId = rows[0]?.stationId ?? 0;
    if (spikeRule) {
      const p = spikeRule.params as { madMultiplier?: number; minSamples?: number };
      for (const i of detectSpikes(samples, {
        madMultiplier: num(p.madMultiplier, 6),
        minSamples: num(p.minSamples, 6),
      })) {
        const r = rows[i];
        if (r) mark(r, QC_REASON.spike);
      }
    }
    if (stuckRule && sampling.get(stationId) === "continuous") {
      const p = stuckRule.params as { hours?: number; minRun?: number };
      for (const i of detectStuck(samples, { hours: num(p.hours, 12), minRun: num(p.minRun, 3) })) {
        const r = rows[i];
        if (r) mark(r, QC_REASON.stuck);
      }
    }
    if (outlierRule) {
      const baseline = baselines.get(key);
      if (baseline) {
        const p = outlierRule.params as { z?: number; minBaseline?: number };
        for (const i of detectOutliers(samples, baseline, {
          z: num(p.z, 5),
          minBaseline: num(p.minBaseline, 30),
        })) {
          const r = rows[i];
          if (r) mark(r, QC_REASON.outlier);
        }
      }
    }
  }

  if (flagged.size > 0) {
    await db.transaction(async (tx) => {
      for (const { row, reason } of flagged.values()) {
        await tx
          .update(s.measurements)
          .set({ qcFlag: QC_FLAG.suspect, qcReason: reason, updatedAt: new Date() })
          .where(
            and(
              eq(s.measurements.time, row.time),
              eq(s.measurements.stationId, row.stationId),
              eq(s.measurements.pollutantId, row.pollutantId),
              eq(s.measurements.averagingMin, row.averagingMin),
              eq(s.measurements.qcLocked, false),
            ),
          );
      }
    });
  }
  return { checked: recent.length, flagged: flagged.size, byReason };
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
