/**
 * Контроль качества измерений (ТЗ, модуль 7): правило диапазона при вводе и
 * пакетные правила (скачки, «залипание», робастные выбросы) в worker.
 * Все функции чистые; решения оператора (qc_locked) учитываются на уровне сервиса.
 */
export const QC_FLAG = {
  raw: 0,
  valid: 1,
  suspect: 2,
  invalid: 3,
  corrected: 4,
  missing: 5,
} as const;
export type QcFlag = (typeof QC_FLAG)[keyof typeof QC_FLAG];

export const QC_REASON = {
  range: "range",
  spike: "spike",
  stuck: "stuck",
  outlier: "mad_outlier",
} as const;

export interface RangeRule {
  min: number;
  max: number;
}

export interface QcVerdict {
  flag: QcFlag;
  reason: string | null;
}

/** Проверяет значение по правилу диапазона: вне [min, max] → invalid, иначе valid. */
export function applyRangeRule(value: number | null, rule: RangeRule | undefined): QcVerdict {
  if (value === null || Number.isNaN(value)) return { flag: QC_FLAG.missing, reason: null };
  if (!rule) return { flag: QC_FLAG.valid, reason: null };
  if (value < rule.min || value > rule.max) {
    return { flag: QC_FLAG.invalid, reason: `${QC_REASON.range}:${rule.min}..${rule.max}` };
  }
  return { flag: QC_FLAG.valid, reason: null };
}

export interface QcSample {
  time: Date;
  value: number;
}

export function median(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
    : (sorted[mid] as number);
}

/** Медианное абсолютное отклонение (без нормирующего множителя). */
export function mad(values: number[], med = median(values)): number {
  if (values.length === 0) return Number.NaN;
  return median(values.map((v) => Math.abs(v - med)));
}

/** Нормирующий множитель MAD → σ для нормального распределения. */
export const MAD_TO_SIGMA = 1.4826;

export interface SpikeOptions {
  /** Порог: отклонение от медианы соседей больше k·MAD. */
  madMultiplier?: number;
  /** Минимум точек в ряду, чтобы правило применялось. */
  minSamples?: number;
}

/**
 * Скачки: точка отклоняется от медианы остальных точек ряда больше чем на k·MAD.
 * При MAD = 0 (ряд почти постоянный) используется 10 % медианы как минимальный разброс.
 */
export function detectSpikes(samples: QcSample[], options: SpikeOptions = {}): number[] {
  const k = options.madMultiplier ?? 6;
  const minSamples = options.minSamples ?? 6;
  if (samples.length < minSamples) return [];
  const flagged: number[] = [];
  samples.forEach((s, i) => {
    const others = samples.filter((_, j) => j !== i).map((o) => o.value);
    const med = median(others);
    const spread = Math.max(mad(others, med), Math.abs(med) * 0.1, 1e-9);
    if (Math.abs(s.value - med) > k * spread) flagged.push(i);
  });
  return flagged;
}

export interface StuckOptions {
  /** Длительность одинаковых значений подряд, часов. */
  hours?: number;
  minRun?: number;
}

/** «Залипание» датчика: одно и то же значение подряд не короче hours (только непрерывные станции). */
export function detectStuck(samples: QcSample[], options: StuckOptions = {}): number[] {
  const hours = options.hours ?? 12;
  const minRun = options.minRun ?? 3;
  const flagged: number[] = [];
  let runStart = 0;
  const sorted = samples
    .map((s, i) => ({ ...s, i }))
    .sort((a, b) => a.time.getTime() - b.time.getTime());
  for (let i = 1; i <= sorted.length; i++) {
    const prev = sorted[i - 1] as (typeof sorted)[number];
    const cur = sorted[i];
    const same = cur !== undefined && Math.abs(cur.value - prev.value) < 1e-9;
    if (!same) {
      const run = sorted.slice(runStart, i);
      const first = run[0];
      const last = run[run.length - 1];
      if (
        first &&
        last &&
        run.length >= minRun &&
        last.time.getTime() - first.time.getTime() >= hours * 3_600_000
      ) {
        for (const r of run) flagged.push(r.i);
      }
      runStart = i;
    }
  }
  return flagged.sort((a, b) => a - b);
}

export interface Baseline {
  median: number;
  mad: number;
  /** Сколько точек в базовом окне. */
  n: number;
}

export interface OutlierOptions {
  z?: number;
  /** Минимум точек в базовом окне. */
  minBaseline?: number;
}

/** Робастный выброс относительно 30‑дневной базы станции: |x − med| / (1.4826·MAD) > z. */
export function detectOutliers(
  samples: QcSample[],
  baseline: Baseline,
  options: OutlierOptions = {},
): number[] {
  const z = options.z ?? 5;
  const minBaseline = options.minBaseline ?? 30;
  if (baseline.n < minBaseline || !(baseline.mad > 0)) return [];
  const sigma = baseline.mad * MAD_TO_SIGMA;
  const flagged: number[] = [];
  samples.forEach((s, i) => {
    if (Math.abs(s.value - baseline.median) / sigma > z) flagged.push(i);
  });
  return flagged;
}
