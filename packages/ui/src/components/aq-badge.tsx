import { cn } from "@meteo/ui/lib/utils";
import type { ComponentProps } from "react";

export type AqLevelValue = 0 | 1 | 2 | 3 | 4 | 5;

const levelClasses: Record<AqLevelValue, string> = {
  0: "bg-aq-0 text-aq-0-foreground",
  1: "bg-aq-1 text-aq-1-foreground",
  2: "bg-aq-2 text-aq-2-foreground",
  3: "bg-aq-3 text-aq-3-foreground",
  4: "bg-aq-4 text-aq-4-foreground",
  5: "bg-aq-5 text-aq-5-foreground",
};

const sizeClasses = {
  sm: "h-6 px-2 text-xs gap-1",
  md: "h-8 px-3 text-sm gap-1.5",
  lg: "h-11 px-4 text-base gap-2 font-medium",
} as const;

export interface AqBadgeProps extends Omit<ComponentProps<"span">, "children"> {
  /** Уровень 1–5; 0 — нет данных. */
  level: AqLevelValue;
  /** Локализованная подпись уровня (обязательна: цвет не единственный носитель смысла). */
  label: string;
  /** Числовое значение индекса или концентрации (опционально). */
  value?: string | number;
  size?: keyof typeof sizeClasses;
}

/**
 * Бейдж уровня качества воздуха: цвет + подпись + (опционально) число.
 * Текст виден всегда, поэтому отдельная aria-подпись не нужна.
 */
export function AqBadge({ level, label, value, size = "md", className, ...props }: AqBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full font-medium leading-none",
        levelClasses[level],
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      {value !== undefined ? <span className="font-semibold">{value}</span> : null}
      <span>{label}</span>
    </span>
  );
}
