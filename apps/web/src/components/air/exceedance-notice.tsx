import { displayScaleFor, toDisplayValue } from "@meteo/core";
import type { Locale } from "@meteo/i18n";
import { cn } from "@meteo/ui/lib/utils";
import { getFormatter, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { loadActiveExceedances } from "@/lib/exceedances";
import { name } from "@/lib/format";
import { getConcentrationDisplayMode } from "@/lib/settings";

/**
 * Действующие превышения порогов одной строкой на вещество: «PM10 выше порога на 5 станциях
 * с 18:10 · Что это значит». Для станции — её значение и порог. Вместо красного баннера.
 */
export async function ExceedanceNotice({
  locale,
  stationId,
  className,
}: {
  locale: Locale;
  stationId?: number;
  className?: string;
}) {
  const [t, format, events, mode] = await Promise.all([
    getTranslations("exceedances"),
    getFormatter(),
    loadActiveExceedances(stationId),
    getConcentrationDisplayMode(),
  ]);
  const visible = events.filter((e) => e.channels.includes("portal"));
  if (visible.length === 0) return null;
  const time = (d: Date) => format.dateTime(d, { hour: "2-digit", minute: "2-digit" });

  type Line = { key: string; text: string; since: Date; station?: { slug: string; name: string } };
  const lines: Line[] = [];
  if (stationId) {
    for (const e of visible) {
      const scale = displayScaleFor(e.unit ?? "µg/m³", e.decimals ?? 1, mode);
      lines.push({
        key: String(e.id),
        since: e.startedAt,
        text:
          e.kind === "pollutant"
            ? t("stationLine", {
                pollutant: e.pollutant ?? "",
                value: format.number(toDisplayValue(e.lastValue ?? e.peakValue ?? 0, scale) ?? 0, {
                  maximumFractionDigits: scale.decimals,
                }),
                unit: scale.unit,
                threshold: format.number(toDisplayValue(e.threshold, scale) ?? e.threshold, {
                  maximumFractionDigits: scale.decimals,
                }),
              })
            : t("index", { level: e.level ?? e.threshold }),
      });
    }
  } else {
    const groups = new Map<
      string,
      { label: string; stations: Set<number>; since: Date; first: (typeof visible)[number] }
    >();
    for (const e of visible) {
      const key =
        e.kind === "pollutant"
          ? (e.pollutantCode ?? e.pollutant ?? "?")
          : `index-${e.level ?? e.threshold}`;
      const label =
        e.kind === "pollutant"
          ? (e.pollutant ?? "")
          : t("index", { level: e.level ?? e.threshold });
      const g = groups.get(key) ?? {
        label,
        stations: new Set<number>(),
        since: e.startedAt,
        first: e,
      };
      g.stations.add(e.stationId);
      if (e.startedAt > g.since) g.since = e.startedAt;
      groups.set(key, g);
    }
    for (const [key, g] of groups) {
      const count = g.stations.size;
      lines.push({
        key,
        since: g.since,
        text:
          count === 1
            ? t("noticeOne", { pollutant: g.label, station: name(g.first.stationName, locale) })
            : t("notice", { pollutant: g.label, count }),
        station:
          count === 1
            ? { slug: g.first.stationSlug, name: name(g.first.stationName, locale) }
            : undefined,
      });
    }
  }

  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-xl border border-l-4 border-l-aq-3 bg-card px-3.5 py-3 text-sm",
        className,
      )}
      data-testid="exceedance-notice"
    >
      <span className="mt-1.5 size-2 shrink-0 rounded-full bg-aq-3" aria-hidden="true" />
      <div className="grid gap-1">
        {lines.slice(0, 3).map((l) => (
          <p key={l.key}>
            {l.station ? (
              <Link
                href={`/air/stations/${l.station.slug}`}
                className="font-semibold hover:underline"
              >
                {l.text}
              </Link>
            ) : (
              <b className="font-semibold">{l.text}</b>
            )}{" "}
            <span className="text-muted-foreground">{t("sinceTime", { time: time(l.since) })}</span>
          </p>
        ))}
        <p>
          <Link href="/air/index#thresholds" className="font-semibold text-brand hover:underline">
            {t("whatItMeans")}
          </Link>
        </p>
      </div>
    </div>
  );
}
