import {
  type AnyPgColumn,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { i18nText, multiPolygon, timestamps } from "./_shared";
import { warningRegions } from "./geo";

/** Перечисления CAP 1.2 (OASIS). Значения хранятся как в XML. */
export const capStatus = pgEnum("cap_status", ["Actual", "Exercise", "System", "Test", "Draft"]);
export const capMsgType = pgEnum("cap_msg_type", ["Alert", "Update", "Cancel", "Ack", "Error"]);
export const capScope = pgEnum("cap_scope", ["Public", "Restricted", "Private"]);
export const capUrgency = pgEnum("cap_urgency", [
  "Immediate",
  "Expected",
  "Future",
  "Past",
  "Unknown",
]);
export const capSeverity = pgEnum("cap_severity", [
  "Extreme",
  "Severe",
  "Moderate",
  "Minor",
  "Unknown",
]);
export const capCertainty = pgEnum("cap_certainty", [
  "Observed",
  "Likely",
  "Possible",
  "Unlikely",
  "Unknown",
]);

export interface CapNamedValue {
  valueName: string;
  value: string;
}

/**
 * Сообщения CAP (SmartMet Alert, модуль M3). Одно сообщение = один <alert>;
 * уникальность по identifier + sent (повторная загрузка идемпотентна).
 * Update/Cancel ссылаются на предыдущие сообщения через references → superseded_by.
 */
export const capAlerts = pgTable(
  "cap_alerts",
  {
    id: serial("id").primaryKey(),
    identifier: varchar("identifier", { length: 255 }).notNull(),
    sender: varchar("sender", { length: 255 }).notNull(),
    sent: timestamp("sent", { withTimezone: true }).notNull(),
    status: capStatus("status").notNull(),
    msgType: capMsgType("msg_type").notNull(),
    scope: capScope("scope").notNull(),
    source: varchar("source", { length: 255 }),
    note: text("note"),
    /** Исходная строка <references>: "sender,identifier,sent sender,identifier,sent". */
    references: text("refs"),
    /** Сообщение, которое заменило (Update) или отменило (Cancel) это. */
    supersededBy: integer("superseded_by").references((): AnyPgColumn => capAlerts.id, {
      onDelete: "set null",
    }),
    /** Откуда загружено: URL файла в фиде/каталоге или путь в режиме file://. */
    sourceUrl: text("source_url"),
    rawXml: text("raw_xml").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("cap_alerts_identifier_sent_uq").on(t.identifier, t.sent),
    index("cap_alerts_identifier_idx").on(t.identifier),
    index("cap_alerts_status_type_idx").on(t.status, t.msgType),
    index("cap_alerts_superseded_by_idx").on(t.supersededBy),
    index("cap_alerts_sent_idx").on(t.sent),
  ],
);

/** Блоки <info> сообщения: по одному на язык. */
export const capInfos = pgTable(
  "cap_infos",
  {
    id: serial("id").primaryKey(),
    alertId: integer("alert_id")
      .notNull()
      .references(() => capAlerts.id, { onDelete: "cascade" }),
    /** Язык как в XML (RFC 3066), по умолчанию en-US. */
    language: varchar("language", { length: 16 }).default("en-US").notNull(),
    /** Нормализованная локаль портала (tg / ru / en) или null для прочих языков. */
    locale: varchar("locale", { length: 5 }),
    categories: jsonb("categories").$type<string[]>().default([]).notNull(),
    event: varchar("event", { length: 255 }).notNull(),
    responseTypes: jsonb("response_types").$type<string[]>().default([]).notNull(),
    urgency: capUrgency("urgency").notNull(),
    severity: capSeverity("severity").notNull(),
    certainty: capCertainty("certainty").notNull(),
    audience: text("audience"),
    eventCodes: jsonb("event_codes").$type<CapNamedValue[]>().default([]).notNull(),
    effective: timestamp("effective", { withTimezone: true }),
    onset: timestamp("onset", { withTimezone: true }),
    expires: timestamp("expires", { withTimezone: true }),
    senderName: text("sender_name"),
    headline: text("headline"),
    description: text("description"),
    instruction: text("instruction"),
    web: text("web"),
    contact: text("contact"),
    parameters: jsonb("parameters").$type<CapNamedValue[]>().default([]).notNull(),
  },
  (t) => [
    index("cap_infos_alert_id_idx").on(t.alertId),
    index("cap_infos_expires_idx").on(t.expires),
    index("cap_infos_event_idx").on(t.event),
  ],
);

/** Области <area>: polygon/circle → геометрия PostGIS, geocode → регион предупреждений. */
export const capAreas = pgTable(
  "cap_areas",
  {
    id: serial("id").primaryKey(),
    infoId: integer("info_id")
      .notNull()
      .references(() => capInfos.id, { onDelete: "cascade" }),
    areaDesc: text("area_desc").notNull(),
    geom: multiPolygon("geom"),
    warningRegionId: integer("warning_region_id").references(() => warningRegions.id, {
      onDelete: "set null",
    }),
    geocodes: jsonb("geocodes").$type<CapNamedValue[]>().default([]).notNull(),
    altitude: real("altitude"),
    ceiling: real("ceiling"),
  },
  (t) => [
    index("cap_areas_info_id_idx").on(t.infoId),
    index("cap_areas_warning_region_id_idx").on(t.warningRegionId),
    index("cap_areas_geom_idx").using("gist", t.geom),
  ],
);

/**
 * Словарь переводов типов событий (<event>) на tg/ru/en: редактор SmartMet Alert может
 * выдавать info только на одном языке — тогда название события берётся отсюда.
 * Строки для новых событий создаёт cap-sync с пустыми переводами.
 */
export const capEventTranslations = pgTable("cap_event_translations", {
  id: serial("id").primaryKey(),
  event: varchar("event", { length: 255 }).notNull().unique(),
  name: i18nText("name").default({}).notNull(),
  ...timestamps,
});
