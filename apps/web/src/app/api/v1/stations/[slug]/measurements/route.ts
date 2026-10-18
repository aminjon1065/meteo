import { eq } from "@meteo/db";
import { stations } from "@meteo/db/schema";
import { type NextRequest, NextResponse } from "next/server";
import { isRange, loadSeries, seriesToCsv } from "@/lib/api/measurement-series";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/stations/{slug}/measurements?range=24h|7d|30d|1y&pollutant=PM25&format=json|csv
 * Часовые (24h/7d) или суточные (30d/1y) средние по валидным измерениям.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const url = req.nextUrl;
  const range = url.searchParams.get("range") ?? "24h";
  if (!isRange(range))
    return NextResponse.json({ error: "range must be one of 24h, 7d, 30d, 1y" }, { status: 400 });
  const pollutant = url.searchParams.get("pollutant") ?? undefined;
  const format = url.searchParams.get("format") === "csv" ? "csv" : "json";

  const station = await getDb().query.stations.findFirst({ where: eq(stations.slug, slug) });
  if (!station || !station.isPublic)
    return NextResponse.json({ error: "not found" }, { status: 404 });

  const data = await loadSeries(station.id, range, pollutant);
  if (format === "csv") {
    const csv = seriesToCsv(station.code, data.aggregation, data.series);
    const stamp = data.to.toISOString().slice(0, 10);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${station.code}_${range}_${stamp}.csv"`,
        "Cache-Control": "public, s-maxage=60",
        "Access-Control-Allow-Origin": "*",
      },
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
