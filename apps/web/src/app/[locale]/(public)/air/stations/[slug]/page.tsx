import { type AqLevelOrNone, clampAqLevel } from "@meteo/core";
import {
  and,
  eq,
  getCurrentIndexes,
  getSilamPointForecast,
  inArray,
  latestPublishedEcoBulletin,
  loadIndexConfig,
  localDateKey,
  ne,
  publicThresholds,
  RATIO_SCALE_CODE,
  sql,
  summarizeSilamDays,
} from "@meteo/db";
import {
  districts,
  measurements,
  pollutants,
  regions,
  stationPollutants,
  stations,
} from "@meteo/db/schema";
import type { Locale } from "@meteo/i18n";
import { AqDot } from "@meteo/ui/components/aq-badge";
import { Badge } from "@meteo/ui/components/badge";
import { cn } from "@meteo/ui/lib/utils";
import { ChevronRightIcon } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { ExceedanceNotice } from "@/components/air/exceedance-notice";
import { MeasurementChartLazy } from "@/components/air/measurement-chart.lazy";
import {
  type MissingTile,
  type PollutantTile,
  PollutantTiles,
} from "@/components/air/pollutant-tiles";
import { SilamDays } from "@/components/air/silam-days";
import { StationMapSection } from "@/components/air/station-map-section";
import { Panel, StatusBand } from "@/components/air/status-band";
import { ecoDateValue } from "@/components/eco-bulletins/date";
import { Link } from "@/i18n/navigation";
import { loadSeries } from "@/lib/api/measurement-series";
import {
  bandsByPollutant,
  displayValue,
  effectiveLevel,
  loadCurrentAq,
  loadHealthAdvice,
  type PollutantInfo,
  toPollutantInfo,
} from "@/lib/aq";
import { distanceKm } from "@/lib/city-air";
import { getDb } from "@/lib/db";
import { name } from "@/lib/format";

export const dynamic = "force-dynamic";

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

/** Ближайшая активная публичная станция, измеряющая каждое из веществ (для пустых плиток). */
async function loadNearestWith(
  stationId: number,
  point: { lon: number; lat: number },
  pollutantIds: number[],
) {
  const out = new Map<
    number,
    { slug: string; name: Parameters<typeof name>[0]; distanceKm: number }
  >();
  if (pollutantIds.length === 0) return out;
  const rows = await getDb()
    .select({
      pollutantId: stationPollutants.pollutantId,
      slug: stations.slug,
      name: stations.name,
      geom: stations.geom,
    })
    .from(stationPollutants)
    .innerJoin(stations, eq(stations.id, stationPollutants.stationId))
    .where(
      and(
        inArray(stationPollutants.pollutantId, pollutantIds),
        eq(stationPollutants.active, true),
        eq(stations.isPublic, true),
        eq(stations.status, "active"),
        ne(stations.id, stationId),
      ),
    );
  for (const r of rows) {
    const d = distanceKm(point, { lon: r.geom.x, lat: r.geom.y });
    const prev = out.get(r.pollutantId);
    if (!prev || d < prev.distanceKm)
      out.set(r.pollutantId, { slug: r.slug, name: r.name, distanceKm: d });
  }
  return out;
}

