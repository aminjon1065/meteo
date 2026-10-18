import {
  eq,
  getForecastLocation,
  getLocationForecast,
  getSilamPointForecast,
  loadIndexConfig,
  localDateKey,
  publicThresholds,
  summarizeSilamDays,
} from "@meteo/db";
import { regions } from "@meteo/db/schema";
import type { Locale } from "@meteo/i18n";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@meteo/ui/components/card";
import { ArrowLeftIcon, DropletsIcon, GaugeIcon, ThermometerIcon, WindIcon } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { SilamDays } from "@/components/air/silam-days";
import { WarningCard } from "@/components/warnings/warning-card";
import { DailyTable } from "@/components/weather/daily-table";
import { HourlyStrip } from "@/components/weather/hourly-strip";
import { WeatherChartLazy } from "@/components/weather/weather-chart.lazy";
import { WeatherSymbol } from "@/components/weather/weather-symbol";
import { Link } from "@/i18n/navigation";
import { loadCurrentAq } from "@/lib/aq";
import { getDb } from "@/lib/db";
import { name } from "@/lib/format";
import { type LocalizedWarning, loadWarningsForPoint } from "@/lib/warnings";
import { aggregateDay, symbolLabel, windDirectionKey } from "@/lib/weather";

export const dynamic = "force-dynamic";

async function loadPage(slug: string, locale: Locale) {
  const db = getDb();
  const location = await getForecastLocation(db, slug);
  if (!location) return null;
  const now = new Date();
  const regionCode = location.regionId
    ? await db
        .select({ code: regions.code })
        .from(regions)
        .where(eq(regions.id, location.regionId))
        .then((r) => r[0]?.code ?? null)
    : null;
  const [forecast, silam, config, aq, warnings] = await Promise.all([
    getLocationForecast(db, location.id, { hours: 72, days: 10, now }),
    getSilamPointForecast(db, { locationId: location.id }),
    loadIndexConfig(db),
    loadCurrentAq([]),
    loadWarningsForPoint(
      locale,
      { lon: location.geom.x, lat: location.geom.y, regionCode },
      { now, horizonDays: 3 },
    ).catch(() => [] as LocalizedWarning[]),
  ]);
  const todayKey = localDateKey(now);
  const days = summarizeSilamDays(silam.rows, publicThresholds(config))
    .filter((d) => d.date >= todayKey)
    .slice(0, 4);
  return {
    location,
    forecast,
    silam: { run: silam.run, days },
    warnings,
    pollutantsById: aq.pollutantsById,
    todayKey,
    now,
  };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const location = await getForecastLocation(getDb(), slug).catch(() => null);
  if (!location) return {};
  const t = await getTranslations({ locale: locale as Locale, namespace: "weather" });
  return { title: `${name(location.name, locale)} · ${t("title")}` };
}

