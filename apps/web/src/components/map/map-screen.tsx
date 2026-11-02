import { CAP_SEVERITIES, CAP_SEVERITY_STYLES, symbolPath } from "@meteo/core";
import { getLatestSilamRun, getSilamLayers } from "@meteo/db";
import { pollutants } from "@meteo/db/schema";
import type { Locale } from "@meteo/i18n";
import { getFormatter, getTranslations } from "next-intl/server";
import { resolveCity } from "@/lib/city";
import {
  type CityAir,
  loadStationSummaries,
  type StationSummary,
  summarizeCityAir,
} from "@/lib/city-air";
import { getDb } from "@/lib/db";
import { name } from "@/lib/format";
import { type LocalizedWarning, loadLocalizedWarnings } from "@/lib/warnings";
import { type LocationOverview, loadWeatherOverview, symbolLabel } from "@/lib/weather";
import { loadWeatherCatalog } from "@/lib/weather-catalog";
import { CityAirCard, CityWeatherCard, LevelGauge, shortTime } from "./home-cards";
import { type HomeStation, MapView, type SilamCatalog } from "./map-view";
import type { CityMarker } from "./station-map";

/** Каталог слоёв последнего прогона SILAM, сгруппированный по веществам (в порядке справочника). */
async function loadSilamCatalog(): Promise<SilamCatalog> {
  try {
    const db = getDb();
    const run = await getLatestSilamRun(db);
    if (!run?.grid) return { run: null, pollutants: [] };
    const [layers, pollutantRows] = await Promise.all([
      getSilamLayers(db, run.id),
      db
        .select({ code: pollutants.code, shortName: pollutants.shortName, unit: pollutants.unit })
        .from(pollutants)
        .orderBy(pollutants.sortOrder),
    ]);
    const byCode = new Map<string, SilamCatalog["pollutants"][number]["frames"]>();
    for (const l of layers) {
      const list = byCode.get(l.code) ?? [];
      list.push({ time: l.time.toISOString(), url: `/silam/${l.file}`, max: l.stats?.max ?? null });
      byCode.set(l.code, list);
    }
    return {
      run: {
        originTime: run.originTime.toISOString(),
        fetchedAt: run.fetchedAt.toISOString(),
        bounds: {
          west: run.grid.west,
          south: run.grid.south,
          east: run.grid.east,
          north: run.grid.north,
        },
      },
      pollutants: pollutantRows
        .filter((p) => byCode.has(p.code))
        .map((p) => ({
          code: p.code,
          shortName: p.shortName,
          unit: p.unit,
          frames: byCode.get(p.code) ?? [],
        })),
    };
  } catch {
    return { run: null, pollutants: [] };
  }
}

/**
 * Карта на весь экран под шапкой — главная страница портала (по просьбе Заказчика, как у
 * гидрометслужб соседних стран): одна тема за раз — «Воздух» (станции) или «Погода» (города), у
 * каждой «Сейчас» и «Прогноз» (SILAM / карты SmartMet); карточка города из шапки отвечает на
 * главный вопрос, предупреждения появляются, только когда действуют.
 * `layer` — что открыть (ссылки вида `/?layer=silam`).
 */
