/**
 * Импорт исторических данных измерений из CSV/XLSX по маппингу колонок (docs/import-history.md).
 *
 *   pnpm --filter @meteo/db import-history -- --file data.xlsx --mapping mapping.json [--dry-run]
 *     [--station DU-01] [--sheet "Лист1"] [--limit 1000] [--report report.json] [--no-index]
 *
 * Шаги: чтение файла (CSV: кодировка/разделитель из маппинга; XLSX: лист) → справочники из БД
 * (станции с единицами ввода, вещества, диапазоны QC) → mapHistoryRows (@meteo/core) → отчёт →
 * вставка пачками с обновлением существующих значений (ключ время/станция/вещество/осреднение),
 * запись пакета в import_batches → пересчёт индекса по затронутым станциям и месяцам.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  type ConcentrationUnit,
  type HistoryImportContext,
  type HistoryImportMapping,
  type ImportTable,
  mapHistoryRows,
  parseCsv,
  validateMapping,
} from "@meteo/core";
import { readXlsxSheet } from "@meteo/core/xlsx";
import { and, eq, sql } from "drizzle-orm";
import { createDb } from "../client";
import { loadRootEnv, requireEnv } from "../env";
import * as s from "../schema";
import { computeStationIndexes } from "../services/station-index";

// pnpm передаёт разделитель «--» скрипту как есть — отбрасываем его.
const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((a, i) => !(i === 0 && a === "--")),
  allowPositionals: true,
  options: {
    file: { type: "string", short: "f" },
    mapping: { type: "string", short: "m" },
    station: { type: "string" },
    sheet: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    limit: { type: "string" },
    report: { type: "string" },
    "no-index": { type: "boolean", default: false },
    "batch-size": { type: "string", default: "1000" },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: true,
});

if (args.help || !args.file || !args.mapping) {
  console.info(`Импорт исторических измерений.
  --file, -f      CSV или XLSX с данными
  --mapping, -m   JSON с описанием колонок (docs/import-history.md)
  --station       код станции, если в файле нет столбца станции (переопределяет mapping.station)
  --sheet         имя или номер листа XLSX (переопределяет mapping.sheet)
  --dry-run       только разобрать и показать отчёт, ничего не записывать
  --limit N       обработать не больше N строк данных (для проверки маппинга)
  --report path   записать отчёт (ошибки построчно) в JSON
  --no-index      не пересчитывать индекс после вставки
  --batch-size N  размер пачки вставки (1000)`);
  process.exit(args.help ? 0 : 1);
}

const started = Date.now();
const filePath = resolve(args.file);
const mappingRaw = JSON.parse(readFileSync(resolve(args.mapping), "utf8")) as HistoryImportMapping;
const mapping: HistoryImportMapping = {
  ...mappingRaw,
  ...(args.station ? { station: { value: args.station } } : {}),
  ...(args.sheet ? { sheet: /^\d+$/.test(args.sheet) ? Number(args.sheet) : args.sheet } : {}),
};
const mappingErrors = validateMapping(mapping);
if (mappingErrors.length) {
  console.error(`Некорректный маппинг:\n  ${mappingErrors.join("\n  ")}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------------------------
// 1. Таблица из файла
// ---------------------------------------------------------------------------------------------
function readTable(): ImportTable {
  const ext = extname(filePath).toLowerCase();
  const headerRow = Math.max(1, mapping.headerRow ?? 1);
  if (ext === ".xlsx" || ext === ".xlsm") {
    const sheet = readXlsxSheet(new Uint8Array(readFileSync(filePath)), { sheet: mapping.sheet });
    const header = (sheet.rows[headerRow - 1] ?? []).map((c) =>
      (c === null ? "" : String(c)).trim(),
    );
    return { header, rows: sheet.rows.slice(headerRow) };
  }
  const bytes = readFileSync(filePath);
  const text = new TextDecoder(mapping.encoding ?? "utf-8").decode(bytes);
  const table = parseCsv(text, { delimiter: mapping.delimiter, skipRows: headerRow - 1 });
  return { header: table.header, rows: table.rows };
}

const table = readTable();
if (args.limit) table.rows = table.rows.slice(0, Number(args.limit));
console.info(
  `[import] ${basename(filePath)}: ${table.rows.length} строк, колонки: ${table.header.map((h) => `«${h}»`).join(", ")}`,
);

// ---------------------------------------------------------------------------------------------
// 2. Справочники из БД
// ---------------------------------------------------------------------------------------------
loadRootEnv();
const db = createDb(requireEnv("DATABASE_URL"), { max: 2 });

async function loadContext(): Promise<HistoryImportContext> {
  const [stationRows, linkRows, pollutantRows, ruleRows] = await Promise.all([
    db
      .select({ id: s.stations.id, code: s.stations.code, sampling: s.stations.sampling })
      .from(s.stations),
    db.select().from(s.stationPollutants).where(eq(s.stationPollutants.active, true)),
    db.select().from(s.pollutants),
    db
      .select()
      .from(s.qcRules)
      .where(and(eq(s.qcRules.kind, "range"), eq(s.qcRules.enabled, true))),
  ]);
  const ctx: HistoryImportContext = {
    stations: new Map(),
    pollutants: new Map(),
    ranges: new Map(),
  };
  for (const st of stationRows) {
    ctx.stations.set(st.code.toUpperCase(), {
      id: st.id,
      sampling: st.sampling,
      inputUnits: new Map(
        linkRows
          .filter((l) => l.stationId === st.id)
          .map((l) => [l.pollutantId, l.inputUnit as ConcentrationUnit]),
      ),
    });
  }
  for (const p of pollutantRows) {
    const entry = {
      id: p.id,
      code: p.code,
      unit: p.unit as ConcentrationUnit,
      decimals: p.decimals,
      molarMass: p.molarMass,
    };
    ctx.pollutants.set(p.code.toUpperCase(), entry);
    ctx.pollutants.set(
      p.shortName.toUpperCase().replace(/[.\s]/g, "").replace("₂", "2").replace("₃", "3"),
      entry,
    );
  }
  for (const r of ruleRows) {
    if (r.pollutantId && typeof r.params.min === "number" && typeof r.params.max === "number") {
      ctx.ranges.set(r.pollutantId, { min: r.params.min, max: r.params.max });
    }
  }
  return ctx;
}

// ---------------------------------------------------------------------------------------------
// 3. Маппинг и отчёт
// ---------------------------------------------------------------------------------------------
const ctx = await loadContext();
const result = mapHistoryRows(table, mapping, ctx);
const summary = {
  file: basename(filePath),
  rows: result.total,
  accepted: result.ok,
  rejected: result.rejected,
  duplicates: result.duplicates,
  invalidRange: result.invalidRange,
  stations: result.stationIds.length,
  from: result.from?.toISOString() ?? null,
  to: result.to?.toISOString() ?? null,
};
console.info("[import] отчёт:", summary);
if (result.errors.length) {
  const byKind = new Map<string, number>();
  for (const e of result.errors) {
    const kind = e.message.split(":")[0] ?? e.message;
    byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
  }
  console.info("[import] ошибки по типам:", Object.fromEntries(byKind));
  for (const e of result.errors.slice(0, 20)) console.info(`  строка ${e.row}: ${e.message}`);
  if (result.errors.length > 20) console.info(`  … и ещё ${result.errors.length - 20}`);
}
if (args.report) {
  writeFileSync(resolve(args.report), JSON.stringify({ summary, errors: result.errors }, null, 2));
  console.info(`[import] отчёт записан: ${args.report}`);
}

if (args["dry-run"] || result.rows.length === 0) {
  console.info(
    args["dry-run"] ? "[import] dry-run: запись пропущена" : "[import] нет строк для записи",
  );
  await db.$client.end();
  process.exit(result.rows.length === 0 && !args["dry-run"] ? 1 : 0);
}

// ---------------------------------------------------------------------------------------------
// 4. Запись пачками + пакет импорта
// ---------------------------------------------------------------------------------------------
const batchSize = Math.max(100, Number(args["batch-size"]) || 1000);
const [batch] = await db
  .insert(s.importBatches)
  .values({
    stationId: result.stationIds.length === 1 ? (result.stationIds[0] ?? null) : null,
    fileName: basename(filePath).slice(0, 255),
    rowsTotal: result.total,
    rowsOk: result.ok,
    rowsRejected: result.rejected,
    report: { errors: result.errors.slice(0, 200) },
    status: "pending",
  })
  .returning({ id: s.importBatches.id });
if (!batch) throw new Error("[import] не удалось создать пакет импорта");

let inserted = 0;
await db.transaction(async (tx) => {
  for (let i = 0; i < result.rows.length; i += batchSize) {
    const chunk = result.rows.slice(i, i + batchSize).map((r) => ({
      time: r.time,
      stationId: r.stationId,
      pollutantId: r.pollutantId,
      averagingMin: r.averagingMin,
      value: r.value,
      qcFlag: r.qcFlag,
      qcReason: r.qcReason,
      source: s.MEASUREMENT_SOURCE.import,
      batchId: batch.id,
    }));
    await tx
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
          batchId: sql`excluded.batch_id`,
          qcLocked: sql`false`,
          updatedAt: sql`now()`,
        },
      });
    inserted += chunk.length;
    if (result.rows.length > batchSize) {
      console.info(`[import] записано ${inserted}/${result.rows.length}`);
    }
  }
  await tx
    .update(s.importBatches)
    .set({ status: "applied" })
    .where(eq(s.importBatches.id, batch.id));
});
await db.insert(s.auditLog).values({
  actorEmail: "import-history",
  actorRole: "system",
  action: "measurements.importHistory",
  entity: "import_batches",
  entityId: batch.id,
  after: { ...summary, inserted },
});
console.info(`[import] записано ${inserted} значений, пакет ${batch.id}`);

// ---------------------------------------------------------------------------------------------
// 5. Пересчёт индекса по месяцам затронутого периода
// ---------------------------------------------------------------------------------------------
if (!args["no-index"] && result.from && result.to) {
  const MONTH = 31 * 24 * 3_600_000;
  let since = new Date(result.from.getTime() - 24 * 3_600_000);
  const end = new Date(result.to.getTime() + 3_600_000);
  let windows = 0;
  while (since < end) {
    const until = new Date(Math.min(since.getTime() + MONTH, end.getTime()));
    await computeStationIndexes(db, { stationIds: result.stationIds, since, until });
    windows += 1;
    since = until;
  }
  console.info(`[import] индекс пересчитан: окон ${windows}, станций ${result.stationIds.length}`);
}

await db.$client.end();
console.info(`[import] готово за ${Math.round((Date.now() - started) / 100) / 10} с`);
