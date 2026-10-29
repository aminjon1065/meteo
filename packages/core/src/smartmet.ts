/**
 * Клиент SmartMet Server (плагин timeseries): построение запроса и разбор ответа.
 * Чистые функции; сетевой вызов — в worker. Формат одинаков для сервера Заказчика
 * и песочницы opendata.fmi.fi (глобальный ECMWF без SmartSymbol — символ выводится из осадков/облачности).
 */
export interface SmartmetQuery {
  baseUrl: string;
  /** Производитель данных (пусто — выбор сервера). */
  producer?: string;
  lat: number;
  lon: number;
  /** Часовой прогноз: число шагов (по умолчанию 72) */
  hourlySteps?: number;
  /** Суточные агрегаты: число дней (по умолчанию 10) */
  dailyDays?: number;
  /** Начало часового ряда (ISO, UTC); без него сервер начинает со следующего полного часа. */
  startTime?: string;
  apiKey?: string;
}

export const HOURLY_PARAMS = [
  "time",
  "origintime",
  "Temperature",
  "WindSpeedMS",
  "WindDirection",
  "WindUMS",
  "WindVMS",
  "WindGust",
  "Humidity",
  "Pressure",
  "DewPoint",
  "Precipitation1h",
  "TotalCloudCover",
  "SmartSymbol",
  "WeatherSymbol3",
] as const;

