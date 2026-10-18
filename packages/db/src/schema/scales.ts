import type { I18nText } from "@meteo/i18n";
import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  serial,
  smallint,
  smallserial,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { i18nText, timestamps } from "./_shared";
import { pollutants } from "./pollutants";

export const indexScaleKind = pgEnum("index_scale_kind", ["breakpoints", "ratio_to_limit", "iza"]);

export interface IndexLevelDef {
  level: number;
  color: string;
  label: I18nText;
  /** Для шкал без порогов по веществам (ИЗА): интервал итогового значения. */
  lo?: number;
  hi?: number | null;
}

/** Шкалы индекса качества воздуха (ADR‑009): табличные, редактируемые в админке. */
export const indexScales = pgTable("index_scales", {
  id: smallserial("id").primaryKey(),
  code: varchar("code", { length: 32 }).notNull().unique(),
  name: i18nText("name").notNull(),
  description: i18nText("description"),
  kind: indexScaleKind("kind").notNull(),
  levels: jsonb("levels").$type<IndexLevelDef[]>().notNull(),
  isDefaultPublic: boolean("is_default_public").default(false).notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  sortOrder: smallint("sort_order").default(0).notNull(),
  ...timestamps,
});

/** Пороги уровня по веществу: [lo, hi) в единицах загрязнителя; hi = null — открытый интервал. */
export const indexBreakpoints = pgTable(
  "index_breakpoints",
  {
    id: serial("id").primaryKey(),
    scaleId: integer("scale_id")
      .notNull()
      .references(() => indexScales.id, { onDelete: "cascade" }),
    pollutantId: integer("pollutant_id")
      .notNull()
      .references(() => pollutants.id, { onDelete: "cascade" }),
    level: smallint("level").notNull(),
    lo: real("lo").notNull(),
    hi: real("hi"),
    averagingMin: smallint("averaging_min").default(60).notNull(),
  },
  (t) => [uniqueIndex("index_breakpoints_uq").on(t.scaleId, t.pollutantId, t.level)],
);

export const healthAudience = pgEnum("health_audience", [
  "general",
  "children",
  "pregnant",
  "elderly",
  "respiratory",
  "cardio",
]);

/** Медицинские рекомендации: уровень × группа населения × язык (markdown в jsonb). */
export const healthAdvice = pgTable(
  "health_advice",
  {
    id: serial("id").primaryKey(),
    scaleId: integer("scale_id")
      .notNull()
      .references(() => indexScales.id, { onDelete: "cascade" }),
    level: smallint("level").notNull(),
    audience: healthAudience("audience").notNull(),
    title: i18nText("title"),
    text: i18nText("text").notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("health_advice_uq").on(t.scaleId, t.level, t.audience)],
);
