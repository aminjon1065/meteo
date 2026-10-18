/**
 * Приём измерений от станций — общий сервис для POST /api/v1/ingest (web) и задачи
 * station-pull (worker): справочники станции → нормализация (@meteo/core `normalizeIngestRecords`)
 * → идемпотентный upsert по ключу «время / станция / вещество / осреднение» (решения оператора
 * с qc_locked не перезаписываются) → отметка последнего приёма на станции → пересчёт индекса.
 * Правила уведомлений (threshold-eval) запускает вызывающая сторона.
 */
import { createHash } from "node:crypto";
import {
  type ConcentrationUnit,
  type IngestContext,
  type IngestNormalizeResult,
  type IngestRecordInput,
  normalizeIngestRecords,
} from "@meteo/core";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../client";
import type { StationIngestSource, StationIngestSummary } from "../schema";
import * as s from "../schema";
import { computeStationIndexesRange } from "./station-index";

export interface IngestStation {
  id: number;
  code: string;
  slug: string;
  status: "active" | "suspended" | "decommissioned";
  sampling: "continuous" | "discrete";
}

/** SHA‑256 ключа станции (в БД хранится только хэш). */
export function hashStationApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

/** Станция по коду и API‑ключу; null — код или ключ не подходят (без различия, чтобы не подсказывать). */
export async function findStationByApiKey(
  db: Database,
  code: string,
  apiKey: string,
): Promise<IngestStation | null> {
  const normalized = code.trim().toUpperCase();
  if (!normalized || !apiKey) return null;
  const rows = await db
    .select({
      id: s.stations.id,
      code: s.stations.code,
      slug: s.stations.slug,
      status: s.stations.status,
      sampling: s.stations.sampling,
    })
    .from(s.stations)
    .where(
      and(
        sql`upper(${s.stations.code}) = ${normalized}`,
        eq(s.stations.apiKeyHash, hashStationApiKey(apiKey)),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Справочники для нормализации: вещества станции с единицами ввода, словарь веществ, диапазоны QC. */
export async function loadIngestContext(
  db: Database,
  station: Pick<IngestStation, "id" | "code" | "sampling">,
  opts: { now?: Date; allowUnconfiguredPollutants?: boolean } = {},
): Promise<IngestContext> {
  const [links, pollutantRows, ruleRows] = await Promise.all([
    db
      .select({
        pollutantId: s.stationPollutants.pollutantId,
        inputUnit: s.stationPollutants.inputUnit,
      })
      .from(s.stationPollutants)
      .where(
        and(eq(s.stationPollutants.stationId, station.id), eq(s.stationPollutants.active, true)),
      ),
    db.select().from(s.pollutants),
    db
      .select()
      .from(s.qcRules)
      .where(and(eq(s.qcRules.kind, "range"), eq(s.qcRules.enabled, true))),
  ]);
  const ctx: IngestContext = {
    station: {
      id: station.id,
      code: station.code,
      sampling: station.sampling,
      inputUnits: new Map(links.map((l) => [l.pollutantId, l.inputUnit as ConcentrationUnit])),
    },
    pollutants: new Map(),
    ranges: new Map(),
    now: opts.now,
    allowUnconfiguredPollutants: opts.allowUnconfiguredPollutants,
  };
  for (const p of pollutantRows) {
    ctx.pollutants.set(p.code.toUpperCase(), {
      id: p.id,
      code: p.code,
      unit: p.unit as ConcentrationUnit,
      decimals: p.decimals,
      molarMass: p.molarMass,
    });
  }
  for (const r of ruleRows) {
    if (r.pollutantId && typeof r.params.min === "number" && typeof r.params.max === "number")
      ctx.ranges.set(r.pollutantId, { min: r.params.min, max: r.params.max });
  }
  return ctx;
}

export interface IngestMeasurementsOptions {
  station: IngestStation;
  records: IngestRecordInput[];
  source: StationIngestSource;
  now?: Date;
  /** Предзагруженный контекст (pull‑адаптер обрабатывает несколько файлов одной станции). */
  context?: IngestContext;
  /** Пересчитывать индекс после записи (по умолчанию да). */
  recomputeIndex?: boolean;
  /** Дополнительные сведения для сводки на карточке станции. */
  meta?: { sourceId?: number; file?: string; agent?: string };
}

export interface IngestMeasurementsResult extends Omit<IngestNormalizeResult, "rows"> {
  inserted: number;
  updated: number;
  /** Строк с решением оператора (qc_locked), которые не перезаписаны. */
  skippedLocked: number;
  indexRecomputed: boolean;
}

const CHUNK = 500;
/** Код источника measurements.source: API/агент → api (3), pull‑адаптер → sensor (4). */
const MEASUREMENT_SOURCE_BY_INGEST: Record<StationIngestSource, number> = {
  api: s.MEASUREMENT_SOURCE.api,
  pull: s.MEASUREMENT_SOURCE.sensor,
};

export async function ingestMeasurements(
  db: Database,
  opts: IngestMeasurementsOptions,
): Promise<IngestMeasurementsResult> {
  const now = opts.now ?? new Date();
  const ctx = opts.context ?? (await loadIngestContext(db, opts.station, { now }));
  const normalized = normalizeIngestRecords(opts.records, { ...ctx, now });
  const { rows, ...summary } = normalized;
  const result: IngestMeasurementsResult = {
    ...summary,
    inserted: 0,
    updated: 0,
    skippedLocked: 0,
    indexRecomputed: false,
  };
  if (rows.length === 0) return result;

  const sourceCode = MEASUREMENT_SOURCE_BY_INGEST[opts.source];
  await db.transaction(async (tx) => {
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK).map((r) => ({
        time: r.time,
        stationId: r.stationId,
        pollutantId: r.pollutantId,
        averagingMin: r.averagingMin,
        value: r.value,
        qcFlag: r.qcFlag,
        qcReason: r.qcReason,
        source: sourceCode,
      }));
      const written = await tx
        .insert(s.measurements)
        .values(chunk)
        .onConflictDoUpdate({
          target: [
            s.measurements.time,
            s.measurements.stationId,
            s.measurements.pollutantId,
            s.measurements.averagingMin,
          ],
          set: {
            value: sql`excluded.value`,
            qcFlag: sql`excluded.qc_flag`,
            qcReason: sql`excluded.qc_reason`,
            source: sql`excluded.source`,
            updatedAt: sql`now()`,
          },
          // Решение оператора окончательное: строки с qc_locked автоматический приём не меняет.
          setWhere: sql`${s.measurements.qcLocked} = false`,
        })
        .returning({ inserted: sql<boolean>`(xmax = 0)` });
      for (const w of written) {
        if (w.inserted) result.inserted += 1;
        else result.updated += 1;
      }
      result.skippedLocked += chunk.length - written.length;
    }
  });

  if (result.inserted + result.updated > 0) {
    const stationSummary: StationIngestSummary = {
      at: now.toISOString(),
      source: opts.source,
      received: result.received,
      accepted: result.accepted,
      rejected: result.rejected,
      invalidRange: result.invalidRange,
      from: result.from?.toISOString() ?? null,
      to: result.to?.toISOString() ?? null,
      pollutants: result.pollutantCodes,
      ...(opts.meta?.sourceId !== undefined ? { sourceId: opts.meta.sourceId } : {}),
      ...(opts.meta?.file ? { file: opts.meta.file.slice(0, 255) } : {}),
      ...(opts.meta?.agent ? { agent: opts.meta.agent.slice(0, 255) } : {}),
    };
    await db
      .update(s.stations)
      .set({ lastIngestAt: now, lastIngestSource: opts.source, lastIngestSummary: stationSummary })
      .where(eq(s.stations.id, opts.station.id));
  }

  if (opts.recomputeIndex !== false && result.from && result.to) {
    await computeStationIndexesRange(db, [opts.station.id], result.from, result.to);
    result.indexRecomputed = true;
  }
  return result;
}
