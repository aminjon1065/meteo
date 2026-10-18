import { layers, namedFlavor } from "@protomaps/basemaps";
import * as maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";

export const TAJIKISTAN_BOUNDS: [[number, number], [number, number]] = [
  [67.3, 36.6],
  [75.2, 41.1],
];
export const DUSHANBE: [number, number] = [68.787, 38.5598];
export const TILES_URL = "/tiles/tajikistan.pmtiles";

let runtimeReady = false;

/**
 * Одноразовая настройка MapLibre на странице: протокол pmtiles:// и статический worker
 * (Turbopack не собирает worker‑URL библиотеки, см. scripts/copy-maplibre-worker.mjs).
 */
export function ensurePmtilesProtocol() {
  if (runtimeReady) return;
  maplibregl.setWorkerUrl(absolute("/maplibre/maplibre-gl-worker.mjs"));
  const protocol = new Protocol({ metadata: true });
  maplibregl.addProtocol("pmtiles", protocol.tile);
  runtimeReady = true;
}

/** Абсолютный URL без percent‑кодирования: шаблоны {fontstack}/{range} должны остаться как есть. */
function absolute(path: string): string {
  if (typeof window === "undefined") return path;
  return `${window.location.origin}${path}`;
}

/** Стиль Protomaps (light/dark) с самостоятельно размещёнными шрифтами, спрайтами и тайлами. */
export function buildBasemapStyle(
  theme: "light" | "dark",
  lang: string,
): maplibregl.StyleSpecification {
  const flavor = namedFlavor(theme === "dark" ? "dark" : "light");
  return {
    version: 8,
    glyphs: absolute("/basemaps/fonts/{fontstack}/{range}.pbf"),
    sprite: absolute(`/basemaps/sprites/v4/${theme}`),
    sources: {
      protomaps: {
        type: "vector",
        url: `pmtiles://${absolute(TILES_URL)}`,
        attribution:
          '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>, <a href="https://protomaps.com">Protomaps</a>',
      },
    },
    layers: layers("protomaps", flavor, { lang }),
  };
}
