/**
 * Города для станций (planStationCities из @meteo/core): каждая активная публичная станция должна
 * быть в радиусе CITY_RADIUS_KM от какого‑нибудь города списка, иначе для неё заводится точка
 * прогноза (kind = station) в месте станции с названием района. Город сразу появляется в выборе в
 * шапке и в сводке «воздух в городе», worker подтягивает для него прогноз SmartMet и SILAM.
 * Вызывается при сохранении станции в админке, импортом станций и задачей worker'а station-cities.
 */
import { CITY_RADIUS_KM, type CityName, planStationCities } from "@meteo/core";
import { sql } from "drizzle-orm";
import type { Database } from "../client";
import * as s from "../schema";

export interface StationCitiesResult {
  /** Активные публичные станции, которые проверялись. */
  stations: number;
  created: Array<{ slug: string; name: CityName; stationId: number }>;
}

export async function ensureStationCities(
  db: Database,
  opts: { radiusKm?: number } = {},
): Promise<StationCitiesResult> {
  // Район — из карточки станции, иначе по границам районов (как при импорте станций сети WWCS).
  // Точки станций хранятся без SRID (0), границы — в 4326: без ST_SetSRID PostGIS не сравнит их.
  const stations = await db.execute<{
    id: number;
    slug: string;
    name: CityName;
    lon: number;
    lat: number;
    region_id: number | null;
    area: CityName | null;
  }>(sql`
    select st.id, st.slug, st.name, ST_X(st.geom) as lon, ST_Y(st.geom) as lat,
      coalesce(st.region_id, (
        select r.id from regions r where r.geom is not null and ST_Contains(r.geom, ST_SetSRID(st.geom, 4326)) limit 1
      )) as region_id,
      d.name as area
    from stations st
    left join districts d on d.id = coalesce(st.district_id, (
      select dd.id from districts dd
      where dd.geom is not null and ST_Contains(dd.geom, ST_SetSRID(st.geom, 4326)) limit 1
    ))
    where st.is_public and st.status = 'active'
    order by st.id`);
  // Все точки прогноза, включая выключенные: выключенный администратором город не создаётся заново.
  const existing = await db
    .select({
      slug: s.forecastLocations.slug,
      lon: sql<number>`ST_X(${s.forecastLocations.geom})`,
      lat: sql<number>`ST_Y(${s.forecastLocations.geom})`,
    })
    .from(s.forecastLocations);

  const planned = planStationCities(
    [...stations].map((r) => ({
      id: Number(r.id),
      slug: r.slug,
      name: r.name ?? {},
      lon: Number(r.lon),
      lat: Number(r.lat),
      regionId: r.region_id === null ? null : Number(r.region_id),
      area: r.area,
    })),
    existing.map((e) => ({ slug: e.slug, lon: Number(e.lon), lat: Number(e.lat) })),
    opts.radiusKm ?? CITY_RADIUS_KM,
  );
  if (planned.length === 0) return { stations: stations.length, created: [] };

  const [{ max } = { max: 0 }] = await db
    .select({ max: sql<number>`coalesce(max(${s.forecastLocations.sortOrder}), 0)` })
    .from(s.forecastLocations);
  const inserted = await db
    .insert(s.forecastLocations)
    .values(
      planned.map((p, i) => ({
        slug: p.slug,
        name: {
          tg: p.name.tg ?? p.name.ru ?? "",
          ru: p.name.ru ?? "",
          en: p.name.en ?? p.name.ru ?? "",
        },
        geom: { x: p.lon, y: p.lat },
        regionId: p.regionId,
        kind: "station" as const,
        sortOrder: Number(max) + 1 + i,
        featured: false,
        active: true,
      })),
    )
    // Параллельный запуск (админка и worker одновременно) не создаст дубль: slug уникален.
    .onConflictDoNothing()
    .returning({ slug: s.forecastLocations.slug });
  const createdSlugs = new Set(inserted.map((r) => r.slug));
  return {
    stations: stations.length,
    created: planned
      .filter((p) => createdSlugs.has(p.slug))
      .map((p) => ({ slug: p.slug, name: p.name, stationId: p.stationId })),
  };
}
