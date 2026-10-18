import { and, eq, getCurrentIndexes, ne } from "@meteo/db";
import { regions, stations } from "@meteo/db/schema";
import { NextResponse } from "next/server";
import { cachedJson } from "@/lib/cache";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

const TTL_SEC = 60;

async function loadStations() {
  const db = getDb();
  const { byStation } = await getCurrentIndexes(db);
  const rows = await db
    .select({
      id: stations.id,
      slug: stations.slug,
      code: stations.code,
      name: stations.name,
      kind: stations.kind,
      status: stations.status,
      geom: stations.geom,
      region: regions.name,
    })
    .from(stations)
    .leftJoin(regions, eq(regions.id, stations.regionId))
    .where(and(eq(stations.isPublic, true), ne(stations.status, "decommissioned")));

  return {
    type: "FeatureCollection",
    features: rows.map((r) => ({
      type: "Feature",
      id: r.id,
      geometry: { type: "Point", coordinates: [r.geom.x, r.geom.y] },
      properties: {
        id: r.id,
        slug: r.slug,
        code: r.code,
        name: r.name,
        kind: r.kind,
        status: r.status,
        region: r.region,
        level:
          byStation.get(r.id) && !byStation.get(r.id)?.stale
            ? (byStation.get(r.id)?.level ?? 0)
            : 0,
        indexValue: byStation.get(r.id)?.value ?? null,
        indexTime: byStation.get(r.id)?.time.toISOString() ?? null,
      },
    })),
  };
}

/**
 * GET /api/v1/stations — публичные станции как GeoJSON FeatureCollection.
 * Свойства: id, slug, code, name (jsonb tg/ru/en), kind, status, region, level (индекс; 0 — нет данных).
 * Ответ кэшируется на минуту (Redis), как и s-maxage.
 */
export async function GET() {
  const { value, hit } = await cachedJson("stations:v1", TTL_SEC, loadStations);
  return NextResponse.json(value, {
    headers: {
      "Cache-Control": `public, s-maxage=${TTL_SEC}, stale-while-revalidate=300`,
      "Access-Control-Allow-Origin": "*",
      "X-Cache": hit ? "HIT" : "MISS",
    },
  });
}
