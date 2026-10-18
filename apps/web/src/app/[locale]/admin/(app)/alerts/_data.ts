import { asc, ne } from "@meteo/db";
import { indexScales, pollutants, regions, stations } from "@meteo/db/schema";
import { getDb } from "@/lib/db";

export async function loadRuleFormOptions() {
  const db = getDb();
  const [stationRows, regionRows, pollutantRows, scaleRows] = await Promise.all([
    db
      .select({ id: stations.id, code: stations.code, name: stations.name })
      .from(stations)
      .where(ne(stations.status, "decommissioned"))
      .orderBy(asc(stations.code)),
    db.select({ id: regions.id, name: regions.name }).from(regions).orderBy(asc(regions.sortOrder)),
    db
      .select({ id: pollutants.id, shortName: pollutants.shortName, unit: pollutants.unit })
      .from(pollutants)
      .orderBy(asc(pollutants.sortOrder)),
    db
      .select({ id: indexScales.id, code: indexScales.code, name: indexScales.name })
      .from(indexScales)
      .orderBy(asc(indexScales.sortOrder)),
  ]);
  return {
    stations: stationRows,
    regions: regionRows,
    pollutants: pollutantRows,
    scales: scaleRows,
  };
}
