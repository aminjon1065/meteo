import type { Locale } from "@meteo/i18n";
import { AQ_DOT_CLASS } from "@meteo/ui/components/aq-badge";
import { cn } from "@meteo/ui/lib/utils";
import { getFormatter, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { StationSummary } from "@/lib/city-air";
import { name } from "@/lib/format";

/**
 * Лента станций (макет 1): плитка с цветной полоской уровня слева, значение определяющего
 * вещества, слово уровня и время обновления; без данных — «нет данных с …».
 */
export async function StationFeed({
  stations,
  locale,
  className,
}: {
  stations: StationSummary[];
  locale: Locale;
  className?: string;
}) {
  const [t, tl, ts, format] = await Promise.all([
    getTranslations("station"),
    getTranslations("levels"),
    getTranslations("stations"),
    getFormatter(),
  ]);
  return (
    <ul
      className={cn("grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4", className)}
      data-testid="station-feed"
    >
      {stations.map((s) => {
        const fresh = s.idx && !s.idx.stale;
        return (
          <li key={s.id}>
            <Link
              href={`/air/stations/${s.slug}`}
              className="relative grid h-full gap-1.5 overflow-hidden rounded-xl border bg-card py-3 pr-3.5 pl-4 transition-colors hover:border-foreground/25"
            >
              <span
                className={cn("absolute inset-y-0 left-0 w-1.5", AQ_DOT_CLASS[s.level])}
                aria-hidden="true"
              />
              <span className="line-clamp-2 leading-tight font-semibold">
                {name(s.name, locale) || s.slug}
              </span>
              <span className="flex items-baseline justify-between gap-2">
                <b
                  className={cn(
                    "num font-heading text-[1.35rem] font-bold",
                    !fresh && "text-muted-foreground",
                  )}
                >
                  {fresh && s.dominantValue !== null
                    ? format.number(s.dominantValue, {
                        maximumFractionDigits: s.dominant?.decimals ?? 1,
                      })
                    : "—"}
                </b>
                {s.dominant ? (
                  <small className="text-caption text-muted-foreground">
                    {s.dominant.shortName}
                    {s.dominant.unit !== "µg/m³" ? `, ${s.dominant.unit}` : ""}
                  </small>
                ) : null}
              </span>
              <span className="text-caption text-muted-foreground">
                {fresh && s.idx
                  ? `${tl(`${s.level}` as "0")} · ${format.relativeTime(s.idx.time)}`
                  : s.status === "suspended"
                    ? ts("status.suspended")
                    : s.idx
                      ? t("noDataSince", {
                          date: format.dateTime(s.idx.time, { day: "numeric", month: "long" }),
                        })
                      : t("noDataYet")}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
