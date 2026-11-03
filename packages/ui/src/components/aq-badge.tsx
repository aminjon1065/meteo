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

/** Круг значка уровня (fill-aq-N) и цвет черт «лица» (text-aq-N-foreground — контраст ≥ 4.5:1). */
const AQ_ICON_FILL_CLASS: Record<AqLevelValue, string> = {
  0: "fill-aq-0",
  1: "fill-aq-1",
  2: "fill-aq-2",
  3: "fill-aq-3",
  4: "fill-aq-4",
  5: "fill-aq-5",
  6: "fill-aq-6",
};
const AQ_ICON_FG_CLASS: Record<AqLevelValue, string> = {
  0: "text-aq-0-foreground",
  1: "text-aq-1-foreground",
  2: "text-aq-2-foreground",
  3: "text-aq-3-foreground",
  4: "text-aq-4-foreground",
  5: "text-aq-5-foreground",
  6: "text-aq-6-foreground",
};

/** Глаза‑точки «лица» значка (сетка 20×20). */
const FACE_EYES =
  "M5.75 8.2a1.25 1.25 0 1 0 2.5 0a1.25 1.25 0 1 0-2.5 0M11.75 8.2a1.25 1.25 0 1 0 2.5 0a1.25 1.25 0 1 0-2.5 0";
const FACE_FROWN_DEEP = "M6.2 14.8Q10 10.9 13.8 14.8";

/**
 * Значки уровней — «лица» от улыбки к грусти (как у распространённых индексов качества воздуха):
 * форма различима без цвета (ТЗ FR1.3, WCAG 1.4.1). Сетка 20×20; `eyes` заливается, `stroke` —
 * линии толщиной 1,6. Общие для SVG в интерфейсе и картинок маркеров карты (Path2D).
 */
export const AQ_FACES: Record<AqLevelValue, { eyes: string | null; stroke: string }> = {
  // Нет данных: черта без лица.
  0: { eyes: null, stroke: "M6.5 10h7" },
  1: { eyes: FACE_EYES, stroke: "M5.8 11.5Q10 16.5 14.2 11.5" },
  2: { eyes: FACE_EYES, stroke: "M6.8 12.4Q10 14.8 13.2 12.4" },
  3: { eyes: FACE_EYES, stroke: "M6.8 13.1h6.4" },
  4: { eyes: FACE_EYES, stroke: "M6.8 14.2Q10 11.7 13.2 14.2" },
  // Очень плохое: глубокая грусть и брови «домиком».
  5: { eyes: FACE_EYES, stroke: `${FACE_FROWN_DEEP}M5.4 5.4L8.3 6.5M14.6 5.4L11.7 6.5` },
  // Опасное: глаза‑крестики.
  6: {
    eyes: null,
    stroke: `M5.9 6.9l2.4 2.4M8.3 6.9l-2.4 2.4M11.7 6.9l2.4 2.4M14.1 6.9l-2.4 2.4${FACE_FROWN_DEEP}`,
  },
};

/**
 * Значок уровня: круг цвета уровня с «лицом». Декоративен (aria-hidden) — смысл несёт подпись
 * рядом. `bare` — только черты текущим цветом текста (на сплошной заливке уровня).
 */
export function AqIcon({
  level,
  variant = "filled",
  className,
  ...props
}: { level: AqLevelValue; variant?: "filled" | "bare" } & Omit<ComponentProps<"svg">, "children">) {
  const face = AQ_FACES[level] ?? AQ_FACES[0];
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      focusable="false"
      data-aq-icon={level}
      className={cn(
        "inline-block size-4 shrink-0",
        variant === "filled" && AQ_ICON_FG_CLASS[level],
        className,
      )}
      {...props}
    >
      {variant === "filled" ? (
        <circle cx="10" cy="10" r="10" className={AQ_ICON_FILL_CLASS[level]} />
      ) : null}
      {face.eyes ? <path d={face.eyes} fill="currentColor" /> : null}
      <path
        d={face.stroke}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const iconSizeClasses = { sm: "size-3.5", md: "size-4", lg: "size-5" } as const;

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
 * Плашка уровня качества воздуха: значок уровня (цвет + «лицо») + подпись + (опционально) число
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
      <AqIcon
        level={level}
        variant={variant === "solid" ? "bare" : "filled"}
        className={iconSizeClasses[size]}
      />
      {value !== undefined ? <span className="num">{value}</span> : null}
      <span>{label}</span>
    </span>
  );
}