export async function MapScreen({ locale, layer }: { locale: Locale; layer?: string }) {
  const [
    t,
    tc,
    tsl,
    twx,
    tsym,
    tl,
    format,
    catalog,
    weather,
    warningList,
    overview,
    cityState,
    aqData,
  ] = await Promise.all([
    getTranslations("map"),
    getTranslations("map.card"),
    getTranslations("silam"),
    getTranslations("weather"),
    getTranslations("weatherSymbols"),
    getTranslations("levels"),
    getFormatter(),
    loadSilamCatalog(),
    loadWeatherCatalog(),
    loadLocalizedWarnings(locale, { horizonDays: 1 }).catch(() => [] as LocalizedWarning[]),
    loadWeatherOverview().catch(() => [] as LocationOverview[]),
    resolveCity(),
    loadStationSummaries().catch(() => null),
  ]);
  const localePrefix = locale === "tg" ? "" : `/${locale}`;

  // Предупреждения: только действующие; цвет плашки — по самому серьёзному.
  const active = warningList.filter((w) => w.active);
  const worst = CAP_SEVERITIES.find((s) => active.some((w) => w.severity === s));
  const warnings = {
    count: active.length,
    url: `/api/v1/alerts?format=geojson&active=1&lang=${locale}`,
    href: `${localePrefix}/warnings`,
    color: worst ? CAP_SEVERITY_STYLES[worst].color : null,
  };

  // Станции для карты: выведенные и приостановленные не показываются — у них нет данных.
  const stations: HomeStation[] = (aqData?.stations ?? [])
    .filter((s: StationSummary) => s.status === "active")
    .map((s) => {
      const fresh = s.idx && !s.idx.stale;
      const value =
        fresh && s.dominant && s.dominantValue !== null
          ? `${s.dominant.shortName} ${format.number(s.dominantValue, { maximumFractionDigits: s.dominant.decimals })} ${s.dominant.unit}`
          : null;
      return {
        slug: s.slug,
        name: name(s.name, locale),
        lon: s.lon,
        lat: s.lat,
        level: s.level,
        label: tl(`${s.level}` as "0"),
        value,
        time: s.idx
          ? fresh
            ? tc("updated", { time: shortTime(format, s.idx.time) })
            : tc("lastData", { time: shortTime(format, s.idx.time) })
          : null,
      };
    });

  const deg = (v: number | null | undefined) =>
    v === null || v === undefined ? null : `${format.number(v, { maximumFractionDigits: 0 })}°`;
  // Города без прогноза на карту не выносятся: пустой маркер «—» ничего не сообщает.
  const cities: CityMarker[] = overview.flatMap((o) => {
    const code = o.now?.params.symbol ?? o.today?.symbol ?? null;
    const light = symbolPath(code, "light");
    const dark = symbolPath(code, "dark");
    const temp = deg(o.now?.params.t);
    if (temp === null && !light) return [];
    const label = code !== null ? symbolLabel(tsym, code) : null;
    const maxMin = o.today
      ? twx("maxMin", { max: deg(o.today.tmax) ?? "—", min: deg(o.today.tmin) ?? "—" })
      : null;
    return [
      {
        slug: o.location.slug,
        name: name(o.location.name, locale) || o.location.slug,
        lon: o.location.geom.x,
        lat: o.location.geom.y,
        temp,
        symbol: light && dark && label ? { light, dark, label } : null,
        details: [label, maxMin].filter((d): d is string => Boolean(d)),
        href: `${localePrefix}/weather/${o.location.slug}`,
        featured: o.location.featured,
      },
    ];
  });

  const city = cityState.city;
  const cityName = city ? name(city.name, locale) || city.slug : "";
  let cityAir: CityAir | null = null;
  if (city && aqData) {
    cityAir = summarizeCityAir(
      { lon: city.geom.x, lat: city.geom.y },
      aqData.stations,
      aqData.aq.pollutantsById,
      cityState.cities.map((c) => ({ lon: c.geom.x, lat: c.geom.y })),
    );
  }
  const scaleLevels = aqData?.aq.scale?.levels.map((l) => l.level);
  const cityWeather = overview.find((o) => o.location.slug === city?.slug) ?? null;

  const initial =
    layer === "silam"
      ? ({ topic: "air", view: "forecast" } as const)
      : layer === "weather"
        ? ({ topic: "weather", view: "now" } as const)
        : ({ topic: "air", view: "now" } as const);

  return (
    <div className="relative h-[calc(100dvh-4rem-1px)] w-full">
      <MapView
        locale={locale}
        now={Date.now()}
        initial={initial}
        catalog={catalog}
        weather={weather}
        warnings={warnings}
        stations={stations}
        cities={cities}
        selectedCity={city?.slug ?? null}
        stationHrefPrefix={`${localePrefix}/air/stations`}
        regionsHref={`${localePrefix}/air`}
        silamFmiHref={`${localePrefix}/air/silam`}
        cards={{
          air: city ? (
            <CityAirCard
              cityName={cityName}
              air={cityAir}
              scaleLevels={scaleLevels}
              locale={locale}
            />
          ) : null,
          weather: city ? (
            <CityWeatherCard cityName={cityName} overview={cityWeather} locale={locale} />
          ) : null,
        }}
        forecastLegend={<LevelGauge levels={scaleLevels} />}
        labels={{
          title: t("title"),
          topic: t("topic"),
          air: t("topics.air"),
          weather: t("topics.weather"),
          view: t("view"),
          now: t("views.now"),
          forecast: t("views.forecast"),
          airForecast: twx("airForecast"),
          weatherForecast: t("weatherForecast"),
          open: t("stationMore"),
          cityOpen: twx("openForecast"),
          regionStations: t("regionStations"),
          regionOpen: t("regionOpen"),
          silamFmi: t("silamFmi"),
          pollutant: tsl("pollutant"),
          time: tsl("time"),
          run: tsl("run", { time: "{time}" }),
          play: tsl("play"),
          pause: tsl("pause"),
          prev: tsl("prev"),
          next: tsl("next"),
          maxInDomain: tsl("maxInDomain", { value: "{value}", unit: "{unit}" }),
          warningsActive: t("warningsActive", { count: warnings.count }),
          warningsOpen: t("warningsOpen"),
          unsupported: t("webglUnsupported"),
          weatherParam: t("weatherParam"),
          weatherRun: t("weatherRun", { time: "{time}" }),
          weatherScale: t("weatherScale", { unit: "{unit}" }),
          weatherParams: {
            temperature: twx("temperature"),
            precipitation: twx("precip"),
            wind: twx("wind"),
            cloudcover: twx("cloud"),
          },
          weatherUnits: { celsius: "°C", mmh: t("unitMmh"), ms: twx("ms"), percent: "%" },
          basemap: {
            title: t("basemap.title"),
            scheme: t("basemap.scheme"),
            gray: t("basemap.gray"),
            relief: t("basemap.relief"),
            satellite: t("basemap.satellite"),
          },
        }}
      />
    </div>
  );
}
