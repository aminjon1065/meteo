"use server";

import { can, dushanbeLocalToUtc, slugify } from "@meteo/core";
import { eq } from "@meteo/db";
import { newsCategories, newsPosts } from "@meteo/db/schema";
import type { Locale } from "@meteo/i18n";
import { recordAudit } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db-errors";
import { requireAdminSession } from "@/lib/session";
import { fieldErrorsOf } from "@/lib/validation/common";
import {
  categoryInput,
  type NewsStatus,
  type NewsValues,
  newsInput,
  newsStatuses,
} from "@/lib/validation/news";

export type NewsResult =
  | { ok: true; id: number; slug: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

/** "YYYY-MM-DDTHH:MM" (местное время Душанбе) → Date. */
function localToUtc(value: string): Date {
  const [date = "", time = "00:00"] = value.split("T");
  return dushanbeLocalToUtc(date, time);
}

function deriveSlug(v: NewsValues): string {
  if (v.slug) return v.slug;
  const base = v.title.en?.trim() || v.title.ru?.trim() || v.title.tg?.trim() || "";
  return slugify(base, 100) || `post-${Date.now()}`;
}

function toRow(v: NewsValues, slug: string, userId: string, existingPublishedAt: Date | null) {
  let publishedAt = v.publishedAt ? localToUtc(v.publishedAt) : existingPublishedAt;
  if (v.status === "published" && !publishedAt) publishedAt = new Date();
  return {
    slug,
    title: v.title,
    excerpt: v.excerpt ?? null,
    body: v.body,
    categoryId: v.categoryId,
    coverId: v.coverId,
    status: v.status,
    publishedAt,
    pinned: v.pinned,
    updatedBy: userId,
  };
}

export async function createPost(locale: Locale, raw: unknown): Promise<NewsResult> {
  const session = await requireAdminSession(locale, "content.write");
  const parsed = newsInput.safeParse(raw);
  if (!parsed.success)
    return { ok: false, message: "validation", fieldErrors: fieldErrorsOf(parsed.error) };
  const values = parsed.data;
  if (values.status === "published" && !can(session.user.role, "content.publish"))
    return { ok: false, message: "forbidden" };
  const slug = deriveSlug(values);
  try {
    const [row] = await getDb()
      .insert(newsPosts)
      .values({ ...toRow(values, slug, session.user.id, null), authorId: session.user.id })
      .returning({ id: newsPosts.id });
    if (!row) return { ok: false, message: "insert" };
    await recordAudit(session, {
      action: "news.create",
      entity: "news_posts",
      entityId: row.id,
      after: { slug, title: values.title, status: values.status },
    });
    return { ok: true, id: row.id, slug };
  } catch (error) {
    if (isUniqueViolation(error))
      return { ok: false, message: "unique", fieldErrors: { slug: ["unique"] } };
    throw error;
  }
}

export async function updatePost(locale: Locale, id: number, raw: unknown): Promise<NewsResult> {
  const session = await requireAdminSession(locale, "content.write");
  const parsed = newsInput.safeParse(raw);
  if (!parsed.success)
    return { ok: false, message: "validation", fieldErrors: fieldErrorsOf(parsed.error) };
  const values = parsed.data;
  const db = getDb();
  const before = await db.query.newsPosts.findFirst({ where: eq(newsPosts.id, id) });
  if (!before) return { ok: false, message: "notFound" };
  if (
    values.status === "published" &&
    before.status !== "published" &&
    !can(session.user.role, "content.publish")
  )
    return { ok: false, message: "forbidden" };
  const slug = deriveSlug(values);
  try {
    await db
      .update(newsPosts)
      .set(toRow(values, slug, session.user.id, before.publishedAt))
      .where(eq(newsPosts.id, id));
    await recordAudit(session, {
      action: "news.update",
      entity: "news_posts",
      entityId: id,
      before: { slug: before.slug, title: before.title, status: before.status },
      after: { slug, title: values.title, status: values.status },
    });
    return { ok: true, id, slug };
  } catch (error) {
    if (isUniqueViolation(error))
      return { ok: false, message: "unique", fieldErrors: { slug: ["unique"] } };
    throw error;
  }
}

/** Публикация / снятие с публикации / архив одной кнопкой. */
export async function setPostStatus(
  locale: Locale,
  id: number,
  status: NewsStatus,
): Promise<NewsResult> {
  // Аргументы server action приходят от клиента: статус проверяем по списку, а не доверяем типу.
  if (!(newsStatuses as readonly string[]).includes(status))
    return { ok: false, message: "validation" };
  const session = await requireAdminSession(
    locale,
    status === "published" ? "content.publish" : "content.write",
  );
  const db = getDb();
  const before = await db.query.newsPosts.findFirst({ where: eq(newsPosts.id, id) });
  if (!before) return { ok: false, message: "notFound" };
  const publishedAt =
    status === "published" ? (before.publishedAt ?? new Date()) : before.publishedAt;
  await db
    .update(newsPosts)
    .set({ status, publishedAt, updatedBy: session.user.id })
    .where(eq(newsPosts.id, id));
  await recordAudit(session, {
    action: status === "published" ? "news.publish" : "news.unpublish",
    entity: "news_posts",
    entityId: id,
    before: { status: before.status },
    after: { status, publishedAt },
  });
  return { ok: true, id, slug: before.slug };
}

export async function deletePost(locale: Locale, id: number): Promise<NewsResult> {
  const session = await requireAdminSession(locale, "content.write");
  const db = getDb();
  const before = await db.query.newsPosts.findFirst({ where: eq(newsPosts.id, id) });
  if (!before) return { ok: false, message: "notFound" };
  await db.delete(newsPosts).where(eq(newsPosts.id, id));
  await recordAudit(session, {
    action: "news.delete",
    entity: "news_posts",
    entityId: id,
    before: { slug: before.slug, title: before.title, status: before.status },
  });
  return { ok: true, id, slug: before.slug };
}

export type CategoryResult = { ok: true; id: number } | { ok: false; message: string };

export async function saveCategory(locale: Locale, raw: unknown): Promise<CategoryResult> {
  const session = await requireAdminSession(locale, "content.write");
  const parsed = categoryInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "validation" };
  const { id, slug, name, sortOrder } = parsed.data;
  const db = getDb();
  try {
    if (id) {
      const before = await db.query.newsCategories.findFirst({ where: eq(newsCategories.id, id) });
      if (!before) return { ok: false, message: "notFound" };
      await db
        .update(newsCategories)
        .set({ slug, name, sortOrder })
        .where(eq(newsCategories.id, id));
      await recordAudit(session, {
        action: "newsCategory.update",
        entity: "news_categories",
        entityId: id,
        before: { slug: before.slug, name: before.name, sortOrder: before.sortOrder },
        after: { slug, name, sortOrder },
      });
      return { ok: true, id };
    }
    const [row] = await db
      .insert(newsCategories)
      .values({ slug, name, sortOrder })
      .returning({ id: newsCategories.id });
    if (!row) return { ok: false, message: "insert" };
    await recordAudit(session, {
      action: "newsCategory.create",
      entity: "news_categories",
      entityId: row.id,
      after: { slug, name, sortOrder },
    });
    return { ok: true, id: row.id };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, message: "unique" };
    throw error;
  }
}

export async function deleteCategory(locale: Locale, id: number): Promise<CategoryResult> {
  const session = await requireAdminSession(locale, "content.write");
  const db = getDb();
  const before = await db.query.newsCategories.findFirst({ where: eq(newsCategories.id, id) });
  if (!before) return { ok: false, message: "notFound" };
  await db.delete(newsCategories).where(eq(newsCategories.id, id));
  await recordAudit(session, {
    action: "newsCategory.delete",
    entity: "news_categories",
    entityId: id,
    before: { slug: before.slug, name: before.name },
  });
  return { ok: true, id };
}
