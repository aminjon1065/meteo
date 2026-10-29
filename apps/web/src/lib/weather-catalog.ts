import "server-only";
import { buildDataTimesUrl, parseDataTimes } from "@meteo/core";
import type { WeatherCatalog } from "@/components/map/weather-layers";
import { cachedJson } from "@/lib/cache";

/**
 * Каталог слоёв погоды SmartMet (WMS): время прогона и сроки прогноза. Адрес сервера — SMARTMET_WMS_URL
 * (на сервере портала http://smartmet:8080, runbook §14); пусто — слои погоды на карте не показываются.
 */
export type { WeatherCatalog };

/** Producer данных слоёв WMS (продукты tajikistan:* в infra/smartmet построены на gfs_surface). */
const PRODUCER = "gfs";
/** Точка внутри области модели для запроса сроков — Душанбе. */
const PROBE = { lat: 38.56, lon: 68.78 };
const TTL_SEC = 600;
const TIMEOUT_MS = 8000;

const EMPTY: WeatherCatalog = { run: null, times: [] };

export function smartmetWmsUrl(): string | null {
  const raw = process.env.SMARTMET_WMS_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? raw.replace(/\/+$/, "") : null;
  } catch {
    return null;
  }
}

async function fetchCatalog(base: string): Promise<WeatherCatalog> {
  const res = await fetch(buildDataTimesUrl(base, { producer: PRODUCER, ...PROBE }), {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`SmartMet timeseries: HTTP ${res.status}`);
  const { originTime, times } = parseDataTimes(await res.json());
  if (!originTime || times.length === 0) throw new Error("SmartMet: нет данных GFS");
  return {
    run: { originTime: originTime.toISOString() },
    times: times.map((t) => t.toISOString()),
  };
}

/**
 * Каталог с кэшем 10 минут (новый прогон GFS приходит раз в 6 часов). Ошибка сервера не кэшируется:
 * карта показывает слой погоды недоступным, следующий запрос попробует снова.
 */
export async function loadWeatherCatalog(): Promise<WeatherCatalog> {
  const base = smartmetWmsUrl();
  if (!base) return EMPTY;
  try {
    const { value } = await cachedJson("weather:catalog", TTL_SEC, () => fetchCatalog(base));
    return value;
  } catch (error) {
    console.warn(
      "[weather] каталог SmartMet недоступен:",
      error instanceof Error ? error.message : error,
    );
    return EMPTY;
  }
}
