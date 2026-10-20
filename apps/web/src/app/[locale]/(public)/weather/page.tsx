import { getLastForecastRun } from "@meteo/db";
import type { Locale } from "@meteo/i18n";
import type { Metadata } from "next";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Panel } from "@/components/air/status-band";
import { PageHeader, Section } from "@/components/site/page-header";
import { CityWeatherList, type CityWeatherRow } from "@/components/weather/city-weather-list";
import { getSelectedCitySlug } from "@/lib/city";
import { loadStationSummaries, summarizeCityAir } from "@/lib/city-air";
import { getDb } from "@/lib/db";
import { loadWeatherOverview } from "@/lib/weather";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: "weather" });
  return { title: t("title"), description: t("intro") };
}

/** Погода по городам списком: крупные города, затем остальные точки; выбранный город — первым. */
export default async function WeatherPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const [t, format, overview, lastRun, selected, air] = await Promise.all([
    getTranslations("weather"),
    getFormatter(),
    loadWeatherOverview().catch(() => []),
    getLastForecastRun(getDb(), "smartmet").catch(() => null),
    getSelectedCitySlug(),
    loadStationSummaries().catch(() => null),
  ]);
  const rows = (list: typeof overview): CityWeatherRow[] =>
    list.map((o) => ({
      overview: o,
      airLevel: air
        ? summarizeCityAir(
            { lon: o.location.geom.x, lat: o.location.geom.y },
            air.stations,
            air.aq.pollutantsById,
          ).level
        : 0,
      selected: o.location.slug === selected,
    }));
  const featured = overview.filter((o) => o.location.featured || o.location.slug === selected);
  const others = overview.filter((o) => !featured.includes(o));
  const hasData = overview.some((o) => o.now || o.today);
  const stale = hasData && (!lastRun || Date.now() - lastRun.fetchedAt.getTime() > 3 * 3_600_000);
  const base = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}${locale === "tg" ? "" : `/${locale}`}`;

  return (
    <div className="container-page flex flex-col gap-9 py-8">
      <PageHeader title={t("title")} intro={t("intro")}>
        {!hasData ? <p className="text-sm text-muted-foreground">{t("noForecast")}</p> : null}
        {stale ? (
          <p className="w-fit rounded-lg border border-l-4 border-l-status-stale bg-card px-3 py-2 text-sm">
            {t("stale")}
            {lastRun ? ` · ${t("updated", { time: format.relativeTime(lastRun.fetchedAt) })}` : ""}
          </p>
        ) : null}
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-2">
        {featured.length > 0 ? (
          <Section title={t("featured")} id="featured-heading">
            <Panel className="py-1">
              <CityWeatherList rows={rows(featured)} locale={locale} />
            </Panel>
          </Section>
        ) : null}
        {others.length > 0 ? (
          <Section title={t("otherLocations")} id="others-heading">
            <Panel className="py-1">
              <CityWeatherList rows={rows(others)} locale={locale} />
            </Panel>
          </Section>
        ) : null}
      </div>

      <section className="flex flex-col gap-2 text-sm text-muted-foreground">
        <h2 className="text-h3 text-foreground">{t("embedTitle")}</h2>
        <p>{t("embedHint")}</p>
        <pre className="overflow-x-auto rounded-lg bg-surface-2 p-3 text-xs text-foreground">
          {`<iframe src="${base}/embed/forecast?location=dushanbe" width="320" height="260" style="border:0" loading="lazy" title="${t("title")}"></iframe>`}
        </pre>
        <p>{t("source")}</p>
      </section>
    </div>
  );
}
