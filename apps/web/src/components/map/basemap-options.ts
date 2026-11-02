/**
 * Типы подложки, которые выбирает посетитель (только открытые данные на нашем сервере, ADR-003):
 * схема и серая — векторные тайлы OSM/Protomaps; рельеф — затенение по Copernicus DEM GLO-30
 * (Mapterhorn, infra/data/fetch-basemap-layers.sh); спутник — безоблачный композит Sentinel-2
 * 2021 проекта ESA WorldCover (CC BY 4.0).
 *
 * Отдельно от basemap.ts: тот тянет maplibre-gl и pmtiles (≈300 КБ). Переключатель подложки
 * рендерится сразу, и с импортом из basemap.ts MapLibre попадал бы в стартовый JS главной, а не
 * в ленивый чанк карты (station-map.lazy.tsx).
 */
export const BASEMAPS = ["scheme", "gray", "relief", "satellite"] as const;
export type Basemap = (typeof BASEMAPS)[number];
export const TERRAIN_URL = "/tiles/terrain.pmtiles";
export const SATELLITE_URL = "/tiles/satellite.pmtiles";
/** Подложки с отдельным файлом тайлов: без файла на сервере вариант не предлагается. */
export const BASEMAP_FILES: Partial<Record<Basemap, string>> = {
  relief: TERRAIN_URL,
  satellite: SATELLITE_URL,
};

export function isBasemap(value: unknown): value is Basemap {
  return typeof value === "string" && (BASEMAPS as readonly string[]).includes(value);
}
