import { AQ_LEVELS_FIVE, type AqLevel } from "@meteo/core";
import { AqDot } from "@meteo/ui/components/aq-badge";
import { cn } from "@meteo/ui/lib/utils";
import { getTranslations } from "next-intl/server";

/**
 * Легенда уровней качества воздуха: точка цвета + подпись. По умолчанию — пять уровней основной
 * шкалы; страницы, знающие публичную шкалу, передают её уровни (шесть у US AQI).
 */
export async function LevelLegend({
  className,
  levels,
  variant = "plain",
}: {
  className?: string;
  levels?: readonly number[];
  /** plain — точки с текстом в строку; chips — фишки на поверхности (поверх карты). */
  variant?: "plain" | "chips";
}) {
  const [t, tc] = await Promise.all([getTranslations("levels"), getTranslations("common")]);
  const shown = (levels?.length ? levels : AQ_LEVELS_FIVE) as readonly AqLevel[];
  return (
    <ul className={cn("flex flex-wrap gap-x-4 gap-y-1.5", className)} aria-label={tc("legend")}>
      {shown.map((level) => (
        <li
          key={level}
          className={cn(
            "inline-flex items-center gap-1.5 text-sm",
            variant === "chips" &&
              "rounded-full border bg-card/95 px-2.5 py-1 text-caption font-medium backdrop-blur",
          )}
        >
          <AqDot level={level} />
          {t(`${level}`)}
        </li>
      ))}
    </ul>
  );
}
