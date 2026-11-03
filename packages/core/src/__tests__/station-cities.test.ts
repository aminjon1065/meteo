import { describe, expect, it } from "vitest";
import {
  CITY_RADIUS_KM,
  cityNameFromArea,
  distanceKm,
  planStationCities,
  type StationForCity,
} from "../station-cities";

const dushanbe = { slug: "dushanbe", lon: 68.787, lat: 38.5598 };

const station = (over: Partial<StationForCity> & Pick<StationForCity, "id" | "lon" | "lat">) =>
  ({
    slug: `station-${over.id}`,
    name: { ru: `Станция ${over.id}` },
    regionId: 2,
    area: null,
    ...over,
  }) satisfies StationForCity;

describe("cityNameFromArea", () => {
  it("город в границах - без слова «город» на всех языках", () => {
    expect(cityNameFromArea({ tg: "Шаҳри Ҳисор", ru: "Город Гиссар", en: "Hisor city" })).toEqual({
      tg: "Ҳисор",
      ru: "Гиссар",
      en: "Hisor",
    });
  });
  it("район остаётся районом", () => {
    const area = { tg: "Ноҳияи Ваҳдат", ru: "Вахдатский район", en: "Vahdat district" };
    expect(cityNameFromArea(area)).toEqual(area);
  });
});

describe("planStationCities", () => {
  it("станции в радиусе существующего города новых городов не создают", () => {
    const inCity = station({ id: 1, lon: 68.75, lat: 38.52 }); // ~5 км от центра Душанбе
    expect(distanceKm(dushanbe, inCity)).toBeLessThan(CITY_RADIUS_KM);
    expect(planStationCities([inCity], [dushanbe])).toEqual([]);
  });

  it("станция за радиусом получает город в своей точке с названием района", () => {
    const hisor = station({
      id: 5,
      lon: 68.5502,
      lat: 38.5252,
      area: { tg: "Шаҳри Ҳисор", ru: "Город Гиссар", en: "Hisor city" },
    });
    expect(distanceKm(dushanbe, hisor)).toBeGreaterThan(CITY_RADIUS_KM);
    expect(planStationCities([hisor], [dushanbe])).toEqual([
      {
        stationId: 5,
        slug: "hisor",
        name: { tg: "Ҳисор", ru: "Гиссар", en: "Hisor" },
        lon: 68.5502,
        lat: 38.5252,
        regionId: 2,
      },
    ]);
  });

  it("соседние станции за радиусом делят один город; без района - название станции", () => {
    const a = station({
      id: 7,
      lon: 70.0,
      lat: 39.0,
      name: { ru: "Центр села А", en: "Village A" },
    });
    const b = station({ id: 8, lon: 70.05, lat: 39.02 }); // ~5 км от a
    const planned = planStationCities([b, a], [dushanbe]);
    expect(planned).toHaveLength(1);
    expect(planned[0]).toMatchObject({ stationId: 7, slug: "village-a", name: a.name });
  });

  it("выключенная точка тоже считается: город заново не создаётся; slug не повторяется", () => {
    const far = station({
      id: 9,
      lon: 71.0,
      lat: 39.5,
      area: { ru: "Город Гиссар", en: "Hisor city" },
    });
    const disabledNearby = { slug: "old-point", lon: 71.01, lat: 39.5 };
    expect(planStationCities([far], [dushanbe, disabledNearby])).toEqual([]);
    const planned = planStationCities([far], [dushanbe, { slug: "hisor", lon: 60, lat: 30 }]);
    expect(planned[0]?.slug).toBe("hisor-2");
  });
});
