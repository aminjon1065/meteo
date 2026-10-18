import {
  boolean,
  geometry,
  index,
  integer,
  pgEnum,
  pgTable,
  serial,
  smallint,
  varchar,
} from "drizzle-orm/pg-core";
import { i18nText, multiPolygon, timestamps } from "./_shared";

/** Области (вилоятҳо) и город Душанбе / РРП. */
export const regions = pgTable("regions", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 16 }).notNull().unique(),
  name: i18nText("name").notNull(),
  geom: multiPolygon("geom"),
  centroid: geometry("centroid", { type: "point", mode: "xy", srid: 4326 }),
  sortOrder: smallint("sort_order").default(0).notNull(),
  ...timestamps,
});

/** Районы (ноҳияҳо). */
export const districts = pgTable(
  "districts",
  {
    id: serial("id").primaryKey(),
    regionId: integer("region_id")
      .notNull()
      .references(() => regions.id, { onDelete: "restrict" }),
    code: varchar("code", { length: 16 }).notNull().unique(),
    name: i18nText("name").notNull(),
    geom: multiPolygon("geom"),
    ...timestamps,
  },
  (t) => [index("districts_region_id_idx").on(t.regionId)],
);

/** Регионы предупреждений SmartMet Alert (CAP geocode → геометрия). */
export const warningRegions = pgTable("warning_regions", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 32 }).notNull().unique(),
  name: i18nText("name").notNull(),
  geom: multiPolygon("geom"),
  ...timestamps,
});

export const forecastLocationKind = pgEnum("forecast_location_kind", [
  "city",
  "district",
  "station",
]);

/** Точки, для которых забираем прогноз SmartMet и SILAM. */
export const forecastLocations = pgTable(
  "forecast_locations",
  {
    id: serial("id").primaryKey(),
    slug: varchar("slug", { length: 64 }).notNull().unique(),
    name: i18nText("name").notNull(),
    geom: geometry("geom", { type: "point", mode: "xy", srid: 4326 }).notNull(),
    regionId: integer("region_id").references(() => regions.id, { onDelete: "set null" }),
    kind: forecastLocationKind("kind").default("city").notNull(),
    smartmetPlace: varchar("smartmet_place", { length: 128 }),
    sortOrder: smallint("sort_order").default(0).notNull(),
    featured: boolean("featured").default(false).notNull(),
    active: boolean("active").default(true).notNull(),
    ...timestamps,
  },
  (t) => [index("forecast_locations_region_id_idx").on(t.regionId)],
);
