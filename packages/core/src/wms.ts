/**
 * Слои погоды SmartMet Server (плагин WMS) для карты портала: границы тайла Web Mercator для GetMap,
 * компактные метки времени для адресов тайлов, сроки и время прогона модели из плагина timeseries.
 * Чистые функции; сетевые вызовы — в web (маршрут /wms, загрузчик каталога).
 */
import { parseSmartmetTime, toQuery } from "./smartmet";

/** Половина длины экватора в EPSG:3857, м. */
export const WEB_MERCATOR_HALF = 20037508.342789244;

/** Границы тайла z/x/y (схема XYZ, y сверху) в EPSG:3857: [minX, minY, maxX, maxY]. */
export function tileBbox3857(z: number, x: number, y: number): [number, number, number, number] {
  const n = 2 ** z;
  const size = (2 * WEB_MERCATOR_HALF) / n;
  const minX = -WEB_MERCATOR_HALF + x * size;
  const maxY = WEB_MERCATOR_HALF - y * size;
  return [minX, maxY - size, minX + size, maxY];
}

/** Тайл существует на уровне z: целые x, y в пределах [0, 2^z). */
export function isValidTile(z: number, x: number, y: number): boolean {
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 22) return false;
  const n = 2 ** z;
  return x >= 0 && y >= 0 && x < n && y < n;
}

/** Границы тайла в градусах: west, south, east, north. */
export function tileBoundsLonLat(
  z: number,
  x: number,
  y: number,
): { west: number; south: number; east: number; north: number } {
  const n = 2 ** z;
  const lat = (row: number) =>
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * row) / n))) * 180) / Math.PI;
  return {
    west: (x / n) * 360 - 180,
    east: ((x + 1) / n) * 360 - 180,
    north: lat(y),
    south: lat(y + 1),
  };
}

/** Пересекается ли тайл с прямоугольником в градусах (данные модели есть только в нём). */
export function tileIntersects(
  z: number,
  x: number,
  y: number,
  area: { west: number; south: number; east: number; north: number },
): boolean {
  const t = tileBoundsLonLat(z, x, y);
  return t.west < area.east && t.east > area.west && t.south < area.north && t.north > area.south;
}

export interface WmsGetMapParams {
  /** Имена слоёв WMS, например `tajikistan:temperature`. */
  layers: string[];
  bbox: [number, number, number, number];
  width: number;
  height: number;
  /** Срок прогноза (ISO 8601, UTC). */
  time?: string;
  /** Время прогона модели (ISO 8601, UTC) — измерение reference_time. */
  referenceTime?: string;
}

/** GetMap WMS 1.3.0 в EPSG:3857, PNG с прозрачностью. */
export function buildWmsGetMapUrl(baseUrl: string, p: WmsGetMapParams): string {
  const query = toQuery([
    ["service", "WMS"],
    ["request", "GetMap"],
    ["version", "1.3.0"],
    ["layers", p.layers.join(",")],
    ["styles", p.layers.map(() => "").join(",")],
    ["crs", "EPSG:3857"],
    ["bbox", p.bbox.map((v) => v.toFixed(3)).join(",")],
    ["width", String(p.width)],
    ["height", String(p.height)],
    ["format", "image/png"],
    ["transparent", "true"],
    ["time", p.time],
    ["reference_time", p.referenceTime],
  ]);
  return `${baseUrl.replace(/\/+$/, "")}/wms?${query}`;
}

/** Метка времени для адресов тайлов: 2026-10-29T12:00:00Z → 20261029T1200 (UTC, точность — минута). */
export function compactTime(d: Date): string {
  const iso = d.toISOString();
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}`;
}

const COMPACT_RE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})$/;

/** Обратное к compactTime; null — строка не в формате YYYYMMDDTHHmm или дата несуществующая. */
export function parseCompactTime(s: string): Date | null {
  const m = COMPACT_RE.exec(s);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi));
  return compactTime(date) === s ? date : null;
}

/**
 * Сроки прогноза и время прогона producer'а: timeseries с шагом и периодом данных
 * (`starttime=data&timestep=data`) в одной точке внутри области модели.
 */
export function buildDataTimesUrl(
  baseUrl: string,
  q: { producer: string; lat: number; lon: number },
): string {
  const query = toQuery([
    ["producer", q.producer],
    ["latlon", `${q.lat},${q.lon}`],
    ["param", "time,origintime"],
    ["starttime", "data"],
    ["endtime", "data"],
    ["timestep", "data"],
    ["format", "json"],
    ["tz", "UTC"],
    ["timeformat", "iso"],
  ]);
  return `${baseUrl.replace(/\/+$/, "")}/timeseries?${query}`;
}

export interface DataTimes {
  /** Время прогона (последнее среди строк ответа). */
  originTime: Date | null;
  /** Сроки прогноза по возрастанию, без повторов. */
  times: Date[];
}

export function parseDataTimes(rows: unknown): DataTimes {
  if (!Array.isArray(rows)) return { originTime: null, times: [] };
  const seen = new Map<number, Date>();
  let origin: Date | null = null;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const t = parseSmartmetTime(r.time);
    if (t) seen.set(t.getTime(), t);
    const o = parseSmartmetTime(r.origintime);
    if (o && (!origin || o > origin)) origin = o;
  }
  const times = [...seen.values()].sort((a, b) => a.getTime() - b.getTime());
  return { originTime: origin, times };
}
