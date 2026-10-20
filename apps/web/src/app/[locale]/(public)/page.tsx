import { type AqLevelOrNone, clampAqLevel, markdownExcerpt } from "@meteo/core";
import {
  getLocationForecast,
  getSilamTomorrow,
  latestPublishedEcoBulletin,
  listPublishedNews,
  localDateKey,
  type NewsPostRow,
  type SilamDaySummary,
} from "@meteo/db";
import type { Locale } from "@meteo/i18n";
import { AqBadge } from "@meteo/ui/components/aq-badge";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { ExceedanceNotice } from "@/components/air/exceedance-notice";
import { MapPanel } from "@/components/air/map-panel";
import { StationFeed } from "@/components/air/station-feed";
import { Panel, StatusBand, type StatusChip } from "@/components/air/status-band";
import { ecoDateValue } from "@/components/eco-bulletins/date";
import { type EditorialItem, EditorialList } from "@/components/news/editorial-list";
import { SeverityDot } from "@/components/warnings/severity-badge";
import { CityWeatherList, type CityWeatherRow } from "@/components/weather/city-weather-list";
import { hasSymbol, WeatherSymbol } from "@/components/weather/weather-symbol";
import { Link } from "@/i18n/navigation";
import { loadHealthAdvice } from "@/lib/aq";
import { resolveCity } from "@/lib/city";
import { type CityAir, loadStationSummaries, summarizeCityAir } from "@/lib/city-air";
import { getDb } from "@/lib/db";
import { name } from "@/lib/format";
import { type LocalizedWarning, loadLocalizedWarnings } from "@/lib/warnings";
import {
  aggregateDay,
  type DayAggregate,
  type LocationOverview,
  loadWeatherOverview,
  symbolLabel,
  windDirectionKey,
} from "@/lib/weather";

export const dynamic = "force-dynamic";

