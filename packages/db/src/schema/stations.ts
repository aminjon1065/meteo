import {
  boolean,
  date,
  geometry,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { i18nText, timestamps } from "./_shared";
import { districts, regions } from "./geo";
import { pollutants } from "./pollutants";

export const stationKind = pgEnum("station_kind", ["air", "meteo", "combined"]);
export const stationStatus = pgEnum("station_status", ["active", "suspended", "decommissioned"]);
export const stationDataSource = pgEnum("station_data_source", [
  "manual",
  "import",
  "api",
  "sensor",
]);
export const stationSampling = pgEnum("station_sampling", ["continuous", "discrete"]);

/** Канал последнего автоматического приёма: api — POST /api/v1/ingest (логгер, агент), pull — задача station-pull. */
export type StationIngestSource = "api" | "pull";

/** Сводка последнего автоматического приёма данных (карточка станции, дашборд). */
export interface StationIngestSummary {
  at: string;
  source: StationIngestSource;
  received: number;
  accepted: number;
  rejected: number;
  invalidRange: number;
  from: string | null;
  to: string | null;
  pollutants: string[];
  /** station_sources.id для pull‑источника. */
  sourceId?: number;
  /** Имя файла экспорта (pull) или User‑Agent отправителя (api). */
  file?: string;
  agent?: string;
}

/** Реестр станций мониторинга (ТЗ, модуль 7). */
export const stations = pgTable(
  "stations",
  {
    id: serial("id").primaryKey(),
    code: varchar("code", { length: 32 }).notNull().unique(),
    slug: varchar("slug", { length: 64 }).notNull().unique(),
    name: i18nText("name").notNull(),
    kind: stationKind("kind").default("air").notNull(),
    geom: geometry("geom", { type: "point", mode: "xy", srid: 4326 }).notNull(),
    elevationM: real("elevation_m"),
    regionId: integer("region_id").references(() => regions.id, { onDelete: "set null" }),
    districtId: integer("district_id").references(() => districts.id, { onDelete: "set null" }),
    status: stationStatus("status").default("active").notNull(),
    commissionedAt: date("commissioned_at"),
    decommissionedAt: date("decommissioned_at"),
    dataSource: stationDataSource("data_source").default("manual").notNull(),
    sampling: stationSampling("sampling").default("discrete").notNull(),
    description: i18nText("description"),
    address: i18nText("address"),
    photo: text("photo"),
    /** Хэш API‑ключа для автоматической отправки измерений (POST /api/v1/ingest). */
    apiKeyHash: text("api_key_hash"),
    isPublic: boolean("is_public").default(true).notNull(),
    /** Последний успешный автоматический приём данных (ingest API или station-pull). */
    lastIngestAt: timestamp("last_ingest_at", { withTimezone: true }),
    lastIngestSource: varchar("last_ingest_source", { length: 16 }).$type<StationIngestSource>(),
    lastIngestSummary: jsonb("last_ingest_summary").$type<StationIngestSummary>(),
    /** Когда администраторам отправлено письмо о длительном отсутствии данных (null — не отправлялось). */
    staleAlertedAt: timestamp("stale_alerted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("stations_status_idx").on(t.status),
    index("stations_region_id_idx").on(t.regionId),
    index("stations_geom_idx").using("gist", t.geom),
  ],
);

/** Какие вещества измеряет станция и в каких единицах приходят данные. */
export const stationPollutants = pgTable(
  "station_pollutants",
  {
    stationId: integer("station_id")
      .notNull()
      .references(() => stations.id, { onDelete: "cascade" }),
    pollutantId: integer("pollutant_id")
      .notNull()
      .references(() => pollutants.id, { onDelete: "cascade" }),
    /** Единица входных данных (µg/m³, mg/m³, ppb, ppm); хранение всегда в единице загрязнителя. */
    inputUnit: varchar("input_unit", { length: 16 }).notNull().default("µg/m³"),
    active: boolean("active").default(true).notNull(),
  },
  (t) => [primaryKey({ columns: [t.stationId, t.pollutantId] })],
);
