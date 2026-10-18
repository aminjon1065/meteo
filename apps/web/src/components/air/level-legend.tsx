import { AQ_LEVELS } from "@meteo/core";
import { AqBadge } from "@meteo/ui/components/aq-badge";
import { getTranslations } from "next-intl/server";

/** Легенда пяти уровней качества воздуха. */
export async function LevelLegend({ className }: { className?: string }) {
  const [t, tc] = await Promise.all([getTranslations("levels"), getTranslations("common")]);
  return (
    <ul className={className ?? "flex flex-wrap gap-2"} aria-label={tc("legend")}>
      {AQ_LEVELS.map((level) => (
        <li key={level}>
          <AqBadge level={level} label={t(`${level}`)} size="sm" />
        </li>
      ))}
    </ul>
  );
}
