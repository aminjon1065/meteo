import { getLastForecastRun } from "@meteo/db";
import type { Locale } from "@meteo/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@meteo/ui/components/card";
import { CloudSunIcon } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { LocationCard } from "@/components/weather/location-card";
import { WeatherSymbol } from "@/components/weather/weather-symbol";
import { Link } from "@/i18n/navigation";
import { getDb } from "@/lib/db";
import { name } from "@/lib/format";
import { loadWeatherOverview, symbolLabel } from "@/lib/weather";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: "weather" });
  return { title: t("title"), description: t("intro") };
}

export default async function WeatherPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const [t, ts, format, overview, lastRun] = await Promise.all([
    getTranslations("weather"),
    getTranslations("weatherSymbols"),
    getFormatter(),
    loadWeatherOverview().catch(() => []),
    getLastForecastRun(getDb(), "smartmet").catch(() => null),
  ]);
  const featured = overview.filter((o) => o.location.featured);
  const others = overview.filter((o) => !o.location.featured);
  const hasData = overview.some((o) => o.now || o.today);
  const stale = hasData && (!lastRun || Date.now() - lastRun.fetchedAt.getTime() > 3 * 3_600_000);

  return (
    <div className="container-page flex flex-col gap-8 py-10">
      <div className="flex flex-col gap-3">
        <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight">
          <CloudSunIcon className="size-8 text-brand" aria-hidden="true" />
          {t("title")}
        </h1>
        <p className="max-w-3xl text-muted-foreground">{t("intro")}</p>
      </div>

      {!hasData ? (
        <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          {t("noForecast")}
        </p>
      ) : null}
      {stale ? (
        <p className="rounded-lg border border-status-stale/60 bg-status-stale/10 p-3 text-sm">
          {t("stale")}
          {lastRun ? ` · ${t("updated", { time: format.relativeTime(lastRun.fetchedAt) })}` : ""}
        </p>
      ) : null}

      {featured.length > 0 ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold">{t("featured")}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((o) => (
              <LocationCard key={o.location.id} overview={o} locale={locale} />
            ))}
          </div>
        </section>
      ) : null}

      {others.length > 0 ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold">{t("otherLocations")}</h2>
          <Card>
            <CardContent className="divide-y p-0">
              {others.map((o) => {
                const code = o.now?.params.symbol ?? o.today?.symbol ?? null;
                return (
                  <Link
                    key={o.location.id}
                    href={`/weather/${o.location.slug}`}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/40"
                  >
                    <WeatherSymbol code={code} label={symbolLabel(ts, code)} className="size-9" />
                    <span className="flex flex-1 flex-col">
                      <span className="font-medium">{name(o.location.name, locale)}</span>
                      <span className="text-xs text-muted-foreground">
                        {name(o.location.regionName, locale)}
                      </span>
                    </span>
                    <span className="text-lg font-semibold tabular-nums">
                      {o.now?.params.t === null || o.now?.params.t === undefined
                        ? "—"
                        : `${format.number(o.now.params.t, { maximumFractionDigits: 0 })}°`}
                    </span>
                    {o.today ? (
                      <span className="w-20 text-right text-sm text-muted-foreground tabular-nums">
                        {o.today.tmax === null
                          ? "—"
                          : format.number(o.today.tmax, { maximumFractionDigits: 0 })}
                        ° /{" "}
                        {o.today.tmin === null
                          ? "—"
                          : format.number(o.today.tmin, { maximumFractionDigits: 0 })}
                        °
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </CardContent>
          </Card>
        </section>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("embedTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
          <p>{t("embedHint")}</p>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs text-foreground">
            {`<iframe src="${process.env.NEXT_PUBLIC_APP_URL ?? ""}${locale === "tg" ? "" : `/${locale}`}/embed/forecast?location=dushanbe" width="320" height="260" style="border:0" loading="lazy" title="${t("title")}"></iframe>`}
          </pre>
          <p>{t("source")}</p>
        </CardContent>
      </Card>
    </div>
  );
}
