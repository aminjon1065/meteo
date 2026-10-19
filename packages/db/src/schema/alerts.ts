import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { timestamps } from "./_shared";
import { users } from "./auth";
import { regions } from "./geo";
import { pollutants } from "./pollutants";
import { indexScales } from "./scales";
import { stations } from "./stations";

export const alertScope = pgEnum("alert_scope", ["all", "station", "region"]);
export const alertKind = pgEnum("alert_kind", ["pollutant", "index"]);

/** Правила уведомлений о превышениях (ТЗ, модуль 1): концентрация вещества или уровень индекса. */
export const alertRules = pgTable(
  "alert_rules",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 120 }).notNull(),
    scope: alertScope("scope").default("all").notNull(),
    stationId: integer("station_id").references(() => stations.id, { onDelete: "cascade" }),
    regionId: integer("region_id").references(() => regions.id, { onDelete: "cascade" }),
    kind: alertKind("kind").default("pollutant").notNull(),
    pollutantId: integer("pollutant_id").references(() => pollutants.id, { onDelete: "cascade" }),
    scaleId: integer("scale_id").references(() => indexScales.id, { onDelete: "cascade" }),
    /** Порог: концентрация в единице вещества или уровень индекса (1–5). */
    threshold: real("threshold").notNull(),
    averagingMin: smallint("averaging_min").default(60).notNull(),
    cooldownMin: integer("cooldown_min").default(180).notNull(),
    channels: jsonb("channels").$type<Array<"portal" | "email">>().default(["portal"]).notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("alert_rules_enabled_idx").on(t.enabled)],
);

export const alertEventStatus = pgEnum("alert_event_status", ["active", "resolved"]);

/** Факты превышения: открываются при срабатывании правила, закрываются при возврате ниже порога. */
export const alertEvents = pgTable(
  "alert_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ruleId: integer("rule_id")
      .notNull()
      .references(() => alertRules.id, { onDelete: "cascade" }),
    stationId: integer("station_id")
      .notNull()
      .references(() => stations.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    peakValue: real("peak_value"),
    lastValue: real("last_value"),
    level: smallint("level"),
    status: alertEventStatus("status").default("active").notNull(),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("alert_events_status_idx").on(t.status),
    index("alert_events_station_started_idx").on(t.stationId, t.startedAt),
  ],
);

export const subscriberStatus = pgEnum("subscriber_status", [
  "pending",
  "confirmed",
  "unsubscribed",
]);

export interface SubscriberTopics {
  all?: boolean;
  stations?: number[];
  regions?: number[];
  newsletter?: boolean;
  /**
   * Изменения, запрошенные через форму для уже подтверждённого адреса; применяются при переходе
   * по ссылке подтверждения (новый confirm_token). Рассылки читают только поля выше.
   */
  pending?: {
    all?: boolean;
    stations?: number[];
    regions?: number[];
    newsletter?: boolean;
    locale?: string;
  };
}

/** Подписчики на уведомления и бюллетень (double opt‑in). */
export const subscribers = pgTable(
  "subscribers",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    locale: varchar("locale", { length: 5 }).default("tg").notNull(),
    status: subscriberStatus("status").default("pending").notNull(),
    confirmToken: text("confirm_token").notNull(),
    unsubscribeToken: text("unsubscribe_token").notNull(),
    topics: jsonb("topics").$type<SubscriberTopics>().default({ all: true }).notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("subscribers_email_uq").on(t.email),
    uniqueIndex("subscribers_confirm_token_uq").on(t.confirmToken),
    uniqueIndex("subscribers_unsubscribe_token_uq").on(t.unsubscribeToken),
    index("subscribers_status_idx").on(t.status),
  ],
);

export const emailStatus = pgEnum("email_status", ["pending", "sent", "failed"]);

/** Исходящая очередь писем: worker отправляет через SMTP с повторами; dedup_key защищает от дублей. */
export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    to: text("to").notNull(),
    locale: varchar("locale", { length: 5 }).default("tg").notNull(),
    template: varchar("template", { length: 64 }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: emailStatus("status").default("pending").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    lastError: text("last_error"),
    dedupKey: text("dedup_key"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("email_outbox_status_idx").on(t.status, t.createdAt),
    uniqueIndex("email_outbox_dedup_uq").on(t.dedupKey),
  ],
);
