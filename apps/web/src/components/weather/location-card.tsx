import { Card, CardContent, CardHeader, CardTitle } from "@meteo/ui/components/card";
import { DropletsIcon, MapPinIcon, WindIcon } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { name } from "@/lib/format";
import { type LocationOverview, symbolLabel, windDirectionKey } from "@/lib/weather";
import { WeatherSymbol } from "./weather-symbol";

/** Карточка города: символ, температура сейчас, макс/мин за сутки, ветер. */
export async function LocationCard({
  overview,
  locale,
}: {
  overview: LocationOverview;
  locale: string;
}) {
  const [t, ts, format] = await Promise.all([
    getTranslations("weather"),
    getTranslations("weatherSymbols"),
    getFormatter(),
  ]);
  const { location, now, today } = overview;
  const code = now?.params.symbol ?? today?.symbol ?? null;
  const label = symbolLabel(ts, code);
  const temp = now?.params.t ?? null;
  const ws = now?.params.ws ?? null;
  const wd = now?.params.wd ?? null;
  const n = (v: number | null | undefined, digits = 0) =>
    v === null || v === undefined ? "—" : format.number(v, { maximumFractionDigits: digits });

  return (
    <Card className="transition-colors hover:bg-accent/40">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-start justify-between gap-2 text-base">
          <span className="flex flex-col">
            <Link href={`/weather/${location.slug}`} className="hover:underline">
              {name(location.name, locale) || location.slug}
            </Link>
            <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
              <MapPinIcon className="size-3" aria-hidden="true" />
              {name(location.regionName, locale) || "—"}
            </span>
          </span>
          <WeatherSymbol code={code} label={label} className="size-12" />
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="flex items-baseline gap-3">
          <span className="text-4xl font-semibold tabular-nums">
            {temp === null ? "—" : `${n(temp)}°`}
          </span>
          {today ? (
            <span className="text-sm text-muted-foreground tabular-nums">
              {n(today.tmax)}° / {n(today.tmin)}°
            </span>
          ) : null}
        </div>
        {code !== null ? <p className="text-sm text-muted-foreground">{label}</p> : null}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <WindIcon className="size-3.5" aria-hidden="true" />
            {ws === null
              ? "—"
              : ws < 0.5
                ? t("calm")
                : `${n(ws, 1)} ${t("ms")}${wd !== null ? ` · ${t(`windDirections.${windDirectionKey(wd)}`)}` : ""}`}
          </span>
          <span className="inline-flex items-center gap-1">
            <DropletsIcon className="size-3.5" aria-hidden="true" />
            {now?.params.rh === null || now?.params.rh === undefined
              ? "—"
              : `${n(now.params.rh)} %`}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
