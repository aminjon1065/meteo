import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  serial,
  smallint,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { i18nText, timestamps } from "./_shared";
import { users } from "./auth";

/** Рубрики новостей. */
export const newsCategories = pgTable("news_categories", {
  id: serial("id").primaryKey(),
  slug: varchar("slug", { length: 64 }).notNull().unique(),
  name: i18nText("name").notNull(),
  sortOrder: smallint("sort_order").default(0).notNull(),
  ...timestamps,
});

/** Загруженные файлы (обложки новостей, изображения в тексте): хранятся в UPLOADS_DIR. */
export const media = pgTable(
  "media",
  {
    id: serial("id").primaryKey(),
    /** Относительный путь внутри UPLOADS_DIR, например 2026/10/3f2a….jpg */
    path: varchar("path", { length: 255 }).notNull().unique(),
    originalName: varchar("original_name", { length: 255 }),
    mime: varchar("mime", { length: 64 }).notNull(),
    size: integer("size").notNull(),
    width: integer("width"),
    height: integer("height"),
    alt: i18nText("alt"),
    uploadedBy: text("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("media_created_at_idx").on(t.createdAt)],
);

export const newsStatus = pgEnum("news_status", ["draft", "published", "archived"]);

/** Новости: трёхъязычные заголовок, анонс и текст (Markdown) в jsonb. */
export const newsPosts = pgTable(
  "news_posts",
  {
    id: serial("id").primaryKey(),
    slug: varchar("slug", { length: 128 }).notNull().unique(),
    categoryId: integer("category_id").references(() => newsCategories.id, {
      onDelete: "set null",
    }),
    title: i18nText("title").notNull(),
    excerpt: i18nText("excerpt"),
    body: i18nText("body").notNull(),
    coverId: integer("cover_id").references(() => media.id, { onDelete: "set null" }),
    status: newsStatus("status").default("draft").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    pinned: boolean("pinned").default(false).notNull(),
    authorId: text("author_id").references(() => users.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("news_posts_status_published_idx").on(t.status, t.publishedAt),
    index("news_posts_category_id_idx").on(t.categoryId),
  ],
);

export const bulletinStatus = pgEnum("bulletin_status", ["draft", "queued", "sent"]);

/**
 * Информационные бюллетени: рассылка подтверждённым подписчикам с темой «бюллетень»
 * через email_outbox (задача mailer). Текст — Markdown на трёх языках.
 */
export const bulletins = pgTable(
  "bulletins",
  {
    id: serial("id").primaryKey(),
    subject: i18nText("subject").notNull(),
    body: i18nText("body").notNull(),
    /** Необязательная связь с новостью (ссылка «читать на портале»). */
    postId: integer("post_id").references(() => newsPosts.id, { onDelete: "set null" }),
    status: bulletinStatus("status").default("draft").notNull(),
    queuedAt: timestamp("queued_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    recipients: integer("recipients").default(0).notNull(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("bulletins_status_idx").on(t.status, t.createdAt)],
);
