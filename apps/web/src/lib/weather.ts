import "server-only";
import { symbolKey } from "@meteo/core";
import {
  type ForecastLocationRow,
  type ForecastPoint,
  getWeatherSummaries,
  listForecastLocations,
  localDateKey,
} from "@meteo/db";
import type { ForecastParams } from "@meteo/db/schema";
import { getDb } from "@/lib/db";
import { translateOr } from "@/lib/i18n-utils";

/** Подпись символа погоды по коду FMI SmartSymbol (ночные коды приводятся к дневным). */
export function symbolLabel(t: unknown, code: number | null | undefined): string {
  return translateOr(t, symbolKey(code), "—");
}

/** Название модели прогноза по producer'у SmartMet (для подписей «на основе модели …»). */
export function modelLabel(producer: string | null | undefined): string {
  const p = producer?.trim().toLowerCase();
  if (!p) return "SmartMet";
  if (p.startsWith("gfs")) return "GFS (NOAA)";
  if (p.startsWith("ecmwf")) return "ECMWF";
  return p.toUpperCase();
}

export const WIND_DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
export type WindDirection = (typeof WIND_DIRECTIONS)[number];

/** Румб по направлению ветра в градусах (откуда дует). */
export function windDirectionKey(deg: number): WindDirection {
  const idx = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return WIND_DIRECTIONS[idx] as WindDirection;
}

export interface DayAggregate {
  tmax: number | null;
  tmin: number | null;
  precipSum: number | null;
  symbol: number | null;
  /** Источник: суточная точка провайдера или агрегат из часового ряда. */
  derived: boolean;
}

function numbers(values: Array<number | null | undefined>): number[] {
  return values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
}

/** Дневной символ: медиана дневных часов (9–16 местного), иначе всех часов. */
function daySymbol(points: ForecastPoint[]): number | null {
  const daytime = points.filter((p) => {
    const h = Math.floor((((p.time.getTime() / 3_600_000 + 5) % 24) + 24) % 24);
    return h >= 9 && h <= 16;
  });
  const symbols = numbers((daytime.length ? daytime : points).map((p) => p.params.symbol)).sort(
    (a, b) => a - b,
  );
  const median = symbols[Math.floor(symbols.length / 2)];
  if (median === undefined) return null;
  return median >= 100 ? median - 100 : median;
}

/** Агрегаты суток: точка провайдера (шаг 1440) либо расчёт по часовому ряду за местные сутки. */
export function aggregateDay(
  daily: ForecastPoint | null,
  hourly: ForecastPoint[],
  dateKey: string,
): DayAggregate | null {
  if (daily && (daily.params.tmax !== null || daily.params.tmin !== null)) {
    return {
      tmax: daily.params.tmax ?? null,
      tmin: daily.params.tmin ?? null,
      precipSum: daily.params.precipSum ?? null,
      symbol:
        daily.params.symbol ?? daySymbol(hourly.filter((p) => localDateKey(p.time) === dateKey)),
      derived: false,
    };
  }
  const points = hourly.filter((p) => localDateKey(p.time) === dateKey);
  if (points.length === 0) return null;
  const temps = numbers(points.map((p) => p.params.t));
  const precip = numbers(points.map((p) => p.params.precip ?? 0));
  return {
    tmax: temps.length ? Math.max(...temps) : null,
    tmin: temps.length ? Math.min(...temps) : null,
    precipSum: precip.length ? Math.round(precip.reduce((a, b) => a + b, 0) * 10) / 10 : null,
    symbol: daySymbol(points),
    derived: true,
  };
}

export interface LocationOverview {
  location: ForecastLocationRow;
  now: ForecastPoint | null;
  today: DayAggregate | null;
  tomorrow: ForecastPoint | null;
}

/** Сводка по точкам прогноза для списков (главная, /weather, виджеты). */
export async function loadWeatherOverview(
  opts: { featuredOnly?: boolean; slugs?: string[] } = {},
): Promise<LocationOverview[]> {
  const db = getDb();
  const now = new Date();
  const all = await listForecastLocations(db, { featuredOnly: opts.featuredOnly });
  const locations = opts.slugs ? all.filter((l) => opts.slugs?.includes(l.slug)) : all;
  const summaries = await getWeatherSummaries(
    db,
    locations.map((l) => l.id),
    now,
  );
  const todayKey = localDateKey(now);
  return locations.map((location) => {
    const s = summaries.get(location.id);
    return {
      location,
      now: s?.now ?? null,
      today: s ? aggregateDay(s.today, s.todayHourly, todayKey) : null,
      tomorrow: s?.tomorrow ?? null,
    };
  });
}

/** Текущая температура: часовая точка, иначе «—». */
export function currentTemperature(p: ForecastParams | null | undefined): number | null {
  return p?.t ?? null;
}
