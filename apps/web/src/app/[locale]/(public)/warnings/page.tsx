import { CAP_SEVERITIES, maxSeverity } from "@meteo/core";
import { listWarningRegions, localDateKey, localMidnightUtc } from "@meteo/db";
import type { Locale } from "@meteo/i18n";
import { cn } from "@meteo/ui/lib/utils";
import { SirenIcon } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { SeverityBadge, SeverityDot } from "@/components/warnings/severity-badge";
import { WarningCard } from "@/components/warnings/warning-card";
import { Link } from "@/i18n/navigation";
import { getDb } from "@/lib/db";
import { name } from "@/lib/format";
import { type LocalizedWarning, loadLocalizedWarnings } from "@/lib/warnings";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;
const DAYS = 5;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: "warnings" });
  return { title: t("title"), description: t("intro") };
}

interface DayColumn {
  key: string;
  start: Date;
  end: Date;
}

function overlaps(w: LocalizedWarning, d: DayColumn): boolean {
  return w.start < d.end && (w.end === null || w.end > d.start);
}

/** Предупреждения CAP: матрица «регион × день», карточки выбранного дня, легенда. */
export default async function WarningsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ day?: string; region?: string }>;
}) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const sp = await searchParams;
  const now = new Date();
  const [t, format, warnings, regions] = await Promise.all([
    getTranslations("warnings"),
    getFormatter(),
    loadLocalizedWarnings(locale, { now, horizonDays: DAYS + 2 }).catch(
      () => [] as LocalizedWarning[],
    ),
    listWarningRegions(getDb()).catch(() => []),
  ]);
  const day0 = localMidnightUtc(now);
  const days: DayColumn[] = Array.from({ length: DAYS }, (_, i) => {
    const start = new Date(day0.getTime() + i * DAY);
    return {
      key: localDateKey(new Date(start.getTime() + 3_600_000)),
      start,
      end: new Date(start.getTime() + DAY),
    };
  });
  const selected = days.find((d) => d.key === sp.day) ?? (days[0] as DayColumn);
  const isToday = selected.key === days[0]?.key;
  const regionFilter = regions.find((r) => r.code === sp.region)?.code ?? null;
  const hasUnassigned = warnings.some((w) => w.regionCodes.length === 0);
  const rows = [
    ...regions.map((r) => ({ code: r.code, label: name(r.name, locale) || r.code })),
    ...(hasUnassigned ? [{ code: "", label: t("wholeCountry") }] : []),
  ];
  const cellSeverity = (code: string, d: DayColumn) =>
    maxSeverity(
      warnings
        .filter(
          (w) =>
            overlaps(w, d) && (code ? w.regionCodes.includes(code) : w.regionCodes.length === 0),
        )
        .map((w) => w.severity),
    );
  const dayList = warnings.filter(
    (w) =>
      overlaps(w, selected) &&
      (regionFilter
        ? w.regionCodes.includes(regionFilter)
        : sp.region === "" && hasUnassigned
          ? w.regionCodes.length === 0
          : true),
  );
  const activeList = isToday ? dayList.filter((w) => w.active) : dayList;
  const upcomingList = isToday ? dayList.filter((w) => !w.active) : [];
  const dayLabel = (d: DayColumn, i: number) =>
    i === 0
      ? t("today")
      : i === 1
        ? t("tomorrow")
        : format.dateTime(new Date(d.start.getTime() + 3_600_000), { weekday: "short" });
  const dayDate = (d: DayColumn) =>
    format.dateTime(new Date(d.start.getTime() + 3_600_000), { day: "numeric", month: "short" });

  return (
    <div className="container-page flex flex-col gap-8 py-10">
      <div className="flex flex-col gap-3">
        <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight">
          <SirenIcon className="size-8 text-brand" aria-hidden="true" />
          {t("title")}
        </h1>
        <p className="max-w-3xl text-muted-foreground">{t("intro")}</p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">{t("byRegion")}</h2>
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <caption className="sr-only">{t("dayNav")}</caption>
            <thead>
              <tr className="border-b">
                <th scope="col" className="px-4 py-2 text-left font-medium text-muted-foreground">
                  {t("region")}
                </th>
                {days.map((d, i) => (
                  <th key={d.key} scope="col" className="px-2 py-2 text-center">
                    <Link
                      href={{
                        pathname: "/warnings",
                        query: {
                          day: d.key,
                          ...(sp.region !== undefined ? { region: sp.region } : {}),
                        },
                      }}
                      aria-current={d.key === selected.key ? "date" : undefined}
                      className={cn(
                        "inline-flex flex-col rounded-md px-2 py-1 leading-tight hover:bg-accent",
                        d.key === selected.key && "bg-accent text-accent-foreground",
                      )}
                    >
                      <span className="font-medium">{dayLabel(d, i)}</span>
                      <span className="text-xs text-muted-foreground">{dayDate(d)}</span>
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={DAYS + 1} className="px-4 py-6 text-center text-muted-foreground">
                    {t("none")}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.code || "_"} className="border-b last:border-b-0">
                    <th scope="row" className="px-4 py-2 text-left font-medium">
                      <Link
                        href={{
                          pathname: "/warnings",
                          query: { day: selected.key, region: r.code },
                        }}
                        className={cn(
                          "rounded-md hover:underline",
                          sp.region === r.code && "underline underline-offset-4",
                        )}
                      >
                        {r.label}
                      </Link>
                    </th>
                    {days.map((d) => {
                      const sev = cellSeverity(r.code, d);
                      return (
                        <td key={d.key} className="px-2 py-2 text-center">
                          {sev === "Unknown" ? (
                            <span className="text-muted-foreground/50">—</span>
                          ) : (
                            <Link
                              href={{
                                pathname: "/warnings",
                                query: { day: d.key, region: r.code },
                              }}
                              aria-label={`${r.label}, ${dayDate(d)}: ${t(`severity.${sev}` as "severity.Severe")}`}
                              className="inline-flex"
                            >
                              <SeverityDot severity={sev} className="size-5" />
                            </Link>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {regionFilter || sp.region === "" ? (
          <Link
            href={{ pathname: "/warnings", query: { day: selected.key } }}
            className="w-fit text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            {t("allRegions")}
          </Link>
        ) : null}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">
          {isToday ? t("activeNow") : dayDate(selected)}
          {regionFilter
            ? ` · ${name(regions.find((r) => r.code === regionFilter)?.name, locale) || regionFilter}`
            : ""}
        </h2>
        {activeList.length === 0 ? (
          <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
            {isToday && !regionFilter ? t("none") : t("noneForDay")}
          </p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {activeList.map((w) => (
              <WarningCard key={w.id} warning={w} locale={locale} />
            ))}
          </div>
        )}
        {upcomingList.length > 0 ? (
          <>
            <h2 className="text-xl font-semibold">{t("upcoming")}</h2>
            <div className="grid gap-4 lg:grid-cols-2">
              {upcomingList.map((w) => (
                <WarningCard key={w.id} warning={w} locale={locale} />
              ))}
            </div>
          </>
        ) : null}
      </section>

      <section className="flex flex-col gap-2 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">{t("legend")}</p>
        <div className="flex flex-wrap gap-2">
          {CAP_SEVERITIES.filter((s) => s !== "Unknown").map((s) => (
            <SeverityBadge key={s} severity={s} label={t(`severity.${s}` as "severity.Severe")} />
          ))}
        </div>
        <p>{t("colorHint")}</p>
        <p>
          {t("sourceNote")} ·{" "}
          <a href="/api/v1/alerts" className="underline-offset-4 hover:underline">
            JSON API
          </a>
        </p>
      </section>
    </div>
  );
}
