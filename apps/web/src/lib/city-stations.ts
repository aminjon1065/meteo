/** Станции в этом радиусе от точки прогноза могут считаться станциями города. */
export const CITY_RADIUS_KM = 15;

export interface GeoPoint {
  lon: number;
  lat: number;
}

/** Расстояние по большому кругу, км. */
export function distanceKm(a: GeoPoint, b: GeoPoint) {
  const r = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

/**
 * Станции города: в радиусе CITY_RADIUS_KM от его точки и ближе к ней, чем к любому другому городу
 * списка. Без второго условия соседние города делили бы станции: датчик на окраине Душанбе (6 км от
 * центра) попадал и в Вахдат (14 км), и худшее значение Душанбе становилось уровнем Вахдата.
 */
export function stationsOfCity<T extends GeoPoint>(
  city: GeoPoint,
  stations: T[],
  cities: GeoPoint[] = [],
): T[] {
  return stations.filter((s) => {
    const own = distanceKm(city, s);
    if (own > CITY_RADIUS_KM) return false;
    return cities.every((other) => distanceKm(other, s) >= own);
  });
}
