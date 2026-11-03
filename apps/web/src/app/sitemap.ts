import { and, eq, lte, ne } from "@meteo/db";
import { ecoBulletins, forecastLocations, newsPosts, stations } from "@meteo/db/schema";
import { locales } from "@meteo/i18n";
import type { MetadataRoute } from "next";
import { getDb } from "@/lib/db";
import { absoluteUrl, languageAlternates } from "@/lib/seo";

export const dynamic = "force-dynamic";

const STATIC_PATHS = [
  "/",
  "/air",
  "/air/index",
  "/air/silam",
  "/air/bulletins",
  "/weather",
  "/warnings",
  "/health",
  "/news",
  "/about",
  "/data",
  "/data/api",
  "/subscribe",
];

function entry(
  path: string,
  opts: {
    lastModified?: Date;
    changeFrequency?: MetadataRoute.Sitemap[number]["changeFrequency"];
    priority?: number;
  } = {},
): MetadataRoute.Sitemap {
  // hreflang те же, что в заголовке Link и <link rel="alternate"> (lib/seo.ts), плюс x-default.
  const languages = languageAlternates(path);
  return locales.map((l) => ({
    url: absoluteUrl(l, path),
    lastModified: opts.lastModified,
    changeFrequency: opts.changeFrequency,
    priority: opts.priority,
    alternates: { languages },
  }));
}

/**
 * sitemap.xml: статические разделы на трёх языках (hreflang + x-default), станции, города прогноза,
 * новости, экобюллетени. Адрес сайта — из окружения (siteUrl), поэтому файл не пререндерится.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const out: MetadataRoute.Sitemap = [];
  for (const path of STATIC_PATHS) {
    out.push(
      ...entry(path, {
        changeFrequency: path === "/" || path === "/warnings" ? "hourly" : "daily",
        priority: path === "/" ? 1 : 0.7,
      }),
    );
  }
  try {
    const db = getDb();
    const [stationRows, locationRows, news, bulletins] = await Promise.all([
      db
        .select({ slug: stations.slug, updatedAt: stations.updatedAt })
        .from(stations)
        .where(and(eq(stations.isPublic, true), ne(stations.status, "decommissioned"))),
      db
        .select({ slug: forecastLocations.slug, updatedAt: forecastLocations.updatedAt })
        .from(forecastLocations)
        .where(eq(forecastLocations.active, true)),
      db
        .select({ slug: newsPosts.slug, updatedAt: newsPosts.updatedAt })
        .from(newsPosts)
        .where(and(eq(newsPosts.status, "published"), lte(newsPosts.publishedAt, new Date()))),
      db
        .select({ id: ecoBulletins.id, publishedAt: ecoBulletins.publishedAt })
        .from(ecoBulletins)
        .innerJoin(stations, eq(stations.id, ecoBulletins.stationId))
        .where(and(eq(ecoBulletins.status, "published"), eq(stations.isPublic, true))),
    ]);
    for (const s of stationRows)
      out.push(
        ...entry(`/air/stations/${s.slug}`, {
          lastModified: s.updatedAt,
          changeFrequency: "hourly",
          priority: 0.8,
        }),
      );
    for (const l of locationRows)
      out.push(
        ...entry(`/weather/${l.slug}`, {
          lastModified: l.updatedAt,
          changeFrequency: "hourly",
          priority: 0.8,
        }),
      );
    for (const n of news)
      out.push(
        ...entry(`/news/${n.slug}`, {
          lastModified: n.updatedAt,
          changeFrequency: "monthly",
          priority: 0.5,
        }),
      );
    for (const b of bulletins)
      out.push(
        ...entry(`/air/bulletins/${b.id}`, {
          lastModified: b.publishedAt ?? undefined,
          changeFrequency: "yearly",
          priority: 0.4,
        }),
      );
  } catch {
    // БД недоступна — отдаём только статические разделы.
  }
  return out;
}