/** Последнее валидное измерение по веществу за всё время (для плиток без данных за сутки). */
async function loadLastEver(stationId: number, pollutantIds: number[]) {
  const out = new Map<number, Date>();
  if (pollutantIds.length === 0) return out;
  const rows = await getDb()
    .select({
      pollutantId: measurements.pollutantId,
      lastAt: sql<Date>`max(${measurements.time})`.mapWith((v) => new Date(v)),
    })
    .from(measurements)
    .where(
      and(
        eq(measurements.stationId, stationId),
        inArray(measurements.pollutantId, pollutantIds),
        sql`${measurements.qcFlag} in (1, 4)`,
      ),
    )
    .groupBy(measurements.pollutantId);
  for (const r of rows) out.set(r.pollutantId, r.lastAt);
  return out;
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
  const [t, ts, tl, tp, ti, tn, format, aq, config, ratioAq, series] = await Promise.all([
    getTranslations("station"),
    getTranslations("stations"),
    getTranslations("levels"),
    getTranslations("pollutantHints"),
    getTranslations("index"),
    getTranslations("nav"),
    getFormatter(),
    loadCurrentAq([station.id]),
    loadIndexConfig(db).catch(() => null),
    getCurrentIndexes(db, { scaleCode: RATIO_SCALE_CODE, stationIds: [station.id] }).catch(
      () => null,
    ),
    loadSeries(station.id, "24h").catch(() => null),
  ]);
  // Измеряемые вещества в единицах отображения (настройка единиц портала).
  const measured = data.measured.map((m) => toPollutantInfo(m, aq.displayMode));
  const idx = aq.byStation.get(station.id);
  const fresh = Boolean(idx && !idx.stale);
  const level = effectiveLevel(idx);
  const advice = aq.scale ? await loadHealthAdvice(aq.scale.id, level) : [];
  const general = advice.find((a) => a.audience === "general");
  const dominant = idx?.dominantPollutantId
    ? aq.pollutantsById.get(idx.dominantPollutantId)
    : undefined;
  const bands = bandsByPollutant(aq.scale, aq.pollutantsById);
  const todayKey = localDateKey(new Date());
  const point = { lon: station.geom.x, lat: station.geom.y };
  // Вещества публичной шкалы, которых станция не измеряет — пустые плитки с ближайшей станцией.
  const coreIds = [...new Set((aq.scale?.breakpoints ?? []).map((b) => b.pollutantId))];
  const missingIds = coreIds.filter((id) => !measured.some((m) => m.id === id));
  const seriesByCode = new Map((series?.series ?? []).map((s) => [s.pollutant.code, s.points]));
  const withoutRecent = measured.filter(
    (m) => !(seriesByCode.get(m.code) ?? []).some((p) => p.v !== null),
  );
  const [ecoBulletin, nearest, lastEver, silamDays] = await Promise.all([
    latestPublishedEcoBulletin(db, station.id).catch(() => null),
    loadNearestWith(station.id, point, missingIds),
    loadLastEver(
      station.id,
      withoutRecent.map((m) => m.id),
    ),
    config
      ? getSilamPointForecast(db, { stationId: station.id })
          .then((silam) =>
            summarizeSilamDays(silam.rows, publicThresholds(config))
              .filter((d) => d.date >= todayKey)
              .slice(0, 4),
          )
          .catch(() => [])
      : Promise.resolve([]),
  ]);
  const levelLabels = Object.fromEntries(
    [0, 1, 2, 3, 4, 5, 6].map((l) => [String(l), tl(`${l}` as "0")]),
  );
  const num = (v: number | null, decimals: number) =>
    v === null ? "—" : format.number(v, { maximumFractionDigits: decimals });
  const hint = (code: string) => (tp.has(code as "PM10") ? tp(code as "PM10") : undefined);

  // Плитки: значение из текущего окна индекса, иначе последняя часовая точка за сутки.
  const tiles: PollutantTile[] = measured.map((m) => {
    const sub = fresh && idx ? idx.subIndices[String(m.id)] : undefined;
    const points = seriesByCode.get(m.code) ?? [];
    const lastPoint = [...points].reverse().find((p) => p.v !== null) ?? null;
    const value = sub ? displayValue(m, sub.value) : (lastPoint?.v ?? null);
    const pollutantBands = bands[m.code] ?? [];
    const levelOf = (v: number | null): AqLevelOrNone => {
      if (v === null) return 0;
      const band = pollutantBands.find((b) => v >= b.lo && (b.hi === null || v < b.hi));
      return band ? clampAqLevel(band.level) : 0;
    };
    return {
      pollutant: m,
      value,
      valueAt: sub && idx ? idx.time : lastPoint ? new Date(lastPoint.t) : null,
      level: sub ? clampAqLevel(sub.level) : levelOf(value),
      points,
      lastEverAt: lastEver.get(m.id) ?? null,
    };
  });
  const missing: MissingTile[] = missingIds
    .map((id) => aq.pollutantsById.get(id))
    .filter((p): p is PollutantInfo => Boolean(p))
    .map((p) => {
      const n = nearest.get(p.id);
      return {
        pollutant: p,
        nearest: n ? { slug: n.slug, name: name(n.name, locale), distanceKm: n.distanceKm } : null,
      };
    });

  // Фраза полосы состояния: определяющее вещество, порог первого уровня, максимум за сутки.
  const dominantValue =
    fresh && idx && dominant
      ? displayValue(dominant, idx.subIndices[String(dominant.id)]?.value)
      : null;
  // Порог во фразе: нижняя граница текущего уровня, а для «хорошего» — его верхняя граница.
  const dominantBands = dominant ? (bands[dominant.code] ?? []) : [];
  const currentBand = dominantBands.find((b) => b.level === level);
  const threshold =
    level >= 2 ? (currentBand?.lo ?? null) : (dominantBands.find((b) => b.level === 1)?.hi ?? null);
  const dayPoints = dominant ? (seriesByCode.get(dominant.code) ?? []) : [];
  const dayMax = dayPoints.reduce<{ v: number; t: string } | null>(
    (best, p) => (p.max !== null && (!best || p.max > best.v) ? { v: p.max, t: p.t } : best),
    null,
  );
  const statusText = fresh
    ? [
        dominant && dominantValue !== null
          ? threshold !== null
            ? t(level >= 2 ? "determines" : "determinesGood", {
                pollutant: dominant.shortName,
                value: num(dominantValue, dominant.decimals),
                unit: dominant.unit,
                threshold: num(threshold, dominant.decimals),
              })
            : t("determinesNoThreshold", {
                pollutant: dominant.shortName,
                value: num(dominantValue, dominant.decimals),
                unit: dominant.unit,
              })
          : null,
        dominant && dayMax
          ? t("dayMax", {
              value: num(dayMax.v, dominant.decimals),
              unit: dominant.unit,
              time: format.dateTime(new Date(dayMax.t), { hour: "2-digit", minute: "2-digit" }),
            })
          : null,
      ]
        .filter(Boolean)
        .join(" ")
    : idx
      ? t("staleSince", {
          time: format.dateTime(idx.time, {
            day: "numeric",
            month: "long",
            hour: "2-digit",
            minute: "2-digit",
          }),
        })
      : t("noData");
  const scaleTotal = aq.scale?.levels.length ?? 5;

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
      <span className="num">{num(ratio, 2)}</span>
    );
  const th = "px-3 py-2 text-left font-medium";
  const td = "num px-3 py-2";

  const place = [name(station.region, locale), name(station.district, locale)].filter(Boolean);

  return (
    <>
      <div className="container-page">
        <nav
          aria-label={t("breadcrumbs")}
          className="flex flex-wrap items-center gap-1 pt-4 pb-1.5 text-sm text-muted-foreground"
        >
          <Link href="/air" className="hover:text-foreground">
            {tn("airShort")}
          </Link>
          {place.map((p) => (
            <span key={p} className="flex items-center gap-1">
              <ChevronRightIcon className="size-3.5" aria-hidden="true" />
              <span>{p}</span>
            </span>
          ))}
          <ChevronRightIcon className="size-3.5" aria-hidden="true" />
          <span className="text-foreground" aria-current="page">
            {name(station.name, locale) || station.code}
          </span>
        </nav>
        <div className="flex flex-wrap items-end gap-x-5 gap-y-2.5 pt-1 pb-5">
          <h1 className="text-h1">{name(station.name, locale) || station.code}</h1>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-caption font-semibold">
            <AqDot
              level={station.status === "active" ? 1 : station.status === "suspended" ? 2 : 0}
              className="size-2"
            />
            {ts(`status.${station.status}`)} ·{" "}
            {station.sampling === "continuous" ? t("samplingContinuous") : t("samplingDiscrete")}
          </span>
          <span className="num text-sm text-muted-foreground">
            {station.geom.y.toFixed(4)}, {station.geom.x.toFixed(4)}
            {station.elevationM !== null ? ` · ${station.elevationM} ${t("m")}` : ""}
          </span>
        </div>
      </div>

      <StatusBand
        compact
        className="border-t"
        eyebrow={
          idx
            ? t("nowAt", {
                time: format.dateTime(idx.time, { hour: "2-digit", minute: "2-digit" }),
              })
            : t("now")
        }
        level={level}
        levelLabel={tl(`${level}` as "0")}
        scaleLabel={t("scaleLabel", { level, total: scaleTotal, label: tl(`${level}` as "0") })}
        scaleLevels={aq.scale?.levels.map((l) => l.level)}
        advice={statusText}
        aside={
          <>
            {general ? (
              <Panel className="grid gap-1.5">
                <p className="eyebrow">{t("recommendations")}</p>
                <p>{name(general.text, locale)}</p>
                <Link href="/health" className="text-sm font-semibold text-brand hover:underline">
                  {t("allGroups")} →
                </Link>
              </Panel>
            ) : null}
            <ExceedanceNotice locale={locale} stationId={station.id} />
          </>
        }
      />

      <div className="container-page flex flex-col gap-9 py-8">
        <section aria-labelledby="pollutants-heading">
          <div className="section-head">
            <h2 id="pollutants-heading" className="text-h2">
              {t("pollutantsTitle")}
            </h2>
            <span className="text-sm text-muted-foreground">{t("pollutantsHint")}</span>
          </div>
          {tiles.length === 0 && missing.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noData")}</p>
          ) : (
            <PollutantTiles tiles={tiles} missing={missing} />
          )}
        </section>

        {measured.length > 0 ? (
          <section
            className="rounded-xl border bg-card px-4 py-4 sm:px-[1.125rem]"
            aria-labelledby="chart-heading"
          >
            <h2 id="chart-heading" className="sr-only">
              {ti("chartTitle")}
            </h2>
            <MeasurementChartLazy
              stationSlug={station.slug}
              pollutants={measured.map((m) => ({
                code: m.code,
                shortName: m.shortName,
                unit: m.unit,
                decimals: m.decimals,
                hint: hint(m.code),
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
                hint: t("chartHint", { pollutant: "{pollutant}" }),
                title: ti("chartTitle"),
              }}
            />
          </section>
        ) : null}

        {measured.length > 0 ? (
          <section
            className="rounded-xl border bg-card px-4 py-4 sm:px-[1.125rem]"
            data-testid="agency-ratio"
          >
            <div className="section-head mb-2">
              <h2 className="text-h3">{ti("agency.title")}</h2>
            </div>
            <p className="mb-3 max-w-3xl text-sm text-muted-foreground">{ti("agency.hint")}</p>
            {ratioFresh && ratioRows.length > 0 ? (
              <div className="flex flex-col gap-3">
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <caption className="sr-only">{ti("agency.caption")}</caption>
                    <thead>
                      <tr className="border-b bg-surface-2/60 text-caption text-muted-foreground">
                        <th scope="col" className={th}>
                          {ti("agency.pollutant")}
                        </th>
                        <th scope="col" className={th}>
                          {ti("agency.dailyMean")}
                        </th>
                        <th scope="col" className={th}>
                          {ti("agency.dailyLimit")}
                        </th>
                        <th scope="col" className={th}>
                          {ti("agency.dailyRatio")}
                        </th>
                        <th scope="col" className={th}>
                          {ti("agency.maxSingle")}
                        </th>
                        <th scope="col" className={th}>
                          {ti("agency.maxSingleLimit")}
                        </th>
                        <th scope="col" className={th}>
                          {ti("agency.maxSingleRatio")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {ratioRows.map((r) => (
                        <tr key={r.pollutant.id} className="border-b last:border-b-0">
                          <th scope="row" className={cn(th, "font-semibold")}>
                            <abbr title={hint(r.pollutant.code)} className="no-underline">
                              {r.pollutant.shortName}
                            </abbr>
                            <span className="block text-caption font-normal text-muted-foreground">
                              {r.pollutant.unit}
                            </span>
                          </th>
                          <td className={td}>{num(r.dailyMean, r.pollutant.decimals)}</td>
                          <td className={cn(td, "text-muted-foreground")}>
                            {num(r.dailyLimit, r.pollutant.decimals)}
                          </td>
                          <td className={td}>{ratioCell(r.dailyRatio)}</td>
                          <td className={td}>{num(r.maxSingle, r.pollutant.decimals)}</td>
                          <td className={cn(td, "text-muted-foreground")}>
                            {num(r.maxSingleLimit, r.pollutant.decimals)}
                          </td>
                          <td className={td}>{ratioCell(r.maxSingleRatio)}</td>
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
                <p className="text-caption text-muted-foreground">
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
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{ti("agency.noData")}</p>
            )}
          </section>
        ) : null}

        <section className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
          <div>
            <div className="section-head">
              <h2 className="text-h2">{t("forecastTitle")}</h2>
              <span className="text-sm text-muted-foreground">{t("forecastSource")}</span>
            </div>
            <SilamDays days={silamDays} pollutantsById={aq.pollutantsById} todayKey={todayKey} />
            <p className="mt-2 text-caption text-muted-foreground">{t("silamHint")}</p>
          </div>
          <div>
            <div className="section-head">
              <h2 className="text-h2">{t("about")}</h2>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm sm:grid-cols-3 lg:grid-cols-2">
              <div>
                <dt className="text-caption text-muted-foreground">{t("code")}</dt>
                <dd className="font-medium">{station.code}</dd>
              </div>
              <div>
                <dt className="text-caption text-muted-foreground">{t("kind")}</dt>
                <dd className="font-medium">
                  {ts(`kind.${station.kind}`)} · {ts(`dataSource.${station.dataSource}`)}
                </dd>
              </div>
              <div>
                <dt className="text-caption text-muted-foreground">{t("region")}</dt>
                <dd className="font-medium">{place.join(", ") || "—"}</dd>
              </div>
              {name(station.address, locale) ? (
                <div>
                  <dt className="text-caption text-muted-foreground">{t("address")}</dt>
                  <dd className="font-medium">{name(station.address, locale)}</dd>
                </div>
              ) : null}
              <div>
                <dt className="text-caption text-muted-foreground">{t("elevation")}</dt>
                <dd className="num font-medium">
                  {station.elevationM !== null ? `${station.elevationM} ${t("m")}` : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-caption text-muted-foreground">{t("commissioned")}</dt>
                <dd className="num font-medium">{station.commissionedAt ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-caption text-muted-foreground">{t("sampling")}</dt>
                <dd className="font-medium">{ts(`sampling.${station.sampling}`)}</dd>
              </div>
            </dl>
            {name(station.description, locale) ? (
              <p className="mt-3 text-sm text-muted-foreground">
                {name(station.description, locale)}
              </p>
            ) : null}
            <div className="mt-4 h-40 overflow-hidden rounded-xl border">
              <StationMapSection
                locale={locale}
                className="h-full w-full"
                compact
                center={[station.geom.x, station.geom.y]}
                zoom={11}
              />
            </div>
            <p className="mt-3 flex flex-col gap-1.5 text-sm">
              <Link
                href={`/subscribe?station=${station.id}`}
                className="font-semibold text-brand hover:underline"
              >
                {t("subscribe")} →
              </Link>
              {ecoBulletin ? (
                <Link
                  href={`/air/bulletins/${ecoBulletin.id}`}
                  className="text-muted-foreground hover:underline"
                >
                  {t("ecoBulletin", {
                    date: format.dateTime(ecoDateValue(ecoBulletin.date), { dateStyle: "long" }),
                  })}
                </Link>
              ) : null}
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
