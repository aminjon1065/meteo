import {
  integer,
  pgEnum,
  pgTable,
  real,
  smallint,
  smallserial,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { i18nText, timestamps } from "./_shared";

/** Загрязнители (ТЗ: PM2.5, PM10, NO2, SO2, CO, O3; список расширяем). */
export const pollutants = pgTable("pollutants", {
  id: smallserial("id").primaryKey(),
  code: varchar("code", { length: 16 }).notNull().unique(),
  name: i18nText("name").notNull(),
  shortName: varchar("short_name", { length: 16 }).notNull(),
  /** Единица хранения значений (µg/m³; для CO — mg/m³). */
  unit: varchar("unit", { length: 16 }).notNull(),
  decimals: smallint("decimals").default(1).notNull(),
  sortOrder: smallint("sort_order").default(0).notNull(),
  /** Молярная масса (г/моль) для конверсии ppb ↔ µg/m³; null для частиц. */
  molarMass: real("molar_mass"),
  /** Класс опасности (1–4) для расчёта ИЗА по РД 52.04.186‑89. */
  hazardClass: smallint("hazard_class"),
  ...timestamps,
});

export const limitKind = pgEnum("limit_kind", ["daily", "max_single", "annual"]);

/** ПДК (среднесуточная, максимальная разовая, среднегодовая) в единицах загрязнителя. */
export const limitValues = pgTable(
  "limit_values",
  {
    id: smallserial("id").primaryKey(),
    pollutantId: integer("pollutant_id")
      .notNull()
      .references(() => pollutants.id, { onDelete: "cascade" }),
    kind: limitKind("kind").notNull(),
    value: real("value").notNull(),
    source: text("source"),
    ...timestamps,
  },
  (t) => [uniqueIndex("limit_values_pollutant_kind_uq").on(t.pollutantId, t.kind)],
);
