import {
  and,
  eq,
  getCurrentIndexes,
  getSilamPointForecast,
  latestPublishedEcoBulletin,
  loadIndexConfig,
  localDateKey,
  publicThresholds,
  RATIO_SCALE_CODE,
  summarizeSilamDays,
} from "@meteo/db";
import { districts, pollutants, regions, stationPollutants, stations } from "@meteo/db/schema";
import type { Locale } from "@meteo/i18n";
import { AqBadge } from "@meteo/ui/components/aq-badge";
import { Badge } from "@meteo/ui/components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@meteo/ui/components/card";
import { ArrowLeftIcon, HeartPulseIcon } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { StationStatusBadge } from "@/components/admin/stations/station-status-badge";
import { ExceedanceBanner } from "@/components/air/exceedance-banner";
import { MeasurementChartLazy } from "@/components/air/measurement-chart.lazy";
import { SilamDays } from "@/components/air/silam-days";
import { StationMapSection } from "@/components/air/station-map-section";
import { ecoDateValue } from "@/components/eco-bulletins/date";
import { Link } from "@/i18n/navigation";
import {
  bandsByPollutant,
  displayValue,
  effectiveLevel,
  loadCurrentAq,
  loadHealthAdvice,
  type PollutantInfo,
  toPollutantInfo,
} from "@/lib/aq";
import { getDb } from "@/lib/db";
import { name } from "@/lib/format";

export const dynamic = "force-dynamic";

const LEVEL_BORDER: Record<number, string> = {
  1: "border-aq-1/50",
  2: "border-aq-2/50",
  3: "border-aq-3/50",
  4: "border-aq-4/50",
  5: "border-aq-5/50",
  6: "border-aq-6/50",
};
const LEVEL_BAR: Record<number, string> = {
  0: "bg-aq-0",
  1: "bg-aq-1",
  2: "bg-aq-2",
  3: "bg-aq-3",
  4: "bg-aq-4",
  5: "bg-aq-5",
  6: "bg-aq-6",
};

async function loadStation(slug: string) {
  const db = getDb();
  const station = await db
    .select({
      id: stations.id,
      code: stations.code,
      slug: stations.slug,
      name: stations.name,
      description: stations.description,
      address: stations.address,
      kind: stations.kind,
      status: stations.status,
      geom: stations.geom,
      elevationM: stations.elevationM,
      commissionedAt: stations.commissionedAt,
      sampling: stations.sampling,
      dataSource: stations.dataSource,
      region: regions.name,
      district: districts.name,
    })
    .from(stations)
    .leftJoin(regions, eq(regions.id, stations.regionId))
    .leftJoin(districts, eq(districts.id, stations.districtId))
    .where(and(eq(stations.slug, slug), eq(stations.isPublic, true)))
    .then((r) => r[0]);
  if (!station) return null;
  const measured = await db
    .select({
      id: pollutants.id,
      code: pollutants.code,
      shortName: pollutants.shortName,
      unit: pollutants.unit,
      decimals: pollutants.decimals,
    })
    .from(stationPollutants)
    .innerJoin(pollutants, eq(pollutants.id, stationPollutants.pollutantId))
    .where(and(eq(stationPollutants.stationId, station.id), eq(stationPollutants.active, true)))
    .orderBy(pollutants.sortOrder);
  return { station, measured };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const data = await loadStation(slug);
  if (!data) return {};
  const t = await getTranslations({ locale: locale as Locale, namespace: "air" });
  return { title: `${name(data.station.name, locale)} · ${t("title")}` };
}

type RatioRow = {
  pollutant: PollutantInfo;
  dailyMean: number | null;
  dailyLimit: number | null;
  dailyRatio: number | null;
  maxSingle: number | null;
  maxSingleLimit: number | null;
  maxSingleRatio: number | null;
};

