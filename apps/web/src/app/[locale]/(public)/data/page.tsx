import type { Locale } from "@meteo/i18n";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@meteo/ui/components/card";
import { DatabaseIcon } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
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
] as const;

/** Открытые данные: наборы, форматы, лицензия и ссылки на API и виджеты. */
export default async function DataPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const t = await getTranslations("data");
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  return (
    <div className="container-page flex flex-col gap-8 py-10">
      <div className="flex flex-col gap-3">
        <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight">
          <DatabaseIcon className="size-8 text-brand" aria-hidden="true" />
          {t("title")}
        </h1>
        <p className="max-w-3xl text-muted-foreground">{t("intro")}</p>
        <div className="flex flex-wrap gap-3 text-sm">
          <Link
            href="/data/api"
            className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground hover:bg-primary/90"
          >
            {t("apiDocs")}
          </Link>
          <a
            href={`/api/v1/openapi.json?lang=${locale}`}
            className="rounded-md border bg-card px-3 py-1.5 font-medium hover:bg-accent"
          >
            OpenAPI 3.1 (JSON)
          </a>
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-2">
        {DATASETS.map((d) => (
          <Card key={d.key}>
            <CardHeader>
              <CardTitle className="text-base">{t(`datasets.${d.key}.title`)}</CardTitle>
              <CardDescription>{t(`datasets.${d.key}.description`)}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <p className="text-xs text-muted-foreground">
                {t("updates")}: {t(`datasets.${d.key}.updates`)}
              </p>
              <code className="rounded-md bg-muted px-2 py-1 font-mono text-xs break-all">
                GET {base}
                {d.href}
              </code>
              <div className="flex flex-wrap gap-3 text-xs">
                <Link href={d.page} className="text-brand underline-offset-4 hover:underline">
                  {t("onPortal")}
                </Link>
                {d.key === "measurements" ? (
                  <span className="text-muted-foreground">{t("csvHint")}</span>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-xl border bg-card p-5 text-sm">
          <h2 className="mb-2 text-base font-semibold">{t("license.title")}</h2>
          <p className="text-muted-foreground">{t("license.text")}</p>
          <p className="mt-2 text-muted-foreground">{t("license.attribution")}</p>
        </div>
        <div className="rounded-xl border bg-card p-5 text-sm">
          <h2 className="mb-2 text-base font-semibold">{t("formats.title")}</h2>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>{t("formats.json")}</li>
            <li>{t("formats.geojson")}</li>
            <li>{t("formats.csv")}</li>
            <li>{t("formats.xml")}</li>
          </ul>
        </div>
        <div className="rounded-xl border bg-card p-5 text-sm">
          <h2 className="mb-2 text-base font-semibold">{t("widgets.title")}</h2>
          <p className="text-muted-foreground">{t("widgets.text")}</p>
          <ul className="mt-2 space-y-1 font-mono text-xs">
            <li>{base}/embed/aqi?station=&lt;slug&gt;&amp;lang=tg</li>
            <li>{base}/embed/forecast?location=dushanbe&amp;lang=ru</li>
            <li>{base}/embed/alerts?region=DU&amp;lang=en</li>
          </ul>
        </div>
      </section>

      <p className="text-sm text-muted-foreground">{t("quality")}</p>
    </div>
  );
}
