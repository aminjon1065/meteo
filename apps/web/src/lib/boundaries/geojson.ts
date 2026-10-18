import { createHash } from "node:crypto";
import type { I18nText } from "@meteo/i18n";
import type { MultiPolygon } from "geojson";

/**
 * Формирование GeoJSON административных границ для карты (FR6.3): чистые функции без БД,
 * чтобы формат ответа и агрегаты по станциям проверялись unit‑тестами. Загрузка — ./load.ts.
 */

export type BoundaryLevel = "region" | "district";

/** Допуск ST_SimplifyPreserveTopology в градусах: ≈ 170–220 м на широтах Таджикистана. */
export const SIMPLIFY_TOLERANCE_DEG = 0.002;
/** Знаков после запятой в координатах ST_AsGeoJSON (5 ≈ 1 м). */
export const GEOJSON_PRECISION = 5;
/** TTL кэша и s-maxage: границы меняются редко, уровень индекса пересчитывается раз в 10 минут. */
export const BOUNDARIES_TTL_SEC = 600;

export interface BoundaryRow {
  id: number;
  code: string;
  name: I18nText;
  /** Упрощённая геометрия или null, если границы ещё не загружены (infra/data/load-boundaries.ts). */
  geometry: MultiPolygon | null;
  sortOrder?: number;
  centroid?: [number, number] | null;
  regionId?: number | null;
  regionCode?: string | null;
}

export interface StationAreaRow {
  regionId: number | null;
  districtId: number | null;
  /** Текущий уровень индекса станции; 0 — нет данных или устарел (как в /api/v1/stations). */
  level: number;
}

export interface AreaStats {
  stationsCount: number;
  level: number;
}

export interface BoundaryProperties {
  id: number;
  code: string;
  name: I18nText;
  /** Публичные станции (кроме выведенных из эксплуатации) внутри единицы. */
  stationsCount: number;
  /** Худший текущий уровень индекса среди станций единицы; 0 — нет данных. */
  level: number;
  sortOrder?: number;
  centroid?: [number, number] | null;
  regionId?: number | null;
  regionCode?: string | null;
}

export interface BoundaryFeature {
  type: "Feature";
  id: number;
  geometry: MultiPolygon;
  properties: BoundaryProperties;
}

export interface BoundaryCollection {
  type: "FeatureCollection";
  features: BoundaryFeature[];
}

/** Число станций и худший уровень по ключу (region_id или district_id). */
export function aggregateStations(
  rows: StationAreaRow[],
  key: "regionId" | "districtId",
): Map<number, AreaStats> {
  const out = new Map<number, AreaStats>();
  for (const row of rows) {
    const id = row[key];
    if (id === null || id === undefined) continue;
    const level = Number.isFinite(row.level) ? Math.max(0, Math.trunc(row.level)) : 0;
    const current = out.get(id) ?? { stationsCount: 0, level: 0 };
    current.stationsCount += 1;
    current.level = Math.max(current.level, level);
    out.set(id, current);
  }
  return out;
}

/**
 * FeatureCollection из строк БД: единицы без геометрии пропускаются (карта получает пустую
 * коллекцию, пока границы не загружены), свойства дополняются агрегатами по станциям.
 */
export function buildBoundaryCollection(
  level: BoundaryLevel,
  rows: BoundaryRow[],
  stats: Map<number, AreaStats>,
): BoundaryCollection {
  const features: BoundaryFeature[] = [];
  for (const row of rows) {
    if (!row.geometry || row.geometry.type !== "MultiPolygon") continue;
    const agg = stats.get(row.id) ?? { stationsCount: 0, level: 0 };
    const properties: BoundaryProperties = {
      id: row.id,
      code: row.code,
      name: row.name,
      stationsCount: agg.stationsCount,
      level: agg.level,
    };
    if (level === "region") {
      properties.sortOrder = row.sortOrder ?? 0;
      properties.centroid = row.centroid ?? null;
    } else {
      properties.regionId = row.regionId ?? null;
      properties.regionCode = row.regionCode ?? null;
    }
    features.push({ type: "Feature", id: row.id, geometry: row.geometry, properties });
  }
  return { type: "FeatureCollection", features };
}

/** Слабый ETag по телу ответа: W/"<16 hex SHA‑1>" — одинаков на всех экземплярах web. */
export function weakEtag(body: string): string {
  return `W/"${createHash("sha1").update(body).digest("hex").slice(0, 16)}"`;
}

/**
 * Сравнение If-None-Match с ETag ответа по слабому алгоритму RFC 9110 §8.8.3.2:
 * префикс W/ игнорируется, список через запятую, «*» совпадает с любым.
 */
export function etagMatches(ifNoneMatch: string | null | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false;
  const normalize = (value: string) => value.trim().replace(/^W\//, "");
  const expected = normalize(etag);
  return ifNoneMatch.split(",").some((candidate) => {
    const value = candidate.trim();
    return value === "*" || normalize(value) === expected;
  });
}
