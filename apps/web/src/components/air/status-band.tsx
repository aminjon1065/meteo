import { AQ_TINT_CLASS, AqDot, type AqLevelValue } from "@meteo/ui/components/aq-badge";
import { LevelScale } from "@meteo/ui/components/level-scale";
import { cn } from "@meteo/ui/lib/utils";
import type { ReactNode } from "react";

export interface StatusChip {
  key: string;
  level: AqLevelValue;
  /** Отформатированное значение. */
  value: string;
  /** Короткое имя вещества (PM10, NO₂). */
  label: string;
  /** Единица, если отличается от основной (например «мг/м³» у CO). */
  unit?: string;
  /** Подсказка (полное название и пояснение). */
  title?: string;
}

export interface StatusBandProps {
  /** Надзаголовок: «Качество воздуха сейчас · Душанбе» или «Сейчас · 18:10». */
  eyebrow: ReactNode;
  /** Текущий уровень (0 — нет данных). */
  level: AqLevelValue;
  /** Слово уровня крупно: «Умеренное». */
  levelLabel: string;
  /** Подпись шкалы для скринридера: «Уровень 3 из 5». */
  scaleLabel: string;
  /** Уровни шкалы (пять или шесть). */
  scaleLevels?: readonly number[];
  /** Совет общей группы или пояснение. */
  advice?: ReactNode;
  chips?: StatusChip[];
  /** Мета‑строка: единицы, «обновлено», число станций, ссылка. */
  meta?: ReactNode;
  /** Правая колонка (погода, завтра, уведомление). */
  aside?: ReactNode;
  /** Компактный вариант (страница станции). */
  compact?: boolean;
  /** Если eyebrow — главный заголовок страницы. */
  as?: "h1" | "p";
  className?: string;
}

/**
 * Полоса состояния воздуха (макет 1): уровень словом крупно, пятисегментная шкала, совет,
 * фишки концентраций с точкой уровня, мета. Цвет уровня — лёгкая заливка всей полосы.
 */
export function StatusBand({
  eyebrow,
  level,
  levelLabel,
  scaleLabel,
  scaleLevels,
  advice,
  chips,
  meta,
  aside,
  compact,
  as = "p",
  className,
}: StatusBandProps) {
  const Eyebrow = as;
  return (
    <section
      className={cn("border-b", AQ_TINT_CLASS[level], className)}
      data-level={level}
      data-testid="status-band"
    >
      <div
        className={cn(
          "container-page grid items-start gap-5 lg:grid-cols-[1.4fr_1fr] lg:gap-8",
          compact ? "py-6" : "pt-8 pb-7 lg:pt-9",
        )}
      >
        <div className="min-w-0 @container">
          <Eyebrow className="eyebrow">{eyebrow}</Eyebrow>
          <p
            className="level-word mt-2 mb-3 font-heading leading-none font-extrabold tracking-[-0.02em]"
            style={
              {
                "--chars": levelLabel.length,
                "--level-max": compact ? "clamp(2rem, 4.5vw, 3rem)" : "clamp(2.4rem, 6vw, 4rem)",
              } as React.CSSProperties
            }
            data-testid="status-level"
          >
            {levelLabel}
          </p>
          <LevelScale level={level} levels={scaleLevels} label={scaleLabel} className="mb-4" />
          {advice ? (
            <div className="max-w-[46ch] text-[1.05rem] leading-relaxed text-pretty">{advice}</div>
          ) : null}
          {chips && chips.length > 0 ? (
            <ul className="mt-4 flex flex-wrap gap-2" aria-label={scaleLabel}>
              {chips.map((c) => (
                <li
                  key={c.key}
                  title={c.title}
                  className="inline-flex items-baseline gap-1.5 rounded-lg border bg-card px-2.5 py-1.5 text-sm"
                >
                  <AqDot level={c.level} className="self-center" />
                  <b className="num font-semibold">{c.value}</b>
                  <small className="text-caption text-muted-foreground">
                    {c.label}
                    {c.unit ? `, ${c.unit}` : ""}
                  </small>
                </li>
              ))}
            </ul>
          ) : null}
          {meta ? (
            <div className="mt-3.5 flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
              {meta}
            </div>
          ) : null}
        </div>
        {aside ? <div className="grid min-w-0 gap-3">{aside}</div> : null}
      </div>
    </section>
  );
}

/** Панель в правой колонке полосы состояния или в сетке секций. */
export function Panel({
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & { children: ReactNode }) {
  return (
    <div
      className={cn("rounded-xl border bg-card px-4 py-3.5 sm:px-[1.125rem]", className)}
      {...props}
    >
      {children}
    </div>
  );
}
