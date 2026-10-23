import "server-only";
import type { AqLevelOrNone } from "@meteo/core";
import { and, type CurrentIndex, eq, ne } from "@meteo/db";
import { regions, stations } from "@meteo/db/schema";
import type { I18nText } from "@meteo/i18n";
import {
  type CurrentAq,
  displayValue,
  effectiveLevel,
  loadCurrentAq,
  type PollutantInfo,
} from "@/lib/aq";
import { distanceKm, type GeoPoint, stationsOfCity } from "@/lib/city-stations";
import { getDb } from "@/lib/db";

export { CITY_RADIUS_KM, distanceKm } from "@/lib/city-stations";

export interface StationSummary {
  id: number;
  slug: string;
  name: I18nText;
  status: string;
  regionCode: string | null;
  regionName: I18nText | null;
  lon: number;
  lat: number;
  idx: CurrentIndex | undefined;
  /** Уровень с учётом устаревания (0 — нет свежих данных). */
  level: AqLevelOrNone;
  /** Определяющее вещество и его значение в единице отображения (свежие данные). */
  dominant: PollutantInfo | undefined;
  dominantValue: number | null;
}

export interface ConcentrationChip {
  pollutant: PollutantInfo;
  value: number;
  level: AqLevelOrNone;
}

export interface CityAir {
  /** Станции города (в радиусе CITY_RADIUS_KM и ближе к нему, чем к другим городам), от худшего уровня к лучшему. */
  stations: StationSummary[];
  fresh: StationSummary[];
  level: AqLevelOrNone;
  updatedAt: Date | null;
  /** Последние данные станций города, если свежих нет. */
  lastAt: Date | null;
  /** Максимум по веществам среди свежих станций города. */
  chips: ConcentrationChip[];
  dominant: PollutantInfo | undefined;
  /** Ближайшая станция с любыми данными, если в городе станций нет. */
  nearest: { station: StationSummary; distanceKm: number } | null;
}

/** Все публичные станции (кроме выведенных) с текущим индексом публичной шкалы. */
export async function loadStationSummaries(aq?: CurrentAq): Promise<{
  aq: CurrentAq;
  stations: StationSummary[];
}> {
  const db = getDb();
  const [current, rows] = await Promise.all([
    aq ?? loadCurrentAq(),
    db
      .select({
        id: stations.id,
        slug: stations.slug,
        name: stations.name,
        status: stations.status,
        geom: stations.geom,
        regionCode: regions.code,
        regionName: regions.name,
      })
      .from(stations)
      .leftJoin(regions, eq(regions.id, stations.regionId))
      .where(and(eq(stations.isPublic, true), ne(stations.status, "decommissioned"))),
  ]);
  const list = rows.map((s): StationSummary => {
    const idx = current.byStation.get(s.id);
    const level = effectiveLevel(idx);
    const dominant =
      idx && !idx.stale && idx.dominantPollutantId
        ? current.pollutantsById.get(idx.dominantPollutantId)
        : undefined;
    return {
      id: s.id,
      slug: s.slug,
      name: s.name,
      status: s.status,
      regionCode: s.regionCode,
      regionName: s.regionName,
      lon: s.geom.x,
      lat: s.geom.y,
      idx,
      level,
      dominant,
      dominantValue:
        dominant && idx ? displayValue(dominant, idx.subIndices[String(dominant.id)]?.value) : null,
    };
  });
  return { aq: current, stations: sortByLevel(list) };
}

/** Порядок ленты: уровень по убыванию, внутри — по индексу; без данных — в конце. */
export function sortByLevel(list: StationSummary[]): StationSummary[] {
  return [...list].sort((a, b) => {
    if (a.level !== b.level) return b.level - a.level;
    const av = a.idx && !a.idx.stale ? (a.idx.value ?? 0) : -1;
    const bv = b.idx && !b.idx.stale ? (b.idx.value ?? 0) : -1;
    if (av !== bv) return bv - av;
    return (b.idx?.time.getTime() ?? 0) - (a.idx?.time.getTime() ?? 0);
  });
}

/**
 * Сводка качества воздуха для города. `cities` — точки всех городов выбора: станция относится только
 * к ближайшему из них (в радиусе CITY_RADIUS_KM), см. stationsOfCity.
 */
export function summarizeCityAir(
  point: GeoPoint,
  all: StationSummary[],
  pollutantsById: Map<number, PollutantInfo>,
  cities: GeoPoint[] = [],
): CityAir {
  const inCity = sortByLevel(stationsOfCity(point, all, cities));
  const fresh = inCity.filter((s) => s.idx && !s.idx.stale);
  const level = fresh.reduce<AqLevelOrNone>((max, s) => (s.level > max ? s.level : max), 0);
  const updatedAt = fresh.reduce<Date | null>(
    (latest, s) => (s.idx && (!latest || s.idx.time > latest) ? s.idx.time : latest),
    null,
  );
  const lastAt = inCity.reduce<Date | null>(
    (latest, s) => (s.idx && (!latest || s.idx.time > latest) ? s.idx.time : latest),
    null,
  );
  const byPollutant = new Map<number, ConcentrationChip>();
  for (const s of fresh) {
    for (const [id, sub] of Object.entries(s.idx?.subIndices ?? {})) {
      const pollutant = pollutantsById.get(Number(id));
      const value = pollutant ? displayValue(pollutant, sub.value) : null;
      if (!pollutant || value === null) continue;
      const prev = byPollutant.get(pollutant.id);
      if (!prev || value > prev.value) {
        byPollutant.set(pollutant.id, {
          pollutant,
          value,
          level: Math.min(6, Math.max(0, sub.level)) as AqLevelOrNone,
        });
      }
    }
  }
  const chips = [...byPollutant.values()].sort((a, b) => {
    const order = [...pollutantsById.keys()];
    return order.indexOf(a.pollutant.id) - order.indexOf(b.pollutant.id);
  });
  let nearest: CityAir["nearest"] = null;
  if (inCity.length === 0) {
    for (const s of all) {
      if (!s.idx) continue;
      const d = distanceKm(point, s);
      if (!nearest || d < nearest.distanceKm) nearest = { station: s, distanceKm: d };
    }
  }
  return {
    stations: inCity,
    fresh,
    level,
    updatedAt,
    lastAt,
    chips,
    dominant: fresh[0]?.dominant,
    nearest,
  };
}
