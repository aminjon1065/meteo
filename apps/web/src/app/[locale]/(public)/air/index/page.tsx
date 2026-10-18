import { AQ_LEVELS } from "@meteo/core";
import { asc, loadIndexConfig } from "@meteo/db";
import { limitValues, pollutants } from "@meteo/db/schema";
import type { Locale } from "@meteo/i18n";
import { AqBadge } from "@meteo/ui/components/aq-badge";
import { GaugeIcon } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { LevelLegend } from "@/components/air/level-legend";
import { Link } from "@/i18n/navigation";
import { getDb } from "@/lib/db";
import { name } from "@/lib/format";

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

/** Таблица порогов шкалы: строки — вещества, столбцы — уровни. Берётся часовое осреднение, иначе минимальное. */
function thresholdRows(
  breakpoints: Breakpoint[],
  pollutantList: Array<{ id: number; code: string; shortName: string; unit: string }>,
) {
  const rows: Array<{
    pollutant: { id: number; code: string; shortName: string; unit: string };
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
  const [t, tl, tp, format, config, pollutantRows, limits] = await Promise.all([
    getTranslations("aboutIndex"),
    getTranslations("levels"),
    getTranslations("pollutants"),
    getFormatter(),
    loadIndexConfig(db).catch(() => ({ scales: [], dailyLimits: [] })),
    db
      .select({
        id: pollutants.id,
        code: pollutants.code,
        shortName: pollutants.shortName,
        unit: pollutants.unit,
        hazardClass: pollutants.hazardClass,
        name: pollutants.name,
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
  ]);
  const publicScale = config.scales.find((s) => s.isDefaultPublic) ?? config.scales[0] ?? null;
  const whoScale = config.scales.find((s) => s.code.startsWith("WHO")) ?? null;
  const izaScale = config.scales.find((s) => s.kind === "iza") ?? null;
  const pollutantLabel = (code: string, shortName: string) =>
    tp.has(code as "PM25") ? tp(code as "PM25") : shortName;
  const num = (v: number) => format.number(v, { maximumFractionDigits: 3 });
  const band = (b: Breakpoint | undefined) =>
    !b
      ? "—"
      : b.hi === null
        ? `≥ ${num(b.lo)}`
        : b.lo === 0
          ? `< ${num(b.hi)}`
          : `${num(b.lo)} – ${num(b.hi)}`;
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
    return (
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <caption className="sr-only">{t("thresholdsCaption")}</caption>
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th scope="col" className="px-3 py-2 font-medium">
                {t("pollutant")}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {t("averaging")}
              </th>
              {AQ_LEVELS.map((lv) => (
                <th key={lv} scope="col" className="px-3 py-2 text-center font-medium">
                  <AqBadge
                    level={lv}
                    label={
                      name(scale.levels.find((l) => l.level === lv)?.label, locale) || tl(`${lv}`)
                    }
                    size="sm"
                  />
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
                    {r.pollutant.shortName}, {r.pollutant.unit}
                  </span>
                </th>
                <td className="px-3 py-2 text-muted-foreground">{averaging(r.averagingMin)}</td>
                {AQ_LEVELS.map((lv) => (
                  <td key={lv} className="px-3 py-2 text-center tabular-nums">
                    {band(r.bands.get(lv))}
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
    <div className="container-page flex flex-col gap-10 py-10">
      <div className="flex flex-col gap-3">
        <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight">
          <GaugeIcon className="size-8 text-brand" aria-hidden="true" />
          {t("title")}
        </h1>
        <p className="max-w-3xl text-lg text-muted-foreground">{t("intro")}</p>
        <LevelLegend />
      </div>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">{t("operational.title")}</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {(["measure", "subindex", "max"] as const).map((step, i) => (
            <div key={step} className="rounded-xl border bg-card p-5">
              <p className="text-xs font-medium text-muted-foreground uppercase">
                {t("step", { n: i + 1 })}
              </p>
              <h3 className="mt-1 font-semibold">{t(`operational.${step}.title`)}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{t(`operational.${step}.text`)}</p>
            </div>
          ))}
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">{t("operational.note")}</p>
        {publicScale ? (
          <>
            <h3 className="text-base font-semibold">
              {t("thresholds")} ·{" "}
              {name(publicScale.levels.length ? undefined : undefined, locale) || publicScale.code}
            </h3>
            {renderScaleTable(publicScale)}
            <p className="text-xs text-muted-foreground">{t("thresholdsHint")}</p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t("noScale")}</p>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">{t("colors.title")}</h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {AQ_LEVELS.map((lv) => (
            <li key={lv} className="flex items-start gap-3 rounded-xl border bg-card p-4">
              <AqBadge level={lv} label={tl(`${lv}`)} size="md" className="shrink-0" />
              <p className="text-sm text-muted-foreground">
                {t(`colors.level${lv}` as "colors.level1")}
              </p>
            </li>
          ))}
          <li className="flex items-start gap-3 rounded-xl border bg-card p-4">
            <AqBadge level={0} label={tl("0")} size="md" className="shrink-0" />
            <p className="text-sm text-muted-foreground">{t("colors.level0")}</p>
          </li>
        </ul>
        <p className="max-w-3xl text-sm text-muted-foreground">{t("colors.accessibility")}</p>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">{t("national.title")}</h2>
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
                <tr className="border-b text-left text-xs text-muted-foreground">
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
                          {p.unit}
                        </span>
                      </th>
                      <td className="px-3 py-2 tabular-nums">{daily ? num(daily.value) : "—"}</td>
                      <td className="px-3 py-2 tabular-nums">{single ? num(single.value) : "—"}</td>
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
          <h2 className="text-xl font-semibold">{t("who.title")}</h2>
          <p className="max-w-3xl text-sm text-muted-foreground">{t("who.text")}</p>
          {renderScaleTable(whoScale)}
        </section>
      ) : null}

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border bg-card p-6 text-sm">
          <h2 className="mb-2 text-base font-semibold">{t("quality.title")}</h2>
          <p className="text-muted-foreground">{t("quality.text")}</p>
          <p className="mt-2 text-muted-foreground">{t("quality.stale")}</p>
        </div>
        <div className="rounded-xl border bg-card p-6 text-sm">
          <h2 className="mb-2 text-base font-semibold">{t("more.title")}</h2>
          <ul className="flex flex-col gap-1">
            <li>
              <Link href="/health" className="text-brand underline-offset-4 hover:underline">
                {t("more.health")}
              </Link>
            </li>
            <li>
              <Link href="/air" className="text-brand underline-offset-4 hover:underline">
                {t("more.air")}
              </Link>
            </li>
            <li>
              <Link href="/data/api" className="text-brand underline-offset-4 hover:underline">
                {t("more.api")}
              </Link>
            </li>
          </ul>
        </div>
      </section>
    </div>
  );
}
