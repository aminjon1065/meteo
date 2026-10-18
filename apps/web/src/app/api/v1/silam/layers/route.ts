import { getLatestSilamRun, getSilamLayers } from "@meteo/db";
import { NextResponse } from "next/server";
import { cachedJson } from "@/lib/cache";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

const TTL_SEC = 600;

async function loadLayers() {
  const db = getDb();
  const run = await getLatestSilamRun(db);
  if (!run) return { run: null, pollutants: [] };
  const layers = await getSilamLayers(db, run.id);
  const byCode = new Map<string, Array<{ time: string; url: string; max: number | null }>>();
  for (const l of layers) {
    const list = byCode.get(l.code) ?? [];
    list.push({ time: l.time.toISOString(), url: `/silam/${l.file}`, max: l.stats?.max ?? null });
    byCode.set(l.code, list);
  }
  return {
    run: {
      originTime: run.originTime.toISOString(),
      fetchedAt: run.fetchedAt.toISOString(),
      hours: run.hours,
      bounds: run.grid
        ? {
            west: run.grid.west,
            south: run.grid.south,
            east: run.grid.east,
            north: run.grid.north,
          }
        : null,
    },
    pollutants: [...byCode.entries()].map(([code, frames]) => ({ code, frames })),
  };
}

/**
 * GET /api/v1/silam/layers — каталог растровых слоёв последнего прогона SILAM:
 * сетка (границы для привязки), часы и URL PNG по веществам. Кэш 10 минут (прогон обновляется раз в сутки).
 */
export async function GET() {
  const { value, hit } = await cachedJson("silam:layers", TTL_SEC, loadLayers);
  return NextResponse.json(value, {
    headers: {
      "Cache-Control": `public, s-maxage=${TTL_SEC}, stale-while-revalidate=1800`,
      "Access-Control-Allow-Origin": "*",
      "X-Cache": hit ? "HIT" : "MISS",
    },
  });
}
