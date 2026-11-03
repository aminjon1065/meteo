/**
 * Периоды и агрегации рядов измерений станции — общие для API (lib/api/measurement-series.ts)
 * и графика на странице станции (components/air/measurement-chart.tsx).
 */
export const RANGES = ["24h", "7d", "30d", "1y", "all"] as const;
export type Range = (typeof RANGES)[number];

export const AGGREGATIONS = ["hour", "day", "month"] as const;
export type Aggregation = (typeof AGGREGATIONS)[number];

/** Допустимые агрегации периода (первая — по умолчанию): не больше ~1–4 тыс. точек на вещество. */
export const RANGE_AGGREGATIONS: Record<Range, readonly Aggregation[]> = {
  "24h": ["hour"],
  "7d": ["hour", "day"],
  "30d": ["day", "hour"],
  "1y": ["day", "month"],
  all: ["month", "day"],
};

/** Исходные значения с флагами QC — только CSV и не длиннее 30 суток. */
export const RAW_RANGES: readonly Range[] = ["24h", "7d", "30d"];

export function isRange(v: unknown): v is Range {
  return typeof v === "string" && (RANGES as readonly string[]).includes(v);
}

export function isAggregation(v: unknown): v is Aggregation {
  return typeof v === "string" && (AGGREGATIONS as readonly string[]).includes(v);
}

/** Агрегация по умолчанию для периода. */
export function aggregationFor(range: Range): Aggregation {
  return RANGE_AGGREGATIONS[range][0] as Aggregation;
}

export function allowedAggregation(range: Range, aggregation: Aggregation): boolean {
  return RANGE_AGGREGATIONS[range].includes(aggregation);
}
