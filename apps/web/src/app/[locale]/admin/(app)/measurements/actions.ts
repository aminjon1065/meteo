"use server";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  applyRangeRule,
  convertConcentration,
  dushanbeLocalToUtc,
  QC_FLAG,
  roundTo,
} from "@meteo/core";
import { computeStationIndexes, eq, sql } from "@meteo/db";
import { importBatches, MEASUREMENT_SOURCE, measurements } from "@meteo/db/schema";
import type { Locale } from "@meteo/i18n";
import { recordAudit } from "@/lib/audit";
import { getDb } from "@/lib/db";
import {
  type ImportReport,
  type ImportRow,
  parseMeasurementsCsv,
} from "@/lib/import/measurements-csv";
import { requireAdminSession } from "@/lib/session";
import { fieldErrorsOf } from "@/lib/validation/common";
import { manualEntryInput, parseDecimal } from "@/lib/validation/measurement";
import { loadEntryStations, loadImportContext } from "./_data";

const IMPORTS_DIR = process.env.IMPORTS_DIR ?? resolve(process.cwd(), "../../data/imports");

export type ManualEntryResult =
  | {
      ok: true;
      saved: number;
      invalid: Array<{ time: string; pollutant: string; value: number; reason: string }>;
    }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

/** Ручной ввод: сетка станция × время × вещество. Повторный ввод обновляет значение. */
export async function saveManualMeasurements(
  locale: Locale,
  raw: unknown,
): Promise<ManualEntryResult> {
  const session = await requireAdminSession(locale, "measurements.write");
  const parsed = manualEntryInput.safeParse(raw);
  if (!parsed.success)
    return { ok: false, message: "validation", fieldErrors: fieldErrorsOf(parsed.error) };
  const input = parsed.data;
  const station = (await loadEntryStations()).find((s) => s.id === input.stationId);
  if (!station) return { ok: false, message: "unknownStation" };
  const ctx = await loadImportContext();
  const averagingMin = station.sampling === "continuous" ? 60 : 20;

  const rows: Array<typeof measurements.$inferInsert> = [];
  const invalid: Array<{ time: string; pollutant: string; value: number; reason: string }> = [];
  for (const row of input.rows) {
    let time: Date;
    try {
      time = dushanbeLocalToUtc(input.date, row.time);
    } catch {
      return { ok: false, message: "validation", fieldErrors: { time: ["time"] } };
    }
    for (const p of station.pollutants) {
      const rawValue = row.values[String(p.id)];
      if (rawValue === undefined) continue;
      const num = parseDecimal(rawValue);
      if (num === null) continue;
      if (Number.isNaN(num))
        return {
          ok: false,
          message: "validation",
          fieldErrors: { [`${row.time}.${p.id}`]: ["value"] },
        };
      const pollutant = ctx.pollutants.get(p.code.toUpperCase());
      if (!pollutant) continue;
      let value: number;
      try {
        value = roundTo(
          convertConcentration(num, p.inputUnit, pollutant.unit, pollutant.molarMass),
          pollutant.decimals + 2,
        );
      } catch {
        return { ok: false, message: "unitConversion" };
      }
      const verdict = applyRangeRule(value, ctx.ranges.get(p.id));
      if (verdict.flag === QC_FLAG.invalid)
        invalid.push({
          time: row.time,
          pollutant: p.shortName,
          value,
          reason: verdict.reason ?? "range",
        });
      rows.push({
        time,
        stationId: station.id,
        pollutantId: p.id,
        averagingMin,
        value,
        qcFlag: verdict.flag,
        qcReason: verdict.reason,
        source: MEASUREMENT_SOURCE.manual,
        createdBy: session.user.id,
        updatedBy: session.user.id,
      });
    }
  }
  if (rows.length === 0) return { ok: false, message: "empty" };

  await getDb()
    .insert(measurements)
    .values(rows)
    .onConflictDoUpdate({
      target: [
        measurements.time,
        measurements.stationId,
        measurements.pollutantId,
        measurements.averagingMin,
      ],
      set: {
        value: sql`excluded.value`,
        qcFlag: sql`excluded.qc_flag`,
        qcReason: sql`excluded.qc_reason`,
        source: sql`excluded.source`,
        updatedBy: sql`excluded.updated_by`,
        updatedAt: sql`now()`,
      },
    });
  const times = rows.map((r) => (r.time as Date).getTime());
  await computeStationIndexes(getDb(), {
    stationIds: [station.id],
    since: new Date(Math.min(...times) - 24 * 3_600_000),
    until: new Date(Math.max(...times) + 3_600_000),
  }).catch((error) => console.error("[index] recompute after manual entry failed", error));
  await recordAudit(session, {
    action: "measurements.manual",
    entity: "measurements",
    entityId: station.id,
    after: { stationId: station.id, date: input.date, rows: rows.length, invalid: invalid.length },
  });
  return { ok: true, saved: rows.length, invalid };
}

export type ImportPreviewResult =
  | { ok: true; batchId: string; report: Omit<ImportReport, "rows"> & { sample: ImportRow[] } }
  | { ok: false; message: string };

