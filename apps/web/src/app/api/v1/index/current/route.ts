import type { AgencyIndicators } from "@meteo/core";
import { and, eq, getCurrentIndexes, ne } from "@meteo/db";
import { pollutants, stations } from "@meteo/db/schema";
import { type NextRequest, NextResponse } from "next/server";
import { cachedJson } from "@/lib/cache";
import { getDb } from "@/lib/db";
import { displayConcentration, getConcentrationDisplayMode } from "@/lib/settings";

export const dynamic = "force-dynamic";

const TTL_SEC = 60;

async function loadCurrent(scaleCode: string | undefined) {
  const db = getDb();
  const [{ scale, byStation }, stationRows, pollutantRows, mode] = await Promise.all([
    getCurrentIndexes(db, { scaleCode }),
    db
      .select({ id: stations.id, slug: stations.slug, code: stations.code, name: stations.name })
      .from(stations)
      .where(and(eq(stations.isPublic, true), ne(stations.status, "decommissioned"))),
    db
      .select({
        id: pollutants.id,
        code: pollutants.code,
        unit: pollutants.unit,
        decimals: pollutants.decimals,
      })
      .from(pollutants),
    getConcentrationDisplayMode(),
  ]);
  if (!scale) return null;
  const byId = new Map(pollutantRows.map((p) => [p.id, p]));
  const codeOf = (pid: string) => byId.get(Number(pid))?.code ?? pid;
  // Концентрации — в единице отображения портала (µg/m³ или mg/m³ как в бюллетенях Агентства).
  const shownValue = (pid: string, value: number) => {
    const p = byId.get(Number(pid));
    return p ? (displayConcentration(value, p, mode) ?? value) : value;
  };
  const units = Object.fromEntries(
    pollutantRows.map((p) => [p.code, displayConcentrationUnit(p, mode)]),
  );
  const mapIndicators = (ind: AgencyIndicators) => ({
    no2so2Sum: ind.no2so2Sum,
    highPollution: ind.highPollution,
    extremeHighPollution: ind.extremeHighPollution,
    maxSingle: Object.fromEntries(
      Object.entries(ind.maxSingle).map(([pid, m]) => [
        codeOf(pid),
        { value: shownValue(pid, m.value), ratio: m.ratio },
      ]),
    ),
    flagged: Object.fromEntries(
      Object.entries(ind.flagged).map(([pid, ratio]) => [codeOf(pid), ratio]),
    ),
  });
  return {
    scale: { code: scale.code, kind: scale.kind, levels: scale.levels },
    generatedAt: new Date().toISOString(),
    units,
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
          ? (byId.get(idx.dominantPollutantId)?.code ?? null)
          : null,
        subIndices: idx
          ? Object.fromEntries(
              Object.entries(idx.subIndices).map(([pid, sub]) => [
                codeOf(pid),
                { ...sub, value: shownValue(pid, sub.value) },
              ]),
            )
          : {},
        indicators: idx?.indicators ? mapIndicators(idx.indicators) : null,
      };
    }),
  };
}

function displayConcentrationUnit(
  p: { unit: string; decimals: number },
  mode: Awaited<ReturnType<typeof getConcentrationDisplayMode>>,
): string {
  return mode === "mg/m³" && p.unit === "µg/m³" ? "mg/m³" : p.unit;
}

/**
 * GET /api/v1/index/current?scale=NATIONAL_OPERATIONAL — текущий индекс всех публичных станций (кэш 60 с).
 * Для шкалы RATIO_TO_LIMIT в `indicators` — показатели методики Агентства: суммация NO₂+SO₂,
 * максимальные разовые концентрации с кратностью ПДКм.р., признаки ВЗ/ЭВЗ.
 */
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
