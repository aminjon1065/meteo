import { slugify } from "./slug";

/**
 * Города для станций: список городов портала (выбор в шапке, сводка «воздух в городе», прогноз
 * погоды) — точки прогноза. Станция относится к городу в радиусе CITY_RADIUS_KM; если такого нет,
 * для неё автоматически заводится город (точка прогноза в месте станции), иначе её данные не попали
 * бы ни в одну сводку (так было с Гиссаром и Вахдатом в ~20 км от Душанбе).
 */

/** Станции в этом радиусе от точки прогноза считаются станциями города. */
export const CITY_RADIUS_KM = 15;

export interface GeoPoint {
  lon: number;
  lat: number;
}

/** Расстояние по большому кругу, км. */
export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const r = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

/** Название на трёх языках (как I18nText в @meteo/i18n). */
export type CityName = Partial<Record<"tg" | "ru" | "en", string>>;

/**
 * Название города по названию района станции. Города республиканского и областного подчинения в
 * границах — «Город Гиссар» / «Шаҳри Ҳисор» / «Hisor city»: в списке городов достаточно «Гиссар».
 * Районы («Вахдатский район», «Ноҳияи Ваҳдат», «Vahdat district») остаются как есть — это не город,
 * и называть его городом было бы неправдой.
 */
export function cityNameFromArea(area: CityName): CityName {
  const isCity =
    /^город\s+/i.test(area.ru ?? "") ||
    /^шаҳри\s+/i.test(area.tg ?? "") ||
    /\s+city$/i.test(area.en ?? "");
  if (!isCity) return { ...area };
  const strip = (v: string | undefined, re: RegExp) => (v ? v.replace(re, "").trim() || v : v);
  return {
    tg: strip(area.tg, /^шаҳри\s+/i),
    ru: strip(area.ru, /^город\s+/i),
    en: strip(area.en, /\s+city$/i),
  };
}

export interface StationForCity extends GeoPoint {
  id: number;
  slug: string;
  /** Название станции — запасное название города, если район неизвестен. */
  name: CityName;
  regionId: number | null;
  /** Район (административная единица), в котором стоит станция. */
  area: CityName | null;
}

export interface ExistingCity extends GeoPoint {
  slug: string;
}

export interface PlannedCity extends GeoPoint {
  /** Станция, ради которой заводится город. */
  stationId: number;
  slug: string;
  name: CityName;
  regionId: number | null;
}

/**
 * Какие города завести, чтобы каждая станция оказалась в радиусе `radiusKm` от какого‑нибудь города.
 * Станции перебираются по id: первая непокрытая получает город в своей точке, соседние станции в том
 * же радиусе относятся к нему. Учитываются все существующие точки, в том числе выключенные
 * администратором, — выключенный город заново не создаётся.
 */
export function planStationCities(
  stations: readonly StationForCity[],
  existing: readonly ExistingCity[],
  radiusKm: number = CITY_RADIUS_KM,
): PlannedCity[] {
  const points: GeoPoint[] = existing.map((c) => ({ lon: c.lon, lat: c.lat }));
  const slugs = new Set(existing.map((c) => c.slug));
  const planned: PlannedCity[] = [];
  for (const station of [...stations].sort((a, b) => a.id - b.id)) {
    if (points.some((p) => distanceKm(p, station) <= radiusKm)) continue;
    const name = station.area ? cityNameFromArea(station.area) : { ...station.name };
    const base =
      slugify(name.en || name.ru || name.tg || "") || slugify(station.slug) || `city-${station.id}`;
    let slug = base;
    for (let i = 2; slugs.has(slug); i++) slug = `${base}-${i}`;
    slugs.add(slug);
    points.push({ lon: station.lon, lat: station.lat });
    planned.push({
      stationId: station.id,
      slug,
      name,
      lon: station.lon,
      lat: station.lat,
      regionId: station.regionId,
    });
  }
  return planned;
}