/** Шаг 1 импорта: разбор и валидация файла, сохранение пакета в статусе pending. */
export async function previewImport(
  locale: Locale,
  formData: FormData,
): Promise<ImportPreviewResult> {
  const session = await requireAdminSession(locale, "measurements.write");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "noFile" };
  if (file.size > 20 * 1024 * 1024) return { ok: false, message: "tooLarge" };
  const defaultStation = String(formData.get("station") ?? "").trim() || undefined;
  const text = new TextDecoder("utf-8").decode(await file.arrayBuffer()).replace(/^﻿/, "");
  const ctx = await loadImportContext(defaultStation);
  const report = parseMeasurementsCsv(text, ctx);

  const db = getDb();
  const [batch] = await db
    .insert(importBatches)
    .values({
      stationId: defaultStation
        ? (ctx.stations.get(defaultStation.toUpperCase())?.id ?? null)
        : null,
      fileName: file.name.slice(0, 255),
      rowsTotal: report.total,
      rowsOk: report.ok,
      rowsRejected: report.rejected,
      report: { errors: report.errors },
      status: "pending",
      createdBy: session.user.id,
    })
    .returning({ id: importBatches.id });
  if (!batch) return { ok: false, message: "insert" };
  await mkdir(IMPORTS_DIR, { recursive: true });
  await writeFile(resolve(IMPORTS_DIR, `${batch.id}.json`), JSON.stringify(report.rows));
  const { rows, ...rest } = report;
  return { ok: true, batchId: batch.id, report: { ...rest, sample: rows.slice(0, 10) } };
}

export type ImportApplyResult = { ok: true; inserted: number } | { ok: false; message: string };

/** Шаг 2 импорта: применение пакета (вставка пачками, статус applied). */
export async function applyImport(locale: Locale, batchId: string): Promise<ImportApplyResult> {
  const session = await requireAdminSession(locale, "measurements.write");
  if (!/^[0-9a-f-]{36}$/.test(batchId)) return { ok: false, message: "notFound" };
  const db = getDb();
  const batch = await db.query.importBatches.findFirst({ where: eq(importBatches.id, batchId) });
  if (!batch) return { ok: false, message: "notFound" };
  if (batch.status !== "pending") return { ok: false, message: "alreadyApplied" };
  let rows: ImportRow[];
  try {
    rows = JSON.parse(
      await readFile(resolve(IMPORTS_DIR, `${batchId}.json`), "utf8"),
    ) as ImportRow[];
  } catch {
    return { ok: false, message: "expired" };
  }
  const CHUNK = 500;
  await db.transaction(async (tx) => {
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK).map((r) => ({
        time: new Date(r.time),
        stationId: r.stationId,
        pollutantId: r.pollutantId,
        averagingMin: r.averagingMin,
        value: r.value,
        qcFlag: r.qcFlag,
        qcReason: r.qcReason,
        source: MEASUREMENT_SOURCE.import,
        batchId,
        createdBy: session.user.id,
        updatedBy: session.user.id,
      }));
      if (chunk.length === 0) continue;
      await tx
        .insert(measurements)
        .values(chunk)
        .onConflictDoUpdate({
          target: [
            measurements.time,
            measurements.stationId,
            measurements.pollutantId,
            measurements.averagingMin,
          ],
          set: {
            value: sql`excluded.value`,
            qcFlag: sql`excluded.qc_flag`,
            qcReason: sql`excluded.qc_reason`,
            source: sql`excluded.source`,
            batchId: sql`excluded.batch_id`,
            updatedBy: sql`excluded.updated_by`,
            updatedAt: sql`now()`,
          },
        });
    }
    await tx.update(importBatches).set({ status: "applied" }).where(eq(importBatches.id, batchId));
  });
  if (rows.length > 0) {
    const times = rows.map((r) => new Date(r.time).getTime());
    await computeStationIndexes(db, {
      stationIds: [...new Set(rows.map((r) => r.stationId))],
      since: new Date(Math.min(...times) - 24 * 3_600_000),
      until: new Date(Math.max(...times) + 3_600_000),
    }).catch((error) => console.error("[index] recompute after import failed", error));
  }
  await recordAudit(session, {
    action: "measurements.import",
    entity: "import_batches",
    entityId: batchId,
    after: { rows: rows.length, fileName: batch.fileName },
  });
  return { ok: true, inserted: rows.length };
}

export async function rejectImport(locale: Locale, batchId: string): Promise<ImportApplyResult> {
  const session = await requireAdminSession(locale, "measurements.write");
  if (!/^[0-9a-f-]{36}$/.test(batchId)) return { ok: false, message: "notFound" };
  await getDb()
    .update(importBatches)
    .set({ status: "rejected" })
    .where(eq(importBatches.id, batchId));
  await recordAudit(session, {
    action: "measurements.importReject",
    entity: "import_batches",
    entityId: batchId,
  });
  return { ok: true, inserted: 0 };
}
