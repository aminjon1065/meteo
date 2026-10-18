import type { Locale } from "@meteo/i18n";
import { getTranslations } from "next-intl/server";
import { StationMapLazy } from "@/components/map/station-map.lazy";

/** Серверная обёртка: передаёт локализованные подписи в клиентскую карту. */
export async function StationMapSection({
  locale,
  className,
  compact,
  center,
  zoom,
  boundaries = true,
}: {
  locale: Locale;
  className?: string;
  compact?: boolean;
  center?: [number, number];
  zoom?: number;
  /** Контуры областей и районов (FR6.3); по умолчанию включены. */
  boundaries?: boolean;
}) {
  const [tm, ts] = await Promise.all([getTranslations("map"), getTranslations("stations")]);
  const localePrefix = locale === "tg" ? "" : `/${locale}`;
  const prefix = `${localePrefix}/air/stations`;
  return (
    <StationMapLazy
      locale={locale}
      boundaries={
        boundaries
          ? {
              regionsUrl: "/api/v1/regions",
              districtsUrl: "/api/v1/districts",
              visible: true,
              fill: false,
              href: `${localePrefix}/air`,
              labels: { stations: tm("regionStations"), open: tm("regionOpen") },
            }
          : null
      }
      openLabel={tm("open")}
      statusLabels={{
        active: ts("status.active"),
        suspended: ts("status.suspended"),
        decommissioned: ts("status.decommissioned"),
      }}
      stationHrefPrefix={prefix}
      ariaLabel={`${tm("title")}: ${tm("stations")}`}
      unsupportedLabel={tm("webglUnsupported")}
      className={className}
      compact={compact}
      center={center}
      zoom={zoom}
    />
  );
}
