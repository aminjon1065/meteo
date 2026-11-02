import { type Flavor, layers, namedFlavor } from "@protomaps/basemaps";
import type { LayerSpecification } from "maplibre-gl";
import * as maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";
import { type Basemap, SATELLITE_URL, TERRAIN_URL } from "./basemap-options";

export const TAJIKISTAN_BOUNDS: [[number, number], [number, number]] = [
  [67.3, 36.6],
  [75.2, 41.1],
];
export const DUSHANBE: [number, number] = [68.787, 38.5598];
export const TILES_URL = "/tiles/tajikistan.pmtiles";

export * from "./basemap-options";

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
 * «Схема» — классическая цветная карта в пастельных тонах: тёплая суша, голубая вода, зелёная
 * растительность, песочные пустоши, белые ледники, жёлтые магистрали. Насыщенность ниже, чем у
 * цветов уровней качества воздуха, поэтому станции и прогноз поверх читаются; нейтральный вариант
 * без цвета — «Серая». Карта светлая в обеих темах, в тёмной — чуть приглушена
 * (docs/03-design-system.md §5).
 */
function flavorFor(theme: "light" | "dark"): { flavor: Flavor; sprite: string } {
  const base = namedFlavor("light");
  const flavor: Flavor = {
    ...base,
    background: "#e9e4da",
    earth: "#f4f1ea",
    water: "#a8cbe6",
    park_a: "#d5e8cf",
    park_b: "#c4e0bc",
    wood_a: "#d2e6cc",
    wood_b: "#bddbb4",
    scrub_a: "#dfe8cd",
    scrub_b: "#cbdfb6",
    glacier: "#fbfcfd",
    sand: "#efe5cc",
    beach: "#f1e6c6",
    buildings: "#e2dcd2",
    industrial: "#e6e1d9",
    aerodrome: "#e4e2dd",
    major: "#ffffff",
    major_casing_early: "#ddd4c4",
    major_casing_late: "#ddd4c4",
    highway: "#f7d590",
    highway_casing_early: "#dfb766",
    highway_casing_late: "#dfb766",
    country_label: "#3b4a63",
    city_label: "#142238",
    landcover: {
      grassland: "#dcebd2",
      barren: "#efe6d3",
      urban_area: "#e5e0d8",
      farmland: "#e2ecce",
      glacier: "#fbfcfd",
      scrub: "#e3e9cd",
      forest: "#c7dfc0",
    },
  };
  return { sprite: "light", flavor: theme === "dark" ? dimFlavor(flavor, 0.14) : flavor };
}

/** Тёмная тема: цвета схемы сдвинуты к серо‑синему, чтобы светлая карта не слепила. */
function dimFlavor(flavor: Flavor, amount: number): Flavor {
  const target = [0x8a, 0x95, 0xa6];
  const dim = (value: unknown): unknown => {
    if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) {
      const rgb = [1, 3, 5].map((i) => Number.parseInt(value.slice(i, i + 2), 16));
      return `#${rgb
        .map((c, i) => Math.round(c + ((target[i] ?? c) - c) * amount))
        .map((c) => c.toString(16).padStart(2, "0"))
        .join("")}`;
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, dim(v)]));
    }
    return value;
  };
  return dim(flavor) as Flavor;
}

/** Серая подложка: нейтральная, без цветных заливок — цвета данных читаются лучше всего. */
function grayFlavor(): Flavor {
  const base = namedFlavor("grayscale");
  return {
    ...base,
    background: "#e4e6e9",
    earth: "#eceef0",
    water: "#cdd2d8",
    park_a: "#e3e5e7",
    park_b: "#dfe1e4",
    buildings: "#dcdfe3",
    major: "#f7f8f9",
    highway: "#fafafa",
    country_label: "#4a4f57",
    city_label: "#2b2f36",
    state_label: "#5b616b",
    landcover: {
      grassland: "#e8eaec",
      barren: "#eeeff0",
      urban_area: "#e2e4e7",
      farmland: "#e8eaeb",
      glacier: "#f8f9fa",
      scrub: "#e9ebec",
      forest: "#e1e4e6",
    },
  };
}

/** Подписи, границы и крупные дороги поверх снимка: светлый текст с тёмной обводкой. */
function satelliteFlavor(): Flavor {
  const base = namedFlavor("dark");
  return {
    ...base,
    // Вне снимка — светлая схема, как у других подложек: под маской край снимка не заметен.
    background: "#e9eef5",
    earth: "#eef2f7",
    water: "#cfdcec",
    highway: "rgba(255, 236, 190, 0.75)",
    highway_casing_early: "rgba(0, 0, 0, 0)",
    highway_casing_late: "rgba(0, 0, 0, 0)",
    major: "rgba(255, 255, 255, 0.55)",
    major_casing_early: "rgba(0, 0, 0, 0)",
    major_casing_late: "rgba(0, 0, 0, 0)",
    boundaries: "rgba(255, 255, 255, 0.7)",
    city_label: "#ffffff",
    city_label_halo: "rgba(0, 0, 0, 0.8)",
    subplace_label: "#f1f3f5",
    subplace_label_halo: "rgba(0, 0, 0, 0.8)",
    state_label: "#e9ecef",
    state_label_halo: "rgba(0, 0, 0, 0.8)",
    country_label: "#ffffff",
    roads_label_major: "#f1f3f5",
    roads_label_major_halo: "rgba(0, 0, 0, 0.8)",
    roads_label_minor: "#e9ecef",
    roads_label_minor_halo: "rgba(0, 0, 0, 0.8)",
    ocean_label: "#cfe0f3",
  };
}

