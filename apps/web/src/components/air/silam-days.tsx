import type { SilamDaySummary } from "@meteo/db";
import { AqBadge } from "@meteo/ui/components/aq-badge";
import { getFormatter, getTranslations } from "next-intl/server";
import type { PollutantInfo } from "@/lib/aq";

/** Суточная сводка SILAM: день, уровень, определяющее вещество и его среднесуточная концентрация. */
export async function SilamDays({
  days,
  pollutantsById,
  todayKey,
  compact,
}: {
  days: SilamDaySummary[];
  pollutantsById: Map<number, PollutantInfo>;
  todayKey: string;
  compact?: boolean;
}) {
  const [t, tl, tp, format] = await Promise.all([
    getTranslations("weather"),
    getTranslations("levels"),
    getTranslations("pollutants"),
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
    return format.dateTime(new Date(`${key}T12:00:00+05:00`), {
      weekday: "long",
      day: "numeric",
      month: "short",
    });
  };
  return (
    <ul className={compact ? "flex flex-col gap-1.5" : "flex flex-col gap-2"}>
      {days.map((d) => {
        const level = Math.min(5, Math.max(0, d.level)) as 0 | 1 | 2 | 3 | 4 | 5;
        const dominant = d.dominantPollutantId
          ? pollutantsById.get(d.dominantPollutantId)
          : undefined;
        const mean = dominant ? d.means[String(dominant.id)] : undefined;
        return (
          <li key={d.date} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-medium capitalize">{dayLabel(d.date)}</span>
            <span className="flex items-center gap-2">
              {dominant && mean !== undefined ? (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {t("dominant", {
                    pollutant: tp.has(dominant.code as "PM25")
                      ? tp(dominant.code as "PM25")
                      : dominant.shortName,
                  })}{" "}
                  {format.number(mean, { maximumFractionDigits: dominant.decimals })}{" "}
                  {dominant.unit}
                </span>
              ) : null}
              <AqBadge level={level} label={tl(`${level}` as "0")} size="sm" />
            </span>
          </li>
        );
      })}
    </ul>
  );
}
