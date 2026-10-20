import { and, eq, ne } from "@meteo/db";
import { stations } from "@meteo/db/schema";
import { isLocale, type Locale } from "@meteo/i18n";
import { AqBadge } from "@meteo/ui/components/aq-badge";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { displayValue, effectiveLevel, loadCurrentAq } from "@/lib/aq";
import { getDb } from "@/lib/db";
import { name } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * /embed/aqi?station=<slug>&lang=ru — виджет текущего индекса качества воздуха.
 * Без параметра station — станция с самыми свежими данными.
 */
export default async function EmbedAqiPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ station?: string; lang?: string }>;
}) {
  const { locale } = (await params) as { locale: Locale };
  const sp = await searchParams;
  if (isLocale(sp.lang) && sp.lang !== locale) {
    redirect({
      href: `/embed/aqi?station=${encodeURIComponent(sp.station ?? "")}`,
      locale: sp.lang,
    });
  }
  setRequestLocale(locale);
  const [te, tl, tp, format] = await Promise.all([
    getTranslations("embed"),
    getTranslations("levels"),
    getTranslations("pollutants"),
    getFormatter(),
  ]);
  const base = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}${locale === "tg" ? "" : `/${locale}`}`;
  const data = await (async () => {
    const db = getDb();
    const [rows, aq] = await Promise.all([
      db
        .select({ id: stations.id, slug: stations.slug, name: stations.name })
        .from(stations)
        .where(and(eq(stations.isPublic, true), ne(stations.status, "decommissioned"))),
      loadCurrentAq(),
    ]);
    const chosen =
      rows.find((r) => r.slug === sp.station) ??
      rows
        .map((r) => ({ ...r, idx: aq.byStation.get(r.id) }))
        .filter((r) => r.idx)
        .sort((a, b) => (b.idx?.time.getTime() ?? 0) - (a.idx?.time.getTime() ?? 0))[0] ??
      rows[0];
    if (!chosen) return null;
    const idx = aq.byStation.get(chosen.id);
    const dominant = idx?.dominantPollutantId
      ? aq.pollutantsById.get(idx.dominantPollutantId)
      : undefined;
    return { station: chosen, idx, level: effectiveLevel(idx), dominant };
  })().catch(() => null);

  if (!data) {
    return (
      <div className="rounded-lg border bg-card p-3 text-sm text-muted-foreground">
        {te("noData")}
      </div>
    );
  }
  const sub = data.idx && data.dominant ? data.idx.subIndices[String(data.dominant.id)] : undefined;
  const subValue = data.dominant && sub ? displayValue(data.dominant, sub.value) : null;
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card p-3 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold">{name(data.station.name, locale)}</span>
        <span className="text-xs text-muted-foreground">{te("airNow")}</span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <AqBadge level={data.level} label={tl(`${data.level}` as "0")} size="lg" />
        {data.dominant && subValue !== null && !data.idx?.stale ? (
          <span className="flex flex-col text-xs text-muted-foreground">
            <span className="text-2xl font-semibold text-foreground tabular-nums">
              {format.number(subValue, { maximumFractionDigits: data.dominant.decimals })}
              <span className="ml-1 text-sm font-normal text-muted-foreground">
                {data.dominant.unit}
              </span>
            </span>
            <span>
              {tp.has(data.dominant.code as "PM25")
                ? tp(data.dominant.code as "PM25")
                : data.dominant.shortName}
            </span>
          </span>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        {data.idx
          ? `${format.relativeTime(data.idx.time)}${data.idx.stale ? ` · ${te("stale")}` : ""}`
          : te("noData")}
      </p>
      <a
        href={`${base}/air/stations/${data.station.slug}`}
        target="_blank"
        rel="noopener"
        className="text-xs text-muted-foreground underline-offset-4 hover:underline"
      >
        {te("poweredBy")} · {te("open")}
      </a>
    </div>
  );
}
