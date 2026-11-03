import type { Locale } from "@meteo/i18n";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { MapScreen } from "@/components/map/map-screen";
import { pageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = (await params) as { locale: Locale };
  const [t, ts] = await Promise.all([
    getTranslations({ locale, namespace: "common" }),
    getTranslations({ locale, namespace: "seo" }),
  ]);
  const meta = await pageMetadata({ locale, path: "/", description: ts("homeDescription") });
  // На главной — «Метеопортал — подзаголовок» без шаблона «… · Метеопортал».
  const title = `${t("siteName")} — ${t("siteTagline")}`;
  return {
    ...meta,
    title: { absolute: title },
    openGraph: { ...meta.openGraph, title },
    twitter: { ...meta.twitter, title },
  };
}

/** Главная — карта на весь экран (по просьбе Заказчика, по образцу data.meteo.uz); разделы — в меню ☰. */
export default async function HomePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ layer?: string }>;
}) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const { layer } = await searchParams;
  return <MapScreen locale={locale} layer={layer} />;
}
