import {
  AQ_LEVELS_FIVE,
  type AqLevel,
  clampAqLevel,
  type DisplayScale,
  toDisplayValue,
} from "@meteo/core";
import { asc, loadIndexConfig } from "@meteo/db";
import { limitValues, pollutants } from "@meteo/db/schema";
import type { Locale } from "@meteo/i18n";
import { AqBadge } from "@meteo/ui/components/aq-badge";
import type { Metadata } from "next";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { LevelLegend } from "@/components/air/level-legend";
import { PageHeader } from "@/components/site/page-header";
import { Link } from "@/i18n/navigation";
import { getDb } from "@/lib/db";
import { name } from "@/lib/format";
import { displayScaleOf, getConcentrationDisplayMode } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: "aboutIndex" });
  return { title: t("title"), description: t("intro") };
}

type Breakpoint = {
  pollutantId: number;
  level: number;
  lo: number;
  hi: number | null;
  averagingMin: number;
};

type PollutantRow = {
  id: number;
  code: string;
  shortName: string;
  unit: string;
  decimals: number;
  hazardClass: number | null;
  /** Единица отображения портала и множитель перевода из единицы хранения. */
  display: DisplayScale;
};

/** Таблица порогов шкалы: строки — вещества, столбцы — уровни. Берётся часовое осреднение, иначе минимальное. */
function thresholdRows(breakpoints: Breakpoint[], pollutantList: PollutantRow[]) {
  const rows: Array<{
    pollutant: PollutantRow;
    averagingMin: number;
    bands: Map<number, Breakpoint>;
  }> = [];
  for (const p of pollutantList) {
    const own = breakpoints.filter((b) => b.pollutantId === p.id);
    if (own.length === 0) continue;
    const averages = [...new Set(own.map((b) => b.averagingMin))];
    const averagingMin = averages.includes(60) ? 60 : Math.min(...averages);
    const bands = new Map(
      own.filter((b) => b.averagingMin === averagingMin).map((b) => [b.level, b]),
    );
    rows.push({ pollutant: p, averagingMin, bands });
  }
  return rows;
}

