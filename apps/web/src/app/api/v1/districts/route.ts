import type { NextRequest } from "next/server";
import { boundariesResponse } from "@/lib/boundaries/load";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/districts — районы и города областного подчинения как GeoJSON FeatureCollection
 * (та же упрощённая геометрия и кэш, что у /api/v1/regions). Свойства: id, code, name,
 * regionId, regionCode, stationsCount, level. Единицы без геометрии не включаются.
 */
export async function GET(req: NextRequest) {
  return boundariesResponse(req, "district");
}
