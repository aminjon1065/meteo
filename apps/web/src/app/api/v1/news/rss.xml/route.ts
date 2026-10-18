import { markdownExcerpt } from "@meteo/core";
import { listPublishedNews } from "@meteo/db";
import { isLocale, type Locale, localeTags, pick } from "@meteo/i18n";
import en from "@meteo/i18n/messages/en.json";
import ru from "@meteo/i18n/messages/ru.json";
import tg from "@meteo/i18n/messages/tg.json";
import { type NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { uploadUrl } from "@/lib/uploads";

export const dynamic = "force-dynamic";

const messages = { tg, ru, en } as const;

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

/** GET /api/v1/news/rss.xml?locale=ru — RSS 2.0 с 20 последними новостями на выбранном языке. */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("locale");
  const locale: Locale = isLocale(raw) ? raw : "tg";
  const base = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  const prefix = locale === "tg" ? "" : `/${locale}`;
  const m = messages[locale];
  const list = await listPublishedNews(getDb(), { page: 1, pageSize: 20 });
  const items = list.rows
    .map((p) => {
      const link = `${base}${prefix}/news/${p.slug}`;
      const description = pick(p.excerpt, locale) || markdownExcerpt(pick(p.body, locale), 300);
      return `<item>
  <title>${esc(pick(p.title, locale))}</title>
  <link>${esc(link)}</link>
  <guid isPermaLink="true">${esc(link)}</guid>
  ${p.publishedAt ? `<pubDate>${p.publishedAt.toUTCString()}</pubDate>` : ""}
  ${p.category ? `<category>${esc(pick(p.category.name, locale))}</category>` : ""}
  <description>${esc(description)}</description>
  ${p.cover ? `<enclosure url="${esc(`${base}${uploadUrl(p.cover.path)}`)}" type="${esc(p.cover.mime)}" length="0"/>` : ""}
</item>`;
    })
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${esc(`${m.common.siteName} · ${m.news.title}`)}</title>
  <link>${esc(`${base}${prefix}/news`)}</link>
  <atom:link href="${esc(`${base}/api/v1/news/rss.xml?locale=${locale}`)}" rel="self" type="application/rss+xml"/>
  <description>${esc(m.news.intro)}</description>
  <language>${esc(localeTags[locale])}</language>
  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
</channel>
</rss>
`;
  return new NextResponse(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
