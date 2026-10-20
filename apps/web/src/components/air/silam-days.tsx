import { clampAqLevel } from "@meteo/core";
import type { SilamDaySummary } from "@meteo/db";
import { AqBadge } from "@meteo/ui/components/aq-badge";
import { cn } from "@meteo/ui/lib/utils";
import { getFormatter, getTranslations } from "next-intl/server";
import { displayValue, type PollutantInfo } from "@/lib/aq";

/**
 * Прогноз SILAM по дням плитками (макет 2): день, плашка уровня, определяющее вещество и его
 * среднесуточная концентрация.
 */
export async function SilamDays({
  days,
  pollutantsById,
  todayKey,
  className,
}: {
  days: SilamDaySummary[];
  pollutantsById: Map<number, PollutantInfo>;
  todayKey: string;
  className?: string;
  /** Совместимость: прежний компактный режим — те же плитки. */
  compact?: boolean;
}) {
  const [t, tl, format] = await Promise.all([
    getTranslations("weather"),
    getTranslations("levels"),
    getFormatter(),
  ]);
  if (days.length === 0)
    return <p className="text-sm text-muted-foreground">{t("airForecastNone")}</p>;
  const tomorrowKey = new Date(Date.parse(`${todayKey}T00:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
  const dayLabel = (key: string) => {
    if (key === todayKey) return t("today");
    if (key === tomorrowKey) return t("tomorrow");
    return format.dateTime(new Date(`${key}T12:00:00+05:00`), { weekday: "long" });
  };
  return (
    <ul className={cn("flex flex-wrap gap-2", className)} data-testid="silam-days">
      {days.map((d) => {
        const level = clampAqLevel(d.level);
        const dominant = d.dominantPollutantId
          ? pollutantsById.get(d.dominantPollutantId)
          : undefined;
        const mean = dominant ? displayValue(dominant, d.means[String(dominant.id)]) : null;
        return (
          <li
            key={d.date}
            className="grid flex-1 basis-32 content-start gap-1 rounded-lg bg-surface-2 px-3 py-2.5"
          >
            <small className="text-caption text-muted-foreground capitalize">
              {dayLabel(d.date)}
            </small>
            <AqBadge level={level} label={tl(`${level}` as "0")} size="sm" className="w-fit" />
            {dominant && mean !== null ? (
              <small className="num text-caption text-muted-foreground">
                {dominant.shortName}{" "}
                {format.number(mean, { maximumFractionDigits: dominant.decimals })} {dominant.unit}
              </small>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
