/**
 * Слои погоды SmartMet Server на карте: параметры, слои WMS (продукты infra/smartmet/wms/customers/
 * tajikistan) и легенды. Классы и цвета легенд повторяют палитры этих продуктов — ресурсы образа FMI
 * (isobands/temperature, precipitation, windspeed) и собственную палитру облачности; при смене палитры
 * в SmartMet меняются и здесь.
 */
import { compactTime } from "@meteo/core";

export const WEATHER_PARAMS = ["temperature", "precipitation", "wind", "cloudcover"] as const;
export type WeatherParam = (typeof WEATHER_PARAMS)[number];

/** Продукты WMS, которые отдаёт маршрут /wms (белый список). */
export const WEATHER_WMS_LAYERS = [
  "temperature",
  "precipitation",
  "windspeed",
  "wind",
  "cloudcover",
] as const;
export type WeatherWmsLayer = (typeof WEATHER_WMS_LAYERS)[number];

/** Каталог слоёв погоды (lib/weather-catalog.ts): время прогона и сроки прогноза. */
export interface WeatherCatalog {
  run: { originTime: string } | null;
  /** Сроки прогноза (ISO, UTC) по возрастанию. */
  times: string[];
}

/** Область данных GFS (infra/smartmet/cnf/data/gfs.cnf): тайлы вне неё не запрашиваются. */
export const WEATHER_AREA = { west: 58, south: 32, east: 82, north: 46 } as const;
/** Уровни тайлов: ниже — страна мельче нескольких пикселей, выше — растягиваются тайлы zoom 9 (сетка 0,25°). */
export const WEATHER_MIN_ZOOM = 3;
export const WEATHER_MAX_ZOOM = 9;

export interface LegendClass {
  /** Нижняя граница класса (null — «меньше hi»). */
  lo: number | null;
  hi: number | null;
  color: string;
}

export interface WeatherParamDef {
  /** Слой‑заливка и, для ветра, стрелки поверх неё. */
  base: WeatherWmsLayer;
  arrows?: WeatherWmsLayer;
  /** Единица в легенде: ключ в weather.* сообщений или литерал. */
  unit: "celsius" | "mmh" | "ms" | "percent";
  legend: LegendClass[];
  /** Подписи под шкалой — нижние границы этих классов. */
  ticks: number[];
}

const TEMPERATURE: Array<[number, string]> = [
  [-30, "rgb(4,18,179)"],
  [-28, "rgb(24,49,214)"],
  [-26, "rgb(56,104,235)"],
  [-24, "rgb(111,154,247)"],
  [-22, "rgb(148,178,242)"],
  [-20, "rgb(0,80,171)"],
  [-18, "rgb(6,98,196)"],
  [-16, "rgb(24,122,219)"],
  [-14, "rgb(17,141,250)"],
  [-12, "rgb(64,169,255)"],
  [-10, "rgb(101,189,247)"],
  [-8, "rgb(0,103,140)"],
  [-6, "rgb(2,123,163)"],
  [-5, "rgb(0,155,186)"],
  [-4, "rgb(34,188,212)"],
  [-3, "rgb(103,219,230)"],
  [-2, "rgb(163,243,247)"],
  [-1, "rgb(212,255,255)"],
  [0, "rgb(5,179,138)"],
  [1, "rgb(2,212,149)"],
  [2, "rgb(138,237,187)"],
  [4, "rgb(204,255,208)"],
  [6, "rgb(235,252,207)"],
  [8, "rgb(235,255,122)"],
  [10, "rgb(255,234,128)"],
  [12, "rgb(247,212,35)"],
  [14, "rgb(245,180,0)"],
  [16, "rgb(242,149,0)"],
  [18, "rgb(240,116,0)"],
  [20, "rgb(255,83,36)"],
  [22, "rgb(247,23,7)"],
  [24, "rgb(219,10,7)"],
  [26, "rgb(189,4,4)"],
  [28, "rgb(156,2,20)"],
  [30, "rgb(196,24,98)"],
  [32, "rgb(232,39,120)"],
  [34, "rgb(245,88,174)"],
  [36, "rgb(240,144,216)"],
  [38, "rgb(247,59,213)"],
];

/** Последовательные классы [lo, следующий lo); последний — открытый сверху. */
function steps(list: Array<[number, string]>): LegendClass[] {
  return list.map(([lo, color], i) => ({ lo, hi: list[i + 1]?.[0] ?? null, color }));
}

export const WEATHER_PARAM_DEFS: Record<WeatherParam, WeatherParamDef> = {
  temperature: {
    base: "temperature",
    unit: "celsius",
    legend: steps(TEMPERATURE),
    ticks: [-30, -20, -10, 0, 10, 20, 30],
  },
  precipitation: {
    base: "precipitation",
    unit: "mmh",
    legend: steps([
      [0.1, "rgb(10,155,255)"],
      [0.2, "rgb(5,205,170)"],
      [0.5, "rgb(140,230,20)"],
      [1, "rgb(240,240,20)"],
      [2, "rgb(255,205,20)"],
      [5, "rgb(255,80,60)"],
      [10, "rgb(213,26,13)"],
    ]),
    ticks: [0.1, 0.5, 1, 2, 5, 10],
  },
  wind: {
    base: "windspeed",
    arrows: "wind",
    unit: "ms",
    legend: steps([
      [3, "rgb(225,255,255)"],
      [4, "rgb(181,240,250)"],
      [5, "rgb(151,209,250)"],
      [6, "rgb(120,186,250)"],
      [7, "rgb(79,166,245)"],
      [8, "rgb(199,255,192)"],
      [9, "rgb(181,250,171)"],
      [10, "rgb(151,245,140)"],
      [11, "rgb(120,245,115)"],
      [12, "rgb(79,240,79)"],
      [13, "rgb(56,209,61)"],
      [14, "rgb(255,232,120)"],
      [15, "rgb(255,192,61)"],
      [16, "rgb(255,161,0)"],
      [17, "rgb(255,97,0)"],
      [18, "rgb(255,51,0)"],
      [19, "rgb(225,20,0)"],
      [20, "rgb(166,0,0)"],
      [21, "rgb(255,199,199)"],
      [22, "rgb(248,161,161)"],
      [23, "rgb(230,140,140)"],
      [24, "rgb(230,112,112)"],
      [25, "rgb(230,79,79)"],
      [26, "rgb(199,61,61)"],
      [27, "rgb(181,40,40)"],
    ]),
    ticks: [3, 8, 14, 20, 27],
  },
  cloudcover: {
    base: "cloudcover",
    unit: "percent",
    legend: steps([
      [10, "rgba(100,116,139,0.18)"],
      [25, "rgba(100,116,139,0.32)"],
      [50, "rgba(71,85,105,0.46)"],
      [75, "rgba(51,65,85,0.58)"],
      [90, "rgba(30,41,59,0.70)"],
    ]),
    ticks: [10, 25, 50, 75, 90],
  },
};

/** Шаблон адреса тайлов MapLibre: /wms/<прогон>/<слой>/<срок>/{z}/{x}/{y}.png. */
export function weatherTileUrl(originTime: string, layer: WeatherWmsLayer, time: string): string {
  return `/wms/${compactTime(new Date(originTime)).replace("T", "")}/${layer}/${compactTime(new Date(time))}/{z}/{x}/{y}.png`;
}
