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
}: {
  locale: Locale;
  className?: string;
  compact?: boolean;
  center?: [number, number];
  zoom?: number;
}) {
  const [tm, ts] = await Promise.all([getTranslations("map"), getTranslations("stations")]);
  const prefix = locale === "tg" ? "/air/stations" : `/${locale}/air/stations`;
  return (
    <StationMapLazy
      locale={locale}
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
