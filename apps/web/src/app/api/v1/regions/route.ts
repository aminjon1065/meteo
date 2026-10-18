import { asc, sql } from "@meteo/db";
import { regions } from "@meteo/db/schema";
import type { MultiPolygon } from "geojson";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/regions — области, город Душанбе и РРП как GeoJSON FeatureCollection с упрощёнными
 * полигонами (загружаются infra/data/load-boundaries.ts). Свойства: id, code, name (jsonb tg/ru/en),
 * sortOrder, centroid [lon, lat]. Границы меняются редко — кэш 1 час.
 */
export async function GET() {
  const rows = await getDb()
    .select({
      id: regions.id,
      code: regions.code,
      name: regions.name,
      sortOrder: regions.sortOrder,
      geometry: sql<MultiPolygon>`ST_AsGeoJSON(${regions.geom}, 5)::json`,
      lon: sql<number | null>`ST_X(${regions.centroid})`,
      lat: sql<number | null>`ST_Y(${regions.centroid})`,
    })
    .from(regions)
    .where(sql`${regions.geom} is not null`)
    .orderBy(asc(regions.sortOrder), asc(regions.id));

  const body = {
    type: "FeatureCollection",
    features: rows.map((r) => ({
      type: "Feature",
      id: r.id,
      geometry: r.geometry,
      properties: {
        id: r.id,
        code: r.code,
        name: r.name,
        sortOrder: r.sortOrder,
        centroid: r.lon !== null && r.lat !== null ? [r.lon, r.lat] : null,
      },
    })),
  };
  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
