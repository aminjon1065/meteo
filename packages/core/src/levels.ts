/**
 * Пятиуровневая шкала качества воздуха (ТЗ, модуль 1).
 * Цвета дублируют CSS‑токены --aq-N из дизайн‑системы, чтобы их можно было
 * использовать вне DOM (карта MapLibre, письма, OG‑изображения, PNG‑слои SILAM).
 */
export const AQ_LEVELS = [1, 2, 3, 4, 5] as const;
export type AqLevel = (typeof AQ_LEVELS)[number];
export type AqLevelOrNone = AqLevel | 0;

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
};

export function isAqLevel(value: unknown): value is AqLevel {
  return typeof value === "number" && (AQ_LEVELS as readonly number[]).includes(value);
}

/** Коды загрязнителей из ТЗ. Совпадают с pollutants.code в БД. */
export const POLLUTANT_CODES = ["PM25", "PM10", "NO2", "SO2", "CO", "O3"] as const;
export type PollutantCode = (typeof POLLUTANT_CODES)[number];
