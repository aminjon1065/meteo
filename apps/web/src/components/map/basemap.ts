import { type Flavor, layers, namedFlavor } from "@protomaps/basemaps";
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

/**
 * Подложка Protomaps в цветах дизайн‑системы: холодный светлый фон в обеих темах, чтобы цветные
 * слои (станции, SILAM, предупреждения, границы) читались. В тёмной теме — приглушённый
 * серо‑синий вариант «grayscale», а не чёрная карта (docs/03-design-system.md §5).
 */
function flavorFor(theme: "light" | "dark"): { flavor: Flavor; sprite: string } {
  if (theme === "dark") {
    const base = namedFlavor("grayscale");
    return {
      sprite: "grayscale",
      flavor: {
        ...base,
        background: "#d8dee8",
        earth: "#e3e8f0",
        park_a: "#dbe6dc",
        park_b: "#d3e0d4",
        water: "#b9c9dc",
        buildings: "#d4dbe6",
        major: "#f4f6f9",
        highway: "#f6f8fb",
        country_label: "#3b4a63",
        city_label: "#2e3d55",
        state_label: "#4e5f78",
      },
    };
  }
  const base = namedFlavor("light");
  return {
    sprite: "light",
    flavor: {
      ...base,
      background: "#e9eef5",
      earth: "#eef2f7",
      water: "#cfdcec",
      park_a: "#dfeadf",
      park_b: "#d5e3d6",
      country_label: "#3b4a63",
      city_label: "#142238",
    },
  };
}

/** Стиль Protomaps (light / приглушённый для тёмной темы) с самостоятельно размещёнными шрифтами, спрайтами и тайлами. */
export function buildBasemapStyle(
  theme: "light" | "dark",
  lang: string,
): maplibregl.StyleSpecification {
  const { flavor, sprite } = flavorFor(theme);
  return {
    version: 8,
    glyphs: absolute("/basemaps/fonts/{fontstack}/{range}.pbf"),
    sprite: absolute(`/basemaps/sprites/v4/${sprite}`),
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
