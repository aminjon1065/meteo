import { AQ_LEVELS_FIVE, type AqLevel } from "@meteo/core";
import type { Locale } from "@meteo/i18n";
import { AqDot } from "@meteo/ui/components/aq-badge";
import { cn } from "@meteo/ui/lib/utils";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { StationMapSection } from "./station-map-section";

/**
 * Карта станций с легендой уровней на самой карте и переключателями слоёв‑ссылками
 * на полную карту (макет 1). Светлая подложка в обеих темах — basemap.ts.
 */
export async function MapPanel({
  locale,
  levels,
  className,
  height = "h-[340px]",
  layers = true,
}: {
  locale: Locale;
  levels?: readonly number[];
  className?: string;
  height?: string;
  /** Показывать фишки слоёв (ссылки на /map с нужным слоем). */
  layers?: boolean;
}) {
  const [t, tl, tm] = await Promise.all([
    getTranslations("levels"),
    getTranslations("common"),
    getTranslations("map"),
  ]);
  const shown = (levels?.length ? levels : AQ_LEVELS_FIVE) as readonly AqLevel[];
  const chip =
    "inline-flex items-center gap-1.5 rounded-full border bg-card/95 px-2.5 py-1 text-caption font-medium text-foreground backdrop-blur";
  return (
    <div
      className={cn("relative overflow-hidden rounded-xl border bg-surface-2", height, className)}
    >
      <StationMapSection locale={locale} className="h-full w-full" compact />
      {layers ? (
        <div className="pointer-events-none absolute top-3 left-3 z-10 flex flex-wrap gap-1.5">
          <span className={cn(chip, "border-primary bg-primary text-primary-foreground")}>
            {tm("stations")}
          </span>
          <Link
            href={{ pathname: "/map", query: { layer: "silam" } }}
            className={cn(chip, "pointer-events-auto hover:bg-muted")}
          >
            {tm("silam")}
          </Link>
          <Link
            href={{ pathname: "/map", query: { layer: "warnings" } }}
            className={cn(chip, "pointer-events-auto hover:bg-muted")}
          >
            {tm("warnings")}
          </Link>
        </div>
      ) : null}
      <ul
        className="pointer-events-none absolute bottom-3 left-3 z-10 flex max-w-[calc(100%-5rem)] flex-wrap gap-1.5"
        aria-label={tl("legend")}
      >
        {shown.map((level) => (
          <li key={level} className={chip}>
            <AqDot level={level} />
            {t(`${level}`)}
          </li>
        ))}
      </ul>
    </div>
  );
}
