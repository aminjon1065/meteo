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

/** Части контура страны меньше этой площади (кв. градусы) — щели между областями, а не территория. */
const OUTLINE_MIN_AREA_DEG2 = 0.0001;
/** Контур страны не зависит от индекса и меняется только с перезагрузкой границ. */
export const OUTLINE_TTL_SEC = 86_400;

export interface CountryOutline {
  type: "Feature";
  properties: Record<string, never>;
  /** null — границы областей ещё не загружены. */
  geometry: MultiPolygon | null;
}

/**
 * Контур страны: объединение упрощённых областей (тот же допуск, что у /api/v1/regions, — край
 * совпадает с их контурами), только внешние кольца: щели между областями внутрь не попадают.
 * Анклавы (Ворух, Кайрагач) остаются отдельными полигонами.
 */
export async function loadCountryOutline(): Promise<CountryOutline> {
  const rows = await getDb().execute<{ geometry: MultiPolygon | null }>(sql`
    select ST_AsGeoJSON(
      ST_Multi(ST_Collect(ST_MakePolygon(ST_ExteriorRing(d.geom)))),
      ${sql.raw(String(GEOJSON_PRECISION))}
    )::json as geometry
    from (
      select (ST_Dump(ST_Union(
        ST_SimplifyPreserveTopology(${regions.geom}, ${sql.raw(String(SIMPLIFY_TOLERANCE_DEG))})
      ))).geom as geom
      from ${regions}
      where ${regions.geom} is not null
    ) d
    where ST_Area(d.geom) > ${sql.raw(String(OUTLINE_MIN_AREA_DEG2))}`);
  return { type: "Feature", properties: {}, geometry: rows[0]?.geometry ?? null };
}

/** JSON из кэша Redis с ETag/304 и открытым CORS. */
async function cachedGeoResponse(
  req: NextRequest,
  key: string,
  ttlSec: number,
  load: () => Promise<unknown>,
): Promise<NextResponse> {
  const { value, hit } = await cachedJson(key, ttlSec, load);
  const body = JSON.stringify(value);
  const etag = weakEtag(body);
  const headers: Record<string, string> = {
    "Cache-Control": `public, max-age=${ttlSec}, s-maxage=${ttlSec}, stale-while-revalidate=3600`,
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

/**
 * Ответ GeoJSON с кэшем 10 минут (Redis, как у остальных маршрутов), ETag и 304 на If-None-Match,
 * открытым CORS. Пока геометрии не загружены — пустая FeatureCollection, карта не ломается.
 */
export function boundariesResponse(req: NextRequest, level: BoundaryLevel): Promise<NextResponse> {
  return cachedGeoResponse(req, `boundaries:${level}:v1`, BOUNDARIES_TTL_SEC, () =>
    loadBoundaries(level),
  );
}

/** Контур страны (/api/v1/regions/outline): кэш сутки, ETag. */
export function outlineResponse(req: NextRequest): Promise<NextResponse> {
  return cachedGeoResponse(req, "boundaries:outline:v1", OUTLINE_TTL_SEC, loadCountryOutline);
}
