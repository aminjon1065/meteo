import type { NextRequest } from "next/server";
import { boundariesResponse } from "@/lib/boundaries/load";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/regions — области, город Душанбе и РРП как GeoJSON FeatureCollection с упрощёнными
 * полигонами (ST_SimplifyPreserveTopology 0,002°, 5 знаков; загружаются infra/data/load-boundaries.ts).
 * Свойства: id, code, name (jsonb tg/ru/en), sortOrder, centroid [lon, lat], stationsCount,
 * level — худший текущий уровень индекса среди станций области (0 — нет данных).
 * Кэш 10 минут, ETag/304, CORS открыт; без загруженных границ — пустая коллекция.
 */
export async function GET(req: NextRequest) {
  return boundariesResponse(req, "region");
}
