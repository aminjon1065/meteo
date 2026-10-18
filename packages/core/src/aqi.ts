/**
 * Движок индекса качества воздуха (ADR‑009). Чистые функции, табличные входы.
 *
 * Три стратегии:
 *  - breakpoints     — уровни 1–5 по интервалам [lo, hi) концентрации для каждого вещества;
 *                      индекс станции = худший под‑индекс (как в индексе FMI/HSY);
 *  - ratio_to_limit  — кратность ПДК: max(q_i / ПДК_i), уровень по интервалам кратности;
 *  - iza             — комплексный ИЗА по РД 52.04.186‑89: Σ (q̄_i / ПДКсс_i)^C_i по среднемесячным.
 */
import type { AqLevel, AqLevelOrNone } from "./levels";

export type ScaleKind = "breakpoints" | "ratio_to_limit" | "iza";

export interface BreakpointRow {
  pollutantId: number;
  level: number;
  lo: number;
  /** null — открытый интервал (последний уровень). */
  hi: number | null;
  averagingMin: number;
}

export interface LevelBand {
  level: number;
  lo?: number;
  hi?: number | null;
}

export interface PollutantValue {
  pollutantId: number;
  value: number | null;
}

export interface SubIndex {
  /** Концентрация, по которой считали (в единице вещества). */
  value: number;
  /** Уровень 1–5 (0 — не удалось определить). */
  level: AqLevelOrNone;
  /** Непрерывный индекс: уровень + доля внутри интервала (1.0 … 5.99). */
  index: number;
}

export interface StationIndexResult {
  /** Непрерывное значение индекса станции (для сортировки/графиков) или null при отсутствии данных. */
  value: number | null;
  level: AqLevelOrNone;
  dominantPollutantId: number | null;
  subIndices: Record<string, SubIndex>;
}

const EMPTY: StationIndexResult = {
  value: null,
  level: 0,
  dominantPollutantId: null,
  subIndices: {},
};

function clampLevel(level: number): AqLevelOrNone {
  if (level <= 0) return 0;
  return Math.min(5, Math.max(1, Math.round(level))) as AqLevel;
}

/**
 * Уровень и непрерывный индекс по интервалам одного вещества.
 * Интервалы полуоткрытые: [lo, hi); значение ровно на границе попадает в следующий уровень.
 */
export function subIndexForValue(value: number, rows: BreakpointRow[]): SubIndex | null {
  if (!Number.isFinite(value) || rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => a.level - b.level);
  for (const row of sorted) {
    const inBand = value >= row.lo && (row.hi === null || value < row.hi);
    if (!inBand) continue;
    const span = row.hi === null ? Math.max(row.lo, 1) : row.hi - row.lo;
    const fraction = span > 0 ? Math.min(0.99, Math.max(0, (value - row.lo) / span)) : 0;
    return { value, level: clampLevel(row.level), index: round2(row.level + fraction) };
  }
  // Ниже самого первого интервала (отрицательные/нулевые границы) — первый уровень; выше последнего закрытого — последний.
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first && value < first.lo)
    return { value, level: clampLevel(first.level), index: first.level };
  if (last) return { value, level: clampLevel(last.level), index: round2(last.level + 0.99) };
  return null;
}

/** Индекс станции по интервальной шкале: худший под‑индекс, доминирующее вещество — по непрерывному индексу. */
export function computeBreakpointIndex(
  values: PollutantValue[],
  breakpoints: BreakpointRow[],
): StationIndexResult {
  const byPollutant = new Map<number, BreakpointRow[]>();
  for (const row of breakpoints) {
    const list = byPollutant.get(row.pollutantId) ?? [];
    list.push(row);
    byPollutant.set(row.pollutantId, list);
  }
  const subIndices: Record<string, SubIndex> = {};
  let worst: { pollutantId: number; sub: SubIndex } | null = null;
  for (const { pollutantId, value } of values) {
    if (value === null) continue;
    const rows = byPollutant.get(pollutantId);
    if (!rows) continue;
    const sub = subIndexForValue(value, rows);
    if (!sub) continue;
    subIndices[String(pollutantId)] = sub;
    if (!worst || sub.index > worst.sub.index) worst = { pollutantId, sub };
  }
  if (!worst) return EMPTY;
  return {
    value: worst.sub.index,
    level: worst.sub.level,
    dominantPollutantId: worst.pollutantId,
    subIndices,
  };
}

export interface LimitRow {
  pollutantId: number;
  /** ПДК (в единице вещества), обычно среднесуточная. */
  limit: number;
  /** Класс опасности 1–4 (для ИЗА). */
  hazardClass?: number | null;
}

