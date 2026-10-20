import { cn } from "@meteo/ui/lib/utils";
import { AQ_DOT_CLASS, type AqLevelValue } from "./aq-badge";

export interface LevelScaleProps {
  /** Текущий уровень (0 — нет данных: все сегменты приглушены). */
  level: AqLevelValue;
  /** Уровни шкалы по порядку (пять у оперативной, шесть у US AQI). */
  levels?: readonly number[];
  /** Доступное описание, например «Уровень 3 из 5 — умеренное». */
  label: string;
  className?: string;
}

/**
 * Пятисегментная шкала уровней: сегмент текущего уровня выделен (выше и ярче), остальные
 * приглушены. Смысл дублируется подписью (aria-label), цвет — не единственный носитель.
 */
export function LevelScale({ level, levels, label, className }: LevelScaleProps) {
  const shown = (levels?.length ? levels : [1, 2, 3, 4, 5]) as readonly AqLevelValue[];
  return (
    <div
      role="img"
      aria-label={label}
      className={cn("grid max-w-[26rem] items-end gap-1", className)}
      style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` }}
    >
      {shown.map((l) => {
        const on = l === level;
        return (
          <span
            key={l}
            className={cn(
              "block rounded-full transition-[height,opacity]",
              AQ_DOT_CLASS[l],
              on ? "h-3 opacity-100 ring-[3px] ring-card" : "h-2 opacity-35",
            )}
          />
        );
      })}
    </div>
  );
}
