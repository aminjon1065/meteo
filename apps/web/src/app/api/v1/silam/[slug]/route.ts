import {
  getForecastLocation,
  getSilamPointForecast,
  loadIndexConfig,
  publicThresholds,
  summarizeSilamDays,
} from "@meteo/db";
import { pollutants } from "@meteo/db/schema";
import { type NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/silam/{slug} — точечный прогноз SILAM для города: часовые концентрации и уровни
 * по веществам плюс суточная сводка (среднее за местные сутки, уровень по публичной шкале).
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const db = getDb();
  const location = await getForecastLocation(db, slug);
  if (!location) return NextResponse.json({ error: "location not found" }, { status: 404 });
  const [{ run, rows }, config, pollutantRows] = await Promise.all([
    getSilamPointForecast(db, { locationId: location.id }),
    loadIndexConfig(db),
    db.select({ id: pollutants.id, code: pollutants.code, unit: pollutants.unit }).from(pollutants),
  ]);
  const codeOf = new Map(pollutantRows.map((p) => [p.id, p.code]));
  const unitOf = new Map(pollutantRows.map((p) => [p.code, p.unit]));
  const hourly: Record<string, Array<[string, number, number]>> = {};
  for (const r of rows) {
    const code = codeOf.get(r.pollutantId) ?? String(r.pollutantId);
    const list = hourly[code] ?? [];
    list.push([r.time.toISOString(), r.value, r.level]);
    hourly[code] = list;
  }
  const days = summarizeSilamDays(rows, publicThresholds(config)).map((d) => ({
    date: d.date,
    level: d.level,
    dominantPollutant: d.dominantPollutantId ? (codeOf.get(d.dominantPollutantId) ?? null) : null,
    means: Object.fromEntries(
      Object.entries(d.means).map(([pid, v]) => [codeOf.get(Number(pid)) ?? pid, v]),
    ),
  }));
  return NextResponse.json(
    {
      location: {
        slug: location.slug,
        name: location.name,
        lat: location.geom.y,
        lon: location.geom.x,
      },
      run: run
        ? { originTime: run.originTime.toISOString(), fetchedAt: run.fetchedAt.toISOString() }
        : null,
      units: Object.fromEntries(Object.keys(hourly).map((code) => [code, unitOf.get(code) ?? ""])),
      hourly,
      days,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=600, stale-while-revalidate=1800",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}
