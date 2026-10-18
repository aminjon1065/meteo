import { markdownExcerpt } from "@meteo/core";
import { listPublishedNews } from "@meteo/db";
import { isLocale, type Locale, pick } from "@meteo/i18n";
import { type NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { uploadUrl } from "@/lib/uploads";

export const dynamic = "force-dynamic";

/** GET /api/v1/news?locale=tg&page=1&pageSize=12&category= — опубликованные новости (JSON, кэш 5 мин). */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const raw = sp.get("locale");
  const locale: Locale = isLocale(raw) ? raw : "tg";
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(sp.get("pageSize")) || 12));
  const category = sp.get("category")?.trim() || undefined;
  const base = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  const prefix = locale === "tg" ? "" : `/${locale}`;
  const list = await listPublishedNews(getDb(), { page, pageSize, categorySlug: category });
  return NextResponse.json(
    {
      locale,
      page,
      pageSize,
      total: list.total,
      items: list.rows.map((p) => ({
        id: p.id,
        slug: p.slug,
        title: pick(p.title, locale),
        excerpt: pick(p.excerpt, locale) || markdownExcerpt(pick(p.body, locale), 200),
        publishedAt: p.publishedAt?.toISOString() ?? null,
        updatedAt: p.updatedAt.toISOString(),
        pinned: p.pinned,
        category: p.category
          ? { slug: p.category.slug, name: pick(p.category.name, locale) }
          : null,
        cover: p.cover ? `${base}${uploadUrl(p.cover.path)}` : null,
        url: `${base}${prefix}/news/${p.slug}`,
      })),
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}
