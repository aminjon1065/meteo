/**
 * CMS: публичные выборки новостей, рубрики, постановка бюллетеня в очередь писем.
 */
import type { I18nText, Locale } from "@meteo/i18n";
import { and, asc, count, desc, eq, isNull, lte, or, sql } from "drizzle-orm";
import type { Database } from "../client";
import * as s from "../schema";

export interface NewsCategoryRow {
  id: number;
  slug: string;
  name: I18nText;
  sortOrder: number;
}

export interface NewsCoverRow {
  id: number;
  path: string;
  mime: string;
  width: number | null;
  height: number | null;
  alt: I18nText | null;
}

export interface NewsPostRow {
  id: number;
  slug: string;
  title: I18nText;
  excerpt: I18nText | null;
  body: I18nText;
  status: "draft" | "published" | "archived";
  publishedAt: Date | null;
  pinned: boolean;
  updatedAt: Date;
  category: NewsCategoryRow | null;
  cover: NewsCoverRow | null;
  authorName: string | null;
}

export interface NewsListOptions {
  now?: Date;
  page?: number;
  pageSize?: number;
  categorySlug?: string;
}

function publishedCondition(now: Date) {
  return and(
    eq(s.newsPosts.status, "published"),
    or(isNull(s.newsPosts.publishedAt), lte(s.newsPosts.publishedAt, now)),
  );
}

const postSelection = {
  id: s.newsPosts.id,
  slug: s.newsPosts.slug,
  title: s.newsPosts.title,
  excerpt: s.newsPosts.excerpt,
  body: s.newsPosts.body,
  status: s.newsPosts.status,
  publishedAt: s.newsPosts.publishedAt,
  pinned: s.newsPosts.pinned,
  updatedAt: s.newsPosts.updatedAt,
  categoryId: s.newsCategories.id,
  categorySlug: s.newsCategories.slug,
  categoryName: s.newsCategories.name,
  categorySort: s.newsCategories.sortOrder,
  coverId: s.media.id,
  coverPath: s.media.path,
  coverMime: s.media.mime,
  coverWidth: s.media.width,
  coverHeight: s.media.height,
  coverAlt: s.media.alt,
  authorName: s.users.name,
};

type PostSelection = {
  [K in keyof typeof postSelection]: (typeof postSelection)[K]["_"]["data"] | null;
} & {
  id: number;
  slug: string;
  title: I18nText;
  body: I18nText;
  status: NewsPostRow["status"];
  pinned: boolean;
  updatedAt: Date;
};

function toRow(r: PostSelection): NewsPostRow {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    excerpt: r.excerpt ?? null,
    body: r.body,
    status: r.status,
    publishedAt: r.publishedAt ?? null,
    pinned: r.pinned,
    updatedAt: r.updatedAt,
    category:
      r.categoryId !== null && r.categorySlug !== null && r.categoryName !== null
        ? {
            id: r.categoryId,
            slug: r.categorySlug,
            name: r.categoryName,
            sortOrder: r.categorySort ?? 0,
          }
        : null,
    cover:
      r.coverId !== null && r.coverPath !== null && r.coverMime !== null
        ? {
            id: r.coverId,
            path: r.coverPath,
            mime: r.coverMime,
            width: r.coverWidth ?? null,
            height: r.coverHeight ?? null,
            alt: r.coverAlt ?? null,
          }
        : null,
    authorName: r.authorName ?? null,
  };
}

function baseQuery(db: Database) {
  return db
    .select(postSelection)
    .from(s.newsPosts)
    .leftJoin(s.newsCategories, eq(s.newsCategories.id, s.newsPosts.categoryId))
    .leftJoin(s.media, eq(s.media.id, s.newsPosts.coverId))
    .leftJoin(s.users, eq(s.users.id, s.newsPosts.authorId));
}

/** Опубликованные новости: закреплённые первыми, затем по дате публикации. */
export async function listPublishedNews(
  db: Database,
  opts: NewsListOptions = {},
): Promise<{ rows: NewsPostRow[]; total: number }> {
  const now = opts.now ?? new Date();
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, opts.pageSize ?? 12));
  const where = opts.categorySlug
    ? and(publishedCondition(now), eq(s.newsCategories.slug, opts.categorySlug))
    : publishedCondition(now);
  const [rows, totalRow] = await Promise.all([
    baseQuery(db)
      .where(where)
      .orderBy(desc(s.newsPosts.pinned), desc(s.newsPosts.publishedAt), desc(s.newsPosts.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ n: count() })
      .from(s.newsPosts)
      .leftJoin(s.newsCategories, eq(s.newsCategories.id, s.newsPosts.categoryId))
      .where(where),
  ]);
  return { rows: rows.map((r) => toRow(r as PostSelection)), total: totalRow[0]?.n ?? 0 };
}

