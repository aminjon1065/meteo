import { eq } from "@meteo/db";
import { stations } from "@meteo/db/schema";
import { type NextRequest, NextResponse } from "next/server";
import {
  allowedAggregation,
  isAggregation,
  isRange,
  loadSeries,
  RANGE_AGGREGATIONS,
  RANGES,
  RAW_RANGES,
  rawToCsv,
  seriesToCsv,
} from "@/lib/api/measurement-series";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/stations/{slug}/measurements?range=24h|7d|30d|1y|all&agg=hour|day|month|raw
 *   &pollutant=PM25&format=json|csv
 * Средние по валидным измерениям; агрегация по умолчанию зависит от периода (RANGE_AGGREGATIONS).
 * agg=raw — исходные значения с флагом QC, только CSV и не длиннее 30 суток.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const url = req.nextUrl;
  const range = url.searchParams.get("range") ?? "24h";
  if (!isRange(range))
    return NextResponse.json(
      { error: `range must be one of ${RANGES.join(", ")}` },
      { status: 400 },
    );
  const pollutant = url.searchParams.get("pollutant") ?? undefined;
  const format = url.searchParams.get("format") === "csv" ? "csv" : "json";
  const agg = url.searchParams.get("agg");
  const raw = agg === "raw";
  if (raw && (format !== "csv" || !RAW_RANGES.includes(range)))
    return NextResponse.json(
      { error: `agg=raw is available with format=csv for range ${RAW_RANGES.join(", ")}` },
      { status: 400 },
    );
  if (agg !== null && !raw && !(isAggregation(agg) && allowedAggregation(range, agg)))
    return NextResponse.json(
      { error: `agg for range ${range} must be one of ${RANGE_AGGREGATIONS[range].join(", ")}` },
      { status: 400 },
    );

  const station = await getDb().query.stations.findFirst({ where: eq(stations.slug, slug) });
  if (!station || !station.isPublic)
    return NextResponse.json({ error: "not found" }, { status: 404 });

  const now = new Date();
  const stamp = now.toISOString().slice(0, 10);
  const csvHeaders = (name: string) => ({
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${name}"`,
    "Cache-Control": "public, s-maxage=60",
    "Access-Control-Allow-Origin": "*",
  });
  if (raw) {
    const csv = await rawToCsv(station.id, station.code, range, pollutant, now);
    return new NextResponse(csv, {
      headers: csvHeaders(`${station.code}_${range}_raw_${stamp}.csv`),
    });
  }

  const data = await loadSeries(
    station.id,
    range,
    pollutant,
    now,
    isAggregation(agg) ? agg : undefined,
  );
  if (format === "csv") {
    const csv = seriesToCsv(station.code, data.aggregation, data.series);
    return new NextResponse(csv, {
      headers: csvHeaders(`${station.code}_${range}_${data.aggregation}_${stamp}.csv`),
    });
  }
  return NextResponse.json(
    {
      station: { id: station.id, slug: station.slug, code: station.code, name: station.name },
      range,
      from: data.from.toISOString(),
      to: data.to.toISOString(),
      aggregation: data.aggregation,
      timezone: "Asia/Dushanbe",
      series: data.series,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}
