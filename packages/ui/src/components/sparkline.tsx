import { cn } from "@meteo/ui/lib/utils";

export interface SparklineProps {
  /** Значения по порядку времени; null — пропуск (линия прерывается). */
  values: Array<number | null>;
  /** Цвет линии (CSS), по умолчанию — currentColor. */
  stroke?: string;
  /** Нижняя/верхняя граница оси Y; по умолчанию — min/max данных с небольшим запасом. */
  min?: number;
  max?: number;
  className?: string;
  /** Текстовая альтернатива; пустая строка — декоративный рисунок. */
  label?: string;
}

const W = 120;
const H = 34;
const PAD = 2;

/** Мини‑график за сутки: одна линия без осей, подписи — в соседнем тексте (мин/макс). */
export function Sparkline({ values, stroke, min, max, className, label }: SparklineProps) {
  const nums = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (nums.length < 2) return null;
  const lo = min ?? Math.min(...nums);
  const hi = max ?? Math.max(...nums);
  const span = hi - lo || 1;
  const step = values.length > 1 ? (W - PAD * 2) / (values.length - 1) : 0;
  const y = (v: number) => H - PAD - ((v - lo) / span) * (H - PAD * 2);
  // Отрезки между соседними непустыми точками; пропуски разрывают линию.
  const segments: string[] = [];
  let current: string[] = [];
  values.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) {
      if (current.length > 1) segments.push(current.join(" "));
      current = [];
      return;
    }
    current.push(`${(PAD + i * step).toFixed(1)},${y(v).toFixed(1)}`);
  });
  if (current.length > 1) segments.push(current.join(" "));
  const last = [...values].reverse().findIndex((v) => v !== null && Number.isFinite(v));
  const lastIndex = last === -1 ? -1 : values.length - 1 - last;
  const lastValue = lastIndex >= 0 ? (values[lastIndex] as number) : null;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={cn("block h-9 w-full", className)}
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      style={{ color: stroke }}
    >
      {segments.map((points, i) => (
        <polyline
          key={`${i}-${points.length}`}
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {lastValue !== null ? (
        <circle
          cx={PAD + lastIndex * step}
          cy={y(lastValue)}
          r={2.5}
          fill="currentColor"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
    </svg>
  );
}
