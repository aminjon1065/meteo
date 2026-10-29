import { describe, expect, it } from "vitest";
import {
  buildDataTimesUrl,
  buildWmsGetMapUrl,
  compactTime,
  isValidTile,
  parseCompactTime,
  parseDataTimes,
  tileBbox3857,
  tileBoundsLonLat,
  tileIntersects,
  WEB_MERCATOR_HALF,
} from "../wms";

describe("tileBbox3857", () => {
  it("z0 — весь мир", () => {
    expect(tileBbox3857(0, 0, 0)).toEqual([
      -WEB_MERCATOR_HALF,
      -WEB_MERCATOR_HALF,
      WEB_MERCATOR_HALF,
      WEB_MERCATOR_HALF,
    ]);
  });

  it("z6 тайл над Таджикистаном совпадает с проверенным на сервере bbox", () => {
    const [minX, minY, maxX, maxY] = tileBbox3857(6, 44, 24);
    expect(minX).toBeCloseTo(7514065.629, 2);
    expect(minY).toBeCloseTo(4383204.95, 2);
    expect(maxX).toBeCloseTo(8140237.764, 2);
    expect(maxY).toBeCloseTo(5009377.086, 2);
  });
});

describe("тайлы и область данных", () => {
  it("isValidTile отбрасывает дробные и выходящие за уровень координаты", () => {
    expect(isValidTile(6, 44, 24)).toBe(true);
    expect(isValidTile(6, 64, 0)).toBe(false);
    expect(isValidTile(6, -1, 0)).toBe(false);
    expect(isValidTile(6.5, 1, 1)).toBe(false);
    expect(isValidTile(23, 0, 0)).toBe(false);
  });

  it("tileBoundsLonLat и tileIntersects: тайл с Душанбе в области GFS, тайл Европы — нет", () => {
    const area = { west: 58, south: 32, east: 82, north: 46 };
    const b = tileBoundsLonLat(6, 44, 24);
    expect(b.west).toBeCloseTo(67.5, 5);
    expect(b.east).toBeCloseTo(73.125, 5);
    expect(b.north).toBeGreaterThan(b.south);
    expect(tileIntersects(6, 44, 24, area)).toBe(true);
    expect(tileIntersects(6, 34, 21, area)).toBe(false);
  });
});

describe("buildWmsGetMapUrl", () => {
  it("GetMap 1.3.0 в EPSG:3857 со стилем на каждый слой и временем прогона", () => {
    const url = new URL(
      buildWmsGetMapUrl("http://smartmet:8080/", {
        layers: ["tajikistan:windspeed", "tajikistan:wind"],
        bbox: [1, 2, 3.1234, 4],
        width: 256,
        height: 256,
        time: "2026-10-29T12:00:00Z",
        referenceTime: "2026-10-29T06:00:00Z",
      }),
    );
    expect(url.origin + url.pathname).toBe("http://smartmet:8080/wms");
    expect(url.searchParams.get("request")).toBe("GetMap");
    expect(url.searchParams.get("layers")).toBe("tajikistan:windspeed,tajikistan:wind");
    expect(url.searchParams.get("styles")).toBe(",");
    expect(url.searchParams.get("crs")).toBe("EPSG:3857");
    expect(url.searchParams.get("bbox")).toBe("1.000,2.000,3.123,4.000");
    expect(url.searchParams.get("time")).toBe("2026-10-29T12:00:00Z");
    expect(url.searchParams.get("reference_time")).toBe("2026-10-29T06:00:00Z");
    expect(url.searchParams.get("transparent")).toBe("true");
  });
});

describe("compactTime / parseCompactTime", () => {
  it("туда и обратно", () => {
    const d = new Date("2026-10-29T12:00:00Z");
    expect(compactTime(d)).toBe("20261029T1200");
    expect(parseCompactTime("20261029T1200")?.toISOString()).toBe("2026-10-29T12:00:00.000Z");
  });

  it("отклоняет чужой формат и несуществующие даты", () => {
    expect(parseCompactTime("2026-10-29T12:00")).toBeNull();
    expect(parseCompactTime("20261329T1200")).toBeNull();
    expect(parseCompactTime("20261029T2460")).toBeNull();
    expect(parseCompactTime("../../etc")).toBeNull();
  });
});

describe("сроки прогноза из timeseries", () => {
  it("buildDataTimesUrl — шаг и период данных producer'а", () => {
    const url = new URL(
      buildDataTimesUrl("http://smartmet:8080", { producer: "gfs", lat: 38.56, lon: 68.78 }),
    );
    expect(url.pathname).toBe("/timeseries");
    expect(url.searchParams.get("producer")).toBe("gfs");
    expect(url.searchParams.get("timestep")).toBe("data");
    expect(url.searchParams.get("starttime")).toBe("data");
    expect(url.searchParams.get("param")).toBe("time,origintime");
  });

  it("parseDataTimes: компактное время SmartMet, сортировка, повторы, мусор", () => {
    const r = parseDataTimes([
      { time: "20261029T090000", origintime: "20261029T060000" },
      { time: "20261029T060000", origintime: "20261029T060000" },
      { time: "20261029T090000", origintime: "20261029T060000" },
      { time: "bad" },
      null,
    ]);
    expect(r.originTime?.toISOString()).toBe("2026-10-29T06:00:00.000Z");
    expect(r.times.map((t) => t.toISOString())).toEqual([
      "2026-10-29T06:00:00.000Z",
      "2026-10-29T09:00:00.000Z",
    ]);
    expect(parseDataTimes({ error: "x" })).toEqual({ originTime: null, times: [] });
  });
});
