import type { ConcentrationUnit } from "@meteo/core";
import { and, asc, eq, ne } from "@meteo/db";
import { pollutants, qcRules, stationPollutants, stations } from "@meteo/db/schema";
import { getDb } from "@/lib/db";
import type { ImportContext } from "@/lib/import/measurements-csv";

export interface EntryStation {
  id: number;
  code: string;
  name: Record<string, string | undefined>;
  sampling: "continuous" | "discrete";
  pollutants: Array<{
    id: number;
    code: string;
    shortName: string;
    unit: string;
    inputUnit: ConcentrationUnit;
    decimals: number;
  }>;
}

/** Активные станции с измеряемыми веществами (для формы ввода и импорта). */
export async function loadEntryStations(): Promise<EntryStation[]> {
  const db = getDb();
  const rows = await db
    .select({
      stationId: stations.id,
      code: stations.code,
      name: stations.name,
      sampling: stations.sampling,
      pollutantId: pollutants.id,
      pollutantCode: pollutants.code,
      shortName: pollutants.shortName,
      unit: pollutants.unit,
      inputUnit: stationPollutants.inputUnit,
      decimals: pollutants.decimals,
      sortOrder: pollutants.sortOrder,
    })
    .from(stations)
    .leftJoin(
      stationPollutants,
      and(eq(stationPollutants.stationId, stations.id), eq(stationPollutants.active, true)),
    )
    .leftJoin(pollutants, eq(pollutants.id, stationPollutants.pollutantId))
    .where(ne(stations.status, "decommissioned"))
    .orderBy(asc(stations.code), asc(pollutants.sortOrder));
  const map = new Map<number, EntryStation>();
  for (const r of rows) {
    let s = map.get(r.stationId);
    if (!s) {
      s = {
        id: r.stationId,
        code: r.code,
        name: r.name as Record<string, string | undefined>,
        sampling: r.sampling,
        pollutants: [],
      };
      map.set(r.stationId, s);
    }
    if (r.pollutantId && r.pollutantCode && r.shortName && r.unit) {
      s.pollutants.push({
        id: r.pollutantId,
        code: r.pollutantCode,
        shortName: r.shortName,
        unit: r.unit,
        inputUnit: (r.inputUnit ?? r.unit) as ConcentrationUnit,
        decimals: r.decimals ?? 1,
      });
    }
  }
  return [...map.values()];
}

/** Контекст импорта: справочники станций/веществ и правила диапазонов. */
export async function loadImportContext(defaultStationCode?: string): Promise<ImportContext> {
  const db = getDb();
  const [entryStations, pollutantRows, ruleRows] = await Promise.all([
    loadEntryStations(),
    db.select().from(pollutants),
    db
      .select()
      .from(qcRules)
      .where(and(eq(qcRules.kind, "range"), eq(qcRules.enabled, true))),
  ]);
  const ctx: ImportContext = {
    stations: new Map(),
    pollutants: new Map(),
    ranges: new Map(),
    defaultStationCode,
  };
  for (const s of entryStations) {
    ctx.stations.set(s.code.toUpperCase(), {
      id: s.id,
      sampling: s.sampling,
      inputUnits: new Map(s.pollutants.map((p) => [p.id, p.inputUnit])),
    });
  }
  for (const p of pollutantRows) {
    const entry = {
      id: p.id,
      unit: p.unit as ConcentrationUnit,
      decimals: p.decimals,
      molarMass: p.molarMass,
    };
    ctx.pollutants.set(p.code.toUpperCase(), entry);
    ctx.pollutants.set(
      p.shortName.toUpperCase().replace(/[.\s]/g, "").replace("₂", "2").replace("₃", "3"),
      entry,
    );
  }
  for (const r of ruleRows) {
    if (r.pollutantId && typeof r.params.min === "number" && typeof r.params.max === "number") {
      ctx.ranges.set(r.pollutantId, { min: r.params.min, max: r.params.max });
    }
  }
  return ctx;
}
