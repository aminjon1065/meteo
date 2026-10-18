import { getForecastLocation, getLocationForecast } from "@meteo/db";
import { type NextRequest, NextResponse } from "next/server";
import { cachedJson } from "@/lib/cache";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

const TTL_SEC = 300;

async function loadForecast(slug: string, hours: number, days: number) {
  const db = getDb();
  const location = await getForecastLocation(db, slug);
  if (!location) return null;
  const forecast = await getLocationForecast(db, location.id, { hours, days });
  return {
    location: {
      slug: location.slug,
      name: location.name,
      lat: location.geom.y,
      lon: location.geom.x,
      region: location.regionName,
    },
    producer: forecast.producer,
    originTime: forecast.originTime?.toISOString() ?? null,
    fetchedAt: forecast.fetchedAt?.toISOString() ?? null,
    timeZone: "Asia/Dushanbe",
    hourly: forecast.hourly.map((p) => ({ time: p.time.toISOString(), ...p.params })),
    daily: forecast.daily.map((p) => ({ date: p.time.toISOString(), ...p.params })),
  };
}

/**
 * GET /api/v1/forecast/{slug}?hours=72&days=10 — прогноз SmartMet для точки:
 * часовой ряд (t °C, ws м/с, wd °, gust, rh %, p гПа, dew, precip мм/ч, cloud %, symbol) и суточные агрегаты.
 * CORS открыт, кэш 5 минут (Redis + s-maxage) — для meteo.tj и виджетов.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  if (!/^[a-z0-9-]{1,64}$/.test(slug)) {
    return NextResponse.json({ error: "location not found" }, { status: 404 });
  }
  const hours = Math.min(
    240,
    Math.max(1, Number(req.nextUrl.searchParams.get("hours") ?? 72) || 72),
  );
  const days = Math.min(16, Math.max(1, Number(req.nextUrl.searchParams.get("days") ?? 10) || 10));
  const { value, hit } = await cachedJson(`forecast:${slug}:${hours}:${days}`, TTL_SEC, () =>
    loadForecast(slug, hours, days),
  );
  if (!value) return NextResponse.json({ error: "location not found" }, { status: 404 });
  return NextResponse.json(value, {
    headers: {
      "Cache-Control": `public, s-maxage=${TTL_SEC}, stale-while-revalidate=900`,
      "Access-Control-Allow-Origin": "*",
      "X-Cache": hit ? "HIT" : "MISS",
    },
  });
}
