import { describe, expect, it } from "vitest";
import { type ImportContext, parseMeasurementsCsv } from "@/lib/import/measurements-csv";

function ctx(overrides: Partial<ImportContext> = {}): ImportContext {
  return {
    stations: new Map([
      ["DU-01", { id: 1, sampling: "discrete", inputUnits: new Map([[3, "ppb"]]) }],
      ["KH-02", { id: 2, sampling: "continuous", inputUnits: new Map() }],
    ]),
    pollutants: new Map([
      ["PM25", { id: 1, unit: "µg/m³", decimals: 1, molarMass: null }],
      ["PM10", { id: 2, unit: "µg/m³", decimals: 1, molarMass: null }],
      ["NO2", { id: 3, unit: "µg/m³", decimals: 1, molarMass: 46.0055 }],
      ["CO", { id: 5, unit: "mg/m³", decimals: 2, molarMass: 28.01 }],
    ]),
    ranges: new Map([[1, { min: 0, max: 2000 }]]),
    ...overrides,
  };
}

describe("parseMeasurementsCsv", () => {
  it("разбирает корректный файл с конверсией единиц и флагами диапазона", () => {
    const csv = [
      "time,station,pollutant,value,unit",
      "2026-10-16 07:00,DU-01,PM25,42.5,µg/m³",
      "2026-10-16 07:00,du-01,NO2,10,ppb",
      "2026-10-16T02:00:00Z,KH-02,CO,1500,µg/m³",
      "2026-10-16 13:00,DU-01,PM25,2500,",
      "2026-10-16 13:00,DU-01,NO2,5,",
    ].join("\n");
    const report = parseMeasurementsCsv(csv, ctx());
    expect(report.total).toBe(5);
    expect(report.ok).toBe(5);
    expect(report.rejected).toBe(0);
    expect(report.invalidRange).toBe(1);
    const no2 = report.rows.find(
      (r) => r.pollutantId === 3 && r.time === "2026-10-16T02:00:00.000Z",
    );
    expect(no2?.value).toBeCloseTo(18.815, 2);
    const co = report.rows.find((r) => r.pollutantId === 5);
    expect(co?.value).toBe(1.5);
    expect(co?.averagingMin).toBe(60);
    const invalid = report.rows.find((r) => r.value === 2500);
    expect(invalid?.qcFlag).toBe(3);
    // NO2 без единицы берёт единицу ввода станции (ppb)
    const no2b = report.rows.find(
      (r) => r.pollutantId === 3 && r.time === "2026-10-16T08:00:00.000Z",
    );
    expect(no2b?.value).toBeCloseTo(9.41, 1);
  });

  it("отклоняет строки с ошибками и дубликаты", () => {
    const csv = [
      "time;station;pollutant;value",
      "2026-10-16 07:00;DU-01;PM25;12,5",
      "2026-10-16 07:00;DU-01;PM25;13",
      "not-a-time;DU-01;PM25;1",
      "2026-10-16 07:00;XX-99;PM25;1",
      "2026-10-16 07:00;DU-01;SO2;1",
      "2026-10-16 07:00;DU-01;PM10;abc",
      "2026-10-16 07:00;DU-01;PM25;;",
    ].join("\n");
    const report = parseMeasurementsCsv(csv, ctx());
    expect(report.ok).toBe(1);
    expect(report.rows[0]?.value).toBe(12.5);
    expect(report.errors.map((e) => e.message.split(":")[0])).toEqual([
      "duplicate",
      "time",
      "unknownStation",
      "unknownPollutant",
      "value",
      "emptyValue",
    ]);
  });

  it("требует обязательные столбцы и станцию по умолчанию", () => {
    expect(parseMeasurementsCsv("time,value\n2026-10-16 07:00,1", ctx()).errors[0]?.message).toBe(
      "missingColumn:pollutant",
    );
    expect(
      parseMeasurementsCsv("time,pollutant,value\n2026-10-16 07:00,PM25,1", ctx()).errors[0]
        ?.message,
    ).toBe("missingColumn:station");
    const ok = parseMeasurementsCsv(
      "time,pollutant,value\n2026-10-16 07:00,PM25,1",
      ctx({ defaultStationCode: "DU-01" }),
    );
    expect(ok.ok).toBe(1);
    expect(ok.rows[0]?.stationId).toBe(1);
  });
});
