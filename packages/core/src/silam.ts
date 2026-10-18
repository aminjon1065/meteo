/**
 * SILAM (FMI THREDDS, NetCDF Subset Service): чистые функции разбора сетки, пересчёта единиц,
 * билинейной интерполяции и растеризации уровней. Сетевые вызовы, netcdfjs и sharp — в worker.
 */
import { AQ_LEVEL_STYLES, type AqLevelOrNone } from "./levels";

/** Домен запроса по умолчанию — Таджикистан с запасом (модель 0,2°). */
export const SILAM_BBOX = { west: 66.5, east: 75.5, south: 36.5, north: 41.5 } as const;

/** Переменные SILAM → код вещества. Концентрации в kg/m3, газы — объёмная доля (mole/mole). */
export const SILAM_VARIABLES: ReadonlyArray<{
  variable: string;
  code: "PM25" | "PM10" | "NO2" | "SO2" | "CO" | "O3";
  kind: "cnc" | "vmr";
  /** Молярная масса, кг/моль (для vmr). */
  molarMass?: number;
}> = [
  { variable: "cnc_PM2_5", code: "PM25", kind: "cnc" },
  { variable: "cnc_PM10", code: "PM10", kind: "cnc" },
  { variable: "vmr_NO2_gas", code: "NO2", kind: "vmr", molarMass: 0.046006 },
  { variable: "vmr_SO2_gas", code: "SO2", kind: "vmr", molarMass: 0.064066 },
  { variable: "vmr_O3_gas", code: "O3", kind: "vmr", molarMass: 0.047998 },
  { variable: "vmr_CO_gas", code: "CO", kind: "vmr", molarMass: 0.02801 },
];

export const AIR_MOLAR_MASS = 0.028965;

export function buildSilamSubsetUrl(opts: {
  baseUrl: string;
  dataset: string;
  variables: readonly string[];
  bbox?: { west: number; east: number; south: number; north: number };
  timeStart: Date;
  timeEnd: Date;
}): string {
  const bbox = opts.bbox ?? SILAM_BBOX;
  const query = [
    ...opts.variables.map((v) => `var=${encodeURIComponent(v)}`),
    `north=${bbox.north}`,
    `south=${bbox.south}`,
    `west=${bbox.west}`,
    `east=${bbox.east}`,
    "horizStride=1",
    `time_start=${encodeURIComponent(opts.timeStart.toISOString())}`,
    `time_end=${encodeURIComponent(opts.timeEnd.toISOString())}`,
    "accept=netcdf",
  ].join("&");
  return `${opts.baseUrl.replace(/\/+$/, "")}/${opts.dataset}?${query}`;
}

/** "hours since 2026-07-08 00:00:00.000 UTC" + значения → Date[]. */
export function decodeTimeAxis(units: string, values: ArrayLike<number>): Date[] {
  const m = units.match(/^(\w+)\s+since\s+(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2}(?:\.\d+)?)/i);
  if (!m) throw new Error(`Неизвестные единицы времени: ${units}`);
  const unit = (m[1] as string).toLowerCase();
  const base = Date.parse(`${m[2]}T${m[3]}Z`);
  const ms = unit.startsWith("hour")
    ? 3_600_000
    : unit.startsWith("minute")
      ? 60_000
      : unit.startsWith("second")
        ? 1000
        : unit.startsWith("day")
          ? 86_400_000
          : null;
  if (ms === null) throw new Error(`Неизвестная единица времени: ${unit}`);
  return Array.from(values, (v) => new Date(base + v * ms));
}

/** Регулярная сетка: значения построчно с юга на север (lat ↑) и с запада на восток (lon ↑). */
export interface Grid {
  nx: number;
  ny: number;
  /** Центры крайних ячеек. */
  lon0: number;
  lat0: number;
  dx: number;
  dy: number;
  /** Длина nx*ny; NaN — нет данных. */
  values: Float32Array;
}

/** Внешние границы сетки (края крайних ячеек) — для привязки растра на карте. */
export function gridBounds(g: Pick<Grid, "nx" | "ny" | "lon0" | "lat0" | "dx" | "dy">) {
  return {
    west: g.lon0 - g.dx / 2,
    east: g.lon0 + g.dx * (g.nx - 1) + g.dx / 2,
    south: g.lat0 - g.dy / 2,
    north: g.lat0 + g.dy * (g.ny - 1) + g.dy / 2,
  };
}

/**
 * Пересчёт в единицы портала: cnc kg/m3 → µg/m³; vmr → µg/m³ через плотность воздуха (kg/m3).
 * Для CO (mg/m³) вызывающий код делит на 1000.
 */