/** «Об индексе»: методика, пороги из БД, цвета, национальный индекс (кратность ПДК, ИЗА), шкала ВОЗ. */
export default async function AboutIndexPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const db = getDb();
  const [t, tl, tp, format, config, storedPollutants, limits, mode] = await Promise.all([
    getTranslations("aboutIndex"),
    getTranslations("levels"),
    getTranslations("pollutants"),
    getFormatter(),
    loadIndexConfig(db).catch(() => ({
      scales: [],
      dailyLimits: [],
      maxSingleLimits: [],
      pollutantIdByCode: {},
    })),
    db
      .select({
        id: pollutants.id,
        code: pollutants.code,
        shortName: pollutants.shortName,
        unit: pollutants.unit,
        decimals: pollutants.decimals,
        hazardClass: pollutants.hazardClass,
      })
      .from(pollutants)
      .orderBy(asc(pollutants.sortOrder))
      .catch(() => []),
    db
      .select({
        pollutantId: limitValues.pollutantId,
        kind: limitValues.kind,
        value: limitValues.value,
      })
      .from(limitValues)
      .catch(() => []),
    getConcentrationDisplayMode(),
  ]);
  // Пороги и ПДК показываем в единице отображения портала (µg/m³ или mg/m³ как в бюллетенях).
  const pollutantRows: PollutantRow[] = storedPollutants.map((p) => ({
    ...p,
    display: displayScaleOf(p, mode),
  }));
  const publicScale = config.scales.find((s) => s.isDefaultPublic) ?? config.scales[0] ?? null;
  // Раздел «Как читать цвета»: уровни публичной шкалы (пять — оперативная, шесть — US AQI).
  const publicLevels: readonly AqLevel[] = publicScale?.levels.length
    ? [...publicScale.levels]
        .map((l) => clampAqLevel(l.level))
        .filter((l): l is AqLevel => l > 0)
        .sort((a, b) => a - b)
    : AQ_LEVELS_FIVE;
  const whoScale = config.scales.find((s) => s.code.startsWith("WHO")) ?? null;
  const izaScale = config.scales.find((s) => s.kind === "iza") ?? null;
  const pollutantLabel = (code: string, shortName: string) =>
    tp.has(code as "PM25") ? tp(code as "PM25") : shortName;
  const num = (v: number) => format.number(v, { maximumFractionDigits: 3 });
  /** Число в единице отображения вещества (µg/m³ → mg/m³ с тремя дополнительными знаками). */
  const conc = (v: number | null | undefined, display: DisplayScale) => {
    const shown = toDisplayValue(v, display);
    return shown === null
      ? "—"
      : format.number(shown, { maximumFractionDigits: Math.max(3, display.decimals) });
  };
  const band = (b: Breakpoint | undefined, display: DisplayScale) =>
    !b
      ? "—"
      : b.hi === null
        ? `≥ ${conc(b.lo, display)}`
        : b.lo === 0
          ? `< ${conc(b.hi, display)}`
          : `${conc(b.lo, display)} – ${conc(b.hi, display)}`;
  const averaging = (min: number) =>
    min >= 1440
      ? t("avg24h")
      : min >= 480
        ? t("avg8h")
        : min >= 60
          ? t("avg1h")
          : t("avgMin", { min });

  const renderScaleTable = (scale: NonNullable<typeof publicScale>) => {
    const rows = thresholdRows(scale.breakpoints, pollutantRows);
    const scaleLevels = [...scale.levels]
      .map((l) => clampAqLevel(l.level))
      .filter((l): l is AqLevel => l > 0)
      .sort((a, b) => a - b);
    return (
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <caption className="sr-only">{t("thresholdsCaption")}</caption>
          <thead>
            <tr className="border-b bg-surface-2/60 text-left text-caption text-muted-foreground">
              <th scope="col" className="px-3 py-2 font-medium">
                {t("pollutant")}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {t("averaging")}
              </th>
              {scaleLevels.map((lv) => (
                <th key={lv} scope="col" className="px-3 py-2 text-center font-medium">
                  <AqBadge level={lv} label={tl(`${lv}`)} size="sm" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.pollutant.id} className="border-b last:border-b-0">
                <th scope="row" className="px-3 py-2 text-left font-medium">
                  {pollutantLabel(r.pollutant.code, r.pollutant.shortName)}
                  <span className="block text-xs font-normal text-muted-foreground">
                    {r.pollutant.shortName}, {r.pollutant.display.unit}
                  </span>
                </th>
                <td className="px-3 py-2 text-muted-foreground">{averaging(r.averagingMin)}</td>
                {scaleLevels.map((lv) => (
                  <td key={lv} className="px-3 py-2 text-center tabular-nums">
                    {band(r.bands.get(lv), r.pollutant.display)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="container-page flex flex-col gap-10 py-8">
      <PageHeader title={t("title")} intro={t("intro")}>
        <LevelLegend levels={publicScale?.levels.map((l) => l.level)} />
      </PageHeader>

      <section className="flex flex-col gap-4" id="thresholds">
        <h2 className="text-h2">{t("operational.title")}</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {(["measure", "subindex", "max"] as const).map((step, i) => (
            <div key={step} className="rounded-xl border bg-card px-4 py-3.5">
              <p className="eyebrow">{t("step", { n: i + 1 })}</p>
              <h3 className="mt-1 text-h3">{t(`operational.${step}.title`)}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{t(`operational.${step}.text`)}</p>
            </div>
          ))}
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">{t("operational.note")}</p>
        {publicScale ? (
          <>
            <h3 className="text-h3">
              {t("thresholds")} · {publicScale.code}
            </h3>
            {renderScaleTable(publicScale)}
            <p className="text-xs text-muted-foreground">{t("thresholdsHint")}</p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t("noScale")}</p>
        )}
      </section>

      <section className="flex flex-col gap-4" data-testid="agency-method">
        <h2 className="text-h2">{t("agency.title")}</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">{t("agency.intro")}</p>
        <div className="grid gap-4 md:grid-cols-3">
          {(["ratio", "sum", "cases"] as const).map((part) => (
            <div key={part} className="rounded-xl border bg-card px-4 py-3.5">
              <h3 className="text-h3">{t(`agency.${part}.title`)}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{t(`agency.${part}.text`)}</p>
            </div>
          ))}
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">{t("agency.compare")}</p>
        <p className="max-w-3xl text-sm text-muted-foreground">{t("agency.units")}</p>
      </section>

      <section className="flex flex-col gap-4" id="levels">
        <h2 className="text-h2">{t("colors.title")}</h2>
        <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {publicLevels.map((lv) => (
            <li
              key={lv}
              className="flex flex-wrap items-start gap-x-3 gap-y-1.5 rounded-xl border bg-card px-4 py-3.5"
            >
              <AqBadge level={lv} label={tl(`${lv}`)} size="md" className="shrink-0" />
              <p className="text-sm text-muted-foreground">
                {t(`colors.level${lv}` as "colors.level1")}
              </p>
            </li>
          ))}
          <li className="flex flex-wrap items-start gap-x-3 gap-y-1.5 rounded-xl border bg-card px-4 py-3.5">
            <AqBadge level={0} label={tl("0")} size="md" className="shrink-0" />
            <p className="text-sm text-muted-foreground">{t("colors.level0")}</p>
          </li>
        </ul>
        <p className="max-w-3xl text-sm text-muted-foreground">{t("colors.accessibility")}</p>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-h2">{t("national.title")}</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">{t("national.ratio")}</p>
        <p className="max-w-3xl text-sm text-muted-foreground">{t("national.iza")}</p>
        {izaScale && izaScale.levels.length > 0 ? (
          <ul className="flex flex-wrap gap-2 text-sm">
            {izaScale.levels.map((lv) => (
              <li key={lv.level} className="rounded-full border bg-card px-3 py-1">
                <span className="font-medium">{name(lv.label, locale) || lv.level}</span>
                <span className="text-muted-foreground">
                  {" "}
                  {lv.hi === null || lv.hi === undefined
                    ? `≥ ${num(lv.lo ?? 0)}`
                    : `${num(lv.lo ?? 0)} – ${num(lv.hi)}`}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {limits.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-sm">
              <caption className="sr-only">{t("limitsCaption")}</caption>
              <thead>
                <tr className="border-b bg-surface-2/60 text-left text-caption text-muted-foreground">
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t("pollutant")}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t("limits.daily")}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t("limits.maxSingle")}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t("limits.hazardClass")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {pollutantRows.map((p) => {
                  const daily = limits.find((l) => l.pollutantId === p.id && l.kind === "daily");
                  const single = limits.find(
                    (l) => l.pollutantId === p.id && l.kind === "max_single",
                  );
                  if (!daily && !single) return null;
                  return (
                    <tr key={p.id} className="border-b last:border-b-0">
                      <th scope="row" className="px-3 py-2 text-left font-medium">
                        {pollutantLabel(p.code, p.shortName)}
                        <span className="block text-xs font-normal text-muted-foreground">
                          {p.shortName}, {p.display.unit}
                        </span>
                      </th>
                      <td className="px-3 py-2 tabular-nums">
                        {daily ? conc(daily.value, p.display) : "—"}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {single ? conc(single.value, p.display) : "—"}
                      </td>
                      <td className="px-3 py-2 tabular-nums">{p.hazardClass ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground">{t("national.note")}</p>
      </section>

      {whoScale ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-h2">{t("who.title")}</h2>
          <p className="max-w-3xl text-sm text-muted-foreground">{t("who.text")}</p>
          {renderScaleTable(whoScale)}
        </section>
      ) : null}

      <section className="grid gap-8 lg:grid-cols-2">
        <div className="text-sm">
          <h2 className="mb-2 text-h3">{t("quality.title")}</h2>
          <p className="text-muted-foreground">{t("quality.text")}</p>
          <p className="mt-2 text-muted-foreground">{t("quality.stale")}</p>
        </div>
        <div className="text-sm">
          <h2 className="mb-2 text-h3">{t("more.title")}</h2>
          <ul className="flex flex-col gap-1">
            <li>
              <Link href="/health" className="font-semibold text-brand hover:underline">
                {t("more.health")}
              </Link>
            </li>
            <li>
              <Link href="/air" className="font-semibold text-brand hover:underline">
                {t("more.air")}
              </Link>
            </li>
            <li>
              <Link href="/data/api" className="font-semibold text-brand hover:underline">
                {t("more.api")}
              </Link>
            </li>
          </ul>
        </div>
      </section>
    </div>
  );
}
