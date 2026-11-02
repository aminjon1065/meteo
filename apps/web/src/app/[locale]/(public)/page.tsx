import type { Locale } from "@meteo/i18n";
import { setRequestLocale } from "next-intl/server";
import { MapScreen } from "@/components/map/map-screen";

export const dynamic = "force-dynamic";

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
