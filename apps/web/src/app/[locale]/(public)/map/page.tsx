import type { Locale } from "@meteo/i18n";
import { redirect } from "@/i18n/navigation";

/** Карта переехала на главную; старые ссылки и закладки `/map?layer=…` ведут туда же. */
export default async function MapPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ layer?: string }>;
}) {
  const { locale } = (await params) as { locale: Locale };
  const { layer } = await searchParams;
  redirect({ href: { pathname: "/", query: layer ? { layer } : {} }, locale });
}
