import { listForecastLocations } from "@meteo/db";
import { NextResponse } from "next/server";
import { cachedJson } from "@/lib/cache";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

const TTL_SEC = 600;

async function loadLocations() {
  const rows = await listForecastLocations(getDb());
  return {
    locations: rows.map((r) => ({
      slug: r.slug,
      name: r.name,
      lat: r.geom.y,
      lon: r.geom.x,
      kind: r.kind,
      region: r.regionName,
      regionCode: r.regionCode,
      featured: r.featured,
    })),
  };
}

/**
 * GET /api/v1/forecast — точки прогноза SmartMet (города, районы и точки у станций): slug для
 * /api/v1/forecast/{slug} и виджета /embed/forecast?location=…, названия tg/ru/en, координаты.
 * CORS открыт, кэш 10 минут (Redis + s-maxage); список меняется редко.
 */
export async function GET() {
  const { value, hit } = await cachedJson("forecast-locations:v1", TTL_SEC, loadLocations);
  return NextResponse.json(value, {
    headers: {
      "Cache-Control": `public, s-maxage=${TTL_SEC}, stale-while-revalidate=1800`,
      "Access-Control-Allow-Origin": "*",
      "X-Cache": hit ? "HIT" : "MISS",
    },
  });
}
