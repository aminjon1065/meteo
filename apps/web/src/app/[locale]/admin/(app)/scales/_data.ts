import { asc } from "@meteo/db";
import { pollutants } from "@meteo/db/schema";
import { getDb } from "@/lib/db";

/** Справочник веществ для редакторов шкал и ПДК (читается только из серверных компонентов). */
export async function listPollutants() {
  return getDb()
    .select({
      id: pollutants.id,
      code: pollutants.code,
      shortName: pollutants.shortName,
      unit: pollutants.unit,
      hazardClass: pollutants.hazardClass,
    })
    .from(pollutants)
    .orderBy(asc(pollutants.sortOrder));
}
