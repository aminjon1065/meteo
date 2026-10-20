import "server-only";
import {
  AQ_LEVEL_STYLES,
  type AqLevelOrNone,
  type ConcentrationDisplayMode,
  roundTo,
} from "@meteo/core";
import { and, asc, type CurrentIndex, eq, getCurrentIndexes, type ScaleConfig } from "@meteo/db";
import { healthAdvice, pollutants } from "@meteo/db/schema";
import type { I18nText } from "@meteo/i18n";
import { getDb } from "@/lib/db";
import { displayScaleOf, getConcentrationDisplayMode } from "@/lib/settings";

export interface PollutantInfo {
  id: number;
  code: string;
  shortName: string;
  /** Единица и точность отображения — с учётом настройки единиц портала (/admin/settings). */
  unit: string;
  decimals: number;
  /** Единица хранения значений в БД. */
  storedUnit: string;
  /** Множитель перевода из единицы хранения в единицу отображения. */
  factor: number;
}

export interface CurrentAq {
  scale: ScaleConfig | null;
  byStation: Map<number, CurrentIndex>;
  pollutantsById: Map<number, PollutantInfo>;
  displayMode: ConcentrationDisplayMode;
}

/** Справочная строка вещества → описание с единицей отображения. */
export function toPollutantInfo(
  p: { id: number; code: string; shortName: string; unit: string; decimals: number },
  mode: ConcentrationDisplayMode,
): PollutantInfo {
  const scale = displayScaleOf(p, mode);
  return {
    id: p.id,
    code: p.code,
    shortName: p.shortName,
    unit: scale.unit,
    decimals: scale.decimals,
    storedUnit: p.unit,
    factor: scale.factor,
  };
}

/** Значение из единицы хранения в единицу отображения вещества; null — нет значения. */
export function displayValue(p: PollutantInfo, value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return roundTo(value * p.factor, p.decimals);
}

/** Текущий индекс станций по шкале (по умолчанию — публичная) + справочник веществ в единицах отображения. */
export async function loadCurrentAq(stationIds?: number[], scaleCode?: string): Promise<CurrentAq> {
  const db = getDb();
  const [{ scale, byStation }, pollutantRows, displayMode] = await Promise.all([
    getCurrentIndexes(db, { stationIds, scaleCode }),
    db
      .select({
        id: pollutants.id,
        code: pollutants.code,
        shortName: pollutants.shortName,
        unit: pollutants.unit,
        decimals: pollutants.decimals,
      })
      .from(pollutants)
      .orderBy(asc(pollutants.sortOrder)),
    getConcentrationDisplayMode(),
  ]);
  return {
    scale,
    byStation,
    displayMode,
    pollutantsById: new Map(pollutantRows.map((p) => [p.id, toPollutantInfo(p, displayMode)])),
  };
}

export function effectiveLevel(idx: CurrentIndex | undefined): AqLevelOrNone {
  if (!idx || idx.stale) return 0;
  return idx.level as AqLevelOrNone;
}

export function levelColor(level: AqLevelOrNone): string {
  return AQ_LEVEL_STYLES[level].color;
}

export interface AdviceText {
  level: number;
  audience: string;
  title: I18nText | null;
  text: I18nText;
}

/** Медицинские рекомендации для уровня (все группы) по шкале. */
export async function loadHealthAdvice(scaleId: number, level: number): Promise<AdviceText[]> {
  if (level <= 0) return [];
  return getDb()
    .select({
      level: healthAdvice.level,
      audience: healthAdvice.audience,
      title: healthAdvice.title,
      text: healthAdvice.text,
    })
    .from(healthAdvice)
    .where(and(eq(healthAdvice.scaleId, scaleId), eq(healthAdvice.level, level)));
}

export type Band = { level: number; lo: number; hi: number | null };

/** Пороги шкалы по веществам в единицах отображения (для цветных полос графика). */
export function bandsByPollutant(
  scale: ScaleConfig | null,
  pollutantsById: Map<number, PollutantInfo>,
): Record<string, Band[]> {
  const out: Record<string, Band[]> = {};
  if (!scale) return out;
  for (const b of scale.breakpoints) {
    const p = pollutantsById.get(b.pollutantId);
    if (!p) continue;
    const list = out[p.code] ?? [];
    list.push({
      level: b.level,
      lo: displayValue(p, b.lo) ?? 0,
      hi: b.hi === null ? null : displayValue(p, b.hi),
    });
    out[p.code] = list;
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.level - b.level);
  return out;
}
