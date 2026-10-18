import { bigserial, index, jsonb, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { users } from "./auth";

/** Журнал аудита административных действий (append-only). */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
    /**
     * Идентификатор пользователя без внешнего ключа: журнал append‑only (триггер запрещает UPDATE),
     * поэтому удаление пользователя не должно обнулять его записи — история сохраняется вместе с e‑mail.
     */
    actorId: text("actor_id"),
    actorEmail: text("actor_email"),
    actorRole: varchar("actor_role", { length: 16 }),
    action: varchar("action", { length: 64 }).notNull(),
    entity: varchar("entity", { length: 64 }).notNull(),
    entityId: varchar("entity_id", { length: 64 }),
    before: jsonb("before"),
    after: jsonb("after"),
    ip: varchar("ip", { length: 64 }),
    userAgent: text("user_agent"),
    requestId: varchar("request_id", { length: 64 }),
  },
  (t) => [
    index("audit_log_entity_idx").on(t.entity, t.entityId),
    index("audit_log_at_idx").on(t.at),
    index("audit_log_actor_idx").on(t.actorId),
  ],
);

/** Настройки: SMTP, адреса интеграций, брендинг, heartbeat фоновых задач. */
export const settings = pgTable("settings", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});
