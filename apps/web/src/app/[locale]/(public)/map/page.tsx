import { CAP_SEVERITIES, CAP_SEVERITY_STYLES } from "@meteo/core";
import { getLatestSilamRun, getSilamLayers } from "@meteo/db";
import { pollutants } from "@meteo/db/schema";
import type { Locale } from "@meteo/i18n";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LevelLegend } from "@/components/air/level-legend";
import { MapView, type SilamCatalog } from "@/components/map/map-view";
import { getDb } from "@/lib/db";
import { type LocalizedWarning, loadLocalizedWarnings } from "@/lib/warnings";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: "map" });
  return { title: t("title"), description: t("subtitle") };
}

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

export default async function MapPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const [t, tsl, ts, tw, catalog, warningList] = await Promise.all([
    getTranslations("map"),
    getTranslations("silam"),
    getTranslations("stations"),
    getTranslations("warnings"),
    loadSilamCatalog(),
    loadLocalizedWarnings(locale, { horizonDays: 1 }).catch(() => [] as LocalizedWarning[]),
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

  return (
    <div className="relative h-[calc(100dvh-4rem)] w-full">
      <MapView
        locale={locale}
        catalog={catalog}
        warnings={warnings}
        openLabel={t("open")}
        statusLabels={{
          active: ts("status.active"),
          suspended: ts("status.suspended"),
          decommissioned: ts("status.decommissioned"),
        }}
        stationHrefPrefix={prefix}
        regionsHref={`${localePrefix}/air`}
        labels={{
          title: t("title"),
          layers: t("layers"),
          stations: t("stations"),
          regions: t("regions"),
          regionsFill: t("regionsFill"),
          regionsHint: t("regionsHint"),
          regionStations: t("regionStations"),
          regionOpen: t("regionOpen"),
          silam: t("silam"),
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
        }}
        legend={<LevelLegend className="flex flex-wrap gap-1.5" />}
      />
    </div>
  );
}
