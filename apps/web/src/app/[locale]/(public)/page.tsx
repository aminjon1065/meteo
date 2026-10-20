import { clampAqLevel } from "@meteo/core";
import {
  count,
  eq,
  getSilamTomorrow,
  latestPublishedEcoBulletin,
  listPublishedNews,
  type NewsPostRow,
  ne,
  type SilamDaySummary,
} from "@meteo/db";
import { forecastLocations, regions, stations } from "@meteo/db/schema";
import type { Locale } from "@meteo/i18n";
import { AqBadge } from "@meteo/ui/components/aq-badge";
import { Button } from "@meteo/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@meteo/ui/components/card";
import { CloudSun, MapPin, Newspaper, TriangleAlert, Wind } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { ExceedanceBanner } from "@/components/air/exceedance-banner";
import { StationMapSection } from "@/components/air/station-map-section";
import { ecoDateValue } from "@/components/eco-bulletins/date";
import { SeverityDot } from "@/components/warnings/severity-badge";
import { WarningsBanner } from "@/components/warnings/warnings-banner";
import { WeatherSymbol } from "@/components/weather/weather-symbol";
import { Link } from "@/i18n/navigation";
import { displayValue, effectiveLevel, loadCurrentAq, loadHealthAdvice } from "@/lib/aq";
import { getDb } from "@/lib/db";
import { name } from "@/lib/format";
import { type LocalizedWarning, loadLocalizedWarnings } from "@/lib/warnings";
import { type LocationOverview, loadWeatherOverview, symbolLabel } from "@/lib/weather";

export const dynamic = "force-dynamic";

