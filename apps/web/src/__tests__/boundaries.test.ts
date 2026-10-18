import type { MultiPolygon } from "geojson";
import { describe, expect, it } from "vitest";
import {
  aggregateStations,
  type BoundaryRow,
  buildBoundaryCollection,
  etagMatches,
  weakEtag,
} from "@/lib/boundaries/geojson";

const square = (x: number, y: number, size = 1): MultiPolygon => ({
  type: "MultiPolygon",
  coordinates: [
    [
      [
        [x, y],
        [x + size, y],
        [x + size, y + size],
        [x, y + size],
        [x, y],
      ],
    ],
  ],
});

const regions: BoundaryRow[] = [
  {
    id: 1,
    code: "DU",
    name: { tg: "Шаҳри Душанбе", ru: "Город Душанбе", en: "Dushanbe city" },
    sortOrder: 1,
    centroid: [68.78, 38.56],
    geometry: square(68.5, 38.3, 0.5),
  },
  {
    id: 4,
    code: "KT",
    name: { tg: "Вилояти Хатлон", ru: "Хатлонская область", en: "Khatlon region" },
    sortOrder: 4,
    centroid: null,
    geometry: square(68, 37),
  },
  // Границы ещё не загружены — единица не попадает в коллекцию.
  { id: 5, code: "GB", name: { ru: "ГБАО" }, sortOrder: 5, centroid: null, geometry: null },
];

describe("aggregateStations", () => {
  it("считает станции и худший уровень по области, пропуская станции без привязки", () => {
    const stats = aggregateStations(
      [
        { regionId: 1, districtId: 10, level: 2 },
        { regionId: 1, districtId: null, level: 4 },
        { regionId: 4, districtId: 40, level: 0 },
        { regionId: null, districtId: null, level: 5 },
      ],
      "regionId",
    );
    expect(stats.get(1)).toEqual({ stationsCount: 2, level: 4 });
    expect(stats.get(4)).toEqual({ stationsCount: 1, level: 0 });
    expect(stats.size).toBe(2);
  });

  it("агрегирует по районам и нормализует некорректные уровни", () => {
    const stats = aggregateStations(
      [
        { regionId: 1, districtId: 10, level: 3.7 },
        { regionId: 1, districtId: 10, level: Number.NaN },
        { regionId: 1, districtId: 11, level: -1 },
      ],
      "districtId",
    );
    expect(stats.get(10)).toEqual({ stationsCount: 2, level: 3 });
    expect(stats.get(11)).toEqual({ stationsCount: 1, level: 0 });
  });
});

describe("buildBoundaryCollection", () => {
  it("формирует FeatureCollection областей со свойствами карты", () => {
    const stats = aggregateStations([{ regionId: 1, districtId: null, level: 3 }], "regionId");
    const collection = buildBoundaryCollection("region", regions, stats);
    expect(collection.type).toBe("FeatureCollection");
    expect(collection.features.map((f) => f.properties.code)).toEqual(["DU", "KT"]);
    const du = collection.features[0];
    expect(du?.type).toBe("Feature");
    expect(du?.id).toBe(1);
    expect(du?.geometry.type).toBe("MultiPolygon");
    expect(du?.properties).toEqual({
      id: 1,
      code: "DU",
      name: { tg: "Шаҳри Душанбе", ru: "Город Душанбе", en: "Dushanbe city" },
      stationsCount: 1,
      level: 3,
      sortOrder: 1,
      centroid: [68.78, 38.56],
    });
    // Область без станций: 0 станций, уровень 0 (нет данных).
    expect(collection.features[1]?.properties).toMatchObject({
      code: "KT",
      stationsCount: 0,
      level: 0,
      centroid: null,
    });
    // Свойства районов в областях не появляются.
    expect(du?.properties).not.toHaveProperty("regionCode");
  });

  it("для районов добавляет привязку к области и не включает служебные поля областей", () => {
    const rows: BoundaryRow[] = [
      {
        id: 10,
        code: "3501001",
        name: { ru: "Район Сино" },
        regionId: 1,
        regionCode: "DU",
        geometry: square(68.7, 38.5, 0.1),
      },
    ];
    const collection = buildBoundaryCollection(
      "district",
      rows,
      aggregateStations([{ regionId: 1, districtId: 10, level: 1 }], "districtId"),
    );
    expect(collection.features).toHaveLength(1);
    expect(collection.features[0]?.properties).toEqual({
      id: 10,
      code: "3501001",
      name: { ru: "Район Сино" },
      stationsCount: 1,
      level: 1,
      regionId: 1,
      regionCode: "DU",
    });
  });

  it("без геометрии отдаёт пустую коллекцию — карта не ломается", () => {
    const collection = buildBoundaryCollection(
      "region",
      regions.map((r) => ({ ...r, geometry: null })),
      new Map(),
    );
    expect(collection).toEqual({ type: "FeatureCollection", features: [] });
    expect(JSON.parse(JSON.stringify(collection))).toEqual(collection);
  });
});

describe("ETag", () => {
  it("weakEtag детерминирован и имеет слабую форму", () => {
    const body = JSON.stringify({ type: "FeatureCollection", features: [] });
    expect(weakEtag(body)).toMatch(/^W\/"[0-9a-f]{16}"$/);
    expect(weakEtag(body)).toBe(weakEtag(body));
    expect(weakEtag(`${body} `)).not.toBe(weakEtag(body));
  });

  it("etagMatches сравнивает по слабому алгоритму: W/, списки, *", () => {
    const etag = weakEtag("abc");
    expect(etagMatches(etag, etag)).toBe(true);
    expect(etagMatches(etag.replace(/^W\//, ""), etag)).toBe(true);
    expect(etagMatches(`"other", ${etag}`, etag)).toBe(true);
    expect(etagMatches("*", etag)).toBe(true);
    expect(etagMatches('"other"', etag)).toBe(false);
    expect(etagMatches(null, etag)).toBe(false);
    expect(etagMatches("", etag)).toBe(false);
  });
});
