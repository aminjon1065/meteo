import { describe, expect, it } from "vitest";
import {
  FMI_SILAM_PRODUCTS,
  fmiSilamFolder,
  fmiSilamFrameTime,
  fmiSilamFrameUrl,
  fmiSilamIsStale,
  fmiSilamNearestHour,
  fmiSilamOrigin,
  fmiSilamProduct,
  fmiSilamRunId,
  fmiSilamUpstreamPath,
  parseFmiSilamFramePath,
  parseFmiSilamRunId,
} from "../silam-fmi";

describe("silam-fmi", () => {
  it("прогон начинается в 00 UTC суток перед выпуском", () => {
    // Каталог 000 записан 29.10.2026 в 02:02 UTC, первый кадр подписан «28Oct2026 hour: 00Z».
    expect(fmiSilamOrigin(new Date("2026-10-29T02:02:56Z")).toISOString()).toBe(
      "2026-10-28T00:00:00.000Z",
    );
    // Переход через месяц и год.
    expect(fmiSilamOrigin(new Date("2026-11-01T02:03:00Z")).toISOString()).toBe(
      "2026-10-31T00:00:00.000Z",
    );
    expect(fmiSilamOrigin(new Date("2027-01-01T23:59:00Z")).toISOString()).toBe(
      "2026-12-31T00:00:00.000Z",
    );
  });

  it("идентификатор прогона туда и обратно", () => {
    const origin = new Date("2026-10-28T00:00:00Z");
    expect(fmiSilamRunId(origin)).toBe("20261028");
    expect(parseFmiSilamRunId("20261028")?.toISOString()).toBe(origin.toISOString());
    expect(parseFmiSilamRunId("20261332")).toBeNull();
    expect(parseFmiSilamRunId("20260230")).toBeNull();
    expect(parseFmiSilamRunId("2026102")).toBeNull();
    expect(parseFmiSilamRunId("../../etc")).toBeNull();
  });

  it("каталог FMI по разнице прогонов в сутках", () => {
    const latest = new Date("2026-10-28T00:00:00Z");
    expect(fmiSilamFolder(latest, new Date("2026-10-28T00:00:00Z"))).toBe(0);
    expect(fmiSilamFolder(latest, new Date("2026-10-27T00:00:00Z"))).toBe(1);
    expect(fmiSilamFolder(latest, new Date("2026-10-26T00:00:00Z"))).toBe(2);
    // 003 и старше FMI не обновляет, будущего прогона ещё нет.
    expect(fmiSilamFolder(latest, new Date("2026-10-25T00:00:00Z"))).toBeNull();
    expect(fmiSilamFolder(latest, new Date("2026-10-29T00:00:00Z"))).toBeNull();
  });

  it("адреса кадров у FMI и на портале", () => {
    const pm10 = fmiSilamProduct("PM10");
    const aqi = fmiSilamProduct("AQI");
    expect(pm10 && fmiSilamUpstreamPath(0, pm10, 24)).toBe("000/PM10_surf_024.png");
    expect(aqi && fmiSilamUpstreamPath(1, aqi, 0)).toBe("001/AQI_000.png");
    expect(fmiSilamUpstreamPath(0, FMI_SILAM_PRODUCTS[5], 7)).toBe("000/PM2_5_surf_007.png");
    expect(fmiSilamFrameUrl("20261028", "PM25", 7)).toBe("/silam-fmi/20261028/PM25/007.png");
  });

  it("разбирает только кадры из белого списка", () => {
    const ok = parseFmiSilamFramePath(["20261028", "ABL", "048.png"]);
    expect(ok?.product.file).toBe("BLH");
    expect(ok?.hour).toBe(48);
    expect(ok?.runId).toBe("20261028");
    expect(parseFmiSilamFramePath(["20261028", "ABL", "049.png"])).toBeNull();
    expect(parseFmiSilamFramePath(["20261028", "BLH", "001.png"])).toBeNull();
    expect(parseFmiSilamFramePath(["20261028", "PM10", "1.png"])).toBeNull();
    expect(parseFmiSilamFramePath(["20261028", "PM10", "001.gif"])).toBeNull();
    expect(parseFmiSilamFramePath(["2026-10-28", "PM10", "001.png"])).toBeNull();
    expect(parseFmiSilamFramePath(["20261028", "PM10"])).toBeNull();
    expect(parseFmiSilamFramePath(["20261028", "PM10", "001.png", "x"])).toBeNull();
  });

  it("сроки кадров и ближайший к текущему моменту", () => {
    const origin = new Date("2026-10-28T00:00:00Z");
    expect(fmiSilamFrameTime(origin, 36).toISOString()).toBe("2026-10-29T12:00:00.000Z");
    expect(fmiSilamNearestHour(origin, new Date("2026-10-29T13:20:00Z"))).toBe(37);
    expect(fmiSilamNearestHour(origin, new Date("2026-10-27T10:00:00Z"))).toBe(0);
    expect(fmiSilamNearestHour(origin, new Date("2026-11-02T00:00:00Z"))).toBe(48);
  });

  it("прогон устарел, если FMI пропустил выпуск", () => {
    const origin = new Date("2026-10-28T00:00:00Z");
    // Обычный день: до следующего выпуска (30.10 ~02:03 UTC) прогон свежий.
    expect(fmiSilamIsStale(origin, new Date("2026-10-30T02:00:00Z"))).toBe(false);
    expect(fmiSilamIsStale(origin, new Date("2026-10-30T13:00:00Z"))).toBe(true);
  });
});
