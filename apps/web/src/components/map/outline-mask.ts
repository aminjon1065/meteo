import type { Feature, MultiPolygon, Polygon } from "geojson";

/** Удвоенная знаковая площадь кольца (порядок обхода): для дырки он должен быть обратным внешнему. */
export function ringArea(ring: number[][]): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j] ?? [0, 0];
    const b = ring[i] ?? [0, 0];
    sum += ((a[0] ?? 0) - (b[0] ?? 0)) * ((a[1] ?? 0) + (b[1] ?? 0));
  }
  return sum;
}

/**
 * Маска «всё, кроме страны»: прямоугольник мира с внешними кольцами контура в роли дырок. MapLibre
 * отличает дырку от нового полигона по направлению обхода — дырки разворачиваются при необходимости.
 */
export function invertOutline(geometry: MultiPolygon): Feature<Polygon> {
  const world = [
    [-180, -85],
    [180, -85],
    [180, 85],
    [-180, 85],
    [-180, -85],
  ];
  const outerSign = Math.sign(ringArea(world));
  const holes = geometry.coordinates
    .map((polygon) => polygon[0])
    .filter((ring): ring is number[][] => Array.isArray(ring) && ring.length >= 4)
    .map((ring) => (Math.sign(ringArea(ring)) === outerSign ? [...ring].reverse() : ring));
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [world, ...holes] },
  };
}
