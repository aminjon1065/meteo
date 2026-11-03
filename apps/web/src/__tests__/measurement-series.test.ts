import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/settings", () => ({
  displayScaleOf: () => ({ unit: "µg/m³", decimals: 1, factor: 1 }),
  getConcentrationDisplayMode: async () => "ugm3",
}));

const { pointQcFlag, seriesToCsv } = await import("@/lib/api/measurement-series");
const { RANGE_AGGREGATIONS, RANGES, aggregationFor, allowedAggregation } = await import(
  "@/lib/measurement-ranges"
);

const point = (over: Partial<Parameters<typeof pointQcFlag>[0]> = {}) => ({
  t: "2026-10-16T19:00:00.000Z",
  v: 40.3,
  min: 24.8,
  max: 56.2,
  n: 18,
  corrected: 0,
  excluded: 0,
  excludedFlag: null,
  ...over,
});

describe("флаг качества точки ряда", () => {
  it("valid / corrected по значениям среднего, иначе худший исключённый", () => {
    expect(pointQcFlag(point())).toBe("valid");
    expect(pointQcFlag(point({ corrected: 2 }))).toBe("corrected");
    expect(pointQcFlag(point({ n: 0, v: null, excluded: 3, excludedFlag: 3 }))).toBe("invalid");
    expect(pointQcFlag(point({ n: 0, v: null, excluded: 1, excludedFlag: 2 }))).toBe("suspect");
    expect(pointQcFlag(point({ n: 0, v: null, excluded: 1, excludedFlag: 0 }))).toBe("raw");
  });
});

describe("CSV средних", () => {
  it("содержит время UTC и местное, единицы, флаг качества и число исключённых", () => {
    const csv = seriesToCsv("DU-01", "day", [
      {
        pollutant: { id: 1, code: "PM25", shortName: "PM2.5", unit: "µg/m³", decimals: 1 },
        points: [point({ excluded: 1, excludedFlag: 2 })],
      },
    ]);
    const [header, row] = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(header).toBe(
      "time_utc,time_local,station,pollutant,value,unit,aggregation,samples,min,max,qc_flag,excluded",
    );
    expect(row).toBe(
      "2026-10-16T19:00:00.000Z,2026-10-17 00:00,DU-01,PM25,40.3,µg/m³,day,18,24.8,56.2,valid,1",
    );
  });
});

describe("периоды и агрегации", () => {
  it("у каждого периода есть агрегация по умолчанию, месяц — только для года и всего времени", () => {
    for (const r of RANGES) expect(allowedAggregation(r, aggregationFor(r))).toBe(true);
    const withMonth = RANGES.filter((r) => RANGE_AGGREGATIONS[r].includes("month"));
    expect(withMonth).toEqual(["1y", "all"]);
    expect(allowedAggregation("1y", "hour")).toBe(false);
  });
});
