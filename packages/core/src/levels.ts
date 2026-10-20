/**
 * Уровни качества воздуха (ТЗ, модуль 1): основная шкала портала пятиуровневая, шестой уровень
 * («опасный») нужен шкалам с шестью категориями — US AQI (EPA). Сколько уровней показывать,
 * решает шкала (`index_scales.levels`); AQ_LEVELS — все допустимые значения.
 * Цвета дублируют CSS‑токены --aq-N из дизайн‑системы, чтобы их можно было
 * использовать вне DOM (карта MapLibre, письма, OG‑изображения, PNG‑слои SILAM).
 */
export const AQ_LEVELS = [1, 2, 3, 4, 5, 6] as const;
export type AqLevel = (typeof AQ_LEVELS)[number];
export type AqLevelOrNone = AqLevel | 0;
/** Уровни пятиуровневых шкал (оперативная, ВОЗ) — легенда по умолчанию. */
export const AQ_LEVELS_FIVE = [1, 2, 3, 4, 5] as const;
export const AQ_LEVEL_MAX: AqLevel = 6;

export interface AqLevelStyle {
  level: AqLevelOrNone;
  /** Цвет фона (hex). */
  color: string;
  /** Цвет текста поверх фона (hex), контраст ≥ 4.5:1 (WCAG AA): для серого и зелёного — тёмный текст. */
  foreground: string;
  /** Ключ сообщения в messages/*.json → levels.{key}. */
  key: `${AqLevelOrNone}`;
}

export const AQ_LEVEL_STYLES: Record<AqLevelOrNone, AqLevelStyle> = {
  0: { level: 0, color: "#9AA5B1", foreground: "#0F172A", key: "0" },
  1: { level: 1, color: "#2E9E5B", foreground: "#0F172A", key: "1" },
  2: { level: 2, color: "#E3B505", foreground: "#1F2937", key: "2" },
  3: { level: 3, color: "#F28C28", foreground: "#1F2937", key: "3" },
  4: { level: 4, color: "#D7263D", foreground: "#FFFFFF", key: "4" },
  5: { level: 5, color: "#7B2CBF", foreground: "#FFFFFF", key: "5" },
  6: { level: 6, color: "#7E0023", foreground: "#FFFFFF", key: "6" },
};

/** Уровень в допустимых границах: ≤ 0 → 0 (нет данных), > AQ_LEVEL_MAX → AQ_LEVEL_MAX. */
export function clampAqLevel(level: number): AqLevelOrNone {
  if (!Number.isFinite(level) || level <= 0) return 0;
  return Math.min(AQ_LEVEL_MAX, Math.max(1, Math.round(level))) as AqLevel;
}

export function isAqLevel(value: unknown): value is AqLevel {
  return typeof value === "number" && (AQ_LEVELS as readonly number[]).includes(value);
}

/**
 * Коды загрязнителей seed (ТЗ + вещества ежедневных бюллетеней Агентства). Совпадают с
 * pollutants.code в БД; справочник расширяем — код в этом списке не обязателен для ввода,
 * импорта и приёма данных: они проверяют вещество по таблице pollutants.
 */
export const POLLUTANT_CODES = [
  "PM25",
  "PM10",
  "NO2",
  "SO2",
  "CO",
  "O3",
  "NO",
  "CH2O",
  "C6H5OH",
  "HF",
  "TSP",
  "CO2",
  "TVOC",
] as const;
export type PollutantCode = (typeof POLLUTANT_CODES)[number];