/** Уровень по интервалам итогового значения (кратность ПДК, ИЗА). */
export function levelForBands(value: number, bands: LevelBand[]): AqLevelOrNone {
  const sorted = [...bands].sort((a, b) => (a.lo ?? 0) - (b.lo ?? 0));
  let matched: number | null = null;
  for (const band of sorted) {
    const lo = band.lo ?? 0;
    const hi = band.hi ?? null;
    if (value >= lo && (hi === null || hi === undefined || value < hi)) {
      matched = band.level;
      break;
    }
  }
  if (matched === null) {
    const last = sorted[sorted.length - 1];
    matched = last ? last.level : 0;
  }
  return clampLevel(matched);
}

/** Кратность ПДК: под‑индекс = q / ПДК; индекс станции = максимум; уровни — по bands шкалы. */
export function computeRatioIndex(
  values: PollutantValue[],
  limits: LimitRow[],
  bands: LevelBand[],
): StationIndexResult {
  const limitBy = new Map(limits.map((l) => [l.pollutantId, l.limit]));
  const subIndices: Record<string, SubIndex> = {};
  let worst: { pollutantId: number; ratio: number } | null = null;
  for (const { pollutantId, value } of values) {
    if (value === null) continue;
    const limit = limitBy.get(pollutantId);
    if (!limit || limit <= 0) continue;
    const ratio = round2(value / limit);
    subIndices[String(pollutantId)] = { value, level: levelForBands(ratio, bands), index: ratio };
    if (!worst || ratio > worst.ratio) worst = { pollutantId, ratio };
  }
  if (!worst) return EMPTY;
  return {
    value: worst.ratio,
    level: levelForBands(worst.ratio, bands),
    dominantPollutantId: worst.pollutantId,
    subIndices,
  };
}

/** Показатель степени по классу опасности (РД 52.04.186‑89). */
export const IZA_EXPONENT: Record<number, number> = { 1: 1.7, 2: 1.3, 3: 1.0, 4: 0.9 };

export interface IzaResult extends StationIndexResult {
  /** Вклад каждого вещества: (q̄/ПДК)^C. */
  contributions: Record<string, number>;
  /** Сколько веществ учтено (ИЗА5 — пять наибольших). */
  pollutantsUsed: number;
}

/**
 * Комплексный ИЗА по среднемесячным концентрациям. По умолчанию учитываются
 * пять наибольших вкладов (ИЗА5); при меньшем числе веществ — все доступные.
 */
export function computeIza(
  means: PollutantValue[],
  limits: LimitRow[],
  bands: LevelBand[],
  top = 5,
): IzaResult {
  const limitBy = new Map(limits.map((l) => [l.pollutantId, l]));
  const contributions: Array<{ pollutantId: number; value: number; c: number }> = [];
  for (const { pollutantId, value } of means) {
    if (value === null) continue;
    const limit = limitBy.get(pollutantId);
    if (!limit || limit.limit <= 0) continue;
    const exponent = IZA_EXPONENT[limit.hazardClass ?? 3] ?? 1.0;
    contributions.push({ pollutantId, value, c: (value / limit.limit) ** exponent });
  }
  if (contributions.length === 0) return { ...EMPTY, contributions: {}, pollutantsUsed: 0 };
  contributions.sort((a, b) => b.c - a.c);
  const used = contributions.slice(0, top);
  const total = round2(used.reduce((s, x) => s + x.c, 0));
  const level = levelForBands(total, bands);
  const dominant = used[0] ?? null;
  const subIndices: Record<string, SubIndex> = {};
  const contribMap: Record<string, number> = {};
  for (const u of used) {
    subIndices[String(u.pollutantId)] = { value: u.value, level, index: round2(u.c) };
    contribMap[String(u.pollutantId)] = round2(u.c);
  }
  return {
    value: total,
    level,
    dominantPollutantId: dominant ? dominant.pollutantId : null,
    subIndices,
    contributions: contribMap,
    pollutantsUsed: used.length,
  };
}

/** Скользящее среднее по часовым значениям: окно windowMin, минимальная полнота coverage (доля часов с данными). */
export function windowMean(
  hourly: Array<{ time: Date; value: number }>,
  end: Date,
  windowMin: number,
  coverage = 0.25,
): number | null {
  const start = end.getTime() - windowMin * 60_000;
  const inWindow = hourly.filter(
    (h) => h.time.getTime() > start && h.time.getTime() <= end.getTime(),
  );
  const needed = Math.max(1, Math.ceil((windowMin / 60) * coverage));
  if (inWindow.length < needed) return null;
  return inWindow.reduce((s, h) => s + h.value, 0) / inWindow.length;
}

function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}
