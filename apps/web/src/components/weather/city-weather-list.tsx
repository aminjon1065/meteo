import type { AqLevelOrNone } from "@meteo/core";
import type { Locale } from "@meteo/i18n";
import { AqBadge } from "@meteo/ui/components/aq-badge";
import { cn } from "@meteo/ui/lib/utils";
import { getFormatter, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { name } from "@/lib/format";
import { type LocationOverview, symbolLabel, windDirectionKey } from "@/lib/weather";
import { hasSymbol, WeatherSymbol } from "./weather-symbol";

export interface CityWeatherRow {
  overview: LocationOverview;
  /** Уровень воздуха в городе (0 — нет станций или данных). */
  airLevel: AqLevelOrNone;
  /** Выделить строку (выбранный город). */
  selected?: boolean;
}

/** Погода по городам списком (макет 1): название и описание, температура, плашка «воздух». */
export async function CityWeatherList({
  rows,
  locale,
  className,
}: {
  rows: CityWeatherRow[];
  locale: Locale;
  className?: string;
}) {
  const [t, ts, tl, th, format] = await Promise.all([
    getTranslations("weather"),
    getTranslations("weatherSymbols"),
    getTranslations("levels"),
    getTranslations("home"),
    getFormatter(),
  ]);
  const deg = (v: number | null | undefined) =>
    v === null || v === undefined ? "—" : `${format.number(v, { maximumFractionDigits: 0 })}°`;
  return (
    <ul className={cn("grid", className)} data-testid="city-weather">
      {rows.map(({ overview: o, airLevel, selected }) => {
        const code = o.now?.params.symbol ?? o.today?.symbol ?? null;
        const ws = o.now?.params.ws ?? null;
        const wd = o.now?.params.wd ?? null;
        const parts = [
          code !== null ? symbolLabel(ts, code).toLowerCase() : null,
          ws === null
            ? null
            : ws < 0.5
              ? t("calm")
              : `${t("windShort", { value: format.number(ws, { maximumFractionDigits: 0 }) })}${
                  wd !== null ? ` ${t(`windDirections.${windDirectionKey(wd)}`)}` : ""
                }`,
        ].filter(Boolean);
        return (
          <li
            key={o.location.id}
            className={cn(
              "grid grid-cols-[1fr_auto_auto] items-center gap-3.5 border-b py-2.5 last:border-b-0",
              selected && "font-semibold",
            )}
          >
            <Link href={`/weather/${o.location.slug}`} className="min-w-0 hover:underline">
              <span className="block truncate">
                {name(o.location.name, locale) || o.location.slug}
              </span>
              <small className="block truncate text-caption font-normal text-muted-foreground">
                {parts.length ? parts.join(", ") : t("noForecastShort")}
              </small>
            </Link>
            <span className="flex items-center gap-2">
              {hasSymbol(code) ? (
                <WeatherSymbol code={code} label={symbolLabel(ts, code)} className="size-7" />
              ) : null}
              <b className="num font-heading text-[1.1rem] font-bold">{deg(o.now?.params.t)}</b>
            </span>
            <AqBadge
              level={airLevel}
              label={airLevel > 0 ? th("airLabel") : tl("0")}
              size="sm"
              title={airLevel > 0 ? tl(`${airLevel}` as "0") : undefined}
              className="justify-self-end"
            />
          </li>
        );
      })}
    </ul>
  );
}