const PROTOMAPS_ATTRIBUTION =
  '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>, <a href="https://protomaps.com">Protomaps</a>';
const TERRAIN_ATTRIBUTION =
  '<a href="https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM">Copernicus DEM GLO-30</a> © DLR, Airbus (ESA), <a href="https://mapterhorn.com">Mapterhorn</a>';
const SATELLITE_ATTRIBUTION =
  '<a href="https://esa-worldcover.org">ESA WorldCover</a> 2021 / Contains modified Copernicus Sentinel data (2021), <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>';

/**
 * Стиль подложки с самостоятельно размещёнными шрифтами, спрайтами и тайлами. `scheme` — светлая
 * Protomaps (приглушённая в тёмной теме), `gray` — нейтральная серая, `relief` — схема с
 * затенением гор под заливками воды и дорогами, `satellite` — снимок с подписями и границами.
 */
export function buildBasemapStyle(
  theme: "light" | "dark",
  lang: string,
  basemap: Basemap = "scheme",
): maplibregl.StyleSpecification {
  const glyphs = absolute("/basemaps/fonts/{fontstack}/{range}.pbf");
  const protomaps = {
    type: "vector" as const,
    url: `pmtiles://${absolute(TILES_URL)}`,
    attribution: PROTOMAPS_ATTRIBUTION,
  };

  if (basemap === "satellite") {
    const flavor = satelliteFlavor();
    const all = layers("protomaps", flavor, { lang });
    const keep = (l: LayerSpecification) =>
      l.id === "boundaries_country" ||
      l.id === "boundaries" ||
      l.id === "roads_highway" ||
      l.id === "roads_major" ||
      l.id === "water_river";
    return {
      version: 8,
      glyphs,
      sprite: absolute("/basemaps/sprites/v4/dark"),
      sources: {
        protomaps,
        satellite: {
          type: "raster",
          url: `pmtiles://${absolute(SATELLITE_URL)}`,
          tileSize: 256,
          attribution: SATELLITE_ATTRIBUTION,
        },
      },
      layers: [
        // Вне снимка (за пределами страны) — суша и вода схемы.
        ...all.filter((l) => l.id === "background" || l.id === "earth" || l.id === "water"),
        {
          id: "satellite",
          type: "raster",
          source: "satellite",
          paint: { "raster-fade-duration": 150, "raster-resampling": "linear" },
        },
        ...all.filter(keep),
        // Значки и подписи объектов (POI) на снимке не читаются — только населённые пункты, улицы, вода.
        ...layers("protomaps", flavor, { lang, labelsOnly: true }).filter((l) => l.id !== "pois"),
      ],
    };
  }

  const { flavor, sprite } =
    basemap === "gray" ? { flavor: grayFlavor(), sprite: "grayscale" } : flavorFor(theme);
  const base = layers("protomaps", flavor, { lang });
  if (basemap !== "relief") {
    return {
      version: 8,
      glyphs,
      sprite: absolute(`/basemaps/sprites/v4/${sprite}`),
      sources: { protomaps },
      layers: base,
    };
  }
  // Рельеф: затенение над сушей и растительностью, под водой, застройкой, дорогами и подписями.
  const at = base.findIndex((l) => l.id === "landcover") + 1;
  return {
    version: 8,
    glyphs,
    sprite: absolute(`/basemaps/sprites/v4/${sprite}`),
    sources: {
      protomaps,
      terrain: {
        type: "raster-dem",
        url: `pmtiles://${absolute(TERRAIN_URL)}`,
        tileSize: 512,
        encoding: "terrarium",
        attribution: TERRAIN_ATTRIBUTION,
      },
    },
    layers: [
      ...base.slice(0, at),
      {
        id: "hillshade",
        type: "hillshade",
        source: "terrain",
        paint: {
          // Сильнее на масштабе страны (горы читаются), мягче вблизи (не спорит с данными).
          "hillshade-exaggeration": [
            "interpolate",
            ["linear"],
            ["zoom"],
            5,
            0.55,
            9,
            0.38,
            13,
            0.25,
          ],
          "hillshade-illumination-direction": 315,
          "hillshade-shadow-color": "#56677d",
          "hillshade-highlight-color": "#ffffff",
          "hillshade-accent-color": "#7d8ea3",
        },
      },
      ...base.slice(at),
    ],
  };
}
