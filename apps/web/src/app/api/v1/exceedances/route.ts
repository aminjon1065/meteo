import { displayScaleFor, toDisplayValue } from "@meteo/core";
import { NextResponse } from "next/server";
import { loadActiveExceedances } from "@/lib/exceedances";
import { getConcentrationDisplayMode } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** GET /api/v1/exceedances — активные превышения порогов (для виджетов meteo.tj). */
export async function GET() {
  const [events, mode] = await Promise.all([
    loadActiveExceedances(),
    getConcentrationDisplayMode(),
  ]);
  return NextResponse.json(
    {
      generatedAt: new Date().toISOString(),
      events: events
        .filter((e) => e.channels.includes("portal"))
        .map((e) => {
          // Концентрации — в единице отображения портала; для правил по индексу масштаб не применяется.
          const scale =
            e.kind === "pollutant" && e.unit
              ? displayScaleFor(e.unit, e.decimals ?? 1, mode)
              : null;
          return {
            id: e.id,
            startedAt: e.startedAt.toISOString(),
            station: { id: e.stationId, slug: e.stationSlug, name: e.stationName },
            rule: e.ruleName,
            kind: e.kind,
            pollutant: e.pollutantCode,
            unit: scale ? scale.unit : e.unit,
            value: scale
              ? toDisplayValue(e.lastValue ?? e.peakValue, scale)
              : (e.lastValue ?? e.peakValue),
            threshold: scale ? (toDisplayValue(e.threshold, scale) ?? e.threshold) : e.threshold,
            level: e.level,
          };
        }),
    },
    { headers: { "Cache-Control": "public, s-maxage=60", "Access-Control-Allow-Origin": "*" } },
  );
}
