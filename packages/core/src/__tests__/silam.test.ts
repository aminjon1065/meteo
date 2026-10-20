import { describe, expect, it } from "vitest";
import {
  buildSilamSubsetUrl,
  decodeTimeAxis,
  type Grid,
  gridBounds,
  levelForThresholds,
  rasterizeLevels,
  sampleGrid,
  toMicrograms,
} from "../silam";

const grid: Grid = {
  nx: 3,
  ny: 2,
  lon0: 68,
  lat0: 38,
  dx: 0.2,
  dy: 0.2,
  values: Float32Array.from([10, 20, 30, 40, 50, 60]),
};

describe("silam", () => {
  it("строит URL NCSS", () => {
    const url = buildSilamSubsetUrl({
      baseUrl: "https://thredds.silam.fmi.fi/thredds/ncss/grid/",
      dataset: "silam_glob_v6_1_sfc/silam_glob_v6_1_sfc_best.ncd",
      variables: ["cnc_PM2_5", "air_dens"],
      timeStart: new Date("2026-10-16T00:00:00Z"),
      timeEnd: new Date("2026-10-17T00:00:00Z"),
    });
    expect(
      url.startsWith(
        "https://thredds.silam.fmi.fi/thredds/ncss/grid/silam_glob_v6_1_sfc/silam_glob_v6_1_sfc_best.ncd?var=cnc_PM2_5&var=air_dens&",
      ),
    ).toBe(true);
    expect(url).toContain("accept=netcdf");
    expect(url).toContain("north=41.5");
    expect(url).toContain("time_start=2026-10-16T00%3A00%3A00.000Z");
  });
  it("декодирует ось времени", () => {
    const t = decodeTimeAxis("hours since 2026-07-08 00:00:00.000 UTC", [2400, 2401]);
    expect(t[0]?.toISOString()).toBe("2026-10-16T00:00:00.000Z");
    expect(t[1]?.toISOString()).toBe("2026-10-16T01:00:00.000Z");
  });
  it("переводит единицы", () => {
    expect(toMicrograms("cnc", 1.2e-8, 1.1)).toBeCloseTo(12, 6);
    // 1 ppb NO2 при 1,2 kg/m3 ≈ 1,9 µg/m³
    expect(toMicrograms("vmr", 1e-9, 1.2, 0.046006)).toBeCloseTo(1.906, 2);
    expect(toMicrograms("vmr", 1e-9, 0, 0.046006)).toBeNaN();
  });
  it("интерполирует билинейно и ограничивает края", () => {
    expect(sampleGrid(grid, 68, 38)).toBe(10);
    expect(sampleGrid(grid, 68.1, 38)).toBeCloseTo(15, 6);
    expect(sampleGrid(grid, 68.1, 38.1)).toBeCloseTo(30, 6);
    expect(sampleGrid(grid, 60, 30)).toBe(10);
    const b = gridBounds(grid);
    expect(b.west).toBeCloseTo(67.9, 6);
    expect(b.east).toBeCloseTo(68.5, 6);
    expect(b.south).toBeCloseTo(37.9, 6);
    expect(b.north).toBeCloseTo(38.3, 6);
  });
  it("классифицирует по порогам", () => {
    const th = [
      { level: 1, lo: 0, hi: 10 },
      { level: 2, lo: 10, hi: 25 },
      { level: 3, lo: 25, hi: null },
    ];
    expect(levelForThresholds(5, th)).toBe(1);
    expect(levelForThresholds(10, th)).toBe(2);
    expect(levelForThresholds(1000, th)).toBe(3);
    expect(levelForThresholds(Number.NaN, th)).toBe(0);
  });
  it("растеризует уровни с прозрачностью вне данных", () => {
    const g: Grid = { ...grid, values: Float32Array.from([10, Number.NaN, 30, 40, 50, 60]) };
    const r = rasterizeLevels(
      g,
      [
        { level: 1, lo: 0, hi: 35 },
        { level: 2, lo: 35, hi: null },
      ],
      { scale: 2 },
    );
    expect(r.width).toBe(6);
    expect(r.height).toBe(4);
    expect(r.data.length).toBe(6 * 4 * 4);
    // Верхняя строка растра — север (lat 38.2 ряд: 40,50,60 → уровень 2 = жёлтый #E3B505)
    expect([r.data[0], r.data[1], r.data[2]]).toEqual([0xd9, 0xa8, 0x0b]);
    expect(r.stats.max).toBe(60);
  });
});
