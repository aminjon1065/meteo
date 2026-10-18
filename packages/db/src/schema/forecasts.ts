import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  serial,
  smallint,
  timestamp,
  unique,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { forecastLocations } from "./geo";
import { pollutants } from "./pollutants";
import { stations } from "./stations";

export const forecastProvider = pgEnum("forecast_provider", ["smartmet", "silam"]);

/** Запуски синхронизации прогнозов (SmartMet) — для статуса в админке и ссылки на источник. */
export const forecastRuns = pgTable(
  "forecast_runs",
  {
    id: serial("id").primaryKey(),
    provider: forecastProvider("provider").notNull(),
    producer: varchar("producer", { length: 64 }),
    originTime: timestamp("origin_time", { withTimezone: true }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
    status: varchar("status", { length: 16 }).default("ok").notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
  },
  (t) => [index("forecast_runs_provider_fetched_idx").on(t.provider, t.fetchedAt)],
);

export interface ForecastParams {
  /** Температура, °C */
  t?: number | null;
  /** Скорость ветра, м/с; направление, °; порыв, м/с */
  ws?: number | null;
  wd?: number | null;
  gust?: number | null;
  /** Относительная влажность, %; давление, гПа; точка росы, °C */
  rh?: number | null;
  p?: number | null;
  dew?: number | null;
  /** Осадки за час, мм; облачность, % */
  precip?: number | null;
  cloud?: number | null;
  /** Код символа погоды (FMI SmartSymbol; 1xx — ночь) */
  symbol?: number | null;
  /** Суточные агрегаты (только в суточных точках) */
  tmax?: number | null;
  tmin?: number | null;
  precipSum?: number | null;
}

/** Точки прогноза SmartMet: последний прогон на каждую точку/время (upsert по ключу). */
export const forecastPoints = pgTable(
  "forecast_points",
  {
    locationId: integer("location_id")
      .notNull()
      .references(() => forecastLocations.id, { onDelete: "cascade" }),
    time: timestamp("time", { withTimezone: true }).notNull(),
    /** 60 — часовой шаг, 1440 — суточные агрегаты */
    stepMin: smallint("step_min").default(60).notNull(),
    runId: integer("run_id").references(() => forecastRuns.id, { onDelete: "set null" }),
    params: jsonb("params").$type<ForecastParams>().notNull(),
  },
  (t) => [
    uniqueIndex("forecast_points_uq").on(t.locationId, t.time, t.stepMin),
    index("forecast_points_time_idx").on(t.time),
  ],
);

export interface SilamGrid {
  nx: number;
  ny: number;
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Прогоны SILAM, загруженные с THREDDS (один прогон в сутки). */
export const silamRuns = pgTable("silam_runs", {
  id: serial("id").primaryKey(),
  originTime: timestamp("origin_time", { withTimezone: true }).notNull().unique(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
  status: varchar("status", { length: 16 }).default("ok").notNull(),
  hours: integer("hours").default(0).notNull(),
  grid: jsonb("grid").$type<SilamGrid>(),
  meta: jsonb("meta").$type<Record<string, unknown>>(),
});

/** Растровые слои SILAM: PNG на вещество и час. */
export const silamFields = pgTable(
  "silam_fields",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id")
      .notNull()
      .references(() => silamRuns.id, { onDelete: "cascade" }),
    pollutantId: integer("pollutant_id")
      .notNull()
      .references(() => pollutants.id, { onDelete: "cascade" }),
    time: timestamp("time", { withTimezone: true }).notNull(),
    /** Относительный путь внутри SILAM_DIR, например 2026101600/PM25/012.png */
    file: varchar("file", { length: 255 }).notNull(),
    stats: jsonb("stats").$type<{ min: number; max: number; mean: number }>(),
  },
  (t) => [
    unique("silam_fields_uq").on(t.runId, t.pollutantId, t.time),
    index("silam_fields_time_idx").on(t.time),
  ],
);

/** Точечный прогноз SILAM для городов и станций (билинейная интерполяция сетки). */
export const silamPointForecast = pgTable(
  "silam_point_forecast",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id")
      .notNull()
      .references(() => silamRuns.id, { onDelete: "cascade" }),
    locationId: integer("location_id").references(() => forecastLocations.id, {
      onDelete: "cascade",
    }),
    stationId: integer("station_id").references(() => stations.id, { onDelete: "cascade" }),
    pollutantId: integer("pollutant_id")
      .notNull()
      .references(() => pollutants.id, { onDelete: "cascade" }),
    time: timestamp("time", { withTimezone: true }).notNull(),
    value: real("value").notNull(),
    level: smallint("level").default(0).notNull(),
  },
  (t) => [
    unique("silam_point_uq")
      .on(t.runId, t.pollutantId, t.time, t.locationId, t.stationId)
      .nullsNotDistinct(),
    index("silam_point_time_idx").on(t.time),
  ],
);
