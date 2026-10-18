import "server-only";
import { and, asc, eq, getCurrentIndexes, ne, sql } from "@meteo/db";
import { districts, regions, stations } from "@meteo/db/schema";
import type { MultiPolygon } from "geojson";
import { type NextRequest, NextResponse } from "next/server";
import { cachedJson } from "@/lib/cache";
import { getDb } from "@/lib/db";
import {
  aggregateStations,
  BOUNDARIES_TTL_SEC,
  type BoundaryCollection,
  type BoundaryLevel,
  buildBoundaryCollection,
  etagMatches,
  GEOJSON_PRECISION,
  SIMPLIFY_TOLERANCE_DEG,
  type StationAreaRow,
  weakEtag,
} from "./geojson";

/** Упрощённая геометрия как GeoJSON: ST_SimplifyPreserveTopology не ломает общие границы; ST_Multi — тип
 * MultiPolygon и для единиц из одного полигона (упрощение возвращает POLYGON). */
const simplifiedGeoJson = (column: unknown) =>
  sql<MultiPolygon>`ST_AsGeoJSON(ST_Multi(ST_SimplifyPreserveTopology(${column}, ${sql.raw(String(SIMPLIFY_TOLERANCE_DEG))})), ${sql.raw(String(GEOJSON_PRECISION))})::json`;

/** Публичные станции с текущим уровнем индекса (как в /api/v1/stations: устаревший → 0). */
async function loadStationLevels(): Promise<StationAreaRow[]> {
  const db = getDb();
  const [{ byStation }, rows] = await Promise.all([
    getCurrentIndexes(db),
    db
      .select({ id: stations.id, regionId: stations.regionId, districtId: stations.districtId })
      .from(stations)
      .where(and(eq(stations.isPublic, true), ne(stations.status, "decommissioned"))),
  ]);
  return rows.map((r) => {
    const idx = byStation.get(r.id);
    return {
      regionId: r.regionId,
      districtId: r.districtId,
      level: idx && !idx.stale ? idx.level : 0,
    };
  });
}

/** Области, Душанбе и РРП (/api/v1/regions) или районы (/api/v1/districts) с агрегатами по станциям. */
export async function loadBoundaries(level: BoundaryLevel): Promise<BoundaryCollection> {
  const db = getDb();
  const stationRows = await loadStationLevels();
  if (level === "region") {
    const rows = await db
      .select({
        id: regions.id,
        code: regions.code,
        name: regions.name,
        sortOrder: regions.sortOrder,
        geometry: simplifiedGeoJson(regions.geom),
        lon: sql<number | null>`ST_X(${regions.centroid})`,
        lat: sql<number | null>`ST_Y(${regions.centroid})`,
      })
      .from(regions)
      .where(sql`${regions.geom} is not null`)
      .orderBy(asc(regions.sortOrder), asc(regions.id));
    return buildBoundaryCollection(
      "region",
      rows.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        sortOrder: r.sortOrder,
        geometry: r.geometry,
        centroid: r.lon !== null && r.lat !== null ? [r.lon, r.lat] : null,
      })),
      aggregateStations(stationRows, "regionId"),
    );
  }
  const rows = await db
    .select({
      id: districts.id,
      code: districts.code,
      name: districts.name,
      regionId: districts.regionId,
      regionCode: regions.code,
      geometry: simplifiedGeoJson(districts.geom),
    })
    .from(districts)
    .innerJoin(regions, eq(regions.id, districts.regionId))
    .where(sql`${districts.geom} is not null`)
    .orderBy(asc(regions.sortOrder), asc(districts.code));
  return buildBoundaryCollection(
    "district",
    rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      regionId: r.regionId,
      regionCode: r.regionCode,
      geometry: r.geometry,
    })),
    aggregateStations(stationRows, "districtId"),
  );
}

/**
 * Ответ GeoJSON с кэшем 10 минут (Redis, как у остальных маршрутов), ETag и 304 на If-None-Match,
 * открытым CORS. Пока геометрии не загружены — пустая FeatureCollection, карта не ломается.
 */
export async function boundariesResponse(
  req: NextRequest,
  level: BoundaryLevel,
): Promise<NextResponse> {
  const { value, hit } = await cachedJson(`boundaries:${level}:v1`, BOUNDARIES_TTL_SEC, () =>
    loadBoundaries(level),
  );
  const body = JSON.stringify(value);
  const etag = weakEtag(body);
  const headers: Record<string, string> = {
    "Cache-Control": `public, max-age=${BOUNDARIES_TTL_SEC}, s-maxage=${BOUNDARIES_TTL_SEC}, stale-while-revalidate=3600`,
    "Access-Control-Allow-Origin": "*",
    ETag: etag,
    "X-Cache": hit ? "HIT" : "MISS",
  };
  if (etagMatches(req.headers.get("if-none-match"), etag)) {
    return new NextResponse(null, { status: 304, headers });
  }
  return new NextResponse(body, {
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
  });
}
