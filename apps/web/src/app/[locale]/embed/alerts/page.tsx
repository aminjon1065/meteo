import { isLocale, type Locale } from "@meteo/i18n";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { SeverityDot } from "@/components/warnings/severity-badge";
import { redirect } from "@/i18n/navigation";
import { name } from "@/lib/format";
import { type LocalizedWarning, loadLocalizedWarnings } from "@/lib/warnings";

export const dynamic = "force-dynamic";

/**
 * /embed/alerts?region=DU&lang=tg — компактный список действующих и ожидаемых предупреждений
 * для iframe на meteo.tj («Метео алерт»). Параметр lang переключает локаль.
 */
export default async function EmbedAlertsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ region?: string; lang?: string; limit?: string }>;
}) {
  const { locale } = (await params) as { locale: Locale };
  const sp = await searchParams;
  if (isLocale(sp.lang) && sp.lang !== locale) {
    redirect({
      href: `/embed/alerts?region=${encodeURIComponent(sp.region ?? "")}`,
      locale: sp.lang,
    });
  }
  setRequestLocale(locale);
  const [t, te, format] = await Promise.all([
    getTranslations("warnings"),
    getTranslations("embed"),
    getFormatter(),
  ]);
  const limit = Math.min(10, Math.max(1, Number(sp.limit) || 5));
  const region = sp.region?.trim().toUpperCase() || undefined;
  const list = await loadLocalizedWarnings(locale, { horizonDays: 3, regionCode: region }).catch(
    () => [] as LocalizedWarning[],
  );
  const base = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}${locale === "tg" ? "" : `/${locale}`}`;
  const dt = (d: Date) =>
    format.dateTime(d, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card p-3 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold">{t("title")}</span>
        <span className="text-xs text-muted-foreground">
          {list.length > 0 ? t("mapCount", { count: list.filter((w) => w.active).length }) : ""}
        </span>
      </div>
      {list.length === 0 ? (
        <p className="text-muted-foreground">{t("none")}</p>
      ) : (
        <ul className="flex flex-col divide-y">
          {list.slice(0, limit).map((w) => (
            <li key={w.id} className="flex gap-2 py-2 first:pt-0 last:pb-0">
              <SeverityDot severity={w.severity} className="mt-1" />
              <div className="flex min-w-0 flex-col">
                <span className="font-medium">{w.headline}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {w.end
                    ? t("period", { from: dt(w.start), to: dt(w.end) })
                    : t("from", { time: dt(w.start) })}
                  {w.regions.length
                    ? ` · ${w.regions.map((r) => name(r.name, locale) || r.code).join(", ")}`
                    : ""}
                  {w.upcoming ? ` · ${t("upcoming").toLowerCase()}` : ""}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      <a
        href={`${base}/warnings`}
        target="_blank"
        rel="noopener"
        className="text-xs text-muted-foreground underline-offset-4 hover:underline"
      >
        {te("poweredBy")} · {te("open")}
      </a>
    </div>
  );
}
