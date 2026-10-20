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
import { ChevronRightIcon } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { SilamDays } from "@/components/air/silam-days";
import { Panel } from "@/components/air/status-band";
import { Section } from "@/components/site/page-header";
import { WarningCard } from "@/components/warnings/warning-card";
import { DailyTable } from "@/components/weather/daily-table";
import { HourlyStrip } from "@/components/weather/hourly-strip";
import { WeatherChartLazy } from "@/components/weather/weather-chart.lazy";
import { hasSymbol, WeatherSymbol } from "@/components/weather/weather-symbol";
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

/** Прогноз для города: сейчас, завтра/SILAM, предупреждения, лента 24 ч, график, дни. */
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
  const facts: Array<{ key: string; label: string; value: string; note?: string }> = [
    {
      key: "wind",
      label: t("wind"),
      value:
        ws === null
          ? "—"
          : ws < 0.5
            ? t("calm")
            : `${n(ws, 1)} ${t("ms")}${wd !== null ? ` ${t(`windDirections.${windDirectionKey(wd)}`)}` : ""}`,
      note: now?.params.gust ? t("gust", { value: n(now.params.gust, 1) }) : undefined,
    },
    {
      key: "humidity",
      label: t("humidity"),
      value:
        now?.params.rh === null || now?.params.rh === undefined ? "—" : `${n(now.params.rh)} %`,
    },
    {
      key: "pressure",
      label: t("pressure"),
      value:
        now?.params.p === null || now?.params.p === undefined
          ? "—"
          : `${n(now.params.p)} ${t("hpa")}`,
    },
    {
      key: "precip",
      label: t("precip"),
      value:
        today?.precipSum === null || today?.precipSum === undefined
          ? "—"
          : `${n(today.precipSum, 1)} ${t("mm")}`,
      note: t("today"),
    },
  ];
  const stale = !forecast.fetchedAt || Date.now() - forecast.fetchedAt.getTime() > 3 * 3_600_000;

  return (
    <>
      <div className="container-page">
        <nav
          aria-label={t("breadcrumbs")}
          className="flex flex-wrap items-center gap-1 pt-4 pb-1.5 text-sm text-muted-foreground"
        >
          <Link href="/weather" className="hover:text-foreground">
            {t("title")}
          </Link>
          {name(location.regionName, locale) ? (
            <span className="flex items-center gap-1">
              <ChevronRightIcon className="size-3.5" aria-hidden="true" />
              <span>{name(location.regionName, locale)}</span>
            </span>
          ) : null}
          <ChevronRightIcon className="size-3.5" aria-hidden="true" />
          <span className="text-foreground" aria-current="page">
            {name(location.name, locale)}
          </span>
        </nav>
        <div className="flex flex-wrap items-end gap-x-5 gap-y-2 pt-1 pb-5">
          <h1 className="text-h1">{name(location.name, locale)}</h1>
          <span className="num text-sm text-muted-foreground">
            {location.geom.y.toFixed(3)}, {location.geom.x.toFixed(3)}
          </span>
        </div>
      </div>

      <section className="border-y bg-card">
        <div className="container-page grid items-start gap-6 py-6 lg:grid-cols-[1.4fr_1fr] lg:gap-8">
          <div>
            <p className="eyebrow">
              {t("now")}
              {now
                ? ` · ${format.dateTime(now.time, { weekday: "long", hour: "2-digit", minute: "2-digit" })}`
                : ""}
            </p>
            {forecast.hourly.length === 0 ? (
              <p className="mt-2 text-muted-foreground">{t("noForecast")}</p>
            ) : (
              <>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                  {hasSymbol(nowCode) ? (
                    <WeatherSymbol code={nowCode} label={nowLabel} className="size-16" />
                  ) : null}
                  <span className="num font-heading text-display">
                    {now?.params.t === null || now?.params.t === undefined
                      ? "—"
                      : `${n(now.params.t)}°`}
                  </span>
                  <span className="flex flex-col text-base">
                    {nowCode !== null ? <span className="font-medium">{nowLabel}</span> : null}
                    {today ? (
                      <span className="num text-muted-foreground">
                        {t("maxMin", { max: `${n(today.tmax)}°`, min: `${n(today.tmin)}°` })}
                      </span>
                    ) : null}
                  </span>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
                  {facts.map((f) => (
                    <div key={f.key}>
                      <dt className="text-caption text-muted-foreground">{f.label}</dt>
                      <dd className="num font-semibold">{f.value}</dd>
                      {f.note ? (
                        <dd className="text-caption text-muted-foreground">{f.note}</dd>
                      ) : null}
                    </div>
                  ))}
                </dl>
              </>
            )}
            {stale ? (
              <p className="mt-3 w-fit rounded-lg border border-l-4 border-l-status-stale bg-background px-3 py-1.5 text-caption">
                {t("stale")}
              </p>
            ) : null}
          </div>
          <Panel className="grid gap-2.5">
            <p className="eyebrow">{t("airForecast")}</p>
            <SilamDays days={silam.days} pollutantsById={pollutantsById} todayKey={todayKey} />
            {silam.run && Date.now() - silam.run.fetchedAt.getTime() > 36 * 3_600_000 ? (
              <p className="text-caption text-muted-foreground">{t("silamStale")}</p>
            ) : null}
            <p className="text-caption text-muted-foreground">{t("airForecastHint")}</p>
            {silam.run ? (
              <Link
                href={{ pathname: "/map", query: { layer: "silam" } }}
                className="text-sm font-semibold text-brand hover:underline"
              >
                {t("openLayer")} →
              </Link>
            ) : null}
          </Panel>
        </div>
      </section>

      <div className="container-page flex flex-col gap-9 py-8">
        <Section title={tw("forLocation")} id="warnings-heading">
          {warnings.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tw("noneForLocation")}</p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {warnings.map((w) => (
                <WarningCard key={w.id} warning={w} locale={locale} compact />
              ))}
            </div>
          )}
        </Section>

        {forecast.hourly.length > 0 ? (
          <Section title={t("next24h")} id="hourly-heading">
            <HourlyStrip points={forecast.hourly.slice(0, 24)} />
          </Section>
        ) : null}

        {chartPoints.length > 0 ? (
          <Section title={t("hourly")} id="chart-heading" aside={t("chartHint")}>
            <div className="rounded-xl border bg-card px-3 py-3 sm:px-[1.125rem]">
              <WeatherChartLazy
                points={chartPoints}
                locale={locale}
                labels={{ temperature: t("chartTemperature"), precip: t("chartPrecip") }}
              />
            </div>
          </Section>
        ) : null}

        {futureDays.length > 0 ? (
          <Section title={t("daily", { days: futureDays.length })} id="daily-heading">
            <div className="overflow-hidden rounded-xl border bg-card">
              <DailyTable days={futureDays} />
            </div>
          </Section>
        ) : null}

        <p className="text-caption text-muted-foreground">
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
    </>
  );
}