export function toMicrograms(
  kind: "cnc" | "vmr",
  value: number,
  airDensity: number,
  molarMass?: number,
): number {
  if (!Number.isFinite(value) || value < 0) return Number.NaN;
  if (kind === "cnc") return value * 1e9;
  if (!molarMass || !Number.isFinite(airDensity) || airDensity <= 0) return Number.NaN;
  return (value * airDensity * molarMass * 1e9) / AIR_MOLAR_MASS;
}

/** Билинейная интерполяция в точке (lon, lat); за пределами сетки — ближайший край; NaN при отсутствии данных. */
export function sampleGrid(g: Grid, lon: number, lat: number): number {
  const fx = Math.min(Math.max((lon - g.lon0) / g.dx, 0), g.nx - 1);
  const fy = Math.min(Math.max((lat - g.lat0) / g.dy, 0), g.ny - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, g.nx - 1);
  const y1 = Math.min(y0 + 1, g.ny - 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const v00 = g.values[y0 * g.nx + x0] as number;
  const v10 = g.values[y0 * g.nx + x1] as number;
  const v01 = g.values[y1 * g.nx + x0] as number;
  const v11 = g.values[y1 * g.nx + x1] as number;
  const top = v00 * (1 - tx) + v10 * tx;
  const bottom = v01 * (1 - tx) + v11 * tx;
  const v = top * (1 - ty) + bottom * ty;
  if (Number.isNaN(v)) {
    // Частично пустая окрестность — берём ближайшую ячейку.
    const near = g.values[Math.round(fy) * g.nx + Math.round(fx)] as number;
    return Number.isFinite(near) ? near : Number.NaN;
  }
  return v;
}

export interface LevelThreshold {
  level: number;
  lo: number;
  hi: number | null;
}

/** Уровень 1–5 по порогам [lo, hi); 0 — нет данных. */
export function levelForThresholds(value: number, thresholds: LevelThreshold[]): AqLevelOrNone {
  if (!Number.isFinite(value)) return 0;
  let matched = 0;
  for (const t of thresholds) {
    if (value >= t.lo && (t.hi === null || value < t.hi)) {
      matched = t.level;
      break;
    }
  }
  if (matched === 0 && thresholds.length) {
    const sorted = [...thresholds].sort((a, b) => a.level - b.level);
    const first = sorted[0] as LevelThreshold;
    const last = sorted[sorted.length - 1] as LevelThreshold;
    matched = value < first.lo ? first.level : last.level;
  }
  return Math.min(5, Math.max(0, Math.round(matched))) as AqLevelOrNone;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const mercY = (latDeg: number) => Math.log(Math.tan(Math.PI / 4 + (latDeg * Math.PI) / 360));
const invMercY = (y: number) => ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI;

/**
 * Растр уровней в проекции Web Mercator (строки — равномерно по меркаторовой y, поэтому
 * картинка ложится на карту без искажений по широте). RGBA, прозрачность вне данных.
 */
export function rasterizeLevels(
  g: Grid,
  thresholds: LevelThreshold[],
  opts: { scale?: number; alpha?: number } = {},
): {
  width: number;
  height: number;
  data: Uint8Array;
  stats: { min: number; max: number; mean: number };
} {
  const scale = opts.scale ?? 8;
  const alpha = Math.round((opts.alpha ?? 0.55) * 255);
  const width = g.nx * scale;
  const height = g.ny * scale;
  const b = gridBounds(g);
  const yN = mercY(b.north);
  const yS = mercY(b.south);
  const palette = ([0, 1, 2, 3, 4, 5] as const).map((l) => hexToRgb(AQ_LEVEL_STYLES[l].color));
  const data = new Uint8Array(width * height * 4);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let sum = 0;
  let n = 0;
  for (let j = 0; j < height; j++) {
    const lat = invMercY(yN + ((yS - yN) * (j + 0.5)) / height);
    for (let i = 0; i < width; i++) {
      const lon = b.west + ((b.east - b.west) * (i + 0.5)) / width;
      const v = sampleGrid(g, lon, lat);
      const o = (j * width + i) * 4;
      if (!Number.isFinite(v)) continue;
      const level = levelForThresholds(v, thresholds);
      if (level === 0) continue;
      const [r, gg, bb] = palette[level] as [number, number, number];
      data[o] = r;
      data[o + 1] = gg;
      data[o + 2] = bb;
      data[o + 3] = alpha;
    }
  }
  for (let k = 0; k < g.values.length; k++) {
    const v = g.values[k] as number;
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
    n++;
  }
  return {
    width,
    height,
    data,
    stats: n
      ? { min: round(min), max: round(max), mean: round(sum / n) }
      : { min: 0, max: 0, mean: 0 },
  };
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