/** Строка запроса без зависимости от глобального URL (пакет общий для браузера и Node). */
export function toQuery(params: Array<[string, string | undefined]>): string {
  return params
    .filter((p): p is [string, string] => p[1] !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

function timeseriesBase(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/timeseries`;
}

export function buildHourlyUrl(q: SmartmetQuery): string {
  const query = toQuery([
    ["producer", q.producer],
    ["latlon", `${q.lat},${q.lon}`],
    ["param", HOURLY_PARAMS.join(",")],
    ["timestep", "60"],
    ["timesteps", String(q.hourlySteps ?? 72)],
    ["starttime", q.startTime],
    ["format", "json"],
    ["tz", "UTC"],
    ["timeformat", "iso"],
    ["fmi_apikey", q.apiKey],
  ]);
  return `${timeseriesBase(q.baseUrl)}?${query}`;
}

/** Суточные агрегаты по местным суткам: max/min температуры, сумма осадков, преобладающий символ (медиана дня). */
export function buildDailyUrl(q: SmartmetQuery, startLocalMidnightIso: string): string {
  const query = toQuery([
    ["producer", q.producer],
    ["latlon", `${q.lat},${q.lon}`],
    [
      "param",
      [
        "time",
        "max_t(Temperature/0h/24h) as tmax",
        "min_t(Temperature/0h/24h) as tmin",
        "sum_t(Precipitation1h/0h/24h) as precip",
        "max_t(WindSpeedMS/0h/24h) as wsmax",
        "mean_t(TotalCloudCover/0h/24h) as cloud",
        "max_t(SmartSymbol/9h/15h) as symbol",
      ].join(","),
    ],
    ["timestep", "1440"],
    ["timesteps", String(q.dailyDays ?? 10)],
    ["starttime", startLocalMidnightIso],
    ["format", "json"],
    ["tz", "UTC"],
    ["timeformat", "iso"],
    ["fmi_apikey", q.apiKey],
  ]);
  return `${timeseriesBase(q.baseUrl)}?${query}`;
}

export interface HourlyPoint {
  time: Date;
  originTime: Date | null;
  t: number | null;
  ws: number | null;
  wd: number | null;
  gust: number | null;
  rh: number | null;
  p: number | null;
  dew: number | null;
  precip: number | null;
  cloud: number | null;
  symbol: number | null;
}

export interface DailyPoint {
  time: Date;
  tmax: number | null;
  tmin: number | null;
  precipSum: number | null;
  wsMax: number | null;
  cloud: number | null;
  symbol: number | null;
}

type Row = Record<string, unknown>;

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Время SmartMet: ISO ("2026-10-16T10:00:00Z") или компактное "20261016T100000". */
export function parseSmartmetTime(raw: unknown): Date | null {
  if (typeof raw !== "string" || !raw) return null;
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?$/);
  if (compact) {
    const [, y, m, d, hh, mm, ss] = compact;
    return new Date(
      Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss ?? "0")),
    );
  }
  const d = new Date(raw.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Скорость и направление ветра из компонент U/V (метеорологическое направление «откуда»). */
export function windFromComponents(
  u: number | null,
  v: number | null,
): { ws: number | null; wd: number | null } {
  if (u === null || v === null) return { ws: null, wd: null };
  const ws = Math.sqrt(u * u + v * v);
  if (ws < 0.05) return { ws: 0, wd: null };
  const wd = (270 - (Math.atan2(v, u) * 180) / Math.PI + 360) % 360;
  return { ws: round1(ws), wd: Math.round(wd) % 360 };
}

/**
 * Символ FMI SmartSymbol по доступным параметрам, если сервер его не отдаёт:
 * 1 ясно, 2 малооблачно, 4 переменная, 6 облачно, 7 пасмурно; дождь 31/32/33, снег 51/52/53,
 * ливни 21/24/27 при переменной облачности. Ночные варианты (1xx) ставит вызывающий код.
 */
export function deriveSymbol(input: {
  precip: number | null;
  cloud: number | null;
  t: number | null;
}): number | null {
  const precip = input.precip ?? 0;
  const cloud = input.cloud;
  const t = input.t;
  if (precip > 0.1) {
    const snow = t !== null && t <= 0;
    const intensity = precip < 1 ? 0 : precip < 4 ? 1 : 2;
    if (cloud !== null && cloud < 70) return [21, 24, 27][intensity] as number;
    return (snow ? [51, 52, 53] : [31, 32, 33])[intensity] as number;
  }
  if (cloud === null) return null;
  if (cloud < 10) return 1;
  if (cloud < 30) return 2;
  if (cloud < 60) return 4;
  if (cloud < 85) return 6;
  return 7;
}

export function parseHourly(rows: unknown): HourlyPoint[] {
  if (!Array.isArray(rows)) return [];
  const out: HourlyPoint[] = [];
  for (const raw of rows as Row[]) {
    const time = parseSmartmetTime(raw.time);
    if (!time) continue;
    const u = num(raw.WindUMS);
    const v = num(raw.WindVMS);
    const fromComponents = windFromComponents(u, v);
    const ws = num(raw.WindSpeedMS) ?? fromComponents.ws;
    const wd = num(raw.WindDirection) ?? fromComponents.wd;
    const t = num(raw.Temperature);
    const precip = num(raw.Precipitation1h);
    const cloud = num(raw.TotalCloudCover);
    const symbol =
      num(raw.SmartSymbol) ??
      symbol3ToSmart(num(raw.WeatherSymbol3)) ??
      deriveSymbol({ precip, cloud, t });
    out.push({
      time,
      originTime: parseSmartmetTime(raw.origintime),
      t,
      ws,
      wd,
      gust: num(raw.WindGust),
      rh: num(raw.Humidity),
      p: num(raw.Pressure),
      dew: num(raw.DewPoint),
      precip,
      cloud,
      symbol,
    });
  }
  return out;
}

export function parseDaily(rows: unknown): DailyPoint[] {
  if (!Array.isArray(rows)) return [];
  const out: DailyPoint[] = [];
  for (const raw of rows as Row[]) {
    const time = parseSmartmetTime(raw.time);
    if (!time) continue;
    const precipSum = num(raw.precip);
    const cloud = num(raw.cloud);
    out.push({
      time,
      tmax: num(raw.tmax),
      tmin: num(raw.tmin),
      precipSum,
      wsMax: num(raw.wsmax),
      cloud,
      symbol:
        num(raw.symbol) ??
        deriveSymbol({
          precip: precipSum === null ? null : precipSum / 24,
          cloud,
          t: num(raw.tmax),
        }),
    });
  }
  return out;
}

/**
 * Старый WeatherSymbol3 (FMI) → ближайший SmartSymbol: 1 ясно, 2 переменная облачность, 3 облачно, 21–23 ливни,
 * 31–33 дождь, 41–43 ливневый снег, 51–53 снегопад, 61–64 грозы, 71–73 ливневый мокрый снег,
 * 81–83 мокрый снег, 91–92 дымка/туман.
 */
export function symbol3ToSmart(code: number | null): number | null {
  if (code === null) return null;
  const map: Record<number, number> = {
    1: 1,
    2: 4,
    3: 7,
    21: 21,
    22: 24,
    23: 27,
    31: 37,
    32: 38,
    33: 39,
    41: 51,
    42: 52,
    43: 53,
    51: 57,
    52: 58,
    53: 59,
    61: 71,
    62: 77,
    63: 74,
    64: 77,
    71: 41,
    72: 42,
    73: 43,
    81: 47,
    82: 48,
    83: 49,
    91: 9,
    92: 9,
  };
  return map[code] ?? null;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** Ночной вариант символа (1xx) по времени суток: солнце ниже горизонта ≈ до 6 и после 19 местного (упрощённо). */
export function nightVariant(symbol: number | null, localHour: number): number | null {
  if (symbol === null) return null;
  if (symbol >= 100) return symbol;
  const night = localHour < 6 || localHour >= 19;
  return night ? symbol + 100 : symbol;
}