export async function getPublishedNews(
  db: Database,
  slug: string,
  now = new Date(),
): Promise<NewsPostRow | null> {
  const rows = await baseQuery(db)
    .where(and(publishedCondition(now), eq(s.newsPosts.slug, slug)))
    .limit(1);
  const row = rows[0];
  return row ? toRow(row as PostSelection) : null;
}

/** Новость по id (админка, превью черновика). */
export async function getNewsById(db: Database, id: number): Promise<NewsPostRow | null> {
  const rows = await baseQuery(db).where(eq(s.newsPosts.id, id)).limit(1);
  const row = rows[0];
  return row ? toRow(row as PostSelection) : null;
}

export async function listNewsCategories(db: Database): Promise<NewsCategoryRow[]> {
  return db
    .select({
      id: s.newsCategories.id,
      slug: s.newsCategories.slug,
      name: s.newsCategories.name,
      sortOrder: s.newsCategories.sortOrder,
    })
    .from(s.newsCategories)
    .orderBy(asc(s.newsCategories.sortOrder), asc(s.newsCategories.id));
}

/** Путь к локализованной странице портала: tg без префикса, остальные — /ru, /en. */
export function localizedPath(publicUrl: string, locale: string, path: string): string {
  const prefix = locale === "tg" ? "" : `/${locale}`;
  return `${publicUrl}${prefix}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Ставит бюллетень в очередь писем: по одному письму на подтверждённого подписчика
 * с темой «бюллетень» (dedup bulletin:{id}:{subscriberId}); статус → queued.
 * Задача mailer отправляет письма и переводит бюллетень в sent, когда очередь пуста.
 */
export async function queueBulletin(
  db: Database,
  bulletinId: number,
  opts: { publicUrl: string },
): Promise<{ recipients: number }> {
  const bulletin = await db.query.bulletins.findFirst({ where: eq(s.bulletins.id, bulletinId) });
  if (!bulletin) throw new Error(`Бюллетень ${bulletinId} не найден`);
  const post = bulletin.postId
    ? await db
        .select({ slug: s.newsPosts.slug })
        .from(s.newsPosts)
        .where(eq(s.newsPosts.id, bulletin.postId))
        .then((r) => r[0] ?? null)
    : null;
  const recipients = await db
    .select({
      id: s.subscribers.id,
      email: s.subscribers.email,
      locale: s.subscribers.locale,
      unsubscribeToken: s.subscribers.unsubscribeToken,
    })
    .from(s.subscribers)
    .where(
      and(
        eq(s.subscribers.status, "confirmed"),
        sql`coalesce((${s.subscribers.topics}->>'newsletter')::boolean, false)`,
      ),
    );
  const BATCH = 500;
  for (let i = 0; i < recipients.length; i += BATCH) {
    const batch = recipients.slice(i, i + BATCH);
    await db
      .insert(s.emailOutbox)
      .values(
        batch.map((sub) => {
          const locale = (["tg", "ru", "en"].includes(sub.locale) ? sub.locale : "tg") as Locale;
          return {
            to: sub.email,
            locale,
            template: "bulletin",
            payload: {
              bulletinId,
              subject: bulletin.subject,
              body: bulletin.body,
              baseUrl: opts.publicUrl,
              url: post ? localizedPath(opts.publicUrl, locale, `/news/${post.slug}`) : null,
              unsubscribeUrl: localizedPath(
                opts.publicUrl,
                locale,
                `/subscribe/unsubscribe?token=${sub.unsubscribeToken}`,
              ),
            },
            dedupKey: `bulletin:${bulletinId}:${sub.id}`,
          };
        }),
      )
      .onConflictDoNothing();
  }
  await db
    .update(s.bulletins)
    .set({
      status: recipients.length === 0 ? "sent" : "queued",
      queuedAt: new Date(),
      sentAt: recipients.length === 0 ? new Date() : null,
      recipients: recipients.length,
    })
    .where(eq(s.bulletins.id, bulletinId));
  return { recipients: recipients.length };
}

/** Переводит бюллетени в sent, когда все их письма отправлены (вызывает mailer). */
export async function finalizeSentBulletins(db: Database): Promise<number> {
  const rows = await db
    .update(s.bulletins)
    .set({ status: "sent", sentAt: new Date() })
    .where(
      and(
        eq(s.bulletins.status, "queued"),
        sql`not exists (
          select 1 from ${s.emailOutbox} o
          where o.dedup_key like 'bulletin:' || ${s.bulletins.id}::text || ':%'
            and o.status = 'pending'
        )`,
      ),
    )
    .returning({ id: s.bulletins.id });
  return rows.length;
}