export default async function WeatherLocationPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = (await params) as { locale: Locale; slug: string };
  setRequestLocale(locale);
  const data = await loadPage(slug, locale);
  if (!data) notFound();
  const { location, forecast, silam, warnings, pollutantsById, todayKey } = data;
  const [t, ts, tw, format] = await Promise.all([
    getTranslations("weather"),
    getTranslations("weatherSymbols"),
    getTranslations("warnings"),
    getFormatter(),
  ]);
  const now = forecast.hourly[0] ?? null;
  const today = aggregateDay(
    forecast.daily.find((d) => localDateKey(d.time) === todayKey) ?? null,
    forecast.hourly,
    todayKey,
  );
  const nowCode = now?.params.symbol ?? today?.symbol ?? null;
  const nowLabel = symbolLabel(ts, nowCode);
  const n = (v: number | null | undefined, digits = 0) =>
    v === null || v === undefined ? "—" : format.number(v, { maximumFractionDigits: digits });
  const wd = now?.params.wd ?? null;
  const ws = now?.params.ws ?? null;
  const futureDays = forecast.daily.filter((d) => localDateKey(d.time) > todayKey);
  const chartPoints = forecast.hourly.map((p) => ({
    t: p.time.toISOString(),
    temp: p.params.t ?? null,
    precip: p.params.precip ?? null,
  }));

  return (
    <div className="container-page flex flex-col gap-8 py-10">
      <div className="flex flex-col gap-3">
        <Link
          href="/weather"
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" aria-hidden="true" />
          {t("backToList")}
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">{name(location.name, locale)}</h1>
        <p className="text-muted-foreground">
          {[
            name(location.regionName, locale),
            `${location.geom.y.toFixed(3)}, ${location.geom.x.toFixed(3)}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      {forecast.hourly.length === 0 ? (
        <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          {t("noForecast")}
        </p>
      ) : null}

      <section className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card className="bg-gradient-to-br from-card to-brand-soft/60 dark:to-accent/40">
          <CardHeader>
            <CardDescription>
              {t("now")}
              {now
                ? ` · ${format.dateTime(now.time, { weekday: "long", hour: "2-digit", minute: "2-digit" })}`
                : ""}
            </CardDescription>
            <CardTitle className="flex flex-wrap items-center gap-4">
              <WeatherSymbol code={nowCode} label={nowLabel} className="size-20" />
              <span className="text-6xl font-semibold tabular-nums">
                {now?.params.t === null || now?.params.t === undefined
                  ? "—"
                  : `${n(now.params.t)}°`}
              </span>
              <span className="flex flex-col text-base font-normal">
                {nowCode !== null ? <span>{nowLabel}</span> : null}
                {today ? (
                  <span className="text-muted-foreground tabular-nums">
                    {t("max")} {n(today.tmax)}° · {t("min")} {n(today.tmin)}°
                  </span>
                ) : null}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border bg-card/70 p-3">
                <dt className="flex items-center gap-1 text-xs text-muted-foreground">
                  <WindIcon className="size-3.5" aria-hidden="true" />
                  {t("wind")}
                </dt>
                <dd className="text-lg font-semibold tabular-nums">
                  {ws === null
                    ? "—"
                    : ws < 0.5
                      ? t("calm")
                      : `${n(ws, 1)} ${t("ms")}${wd !== null ? ` ${t(`windDirections.${windDirectionKey(wd)}`)}` : ""}`}
                </dd>
                {now?.params.gust ? (
                  <dd className="text-xs text-muted-foreground">
                    {t("gust", { value: n(now.params.gust, 1) })}
                  </dd>
                ) : null}
              </div>
              <div className="rounded-lg border bg-card/70 p-3">
                <dt className="flex items-center gap-1 text-xs text-muted-foreground">
                  <DropletsIcon className="size-3.5" aria-hidden="true" />
                  {t("humidity")}
                </dt>
                <dd className="text-lg font-semibold tabular-nums">
                  {now?.params.rh === null || now?.params.rh === undefined
                    ? "—"
                    : `${n(now.params.rh)} %`}
                </dd>
              </div>
              <div className="rounded-lg border bg-card/70 p-3">
                <dt className="flex items-center gap-1 text-xs text-muted-foreground">
                  <GaugeIcon className="size-3.5" aria-hidden="true" />
                  {t("pressure")}
                </dt>
                <dd className="text-lg font-semibold tabular-nums">
                  {now?.params.p === null || now?.params.p === undefined
                    ? "—"
                    : `${n(now.params.p)} ${t("hpa")}`}
                </dd>
              </div>
              <div className="rounded-lg border bg-card/70 p-3">
                <dt className="flex items-center gap-1 text-xs text-muted-foreground">
                  <ThermometerIcon className="size-3.5" aria-hidden="true" />
                  {t("precip")}
                </dt>
                <dd className="text-lg font-semibold tabular-nums">
                  {today?.precipSum === null || today?.precipSum === undefined
                    ? "—"
                    : `${n(today.precipSum, 1)} ${t("mm")}`}
                </dd>
                <dd className="text-xs text-muted-foreground">{t("today")}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("airForecast")}</CardTitle>
            <CardDescription>{t("airForecastHint")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <SilamDays days={silam.days} pollutantsById={pollutantsById} todayKey={todayKey} />
            {silam.run && Date.now() - silam.run.fetchedAt.getTime() > 36 * 3_600_000 ? (
              <p className="rounded-md bg-status-stale/15 px-2 py-1 text-xs">{t("silamStale")}</p>
            ) : null}
            {silam.run ? (
              <Link
                href="/map"
                className="text-sm text-muted-foreground underline-offset-4 hover:underline"
              >
                {t("openLayer")}
              </Link>
            ) : null}
          </CardContent>
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">{tw("forLocation")}</h2>
        {warnings.length === 0 ? (
          <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
            {tw("noneForLocation")}
          </p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {warnings.map((w) => (
              <WarningCard key={w.id} warning={w} locale={locale} compact />
            ))}
          </div>
        )}
      </section>

      {forecast.hourly.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">{t("next24h")}</h2>
          <HourlyStrip points={forecast.hourly.slice(0, 24)} />
        </section>
      ) : null}

      {chartPoints.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("hourly")}</CardTitle>
            <CardDescription>{t("chartHint")}</CardDescription>
          </CardHeader>
          <CardContent>
            <WeatherChartLazy
              points={chartPoints}
              locale={locale}
              labels={{ temperature: t("chartTemperature"), precip: t("chartPrecip") }}
            />
          </CardContent>
        </Card>
      ) : null}

      {futureDays.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("daily", { days: futureDays.length })}</CardTitle>
          </CardHeader>
          <CardContent className="px-0 sm:px-6">
            <DailyTable days={futureDays} />
          </CardContent>
        </Card>
      ) : null}

      {!forecast.fetchedAt || Date.now() - forecast.fetchedAt.getTime() > 3 * 3_600_000 ? (
        <p className="w-fit rounded-md bg-status-stale/15 px-2 py-1 text-xs">{t("stale")}</p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {forecast.fetchedAt
          ? `${t("updated", { time: format.relativeTime(forecast.fetchedAt) })} · `
          : ""}
        {forecast.originTime
          ? `${t("model", {
              producer: forecast.producer ?? "SmartMet",
              time: format.dateTime(forecast.originTime, {
                timeZone: "UTC",
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              }),
            })} · `
          : ""}
        {t("source")}
      </p>
    </div>
  );
}
