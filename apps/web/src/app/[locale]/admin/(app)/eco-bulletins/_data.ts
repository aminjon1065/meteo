import { type BulletinStation, listBulletinStations } from "@meteo/db";
import { getDb } from "@/lib/db";

export interface StationOption {
  id: number;
  code: string;
  name: BulletinStation["name"];
  city: BulletinStation["city"]["name"];
  automatic: boolean;
  isPublic: boolean;
}

/** Станции для выбора в форме: Душанбе первым, затем по области и коду. */
export async function loadStationOptions(): Promise<StationOption[]> {
  const stations = await listBulletinStations(getDb());
  return stations
    .sort((a, b) => {
      const du = Number(b.city.key === "region:DU") - Number(a.city.key === "region:DU");
      return du !== 0 ? du : a.city.order - b.city.order || a.code.localeCompare(b.code);
    })
    .map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      city: s.city.name,
      automatic: s.automatic,
      isPublic: s.isPublic,
    }));
}
