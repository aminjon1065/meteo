import { and, eq, getCurrentIndexes, ne } from "@meteo/db";
import { pollutants, stations } from "@meteo/db/schema";
import { type NextRequest, NextResponse } from "next/server";
import { cachedJson } from "@/lib/cache";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

const TTL_SEC = 60;

async function loadCurrent(scaleCode: string | undefined) {
  const db = getDb();
  const [{ scale, byStation }, stationRows, pollutantRows] = await Promise.all([
    getCurrentIndexes(db, { scaleCode }),
    db
      .select({ id: stations.id, slug: stations.slug, code: stations.code, name: stations.name })
      .from(stations)
      .where(and(eq(stations.isPublic, true), ne(stations.status, "decommissioned"))),
    db.select({ id: pollutants.id, code: pollutants.code }).from(pollutants),
  ]);
  if (!scale) return null;
  const codeOf = new Map(pollutantRows.map((p) => [p.id, p.code]));
  return {
    scale: { code: scale.code, kind: scale.kind, levels: scale.levels },
    generatedAt: new Date().toISOString(),
    stations: stationRows.map((st) => {
      const idx = byStation.get(st.id);
      return {
        id: st.id,
        slug: st.slug,
        code: st.code,
        name: st.name,
        level: idx && !idx.stale ? idx.level : 0,
        value: idx?.value ?? null,
        time: idx?.time.toISOString() ?? null,
        stale: idx?.stale ?? true,
        dominantPollutant: idx?.dominantPollutantId
          ? (codeOf.get(idx.dominantPollutantId) ?? null)
          : null,
        subIndices: idx
          ? Object.fromEntries(
              Object.entries(idx.subIndices).map(([pid, sub]) => [
                codeOf.get(Number(pid)) ?? pid,
                sub,
              ]),
            )
          : {},
      };
    }),
  };
}

/** GET /api/v1/index/current?scale=NATIONAL_OPERATIONAL — текущий индекс всех публичных станций (кэш 60 с). */
export async function GET(req: NextRequest) {
  const scaleCode = req.nextUrl.searchParams.get("scale") ?? undefined;
  if (scaleCode && !/^[A-Z0-9_]{1,32}$/.test(scaleCode)) {
    return NextResponse.json({ error: "scale not found" }, { status: 404 });
  }
  const { value, hit } = await cachedJson(`index:current:${scaleCode ?? "default"}`, TTL_SEC, () =>
    loadCurrent(scaleCode),
  );
  if (!value) return NextResponse.json({ error: "scale not found" }, { status: 404 });
  return NextResponse.json(value, {
    headers: {
      "Cache-Control": `public, s-maxage=${TTL_SEC}, stale-while-revalidate=300`,
      "Access-Control-Allow-Origin": "*",
      "X-Cache": hit ? "HIT" : "MISS",
    },
  });
}
