import { and, asc, eq, ne } from "@meteo/db";
import { stations } from "@meteo/db/schema";
import type { Locale } from "@meteo/i18n";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PageHeader } from "@/components/site/page-header";
import { SubscribeForm } from "@/components/subscribe/subscribe-form";
import { getDb } from "@/lib/db";
import { subscribe } from "./actions";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: "subscribe" });
  return { title: t("title"), description: t("intro") };
}

export default async function SubscribePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ station?: string }>;
}) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const sp = await searchParams;
  const [t, stationRows] = await Promise.all([
    getTranslations("subscribe"),
    getDb()
      .select({ id: stations.id, name: stations.name })
      .from(stations)
      .where(and(eq(stations.isPublic, true), ne(stations.status, "decommissioned")))
      .orderBy(asc(stations.code)),
  ]);
  const initialStation = Number(sp.station) || undefined;
  return (
    <div className="container-page flex max-w-2xl flex-col gap-6 py-8">
      <PageHeader title={t("title")} intro={t("intro")} />
      <div className="rounded-xl border bg-card px-4 py-5 sm:px-6">
        <SubscribeForm stations={stationRows} action={subscribe} initialStation={initialStation} />
      </div>
    </div>
  );
}
