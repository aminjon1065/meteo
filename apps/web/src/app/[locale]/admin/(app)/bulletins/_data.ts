import { and, count, desc, eq, sql } from "@meteo/db";
import { newsPosts, subscribers } from "@meteo/db/schema";
import { getDb } from "@/lib/db";

/** Опубликованные новости для связи с бюллетенем и число подписчиков на бюллетень. */
export async function loadBulletinFormData() {
  const db = getDb();
  const [posts, subs] = await Promise.all([
    db
      .select({ id: newsPosts.id, title: newsPosts.title })
      .from(newsPosts)
      .where(eq(newsPosts.status, "published"))
      .orderBy(desc(newsPosts.publishedAt))
      .limit(100),
    db
      .select({ n: count() })
      .from(subscribers)
      .where(
        and(
          eq(subscribers.status, "confirmed"),
          sql`coalesce((${subscribers.topics}->>'newsletter')::boolean, false)`,
        ),
      ),
  ]);
  return { posts, subscribersCount: subs[0]?.n ?? 0 };
}
