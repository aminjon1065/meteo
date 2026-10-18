import { describe, expect, it } from "vitest";
import {
  buildHourlyUrl,
  deriveSymbol,
  nightVariant,
  parseDaily,
  parseHourly,
  parseSmartmetTime,
  windFromComponents,
} from "../smartmet";
import { symbolKey, symbolPath } from "../weather-symbols";

describe("smartmet client", () => {
  it("строит URL timeseries с параметрами", () => {
    const url = buildHourlyUrl({
      baseUrl: "https://opendata.fmi.fi/",
      lat: 38.5598,
      lon: 68.787,
      producer: "ecmwf",
      startTime: "2026-10-16T10:00:00.000Z",
    });
    expect(url.startsWith("https://opendata.fmi.fi/timeseries?")).toBe(true);
    expect(url).toContain("latlon=38.5598%2C68.787");
    expect(url).toContain("producer=ecmwf");
    expect(url).toContain("SmartSymbol");
    expect(url).toContain("starttime=2026-10-16T10%3A00%3A00.000Z");
    expect(url).not.toContain("fmi_apikey");
  });
  it("разбирает компактное и ISO время", () => {
    expect(parseSmartmetTime("20261016T100000")?.toISOString()).toBe("2026-10-16T10:00:00.000Z");
    expect(parseSmartmetTime("2026-10-16T10:00:00Z")?.toISOString()).toBe(
      "2026-10-16T10:00:00.000Z",
    );
    expect(parseSmartmetTime("bad")).toBeNull();
  });
  it("считает ветер из компонент", () => {
    expect(windFromComponents(0, -5)).toEqual({ ws: 5, wd: 0 }); // северный ветер (дует на юг)
    expect(windFromComponents(-3, 0).wd).toBe(90); // восточный
    expect(windFromComponents(null, 1).ws).toBeNull();
    expect(windFromComponents(0, 0)).toEqual({ ws: 0, wd: null });
  });
  it("выводит символ из осадков и облачности", () => {
    expect(deriveSymbol({ precip: 0, cloud: 5, t: 20 })).toBe(1);
    expect(deriveSymbol({ precip: 0, cloud: 95, t: 20 })).toBe(7);
    expect(deriveSymbol({ precip: 2, cloud: 90, t: 10 })).toBe(32);
    expect(deriveSymbol({ precip: 2, cloud: 90, t: -2 })).toBe(52);
    expect(deriveSymbol({ precip: 0.5, cloud: 40, t: 10 })).toBe(21);
    expect(deriveSymbol({ precip: 0, cloud: null, t: 10 })).toBeNull();
  });
  it("разбирает часовой ряд с фолбэками", () => {
    const rows = [
      {
        time: "20261016T100000",
        origintime: "20261016T000000",
        Temperature: 19,
        WindUMS: 3,
        WindVMS: 4,
        Humidity: 35,
        Pressure: 1017,
        Precipitation1h: 0,
        TotalCloudCover: null,
        SmartSymbol: null,
      },
      {
        time: "20261016T110000",
        Temperature: "18.5",
        WindSpeedMS: 2.2,
        WindDirection: 180,
        Precipitation1h: 1.5,
        TotalCloudCover: 90,
        SmartSymbol: 32,
      },
    ];
    const points = parseHourly(rows);
    expect(points).toHaveLength(2);
    expect(points[0]?.ws).toBe(5);
    expect(points[0]?.originTime?.toISOString()).toBe("2026-10-16T00:00:00.000Z");
    expect(points[0]?.symbol).toBeNull();
    expect(points[1]?.t).toBe(18.5);
    expect(points[1]?.symbol).toBe(32);
  });
  it("разбирает суточные агрегаты", () => {
    const days = parseDaily([
      {
        time: "20261017T000000",
        tmax: 20,
        tmin: 10,
        precip: 0.1,
        wsmax: null,
        cloud: 20,
        symbol: null,
      },
    ]);
    expect(days[0]?.tmax).toBe(20);
    expect(days[0]?.symbol).toBe(2);
  });
  it("ночные варианты и ключи символов", () => {
    expect(nightVariant(1, 23)).toBe(101);
    expect(nightVariant(1, 12)).toBe(1);
    expect(symbolKey(132)).toBe("rain");
    expect(symbolPath(104, "dark")).toBe("/weather-symbols/dark/104.svg");
    expect(symbolPath(999)).toBeNull();
  });
});
