import { CITY_RADIUS_KM, distanceKm, type GeoPoint } from "@meteo/core";

export { CITY_RADIUS_KM, distanceKm, type GeoPoint };

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
