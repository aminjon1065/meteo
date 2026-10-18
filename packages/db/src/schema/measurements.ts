import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  serial,
  smallint,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { pollutants } from "./pollutants";
import { indexScales } from "./scales";
import { stations } from "./stations";

/**
 * Флаги контроля качества:
 * 0 raw, 1 valid, 2 suspect, 3 invalid, 4 corrected, 5 missing.
 * Публичные выборки и агрегаты учитывают только 1 и 4.
 */
export const QC_FLAG = {
  raw: 0,
  valid: 1,
  suspect: 2,
  invalid: 3,
  corrected: 4,
  missing: 5,
} as const;

/** Источник записи: 1 manual, 2 import, 3 api, 4 sensor. */
export const MEASUREMENT_SOURCE = { manual: 1, import: 2, api: 3, sensor: 4 } as const;

/**
 * Измерения — гипертаблица TimescaleDB (создаётся в sql/0001_timescale.sql).
 * Ключ включает время и период осреднения: разовая проба (20 мин), час (60), сутки (1440).
 */
export const measurements = pgTable(
  "measurements",
  {
    time: timestamp("time", { withTimezone: true }).notNull(),
    stationId: integer("station_id")
      .notNull()
      .references(() => stations.id, { onDelete: "cascade" }),
    pollutantId: integer("pollutant_id")
      .notNull()
      .references(() => pollutants.id, { onDelete: "restrict" }),
    averagingMin: smallint("averaging_min").default(60).notNull(),
    value: doublePrecision("value"),
    originalValue: doublePrecision("original_value"),
    qcFlag: smallint("qc_flag").default(QC_FLAG.raw).notNull(),
    qcReason: text("qc_reason"),
    /** Решение оператора окончательное: автоматический QC больше не меняет флаг. */
    qcLocked: boolean("qc_locked").default(false).notNull(),
    source: smallint("source").default(MEASUREMENT_SOURCE.manual).notNull(),
    batchId: uuid("batch_id"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.time, t.stationId, t.pollutantId, t.averagingMin] }),
    index("measurements_station_time_idx").on(t.stationId, t.time),
    index("measurements_qc_flag_idx").on(t.qcFlag),
  ],
);

/** Предрассчитанный индекс станции по каждой шкале (час). */
export const stationIndex = pgTable(
  "station_index",
  {
    time: timestamp("time", { withTimezone: true }).notNull(),
    stationId: integer("station_id")
      .notNull()
      .references(() => stations.id, { onDelete: "cascade" }),
    scaleId: integer("scale_id")
      .notNull()
      .references(() => indexScales.id, { onDelete: "cascade" }),
    value: real("value"),
    level: smallint("level").notNull(),
    dominantPollutantId: integer("dominant_pollutant_id").references(() => pollutants.id),
    subIndices:
      jsonb("sub_indices").$type<Record<string, { value: number | null; level: number }>>(),
    computedAt: timestamp("computed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.time, t.stationId, t.scaleId] }),
    index("station_index_station_time_idx").on(t.stationId, t.time),
  ],
);

export const importBatchStatus = pgEnum("import_batch_status", ["pending", "applied", "rejected"]);

/** Пакеты импорта CSV/XLSX с отчётом по строкам. */
export const importBatches = pgTable(
  "import_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stationId: integer("station_id").references(() => stations.id, { onDelete: "set null" }),
    fileName: varchar("file_name", { length: 255 }).notNull(),
    rowsTotal: integer("rows_total").default(0).notNull(),
    rowsOk: integer("rows_ok").default(0).notNull(),
    rowsRejected: integer("rows_rejected").default(0).notNull(),
    report: jsonb("report").$type<{ errors: Array<{ row: number; message: string }> }>(),
    status: importBatchStatus("status").default("pending").notNull(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("import_batches_station_id_idx").on(t.stationId)],
);

export const qcRuleKind = pgEnum("qc_rule_kind", ["range", "spike", "stuck", "mad_outlier"]);

/** Правила автоматического контроля качества. */
export const qcRules = pgTable("qc_rules", {
  id: serial("id").primaryKey(),
  pollutantId: integer("pollutant_id").references(() => pollutants.id, { onDelete: "cascade" }),
  kind: qcRuleKind("kind").notNull(),
  params: jsonb("params").$type<Record<string, number | string | boolean>>().notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});
