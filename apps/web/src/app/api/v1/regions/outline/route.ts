import type { NextRequest } from "next/server";
import { outlineResponse } from "@/lib/boundaries/load";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/regions/outline — контур Таджикистана одним GeoJSON Feature (MultiPolygon: основная
 * территория и анклавы), собранный из упрощённых областей. Главная карта приглушает всё, что вне
 * него. Кэш сутки, ETag/304, CORS открыт; без загруженных границ — geometry: null.
 */
export async function GET(req: NextRequest) {
  return outlineResponse(req);
}
