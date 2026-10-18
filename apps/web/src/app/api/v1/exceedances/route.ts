import { NextResponse } from "next/server";
import { loadActiveExceedances } from "@/lib/exceedances";

export const dynamic = "force-dynamic";

/** GET /api/v1/exceedances — активные превышения порогов (для виджетов meteo.tj). */
export async function GET() {
  const events = await loadActiveExceedances();
  return NextResponse.json(
    {
      generatedAt: new Date().toISOString(),
      events: events
        .filter((e) => e.channels.includes("portal"))
        .map((e) => ({
          id: e.id,
          startedAt: e.startedAt.toISOString(),
          station: { id: e.stationId, slug: e.stationSlug, name: e.stationName },
          rule: e.ruleName,
          kind: e.kind,
          pollutant: e.pollutantCode,
          unit: e.unit,
          value: e.lastValue ?? e.peakValue,
          threshold: e.threshold,
          level: e.level,
        })),
    },
    { headers: { "Cache-Control": "public, s-maxage=60", "Access-Control-Allow-Origin": "*" } },
  );
}
