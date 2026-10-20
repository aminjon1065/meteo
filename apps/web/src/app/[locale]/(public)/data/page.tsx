import type { Locale } from "@meteo/i18n";
import { buttonVariants } from "@meteo/ui/components/button";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PageHeader, Section } from "@/components/site/page-header";
import { Link } from "@/i18n/navigation";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: "data" });
  return { title: t("title"), description: t("intro") };
}

const DATASETS = [
  { key: "stations", href: "/api/v1/stations", page: "/air" },
  { key: "measurements", href: "/api/v1/stations/{slug}/measurements?range=7d", page: "/air" },
  { key: "index", href: "/api/v1/index/current", page: "/air/index" },
  { key: "forecast", href: "/api/v1/forecast/dushanbe", page: "/weather" },
  { key: "silam", href: "/api/v1/silam/dushanbe", page: "/map" },
  { key: "alerts", href: "/api/v1/alerts?active=1", page: "/warnings" },
  { key: "news", href: "/api/v1/news", page: "/news" },
  { key: "regions", href: "/api/v1/regions", page: "/map" },
  { key: "districts", href: "/api/v1/districts", page: "/map" },
] as const;

/** Открытые данные: наборы списком, форматы, лицензия, виджеты. */
export default async function DataPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const t = await getTranslations("data");
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  return (
    <div className="container-page flex flex-col gap-9 py-8">
      <PageHeader
        title={t("title")}
        intro={t("intro")}
        actions={
          <>
            <Link href="/data/api" className={buttonVariants({ size: "lg" })}>
              {t("apiDocs")}
            </Link>
            <a
              href={`/api/v1/openapi.json?lang=${locale}`}
              className={buttonVariants({ variant: "outline", size: "lg" })}
            >
              OpenAPI 3.1 (JSON)
            </a>
          </>
        }
      />

      <Section title={t("datasets.title")} id="datasets">
        <ul className="divide-y rounded-xl border bg-card">
          {DATASETS.map((d) => (
            <li
              key={d.key}
              className="grid gap-x-6 gap-y-1.5 px-4 py-3.5 sm:px-5 lg:grid-cols-[1fr_auto] lg:items-start"
            >
              <div className="grid gap-1">
                <h3 className="text-h3">{t(`datasets.${d.key}.title`)}</h3>
                <p className="text-sm text-muted-foreground">
                  {t(`datasets.${d.key}.description`)}
                </p>
                <code className="w-fit max-w-full rounded-md bg-surface-2 px-2 py-1 font-mono text-xs break-all">
                  GET {base}
                  {d.href}
                </code>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-muted-foreground lg:flex-col lg:items-end lg:text-right">
                <span>
                  {t("updates")}: {t(`datasets.${d.key}.updates`)}
                </span>
                <Link href={d.page} className="font-semibold text-brand hover:underline">
                  {t("onPortal")} →
                </Link>
                {d.key === "measurements" ? <span>{t("csvHint")}</span> : null}
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <div className="grid gap-8 text-sm md:grid-cols-3">
        <section>
          <h2 className="mb-2 text-h3">{t("license.title")}</h2>
          <p className="text-muted-foreground">{t("license.text")}</p>
          <p className="mt-2 text-muted-foreground">{t("license.attribution")}</p>
        </section>
        <section>
          <h2 className="mb-2 text-h3">{t("formats.title")}</h2>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>{t("formats.json")}</li>
            <li>{t("formats.geojson")}</li>
            <li>{t("formats.csv")}</li>
            <li>{t("formats.xml")}</li>
          </ul>
        </section>
        <section>
          <h2 className="mb-2 text-h3">{t("widgets.title")}</h2>
          <p className="text-muted-foreground">{t("widgets.text")}</p>
          <ul className="mt-2 space-y-1 font-mono text-xs break-all">
            <li>{base}/embed/aqi?station=&lt;slug&gt;&amp;lang=tg</li>
            <li>{base}/embed/forecast?location=dushanbe&amp;lang=ru</li>
            <li>{base}/embed/alerts?region=DU&amp;lang=en</li>
          </ul>
        </section>
      </div>

      <p className="text-sm text-muted-foreground">{t("quality")}</p>
    </div>
  );
}