export default async function StationPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = (await params) as { locale: Locale; slug: string };
  setRequestLocale(locale);
  const data = await loadStation(slug);
  if (!data) notFound();
  const { station } = data;
  const db = getDb();
  const [t, ts, tl, tp, ti, format, aq, config, ratioAq] = await Promise.all([
    getTranslations("station"),
    getTranslations("stations"),
    getTranslations("levels"),
    getTranslations("pollutants"),
    getTranslations("index"),
    getFormatter(),
    loadCurrentAq([station.id]),
    loadIndexConfig(db).catch(() => null),
    getCurrentIndexes(db, { scaleCode: RATIO_SCALE_CODE, stationIds: [station.id] }).catch(
      () => null,
    ),
  ]);
  // Измеряемые вещества в единицах отображения (настройка единиц портала).
  const measured = data.measured.map((m) => toPollutantInfo(m, aq.displayMode));
  const idx = aq.byStation.get(station.id);
  const level = effectiveLevel(idx);
  const advice = aq.scale ? await loadHealthAdvice(aq.scale.id, level) : [];
  const general = advice.find((a) => a.audience === "general");
  const dominant = idx?.dominantPollutantId
    ? aq.pollutantsById.get(idx.dominantPollutantId)
    : undefined;
  const bands = bandsByPollutant(aq.scale, aq.pollutantsById);
  const todayKey = localDateKey(new Date());
  const ecoBulletin = await latestPublishedEcoBulletin(getDb(), station.id).catch(() => null);
  const silamDays = config
    ? await getSilamPointForecast(db, { stationId: station.id })
        .then((silam) =>
          summarizeSilamDays(silam.rows, publicThresholds(config))
            .filter((d) => d.date >= todayKey)
            .slice(0, 3),
        )
        .catch(() => [])
    : [];
  const levelLabels = Object.fromEntries(
    [0, 1, 2, 3, 4, 5, 6].map((l) => [String(l), tl(`${l}` as "0")]),
  );
  const pollutantLabel = (code: string, fallback: string) =>
    tp.has(code as "PM25") ? tp(code as "PM25") : fallback;
  const num = (v: number | null, decimals: number) =>
    v === null ? "—" : format.number(v, { maximumFractionDigits: decimals });

  // Методика Агентства: кратность ПДКс.с./ПДКм.р., суммация NO₂+SO₂, случаи ВЗ/ЭВЗ (шкала RATIO_TO_LIMIT).
  const ratioIdx = ratioAq?.scale ? ratioAq.byStation.get(station.id) : undefined;
  const ratioFresh = ratioIdx && !ratioIdx.stale ? ratioIdx : undefined;
  const indicators = ratioFresh?.indicators ?? null;
  const limitOf = (list: Array<{ pollutantId: number; limit: number }> | undefined, id: number) =>
    list?.find((l) => l.pollutantId === id)?.limit ?? null;
  const ratioRows: RatioRow[] = ratioFresh
    ? measured
        .map((p): RatioRow | null => {
          const sub = ratioFresh.subIndices[String(p.id)];
          const single = indicators?.maxSingle[String(p.id)];
          if (!sub && !single) return null;
          return {
            pollutant: p,
            dailyMean: sub ? displayValue(p, sub.value) : null,
            dailyLimit: displayValue(p, limitOf(config?.dailyLimits, p.id)),
            dailyRatio: sub?.index ?? null,
            maxSingle: single ? displayValue(p, single.value) : null,
            maxSingleLimit: displayValue(p, limitOf(config?.maxSingleLimits, p.id)),
            maxSingleRatio: single?.ratio ?? null,
          };
        })
        .filter((r): r is RatioRow => r !== null)
    : [];
  const measuresBoth =
    measured.some((p) => p.code === "NO2") && measured.some((p) => p.code === "SO2");
  const ratioCell = (ratio: number | null) =>
    ratio === null ? (
      <span className="text-muted-foreground">—</span>
    ) : ratio >= 1 ? (
      <span className="font-semibold text-aq-4">
        {num(ratio, 2)}
        <span className="sr-only"> · {ti("agency.exceeds")}</span>
      </span>
    ) : (
      <span className="tabular-nums">{num(ratio, 2)}</span>
    );

  return (
    <div className="container-page flex flex-col gap-8 py-10">
      <div className="flex flex-col gap-3">
        <Link
          href="/air"
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" aria-hidden="true" />
          {t("backToList")}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">
            {name(station.name, locale) || station.code}
          </h1>
          <StationStatusBadge status={station.status} label={ts(`status.${station.status}`)} />
        </div>
        <p className="text-muted-foreground">
          {[
            name(station.region, locale),
            name(station.district, locale),
            name(station.address, locale),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      <ExceedanceBanner locale={locale} stationId={station.id} />
      <section className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card className={LEVEL_BORDER[level]}>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-3">
              <AqBadge
                level={level}
                label={tl(`${level}` as "0")}
                value={
                  idx?.value !== null && idx?.value !== undefined && !idx.stale
                    ? format.number(idx.value, { maximumFractionDigits: 1 })
                    : undefined
                }
                size="lg"
              />
              <span className="text-base font-normal text-muted-foreground">{t("current")}</span>
            </CardTitle>
            <CardDescription className="flex flex-wrap gap-x-4 gap-y-1">
              {idx ? (
                <span>
                  {format.relativeTime(idx.time)}
                  {idx.stale ? ` · ${ti("stale")}` : ""}
                </span>
              ) : (
                <span>{t("noData")}</span>
              )}
              {dominant && !idx?.stale ? (
                <span>
                  {ti("dominant")}: {pollutantLabel(dominant.code, dominant.shortName)}
                </span>
              ) : null}
              <span>
                {ti("scale")}: {ti("scaleDefault")}
              </span>
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {measured.map((m) => {
              const sub = idx && !idx.stale ? idx.subIndices[String(m.id)] : undefined;
              const subLevel = sub?.level ?? 0;
              const value = sub ? displayValue(m, sub.value) : null;
              return (
                <div key={m.id} className="relative overflow-hidden rounded-lg border p-3 pl-4">
                  <span
                    className={`absolute inset-y-0 left-0 w-1.5 ${LEVEL_BAR[subLevel] ?? LEVEL_BAR[0]}`}
                    aria-hidden="true"
                  />
                  <p className="text-xs text-muted-foreground">
                    {pollutantLabel(m.code, m.shortName)}
                  </p>
                  <p className="text-2xl font-semibold tabular-nums">
                    {num(value, m.decimals)}
                    <span className="ml-1 text-sm font-normal text-muted-foreground">{m.unit}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">{tl(`${subLevel}` as "0")}</p>
                </div>
              );
            })}
            {measured.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noData")}</p>
            ) : null}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("mapTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-48 overflow-hidden rounded-lg border">
                <StationMapSection
                  locale={locale}
                  className="h-full w-full"
                  compact
                  center={[station.geom.x, station.geom.y]}
                  zoom={11}
                />
              </div>
            </CardContent>
          </Card>
          {silamDays.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("silamTomorrow")}</CardTitle>
                <CardDescription>{t("silamHint")}</CardDescription>
              </CardHeader>
              <CardContent>
                <SilamDays
                  days={silamDays}
                  pollutantsById={aq.pollutantsById}
                  todayKey={todayKey}
                  compact
                />
              </CardContent>
            </Card>
          ) : null}
          {general ? (
            <Card className={LEVEL_BORDER[level]}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <HeartPulseIcon className="size-4" aria-hidden="true" />
                  {name(general.title, locale) || ti("advice")}
                </CardTitle>
                <CardDescription>{ti("adviceGeneral")}</CardDescription>
              </CardHeader>
              <CardContent className="text-sm">{name(general.text, locale)}</CardContent>
            </Card>
          ) : null}
          {ecoBulletin ? (
            <Link
              href={`/air/bulletins/${ecoBulletin.id}`}
              className="text-sm text-brand underline-offset-4 hover:underline"
            >
              {t("ecoBulletin", {
                date: format.dateTime(ecoDateValue(ecoBulletin.date), { dateStyle: "long" }),
              })}
            </Link>
          ) : null}
          <Link
            href={`/subscribe?station=${station.id}`}
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            {ti("subscribeStation")}
          </Link>
        </div>
      </section>

      {measured.length > 0 ? (
        <Card data-testid="agency-ratio">
          <CardHeader>
            <CardTitle className="text-base">{ti("agency.title")}</CardTitle>
            <CardDescription>{ti("agency.hint")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {ratioFresh && ratioRows.length > 0 ? (
              <>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <caption className="sr-only">{ti("agency.caption")}</caption>
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th scope="col" className="px-3 py-2 font-medium">
                          {ti("agency.pollutant")}
                        </th>
                        <th scope="col" className="px-3 py-2 font-medium">
                          {ti("agency.dailyMean")}
                        </th>
                        <th scope="col" className="px-3 py-2 font-medium">
                          {ti("agency.dailyLimit")}
                        </th>
                        <th scope="col" className="px-3 py-2 font-medium">
                          {ti("agency.dailyRatio")}
                        </th>
                        <th scope="col" className="px-3 py-2 font-medium">
                          {ti("agency.maxSingle")}
                        </th>
                        <th scope="col" className="px-3 py-2 font-medium">
                          {ti("agency.maxSingleLimit")}
                        </th>
                        <th scope="col" className="px-3 py-2 font-medium">
                          {ti("agency.maxSingleRatio")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {ratioRows.map((r) => (
                        <tr key={r.pollutant.id} className="border-b last:border-b-0">
                          <th scope="row" className="px-3 py-2 text-left font-medium">
                            {pollutantLabel(r.pollutant.code, r.pollutant.shortName)}
                            <span className="block text-xs font-normal text-muted-foreground">
                              {r.pollutant.shortName}, {r.pollutant.unit}
                            </span>
                          </th>
                          <td className="px-3 py-2 tabular-nums">
                            {num(r.dailyMean, r.pollutant.decimals)}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground tabular-nums">
                            {num(r.dailyLimit, r.pollutant.decimals)}
                          </td>
                          <td className="px-3 py-2 tabular-nums">{ratioCell(r.dailyRatio)}</td>
                          <td className="px-3 py-2 tabular-nums">
                            {num(r.maxSingle, r.pollutant.decimals)}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground tabular-nums">
                            {num(r.maxSingleLimit, r.pollutant.decimals)}
                          </td>
                          <td className="px-3 py-2 tabular-nums">{ratioCell(r.maxSingleRatio)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                  {indicators?.no2so2Sum !== null && indicators?.no2so2Sum !== undefined ? (
                    <p data-testid="agency-sum">
                      <span className="font-medium">{ti("agency.sum")}: </span>
                      {ratioCell(indicators.no2so2Sum)}
                      <span className="text-muted-foreground"> · {ti("agency.sumHint")}</span>
                    </p>
                  ) : !measuresBoth ? (
                    <p className="text-muted-foreground">{ti("agency.sumNotMeasured")}</p>
                  ) : null}
                  {indicators?.extremeHighPollution ? (
                    <Badge variant="destructive">
                      {ti("agency.extremeHighPollution")} · {ti("agency.extremeHighPollutionLong")}
                    </Badge>
                  ) : indicators?.highPollution ? (
                    <Badge variant="destructive">
                      {ti("agency.highPollution")} · {ti("agency.highPollutionLong")}
                    </Badge>
                  ) : (
                    <p className="text-muted-foreground">{ti("agency.noCases")}</p>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {ti("agency.asOf", {
                    time: format.dateTime(ratioFresh.time, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }),
                  })}
                  {" · "}
                  <Link href="/air/index" className="underline-offset-4 hover:underline">
                    {ti("about")}
                  </Link>
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{ti("agency.noData")}</p>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{ti("chartTitle")}</CardTitle>
          <CardDescription>{ti("bandsHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          {measured.length > 0 ? (
            <MeasurementChartLazy
              stationSlug={station.slug}
              pollutants={measured.map((m) => ({
                code: m.code,
                shortName: m.shortName,
                unit: m.unit,
                decimals: m.decimals,
              }))}
              bands={bands}
              locale={locale}
              labels={{
                ranges: {
                  "24h": ti("ranges.24h"),
                  "7d": ti("ranges.7d"),
                  "30d": ti("ranges.30d"),
                  "1y": ti("ranges.1y"),
                },
                pollutant: ti("pollutant"),
                downloadCsv: ti("downloadCsv"),
                noData: ti("noData"),
                loading: ti("loading"),
                hourly: ti("hourly"),
                daily: ti("daily"),
                levels: levelLabels,
              }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{t("noData")}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("passport")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">{t("code")}</dt>
              <dd className="font-mono">{station.code}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("kind")}</dt>
              <dd>{ts(`kind.${station.kind}`)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("coordinates")}</dt>
              <dd className="tabular-nums">
                {station.geom.y.toFixed(5)}, {station.geom.x.toFixed(5)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("elevation")}</dt>
              <dd>{station.elevationM !== null ? `${station.elevationM} м` : "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("commissioned")}</dt>
              <dd>{station.commissionedAt ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("sampling")}</dt>
              <dd>{ts(`sampling.${station.sampling}`)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("source")}</dt>
              <dd>{ts(`dataSource.${station.dataSource}`)}</dd>
            </div>
          </dl>
          {name(station.description, locale) ? (
            <p className="mt-4 text-sm text-muted-foreground">
              {name(station.description, locale)}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
