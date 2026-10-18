import { getLocationForecast, localDateKey } from "@meteo/db";
import { isLocale, type Locale } from "@meteo/i18n";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { WeatherSymbol } from "@/components/weather/weather-symbol";
import { redirect } from "@/i18n/navigation";
import { getDb } from "@/lib/db";
import { name } from "@/lib/format";
import { loadWeatherOverview, symbolLabel } from "@/lib/weather";

export const dynamic = "force-dynamic";

/**
 * /embed/forecast?location=dushanbe&lang=tg — компактный виджет прогноза для iframe.
 * Параметр lang переключает локаль (редирект на локализованный путь).
 */
export default async function EmbedForecastPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ location?: string; lang?: string }>;
}) {
  const { locale } = (await params) as { locale: Locale };
  const sp = await searchParams;
  if (isLocale(sp.lang) && sp.lang !== locale) {
    redirect({
      href: `/embed/forecast?location=${encodeURIComponent(sp.location ?? "")}`,
      locale: sp.lang,
    });
  }
  setRequestLocale(locale);
  const [t, te, ts, format] = await Promise.all([
    getTranslations("weather"),
    getTranslations("embed"),
    getTranslations("weatherSymbols"),
    getFormatter(),
  ]);
  const all = await loadWeatherOverview().catch(() => []);
  const overview =
    all.find((o) => o.location.slug === sp.location) ??
    all.find((o) => o.location.featured) ??
    all[0];
  const base = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}${locale === "tg" ? "" : `/${locale}`}`;
  if (!overview) {
    return (
      <div className="rounded-lg border bg-card p-3 text-sm text-muted-foreground">
        {te("noData")}
      </div>
    );
  }
  const todayKey = localDateKey(new Date());
  const forecast = await getLocationForecast(getDb(), overview.location.id, {
    hours: 1,
    days: 5,
  }).catch(() => null);
  const days = (forecast?.daily ?? []).filter((d) => localDateKey(d.time) > todayKey).slice(0, 3);
  const code = overview.now?.params.symbol ?? overview.today?.symbol ?? null;
  const deg = (v: number | null | undefined) =>
    v === null || v === undefined ? "—" : `${format.number(v, { maximumFractionDigits: 0 })}°`;

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card p-3 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold">{name(overview.location.name, locale)}</span>
        <span className="text-xs text-muted-foreground">{te("forecast")}</span>
      </div>
      <div className="flex items-center gap-3">
        <WeatherSymbol code={code} label={symbolLabel(ts, code)} className="size-14" />
        <span className="text-4xl font-semibold tabular-nums">{deg(overview.now?.params.t)}</span>
        <span className="flex flex-col text-xs text-muted-foreground">
          {code !== null ? <span className="text-foreground">{symbolLabel(ts, code)}</span> : null}
          {overview.today ? (
            <span className="tabular-nums">
              {t("max")} {deg(overview.today.tmax)} · {t("min")} {deg(overview.today.tmin)}
            </span>
          ) : null}
        </span>
      </div>
      {days.length > 0 ? (
        <ul className="grid grid-cols-3 gap-1 border-t pt-2">
          {days.map((d) => (
            <li key={d.time.toISOString()} className="flex flex-col items-center text-xs">
              <span className="text-muted-foreground">
                {format.dateTime(d.time, { weekday: "short" })}
              </span>
              <WeatherSymbol
                code={d.params.symbol}
                label={symbolLabel(ts, d.params.symbol)}
                className="size-8"
              />
              <span className="tabular-nums">
                {deg(d.params.tmax)} / {deg(d.params.tmin)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <a
        href={`${base}/weather/${overview.location.slug}`}
        target="_blank"
        rel="noopener"
        className="text-xs text-muted-foreground underline-offset-4 hover:underline"
      >
        {te("poweredBy")} · {te("open")}
      </a>
    </div>
  );
}