async function loadHomeData(locale: Locale) {
  try {
    const db = getDb();
    const [stationsRow, featured, stationRows, aq, weather, warnings, news] = await Promise.all([
      db.select({ n: count() }).from(stations).where(eq(stations.status, "active")),
      db
        .select({ slug: forecastLocations.slug, name: forecastLocations.name })
        .from(forecastLocations)
        .where(eq(forecastLocations.featured, true))
        .orderBy(forecastLocations.sortOrder),
      db
        .select({
          id: stations.id,
          slug: stations.slug,
          name: stations.name,
          regionCode: regions.code,
        })
        .from(stations)
        .leftJoin(regions, eq(regions.id, stations.regionId))
        .where(ne(stations.status, "decommissioned")),
      loadCurrentAq(),
      loadWeatherOverview({ featuredOnly: true }).catch(() => [] as LocationOverview[]),
      loadLocalizedWarnings(locale, { horizonDays: 2 }).catch(() => [] as LocalizedWarning[]),
      listPublishedNews(db, { pageSize: 3 }).catch(() => ({ rows: [] as NewsPostRow[], total: 0 })),
    ]);
    const silam = await getSilamTomorrow(
      db,
      weather.map((w) => w.location.id),
    ).catch(() => ({ run: null, byLocation: new Map<number, SilamDaySummary | null>() }));
    // Станция для hero: с актуальным индексом, предпочтительно в Душанбе; иначе — самая свежая.
    const candidates = stationRows
      .map((s) => ({ ...s, idx: aq.byStation.get(s.id) }))
      .filter((s) => s.idx && !s.idx.stale)
      .sort((a, b) => {
        const du = Number(b.regionCode === "DU") - Number(a.regionCode === "DU");
        return du !== 0 ? du : (b.idx?.time.getTime() ?? 0) - (a.idx?.time.getTime() ?? 0);
      });
    const hero = candidates[0] ?? null;
    const level = effectiveLevel(hero?.idx);
    const advice = hero && aq.scale ? await loadHealthAdvice(aq.scale.id, level) : [];
    const ecoBulletin = await latestPublishedEcoBulletin(db).catch(() => null);
    return {
      stationsCount: stationsRow[0]?.n ?? 0,
      ecoBulletin,
      featured,
      hero,
      level,
      dominant: hero?.idx?.dominantPollutantId
        ? aq.pollutantsById.get(hero.idx.dominantPollutantId)
        : undefined,
      advice: advice.find((a) => a.audience === "general") ?? null,
      weather,
      silam,
      warnings,
      news: news.rows,
      pollutantsById: aq.pollutantsById,
      degraded: false,
    };
  } catch {
    return {
      stationsCount: 0,
      ecoBulletin: null,
      featured: [],
      hero: null,
      level: 0 as const,
      dominant: undefined,
      advice: null,
      weather: [] as LocationOverview[],
      silam: { run: null, byLocation: new Map<number, SilamDaySummary | null>() },
      warnings: [] as LocalizedWarning[],
      news: [] as NewsPostRow[],
      pollutantsById: new Map(),
      degraded: true,
    };
  }
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const [t, tc, tl, tp, ti, tsym, tw, format, data] = await Promise.all([
    getTranslations("home"),
    getTranslations("common"),
    getTranslations("levels"),
    getTranslations("pollutants"),
    getTranslations("index"),
    getTranslations("weatherSymbols"),
    getTranslations("warnings"),
    getFormatter(),
    loadHomeData(locale),
  ]);
  const deg = (v: number | null | undefined) =>
    v === null || v === undefined ? "—" : `${format.number(v, { maximumFractionDigits: 0 })}°`;
  const hero = data.hero;
  const dominantValue =
    hero?.idx && data.dominant
      ? displayValue(data.dominant, hero.idx.subIndices[String(data.dominant.id)]?.value)
      : null;

  return (
    <div className="container-page flex flex-col gap-10 py-10">
      <WarningsBanner locale={locale} warnings={data.warnings} />
      <ExceedanceBanner locale={locale} />
      <section className="grid gap-6 lg:grid-cols-[3fr_2fr] lg:items-center">
        <div className="flex flex-col gap-4">
          <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl lg:text-5xl">
            {t("title")}
          </h1>
          <p className="max-w-2xl text-pretty text-lg text-muted-foreground">{t("subtitle")}</p>
          <div className="flex flex-wrap gap-2 pt-2">
            {data.featured.map((loc) => (
              <Link
                key={loc.slug}
                href={`/weather/${loc.slug}`}
                className="inline-flex items-center gap-1 rounded-full border bg-card px-3 py-1 text-sm transition-colors hover:bg-accent"
              >
                <MapPin className="size-3.5 text-muted-foreground" aria-hidden="true" />
                {name(loc.name, locale)}
              </Link>
            ))}
          </div>
        </div>

        <Card
          className={
            data.level > 0
              ? `border-aq-${data.level}/50 bg-gradient-to-br from-card to-brand-soft/60 dark:to-accent/40`
              : "border-brand/20 bg-gradient-to-br from-card to-brand-soft/60 dark:to-accent/40"
          }
        >
          <CardHeader>
            <CardDescription className="flex items-center gap-2">
              <Wind className="size-4" aria-hidden="true" />
              {t("airNow")}
              {hero ? ` · ${name(hero.name, locale)}` : ""}
            </CardDescription>
            <CardTitle className="flex flex-wrap items-center gap-3">
              <span className="text-5xl font-semibold tabular-nums">
                {dominantValue !== null && data.dominant
                  ? format.number(dominantValue, { maximumFractionDigits: data.dominant.decimals })
                  : "—"}
              </span>
              {data.dominant ? (
                <span className="text-sm font-normal text-muted-foreground">
                  {data.dominant.unit} ·{" "}
                  {tp.has(data.dominant.code as "PM25")
                    ? tp(data.dominant.code as "PM25")
                    : data.dominant.shortName}
                </span>
              ) : null}
              <AqBadge level={data.level} label={tl(`${data.level}` as "0")} size="lg" />
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
            {hero?.idx ? (
              <p>{t("heroUpdated", { time: format.relativeTime(hero.idx.time) })}</p>
            ) : (
              <p>{t("heroNoStation")}</p>
            )}
            {data.advice ? (
              <p className="text-foreground">{name(data.advice.text, locale)}</p>
            ) : null}
            <p>{t("stationsCount", { count: data.stationsCount })}</p>
            {data.ecoBulletin ? (
              <p>
                <Link
                  href={`/air/bulletins/${data.ecoBulletin.id}`}
                  className="underline-offset-4 hover:underline"
                >
                  {t("ecoBulletin", {
                    date: format.dateTime(ecoDateValue(data.ecoBulletin.date), {
                      dateStyle: "long",
                    }),
                  })}
                </Link>
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2 pt-1">
              {hero ? (
                <Button
                  size="sm"
                  render={<Link href={`/air/stations/${hero.slug}`} />}
                  nativeButton={false}
                >
                  {t("viewStation")}
                </Button>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                render={<Link href="/map" />}
                nativeButton={false}
              >
                {tc("actions.openMap")}
              </Button>
            </div>
            <p>
              {ti("scale")}: {ti("scaleDefault")} ·{" "}
              <Link href="/air/index" className="underline-offset-4 hover:underline">
                {ti("about")}
              </Link>
            </p>
          </CardContent>
        </Card>
      </section>

      <section className="overflow-hidden rounded-xl border">
        <StationMapSection locale={locale} className="h-72 w-full" compact />
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CloudSun className="size-4 text-brand" aria-hidden="true" />
              {t("forecastToday")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {data.weather.length === 0 ? (
              <p className="text-muted-foreground">{t("noForecast")}</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {data.weather.map((o) => {
                  const code = o.now?.params.symbol ?? o.today?.symbol ?? null;
                  return (
                    <li key={o.location.id}>
                      <Link
                        href={`/weather/${o.location.slug}`}
                        className="flex items-center gap-2 rounded-md hover:bg-accent/40"
                      >
                        <WeatherSymbol
                          code={code}
                          label={symbolLabel(tsym, code)}
                          className="size-7"
                        />
                        <span className="flex-1 truncate">{name(o.location.name, locale)}</span>
                        <span className="font-semibold tabular-nums">{deg(o.now?.params.t)}</span>
                        <span className="w-16 text-right text-xs text-muted-foreground tabular-nums">
                          {o.today ? `${deg(o.today.tmax)} / ${deg(o.today.tmin)}` : ""}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
            <Link
              href="/weather"
              className="text-xs text-muted-foreground underline-offset-4 hover:underline"
            >
              {t("allCities")}
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Wind className="size-4 text-brand" aria-hidden="true" />
              {t("airTomorrow")}
            </CardTitle>
            <CardDescription>{t("silamSource")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {!data.silam.run || data.weather.length === 0 ? (
              <p className="text-muted-foreground">{t("noForecast")}</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {data.weather.map((o) => {
                  const day = data.silam.byLocation.get(o.location.id) ?? null;
                  const level = clampAqLevel(day?.level ?? 0);
                  const dominant = day?.dominantPollutantId
                    ? data.pollutantsById.get(day.dominantPollutantId)
                    : undefined;
                  return (
                    <li key={o.location.id} className="flex items-center gap-2">
                      <Link
                        href={`/weather/${o.location.slug}`}
                        className="flex-1 truncate hover:underline"
                      >
                        {name(o.location.name, locale)}
                      </Link>
                      {dominant ? (
                        <span className="text-xs text-muted-foreground">
                          {tp.has(dominant.code as "PM25")
                            ? tp(dominant.code as "PM25")
                            : dominant.shortName}
                        </span>
                      ) : null}
                      <AqBadge level={level} label={tl(`${level}` as "0")} size="sm" />
                    </li>
                  );
                })}
              </ul>
            )}
            <Link
              href="/map"
              className="text-xs text-muted-foreground underline-offset-4 hover:underline"
            >
              {tc("actions.openMap")}
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TriangleAlert className="size-4 text-brand" aria-hidden="true" />
              {t("warningsActive")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {data.warnings.length === 0 ? (
              <p className="text-muted-foreground">{t("noWarnings")}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {data.warnings.slice(0, 3).map((w) => (
                  <li key={w.id} className="flex gap-2">
                    <SeverityDot severity={w.severity} className="mt-1" />
                    <Link href="/warnings" className="flex min-w-0 flex-col hover:underline">
                      <span className="font-medium">{w.headline}</span>
                      <span className="text-xs text-muted-foreground">
                        {w.regions.length
                          ? w.regions.map((r) => name(r.name, locale) || r.code).join(", ")
                          : w.areaDescs.join(", ")}
                        {w.upcoming ? ` · ${tw("upcoming").toLowerCase()}` : ""}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <Link
              href="/warnings"
              className="text-xs text-muted-foreground underline-offset-4 hover:underline"
            >
              {t("allWarnings")}
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Newspaper className="size-4 text-brand" aria-hidden="true" />
              {t("latestNews")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {data.news.length === 0 ? (
              <p className="text-muted-foreground">{t("noNews")}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {data.news.map((post) => (
                  <li key={post.id} className="flex flex-col">
                    <Link href={`/news/${post.slug}`} className="font-medium hover:underline">
                      {name(post.title, locale)}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      {post.publishedAt
                        ? format.dateTime(post.publishedAt, { dateStyle: "medium" })
                        : ""}
                      {post.category ? ` · ${name(post.category.name, locale)}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Link
              href="/news"
              className="text-xs text-muted-foreground underline-offset-4 hover:underline"
            >
              {t("allNews")}
            </Link>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
