import { cn } from "@meteo/ui/lib/utils";
import type { ComponentProps } from "react";

export type AqLevelValue = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Цвет точки/полоски уровня (bg-aq-N). */
export const AQ_DOT_CLASS: Record<AqLevelValue, string> = {
  0: "bg-aq-0",
  1: "bg-aq-1",
  2: "bg-aq-2",
  3: "bg-aq-3",
  4: "bg-aq-4",
  5: "bg-aq-5",
  6: "bg-aq-6",
};

/** Лёгкая заливка уровня (bg-aq-N-tint) — для полос состояния, плашек, фонов графика. */
export const AQ_TINT_CLASS: Record<AqLevelValue, string> = {
  0: "bg-aq-0-tint",
  1: "bg-aq-1-tint",
  2: "bg-aq-2-tint",
  3: "bg-aq-3-tint",
  4: "bg-aq-4-tint",
  5: "bg-aq-5-tint",
  6: "bg-aq-6-tint",
};

/** Сплошной цвет уровня с контрастным текстом (легенды карты, письма). */
export const AQ_SOLID_CLASS: Record<AqLevelValue, string> = {
  0: "bg-aq-0 text-aq-0-foreground",
  1: "bg-aq-1 text-aq-1-foreground",
  2: "bg-aq-2 text-aq-2-foreground",
  3: "bg-aq-3 text-aq-3-foreground",
  4: "bg-aq-4 text-aq-4-foreground",
  5: "bg-aq-5 text-aq-5-foreground",
  6: "bg-aq-6 text-aq-6-foreground",
};

const sizeClasses = {
  sm: "h-6 px-2.5 text-xs gap-1.5",
  md: "h-7 px-3 text-sm gap-2",
  lg: "h-9 px-4 text-base gap-2",
} as const;

/** Цветная точка уровня: декоративна, смысл несёт подпись рядом. */
export function AqDot({
  level,
  className,
  ...props
}: { level: AqLevelValue } & Omit<ComponentProps<"span">, "children">) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block size-2 shrink-0 rounded-full", AQ_DOT_CLASS[level], className)}
      {...props}
    />
  );
}

export interface AqBadgeProps extends Omit<ComponentProps<"span">, "children"> {
  /** Уровень 1–6 (6 — «опасный» у шестиуровневых шкал, например US AQI); 0 — нет данных. */
  level: AqLevelValue;
  /** Локализованная подпись уровня (обязательна: цвет не единственный носитель смысла). */
  label: string;
  /** Числовое значение индекса или концентрации (опционально). */
  value?: string | number;
  size?: keyof typeof sizeClasses;
  /** tint — плашка на лёгкой заливке с точкой уровня (по умолчанию); solid — сплошной цвет. */
  variant?: "tint" | "solid";
}

/**
 * Плашка уровня качества воздуха: точка цвета уровня + подпись + (опционально) число
 * на лёгкой заливке того же уровня. Текст виден всегда, поэтому отдельная aria-подпись не нужна.
 */
export function AqBadge({
  level,
  label,
  value,
  size = "md",
  variant = "tint",
  className,
  ...props
}: AqBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full font-semibold leading-none whitespace-nowrap",
        variant === "solid" ? AQ_SOLID_CLASS[level] : cn(AQ_TINT_CLASS[level], "text-foreground"),
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      {variant === "tint" ? (
        <AqDot level={level} className={size === "lg" ? "size-2.5" : undefined} />
      ) : null}
      {value !== undefined ? <span className="num">{value}</span> : null}
      <span>{label}</span>
    </span>
  );
}
