import "server-only";
import { type ForecastLocationRow, listForecastLocations } from "@meteo/db";
import { cookies } from "next/headers";
import { getDb } from "@/lib/db";

/** Cookie с выбранным городом (slug точки прогноза); ставится в шапке (CitySelect) на год. */
export const CITY_COOKIE = "meteo-city";
export const DEFAULT_CITY_SLUG = "dushanbe";

/** Список городов для выбора в шапке: активные точки прогноза в порядке справочника. */
export async function loadCityChoices(): Promise<ForecastLocationRow[]> {
  try {
    return await listForecastLocations(getDb());
  } catch {
    return [];
  }
}

/** Slug выбранного города из cookie (без проверки существования). */
export async function getSelectedCitySlug(): Promise<string | null> {
  const value = (await cookies()).get(CITY_COOKIE)?.value;
  return value && /^[a-z0-9-]{1,64}$/.test(value) ? value : null;
}

/**
 * Выбранный город: из cookie, иначе Душанбе, иначе первый из списка.
 * Возвращает и весь список — шапка и главная читают его одним запросом.
 */
export async function resolveCity(): Promise<{
  city: ForecastLocationRow | null;
  cities: ForecastLocationRow[];
  selectedSlug: string | null;
}> {
  const [cities, selectedSlug] = await Promise.all([loadCityChoices(), getSelectedCitySlug()]);
  const city =
    cities.find((c) => c.slug === selectedSlug) ??
    cities.find((c) => c.slug === DEFAULT_CITY_SLUG) ??
    cities.find((c) => c.featured) ??
    cities[0] ??
    null;
  return { city, cities, selectedSlug };
}
