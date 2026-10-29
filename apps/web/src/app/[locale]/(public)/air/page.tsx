import type { Locale } from "@meteo/i18n";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LevelLegend } from "@/components/air/level-legend";
import { MapPanel } from "@/components/air/map-panel";
import { StationFeed } from "@/components/air/station-feed";
import { PageHeader, Section } from "@/components/site/page-header";
import { Link } from "@/i18n/navigation";
import { loadStationSummaries, type StationSummary } from "@/lib/city-air";
import { name } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: "air" });
  return { title: t("title"), description: t("intro") };
}

/** Качество воздуха: карта и лента всех станций по регионам. */
export default async function AirPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const [t, tl, { aq, stations }] = await Promise.all([
    getTranslations("air"),
    getTranslations("levels"),
    loadStationSummaries().catch(() => ({ aq: null, stations: [] as StationSummary[] })),
  ]);
  // Группировка по областям в порядке справочника; станции внутри — от худшего уровня.
  const groups = new Map<string, { label: string; stations: StationSummary[] }>();
  for (const s of stations) {
    const key = s.regionCode ?? "";
    const g = groups.get(key) ?? {
      label: name(s.regionName, locale) || t("noRegion"),
      stations: [],
    };
    g.stations.push(s);
    groups.set(key, g);
  }
  const fresh = stations.filter((s) => s.idx && !s.idx.stale).length;
  const worst = stations.reduce((max, s) => (s.level > max ? s.level : max), 0);

  return (
    <div className="container-page flex flex-col gap-9 py-8">
      <PageHeader
        title={t("title")}
        intro={
          stations.length > 0
            ? t("summary", {
                count: stations.length,
                fresh,
                level: tl(`${worst}` as "0").toLowerCase(),
              })
            : t("intro")
        }
      >
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <LevelLegend levels={aq?.scale?.levels.map((l) => l.level)} />
          <Link href="/air/index" className="text-sm font-semibold text-brand hover:underline">
            {t("aboutIndex")} →
          </Link>
          <Link href="/air/silam" className="text-sm font-semibold text-brand hover:underline">
            {t("silamLink")} →
          </Link>
        </div>
      </PageHeader>

      <MapPanel locale={locale} levels={aq?.scale?.levels.map((l) => l.level)} height="h-[420px]" />

      <Section title={t("stationsHeading")} id="stations-heading">
        {stations.length === 0 ? (
          <p className="text-muted-foreground">{t("noStations")}</p>
        ) : (
          <div className="flex flex-col gap-7">
            {[...groups.values()].map((g) => (
              <section key={g.label} aria-label={g.label}>
                <h3 className="mb-2.5 text-h3 text-muted-foreground">{g.label}</h3>
                <StationFeed stations={g.stations} locale={locale} />
              </section>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
