import { asc } from "@meteo/db";
import { districts, pollutants, regions } from "@meteo/db/schema";
import { getDb } from "@/lib/db";

/** Справочники для формы станции (регионы, районы, загрязнители). */
export async function loadStationFormOptions() {
  const db = getDb();
  const [regionRows, districtRows, pollutantRows] = await Promise.all([
    db.select({ id: regions.id, name: regions.name }).from(regions).orderBy(asc(regions.sortOrder)),
    db
      .select({ id: districts.id, regionId: districts.regionId, name: districts.name })
      .from(districts)
      .orderBy(asc(districts.code)),
    db
      .select({
        id: pollutants.id,
        code: pollutants.code,
        shortName: pollutants.shortName,
        unit: pollutants.unit,
        molarMass: pollutants.molarMass,
      })
      .from(pollutants)
      .orderBy(asc(pollutants.sortOrder)),
  ]);
  return { regions: regionRows, districts: districtRows, pollutants: pollutantRows };
}
