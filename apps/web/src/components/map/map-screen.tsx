import { CAP_SEVERITIES, CAP_SEVERITY_STYLES, symbolPath } from "@meteo/core";
import { getLatestSilamRun, getSilamLayers } from "@meteo/db";
import { pollutants } from "@meteo/db/schema";
import type { Locale } from "@meteo/i18n";
import { getFormatter, getTranslations } from "next-intl/server";
import { LevelLegend } from "@/components/air/level-legend";
import { getSelectedCitySlug, pickCity } from "@/lib/city";
import { getDb } from "@/lib/db";
import { name } from "@/lib/format";
import { type LocalizedWarning, loadLocalizedWarnings } from "@/lib/warnings";
import { type LocationOverview, loadWeatherOverview, symbolLabel } from "@/lib/weather";
import { loadWeatherCatalog } from "@/lib/weather-catalog";
import { MapView, type SilamCatalog } from "./map-view";
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
 * Карта на весь экран под шапкой — главная страница портала (по образцу data.meteo.uz):
 * погода в городах SmartMet, станции, границы, прогнозы погоды и SILAM, предупреждения CAP.
 * `layer` — слой, включённый при открытии (ссылки вида `/?layer=silam`).
 */
export async function MapScreen({ locale, layer }: { locale: Locale; layer?: string }) {
  const [t, tsl, ts, tw, twx, tsym, format, catalog, weather, warningList, overview, selectedSlug] =
    await Promise.all([
      getTranslations("map"),
      getTranslations("silam"),
      getTranslations("stations"),
      getTranslations("warnings"),
      getTranslations("weather"),
      getTranslations("weatherSymbols"),
      getFormatter(),
      loadSilamCatalog(),
      loadWeatherCatalog(),
      loadLocalizedWarnings(locale, { horizonDays: 1 }).catch(() => [] as LocalizedWarning[]),
      loadWeatherOverview().catch(() => [] as LocationOverview[]),
      getSelectedCitySlug(),
    ]);
  const localePrefix = locale === "tg" ? "" : `/${locale}`;
  const prefix = `${localePrefix}/air/stations`;
  const warnings = {
    count: warningList.filter((w) => w.active).length,
    url: `/api/v1/alerts?format=geojson&active=1&lang=${locale}`,
    href: `${localePrefix}/warnings`,
    legend: CAP_SEVERITIES.filter((s) => s !== "Unknown").map((s) => ({
      severity: s,
      label: tw(`severity.${s}` as "severity.Severe"),
      color: CAP_SEVERITY_STYLES[s].color,
    })),
  };

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
  const selectedCity = pickCity(
    overview.map((o) => o.location),
    selectedSlug,
  )?.slug;

  return (
    <div className="relative h-[calc(100dvh-4rem-1px)] w-full">
      <MapView
        locale={locale}
        now={Date.now()}
        initialLayer={
          layer === "silam" || layer === "warnings" || layer === "weather" ? layer : undefined
        }
        catalog={catalog}
        weather={weather}
        warnings={warnings}
        cities={cities}
        selectedCity={selectedCity ?? null}
        openLabel={t("open")}
        statusLabels={{
          active: ts("status.active"),
          suspended: ts("status.suspended"),
          decommissioned: ts("status.decommissioned"),
        }}
        stationHrefPrefix={prefix}
        regionsHref={`${localePrefix}/air`}
        silamFmiHref={`${localePrefix}/air/silam`}
        labels={{
          title: t("title"),
          layers: t("layers"),
          cities: t("cities"),
          cityOpen: twx("openForecast"),
          stations: t("stations"),
          regions: t("regions"),
          regionsFill: t("regionsFill"),
          regionsHint: t("regionsHint"),
          regionStations: t("regionStations"),
          regionOpen: t("regionOpen"),
          silam: t("silam"),
          silamFmi: t("silamFmi"),
          warnings: t("warnings"),
          soon: t("soon"),
          legend: t("legend"),
          pollutant: tsl("pollutant"),
          time: tsl("time"),
          run: tsl("run", { time: "{time}" }),
          noData: tsl("noData"),
          play: tsl("play"),
          pause: tsl("pause"),
          prev: tsl("prev"),
          next: tsl("next"),
          hint: tsl("hint"),
          maxInDomain: tsl("maxInDomain", { value: "{value}", unit: "{unit}" }),
          warningsNone: t("warningsNone"),
          warningsCount: t("warningsCount", { count: warnings.count }),
          warningsOpen: t("warningsOpen"),
          unsupported: t("webglUnsupported"),
          weather: t("weather"),
          weatherParam: t("weatherParam"),
          weatherRun: t("weatherRun", { time: "{time}" }),
          weatherHint: t("weatherHint"),
          weatherNoData: t("weatherNoData"),
          weatherScale: t("weatherScale", { unit: "{unit}" }),
          weatherParams: {
            temperature: twx("temperature"),
            precipitation: twx("precip"),
            wind: twx("wind"),
            cloudcover: twx("cloud"),
          },
          weatherUnits: { celsius: "°C", mmh: t("unitMmh"), ms: twx("ms"), percent: "%" },
        }}
        legend={<LevelLegend className="gap-x-3 gap-y-1" />}
        legendChips={<LevelLegend variant="chips" className="gap-1.5" />}
      />
    </div>
  );
}
