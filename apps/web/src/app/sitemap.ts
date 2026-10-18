import { and, eq, lte, ne } from "@meteo/db";
import { forecastLocations, newsPosts, stations } from "@meteo/db/schema";
import { type Locale, locales, localeTags } from "@meteo/i18n";
import type { MetadataRoute } from "next";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

const STATIC_PATHS = [
  "/",
  "/air",
  "/air/index",
  "/map",
  "/weather",
  "/warnings",
  "/health",
  "/news",
  "/about",
  "/data",
  "/data/api",
  "/subscribe",
];

function href(base: string, locale: Locale, path: string): string {
  const prefix = locale === "tg" ? "" : `/${locale}`;
  return `${base}${prefix}${path === "/" && prefix ? "" : path}`;
}

function entry(
  base: string,
  path: string,
  opts: {
    lastModified?: Date;
    changeFrequency?: MetadataRoute.Sitemap[number]["changeFrequency"];
    priority?: number;
  } = {},
): MetadataRoute.Sitemap {
  const languages = Object.fromEntries(locales.map((l) => [localeTags[l], href(base, l, path)]));
  return locales.map((l) => ({
    url: href(base, l, path),
    lastModified: opts.lastModified,
    changeFrequency: opts.changeFrequency,
    priority: opts.priority,
    alternates: { languages },
  }));
}

/** sitemap.xml: статические разделы на трёх языках (hreflang), станции, города прогноза, новости. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const out: MetadataRoute.Sitemap = [];
  for (const path of STATIC_PATHS) {
    out.push(
      ...entry(base, path, {
        changeFrequency: path === "/" || path === "/warnings" ? "hourly" : "daily",
        priority: path === "/" ? 1 : 0.7,
      }),
    );
  }
  try {
    const db = getDb();
    const [stationRows, locationRows, news] = await Promise.all([
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
    ]);
    for (const s of stationRows)
      out.push(
        ...entry(base, `/air/stations/${s.slug}`, {
          lastModified: s.updatedAt,
          changeFrequency: "hourly",
          priority: 0.8,
        }),
      );
    for (const l of locationRows)
      out.push(
        ...entry(base, `/weather/${l.slug}`, {
          lastModified: l.updatedAt,
          changeFrequency: "hourly",
          priority: 0.8,
        }),
      );
    for (const n of news)
      out.push(
        ...entry(base, `/news/${n.slug}`, {
          lastModified: n.updatedAt,
          changeFrequency: "monthly",
          priority: 0.5,
        }),
      );
  } catch {
    // БД недоступна — отдаём только статические разделы.
  }
  return out;
}
