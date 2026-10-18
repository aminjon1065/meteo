import { and, asc, eq, ne } from "@meteo/db";
import { regions, stations } from "@meteo/db/schema";
import type { Locale } from "@meteo/i18n";
import { AqBadge } from "@meteo/ui/components/aq-badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@meteo/ui/components/card";
import { MapPinIcon } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { StationStatusBadge } from "@/components/admin/stations/station-status-badge";
import { LevelLegend } from "@/components/air/level-legend";
import { StationMapSection } from "@/components/air/station-map-section";
import { Link } from "@/i18n/navigation";
import { effectiveLevel, loadCurrentAq } from "@/lib/aq";
import { getDb } from "@/lib/db";
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

export default async function AirPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const [t, ts, tl] = await Promise.all([
    getTranslations("air"),
    getTranslations("stations"),
    getTranslations("levels"),
  ]);
  const aq = await loadCurrentAq();
  const rows = await getDb()
    .select({
      id: stations.id,
      slug: stations.slug,
      name: stations.name,
      status: stations.status,
      kind: stations.kind,
      region: regions.name,
      regionOrder: regions.sortOrder,
    })
    .from(stations)
    .leftJoin(regions, eq(regions.id, stations.regionId))
    .where(and(eq(stations.isPublic, true), ne(stations.status, "decommissioned")))
    .orderBy(asc(regions.sortOrder), asc(stations.code));

  return (
    <div className="container-page flex flex-col gap-8 py-10">
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="max-w-3xl text-muted-foreground">{t("intro")}</p>
        <div className="flex flex-wrap items-center gap-3">
          <LevelLegend />
          <Link href="/air/index" className="text-sm text-brand underline-offset-4 hover:underline">
            {t("aboutIndex")}
          </Link>
        </div>
      </div>
      <div className="h-96 overflow-hidden rounded-xl border">
        <StationMapSection locale={locale} className="h-full w-full" />
      </div>
      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">{t("stationsHeading")}</h2>
        {rows.length === 0 ? (
          <p className="text-muted-foreground">{t("noStations")}</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((s) => (
              <Card key={s.id} className="transition-colors hover:bg-accent/40">
                <CardHeader>
                  <CardTitle className="text-base">
                    <Link href={`/air/stations/${s.slug}`} className="hover:underline">
                      {name(s.name, locale) || s.slug}
                    </Link>
                  </CardTitle>
                  <CardDescription className="flex items-center gap-1">
                    <MapPinIcon className="size-3.5" aria-hidden="true" />
                    {name(s.region, locale) || "—"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex items-center justify-between gap-2">
                  <AqBadge
                    level={effectiveLevel(aq.byStation.get(s.id))}
                    label={tl(`${effectiveLevel(aq.byStation.get(s.id))}` as "0")}
                    size="sm"
                  />
                  <StationStatusBadge status={s.status} label={ts(`status.${s.status}`)} />
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