async function loadHomeData(locale: Locale) {
  const empty = {
    city: null,
    cityAir: null as CityAir | null,
    advice: null as { text: Record<string, string | undefined> } | null,
    scaleLevels: undefined as readonly number[] | undefined,
    stations: [] as Awaited<ReturnType<typeof loadStationSummaries>>["stations"],
    pollutantsById: new Map(),
    weather: [] as LocationOverview[],
    cityWeather: null as LocationOverview | null,
    tomorrowWeather: null as DayAggregate | null,
    silam: { run: null, byLocation: new Map<number, SilamDaySummary | null>() },
    warnings: [] as LocalizedWarning[],
    news: [] as NewsPostRow[],
    ecoBulletin: null as Awaited<ReturnType<typeof latestPublishedEcoBulletin>> | null,
    cityAirByLocation: new Map<number, AqLevelOrNone>(),
    degraded: true,
  };
  try {
    const db = getDb();
    const [{ city, cities }, { aq, stations }, weather, warnings, news, ecoBulletin] =
      await Promise.all([
        resolveCity(),
        loadStationSummaries(),
        loadWeatherOverview().catch(() => [] as LocationOverview[]),
        loadLocalizedWarnings(locale, { horizonDays: 2 }).catch(() => [] as LocalizedWarning[]),
        listPublishedNews(db, { pageSize: 3 }).catch(() => ({
          rows: [] as NewsPostRow[],
          total: 0,
        })),
        latestPublishedEcoBulletin(db).catch(() => null),
      ]);
    const cityAir = city
      ? summarizeCityAir({ lon: city.geom.x, lat: city.geom.y }, stations, aq.pollutantsById)
      : null;
    const level = cityAir?.level ?? 0;
    const advice =
      cityAir && aq.scale && level > 0
        ? ((await loadHealthAdvice(aq.scale.id, level)).find((a) => a.audience === "general") ??
          null)
        : null;
    const shownWeather = weather.filter(
      (w) => w.location.featured || w.location.slug === city?.slug,
    );
    const now = new Date();
    const tomorrowKey = localDateKey(new Date(now.getTime() + 86_400_000));
    const [silam, cityForecast] = await Promise.all([
      getSilamTomorrow(
        db,
        shownWeather.map((w) => w.location.id),
        now,
      ).catch(() => ({ run: null, byLocation: new Map<number, SilamDaySummary | null>() })),
      city
        ? getLocationForecast(db, city.id, { hours: 48, days: 3, now }).catch(() => null)
        : Promise.resolve(null),
    ]);
    // Завтра: суточная точка провайдера, иначе агрегат из часового ряда за местные сутки.
    const tomorrowWeather = cityForecast
      ? aggregateDay(
          cityForecast.daily.find((d) => localDateKey(d.time) === tomorrowKey) ?? null,
          cityForecast.hourly,
          tomorrowKey,
        )
      : null;
    const cityAirByLocation = new Map<number, AqLevelOrNone>(
      shownWeather.map((w) => [
        w.location.id,
        summarizeCityAir(
          { lon: w.location.geom.x, lat: w.location.geom.y },
          stations,
          aq.pollutantsById,
        ).level,
      ]),
    );
    return {
      ...empty,
      city,
      cities,
      cityAir,
      advice,
      scaleLevels: aq.scale?.levels.map((l) => l.level),
      stations,
      pollutantsById: aq.pollutantsById,
      weather: shownWeather,
      cityWeather: weather.find((w) => w.location.slug === city?.slug) ?? null,
      tomorrowWeather,
      silam,
      warnings,
      news: news.rows,
      ecoBulletin,
      cityAirByLocation,
      degraded: false,
    };
  } catch {
    return { ...empty, cities: [] };
  }
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const [t, tc, tl, tp, ti, tsym, tw, tn, te, format, data] = await Promise.all([
    getTranslations("home"),
    getTranslations("common"),
    getTranslations("levels"),
    getTranslations("pollutantHints"),
    getTranslations("index"),
    getTranslations("weatherSymbols"),
    getTranslations("weather"),
    getTranslations("news"),
    getTranslations("ecoBulletin"),
    getFormatter(),
    loadHomeData(locale),
  ]);
  const deg = (v: number | null | undefined) =>
    v === null || v === undefined ? "—" : `${format.number(v, { maximumFractionDigits: 0 })}°`;
  const cityName = data.city ? name(data.city.name, locale) : "";
  const air = data.cityAir;
  const level = air?.level ?? 0;
  const scaleTotal = data.scaleLevels?.length ?? 5;
  const chips: StatusChip[] = (air?.chips ?? []).map((c) => ({
    key: c.pollutant.code,
    level: c.level,
    value: format.number(c.value, { maximumFractionDigits: c.pollutant.decimals }),
    label: c.pollutant.shortName,
    unit: c.pollutant.unit !== "µg/m³" ? c.pollutant.unit : undefined,
    title: tp.has(c.pollutant.code as "PM10") ? tp(c.pollutant.code as "PM10") : undefined,
  }));
  const activeWarnings = data.warnings.filter((w) => w.active).slice(0, 2);

  // Текст под уровнем: совет общей группы, иначе — почему данных нет.
  const advice = data.advice
    ? name(data.advice.text, locale)
    : air && air.stations.length === 0
      ? air.nearest
        ? `${t("noCityStations", { city: cityName })} ${t("nearestStation", {
            station: name(air.nearest.station.name, locale),
            distance: format.number(air.nearest.distanceKm, { maximumFractionDigits: 0 }),
          })}`
        : t("noCityStations", { city: cityName })
      : air?.lastAt
        ? t("noFreshData", { time: format.relativeTime(air.lastAt) })
        : t("heroNoStation");

  const wx = data.cityWeather;
  const nowCode = wx?.now?.params.symbol ?? wx?.today?.symbol ?? null;
  const ws = wx?.now?.params.ws ?? null;
  const wd = wx?.now?.params.wd ?? null;
  const rh = wx?.now?.params.rh ?? null;
  const tomorrowSilam = data.city ? (data.silam.byLocation.get(data.city.id) ?? null) : null;
  const tomorrowLevel = clampAqLevel(tomorrowSilam?.level ?? 0);
  const tomorrowWx = data.tomorrowWeather;

  const editorial: EditorialItem[] = [
    ...data.news.map((post) => ({
      key: `news-${post.id}`,
      href: `/news/${post.slug}`,
      title: name(post.title, locale),
      kind: post.category ? name(post.category.name, locale) : tn("title"),
      date: post.publishedAt,
      excerpt: name(post.excerpt, locale) || markdownExcerpt(name(post.body, locale), 140),
    })),
    ...(data.ecoBulletin
      ? [
          {
            key: `eco-${data.ecoBulletin.id}`,
            href: `/air/bulletins/${data.ecoBulletin.id}`,
            title: te("public.forDate", {
              date: format.dateTime(ecoDateValue(data.ecoBulletin.date), { dateStyle: "long" }),
            }),
            kind: te("public.kind"),
            date: data.ecoBulletin.publishedAt ?? ecoDateValue(data.ecoBulletin.date),
            excerpt: name(data.ecoBulletin.data.city.name, locale),
          },
        ]
      : []),
  ]
    .sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0))
    .slice(0, 3);

  const cityRows: CityWeatherRow[] = data.weather.map((o) => ({
    overview: o,
    airLevel: data.cityAirByLocation.get(o.location.id) ?? 0,
    selected: o.location.slug === data.city?.slug,
  }));

  return (
    <>
      <StatusBand
        as="h1"
        eyebrow={cityName ? `${t("airNow")} · ${cityName}` : t("airNow")}
        level={level}
        levelLabel={tl(`${level}` as "0")}
        scaleLabel={t("scaleLabel", { level, total: scaleTotal, label: tl(`${level}` as "0") })}
        scaleLevels={data.scaleLevels}
        advice={advice}
        chips={chips}
        meta={
          <>
            {chips.length > 0 ? <span>{t("hourlyMeans")}</span> : null}
            {air?.updatedAt ? (
              <span>{t("heroUpdated", { time: format.relativeTime(air.updatedAt) })}</span>
            ) : null}
            {air && air.stations.length > 0 ? (
              <Link href="/air" className="hover:underline">
                {t("cityStations", { count: air.stations.length })}
              </Link>
            ) : null}
            <Link href="/air/index" className="font-semibold text-brand hover:underline">
              {t("howToRead")}
            </Link>
          </>
        }
        aside={
          <>
            <Panel
              className="grid grid-cols-[auto_1fr] items-center gap-3.5"
              data-testid="weather-today"
            >
              {hasSymbol(nowCode) ? (
                <WeatherSymbol
                  code={nowCode}
                  label={symbolLabel(tsym, nowCode)}
                  className="size-13"
                />
              ) : (
                <span
                  className="size-13 rounded-full bg-[radial-gradient(circle_at_35%_35%,#ffd66b,#f3a43a_70%)] shadow-[0_0_0_6px_rgba(243,164,58,0.15)]"
                  aria-hidden="true"
                />
              )}
              <div>
                <p className="eyebrow">
                  {t("forecastToday")}
                  {cityName ? ` · ${cityName}` : ""}
                </p>
                <p className="num mt-0.5 font-heading text-[2.6rem] leading-none font-bold">
                  {deg(wx?.now?.params.t)}
                </p>
                <p className="mt-1 flex flex-wrap gap-x-3.5 gap-y-0.5 text-sm text-muted-foreground">
                  {wx?.today ? (
                    <span className="num">
                      {tw("maxMin", { max: deg(wx.today.tmax), min: deg(wx.today.tmin) })}
                    </span>
                  ) : null}
                  {nowCode !== null ? (
                    <span>{symbolLabel(tsym, nowCode).toLowerCase()}</span>
                  ) : null}
                  {ws !== null ? (
                    <span>
                      {ws < 0.5
                        ? tw("calm")
                        : `${tw("windShort", { value: format.number(ws, { maximumFractionDigits: 0 }) })}${
                            wd !== null ? ` ${tw(`windDirections.${windDirectionKey(wd)}`)}` : ""
                          }`}
                    </span>
                  ) : null}
                  {rh !== null ? (
                    <span>
                      {tw("humidityShort", {
                        value: format.number(rh, { maximumFractionDigits: 0 }),
                      })}
                    </span>
                  ) : null}
                  {!wx || (!wx.now && !wx.today) ? <span>{t("noForecast")}</span> : null}
                </p>
                {wx ? (
                  <Link
                    href={`/weather/${wx.location.slug}`}
                    className="mt-1 inline-block text-caption font-semibold text-brand hover:underline"
                  >
                    {tw("openForecast")}
                  </Link>
                ) : null}
              </div>
            </Panel>
            <Panel className="grid gap-2" data-testid="tomorrow">
              <p className="eyebrow">{t("tomorrow")}</p>
              <div className="flex items-center justify-between gap-2.5 text-sm">
                <span>{t("airBySilam")}</span>
                {data.silam.run && tomorrowSilam ? (
                  <AqBadge level={tomorrowLevel} label={tl(`${tomorrowLevel}` as "0")} size="sm" />
                ) : (
                  <span className="text-muted-foreground">{t("noForecast")}</span>
                )}
              </div>
              <div className="flex items-center justify-between gap-2.5 text-sm">
                <span>{tw("title")}</span>
                <span className="num text-muted-foreground">
                  {tomorrowWx
                    ? `${deg(tomorrowWx.tmax)} / ${deg(tomorrowWx.tmin)}${
                        tomorrowWx.precipSum
                          ? ` · ${t("precip", { value: format.number(tomorrowWx.precipSum, { maximumFractionDigits: 1 }) })}`
                          : hasSymbol(tomorrowWx.symbol)
                            ? ` · ${symbolLabel(tsym, tomorrowWx.symbol).toLowerCase()}`
                            : ` · ${t("noPrecip")}`
                      }`
                    : t("noForecast")}
                </span>
              </div>
            </Panel>
            {activeWarnings.length > 0 ? (
              <div
                className="flex items-start gap-2.5 rounded-xl border border-l-4 border-l-warn-severe bg-card px-3.5 py-3 text-sm"
                data-testid="warnings-notice"
              >
                <div className="grid gap-1">
                  {activeWarnings.map((w) => (
                    <p key={w.id} className="flex items-start gap-2">
                      <SeverityDot severity={w.severity} className="mt-1.5 size-2" />
                      <span>
                        <Link href="/warnings" className="font-semibold hover:underline">
                          {w.headline}
                        </Link>
                        {w.regions.length ? (
                          <span className="text-muted-foreground">
                            {" "}
                            · {w.regions.map((r) => name(r.name, locale) || r.code).join(", ")}
                          </span>
                        ) : null}
                      </span>
                    </p>
                  ))}
                  <p>
                    <Link href="/warnings" className="font-semibold text-brand hover:underline">
                      {t("allWarnings")}
                    </Link>
                  </p>
                </div>
              </div>
            ) : null}
            <ExceedanceNotice locale={locale} />
          </>
        }
      />

      <div className="container-page flex flex-col gap-9 py-8">
        <section aria-labelledby="stations-now">
          <div className="section-head">
            <h2 id="stations-now" className="text-h2">
              {t("stationsNow")}
            </h2>
            <Link href="/air" className="text-sm font-semibold text-brand hover:underline">
              {t("allStations", { count: data.stations.length })} →
            </Link>
          </div>
          {data.stations.length === 0 ? (
            <p className="text-muted-foreground">{t("heroNoStation")}</p>
          ) : (
            <StationFeed stations={data.stations.slice(0, 8)} locale={locale} />
          )}
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
          <div>
            <div className="section-head">
              <h2 className="text-h2">{t("mapTitle")}</h2>
              <Link href="/map" className="text-sm font-semibold text-brand hover:underline">
                {t("openFullMap")} →
              </Link>
            </div>
            <MapPanel locale={locale} levels={data.scaleLevels} />
          </div>
          <div>
            <div className="section-head">
              <h2 className="text-h2">{t("weatherByCity")}</h2>
              <Link href="/weather" className="text-sm font-semibold text-brand hover:underline">
                {t("allCities")} →
              </Link>
            </div>
            <Panel className="py-1">
              {cityRows.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">{t("noForecast")}</p>
              ) : (
                <CityWeatherList rows={cityRows} locale={locale} />
              )}
            </Panel>
          </div>
        </section>

        <section aria-labelledby="news-heading">
          <div className="section-head">
            <h2 id="news-heading" className="text-h2">
              {t("newsTitle")}
            </h2>
            <Link href="/news" className="text-sm font-semibold text-brand hover:underline">
              {t("allMaterials")} →
            </Link>
          </div>
          {editorial.length === 0 ? (
            <p className="text-muted-foreground">{t("noNews")}</p>
          ) : (
            <EditorialList items={editorial} />
          )}
        </section>

        <p className="text-sm text-muted-foreground">
          {ti("scale")}: {ti("scaleDefault")} ·{" "}
          <Link href="/air/index" className="underline-offset-4 hover:underline">
            {ti("about")}
          </Link>
          {" · "}
          <Link href="/subscribe" className="underline-offset-4 hover:underline">
            {t("subscribe")}
          </Link>
          {" · "}
          <span>{tc("fintaj")}</span>
        </p>
      </div>
    </>
  );
}
