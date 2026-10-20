import type { EcoBulletinData } from "@meteo/core";
import {
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { timestamps } from "./_shared";
import { users } from "./auth";
import { bulletins, newsPosts } from "./content";
import { stations } from "./stations";

export const ecoBulletinStatus = pgEnum("eco_bulletin_status", ["draft", "published"]);

/** Сохранённый файл опубликованного бюллетеня (внутри UPLOADS_DIR/eco-bulletins/{id}/). */
export interface EcoBulletinFile {
  /** Имя файла, например city-ru.docx, summary-tg.pdf. */
  name: string;
  mime: string;
  size: number;
}

/**
 * Ежедневный экологический бюллетень (формат Агентства): один на дату и станцию города.
 * `data` — снимок расчёта (таблица станции, сводка по городам, суммация, превышения), из которого
 * рендерятся три документа (бюллетень города, сводка ЗАВ/ИҲА, форма 4а) на tg и ru.
 * Черновик готовит задача worker'а `eco-bulletin-draft` (08:00 Душанбе) или оператор вручную;
 * публикация сохраняет файлы, создаёт новость и (по желанию) рассылку через `bulletins`.
 */
export const ecoBulletins = pgTable(
  "eco_bulletins",
  {
    id: serial("id").primaryKey(),
    /** Местные сутки (Asia/Dushanbe), за которые составлен бюллетень. */
    date: date("date").notNull(),
    stationId: integer("station_id")
      .notNull()
      .references(() => stations.id, { onDelete: "cascade" }),
    status: ecoBulletinStatus("status").default("draft").notNull(),
    data: jsonb("data").$type<EcoBulletinData>().notNull(),
    /** Радиационный γ‑фон — ручной ввод оператора (строка как в документе, например «0,014»). */
    gamma: varchar("gamma", { length: 32 }),
    /** manual — оператор; scheduler — задача по расписанию. */
    generatedBy: varchar("generated_by", { length: 16 }).default("manual").notNull(),
    files: jsonb("files").$type<EcoBulletinFile[]>().default([]).notNull(),
    postId: integer("post_id").references(() => newsPosts.id, { onDelete: "set null" }),
    mailBulletinId: integer("mail_bulletin_id").references(() => bulletins.id, {
      onDelete: "set null",
    }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedBy: text("published_by").references(() => users.id, { onDelete: "set null" }),
    /** Когда операторам отправлено письмо о готовом черновике. */
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("eco_bulletins_date_station_uq").on(t.date, t.stationId),
    index("eco_bulletins_status_date_idx").on(t.status, t.date),
  ],
);
