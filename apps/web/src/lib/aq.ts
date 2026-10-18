import "server-only";
import { AQ_LEVEL_STYLES, type AqLevelOrNone } from "@meteo/core";
import { and, asc, type CurrentIndex, eq, getCurrentIndexes, type ScaleConfig } from "@meteo/db";
import { healthAdvice, pollutants } from "@meteo/db/schema";
import type { I18nText } from "@meteo/i18n";
import { getDb } from "@/lib/db";

export interface PollutantInfo {
  id: number;
  code: string;
  shortName: string;
  unit: string;
  decimals: number;
}

export interface CurrentAq {
  scale: ScaleConfig | null;
  byStation: Map<number, CurrentIndex>;
  pollutantsById: Map<number, PollutantInfo>;
}

/** Текущий индекс станций по публичной шкале + справочник веществ. */
export async function loadCurrentAq(stationIds?: number[]): Promise<CurrentAq> {
  const db = getDb();
  const [{ scale, byStation }, pollutantRows] = await Promise.all([
    getCurrentIndexes(db, { stationIds }),
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
  ]);
  return { scale, byStation, pollutantsById: new Map(pollutantRows.map((p) => [p.id, p])) };
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

/** Пороги шкалы по веществам (для цветных полос графика). */
export function bandsByPollutant(
  scale: ScaleConfig | null,
  pollutantsById: Map<number, PollutantInfo>,
): Record<string, Band[]> {
  const out: Record<string, Band[]> = {};
  if (!scale) return out;
  for (const b of scale.breakpoints) {
    const code = pollutantsById.get(b.pollutantId)?.code;
    if (!code) continue;
    const list = out[code] ?? [];
    list.push({ level: b.level, lo: b.lo, hi: b.hi });
    out[code] = list;
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.level - b.level);
  return out;
}
