import { AQ_LEVELS_FIVE, type AqLevel } from "@meteo/core";
import { AqBadge } from "@meteo/ui/components/aq-badge";
import { getTranslations } from "next-intl/server";

/**
 * Легенда уровней качества воздуха. По умолчанию — пять уровней основной шкалы; страницы, знающие
 * публичную шкалу, передают её уровни (шесть у US AQI).
 */
export async function LevelLegend({
  className,
  levels,
}: {
  className?: string;
  levels?: readonly number[];
}) {
  const [t, tc] = await Promise.all([getTranslations("levels"), getTranslations("common")]);
  const shown = (levels?.length ? levels : AQ_LEVELS_FIVE) as readonly AqLevel[];
  return (
    <ul className={className ?? "flex flex-wrap gap-2"} aria-label={tc("legend")}>
      {shown.map((level) => (
        <li key={level}>
          <AqBadge level={level} label={t(`${level}`)} size="sm" />
        </li>
      ))}
    </ul>
  );
}
