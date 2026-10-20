import { describe, expect, it } from "vitest";
import {
  type IngestContext,
  normalizeIngestRecords,
  parseIngestTime,
  parseVendorFlag,
  resolvePollutantCode,
} from "../ingest";

function ctx(overrides: Partial<IngestContext> = {}): IngestContext {
  return {
    station: {
      id: 10,
      code: "DU-01",
      sampling: "continuous",
      inputUnits: new Map([
        [1, "µg/m³"],
        [3, "ppb"],
        [5, "mg/m³"],
      ]),
    },
    pollutants: new Map([
      ["PM25", { id: 1, code: "PM25", unit: "µg/m³", decimals: 1, molarMass: null }],
      ["PM10", { id: 2, code: "PM10", unit: "µg/m³", decimals: 1, molarMass: null }],
      ["NO2", { id: 3, code: "NO2", unit: "µg/m³", decimals: 1, molarMass: 46.0055 }],
      ["CO", { id: 5, code: "CO", unit: "mg/m³", decimals: 2, molarMass: 28.01 }],
    ]),
    ranges: new Map([[1, { min: 0, max: 2000 }]]),
    now: new Date("2026-10-18T10:00:00Z"),
    ...overrides,
  };
}

describe("resolvePollutantCode", () => {
  it("синонимы вендоров и единицы в названии", () => {
    expect(resolvePollutantCode("pm2.5")).toBe("PM25");
    expect(resolvePollutantCode("PM 2,5")).toBe("PM25");
    expect(resolvePollutantCode("pm2p5")).toBe("PM25");
    expect(resolvePollutantCode("PM2.5 (ug/m3)")).toBe("PM25");
    expect(resolvePollutantCode("PM10 µg/m³")).toBe("PM10");
    expect(resolvePollutantCode("NO₂")).toBe("NO2");
    expect(resolvePollutantCode("Nitrogen dioxide")).toBe("NO2");
    expect(resolvePollutantCode("Ozone")).toBe("O3");
    expect(resolvePollutantCode("Диоксид серы")).toBe("SO2");
    expect(resolvePollutantCode("CO ppm")).toBe("CO");
    expect(resolvePollutantCode("Temperature")).toBe("TEMPERATURE");
    // Вещества бюллетеней Агентства: оксид азота, формальдегид, фенол, HF, пыль, CO₂, ЛОС
    expect(resolvePollutantCode("Оксид азота")).toBe("NO");
    expect(resolvePollutantCode("NO (ppb)")).toBe("NO");
    expect(resolvePollutantCode("HCHO")).toBe("CH2O");
    expect(resolvePollutantCode("Формальдегид, мг/м3")).toBe("CH2O");
    expect(resolvePollutantCode("Phenol")).toBe("C6H5OH");
    expect(resolvePollutantCode("C6H6O")).toBe("C6H5OH");
    expect(resolvePollutantCode("Фтористый водород")).toBe("HF");
    expect(resolvePollutantCode("Взвешенные частицы")).toBe("TSP");
    expect(resolvePollutantCode("пыль")).toBe("TSP");
    expect(resolvePollutantCode("CO2 ppm")).toBe("CO2");
    expect(resolvePollutantCode("ЛОС")).toBe("TVOC");
    expect(resolvePollutantCode("VOC")).toBe("TVOC");
  });
  it("явные синонимы маппинга имеют приоритет", () => {
    expect(resolvePollutantCode("Ch1", { ch1: "PM2.5", ch2: "no2" })).toBe("PM25");
    expect(resolvePollutantCode("CH2", { ch1: "PM2.5", ch2: "no2" })).toBe("NO2");
  });
});

describe("parseIngestTime / parseVendorFlag", () => {
  it("ISO со зоной, местное без зоны, epoch", () => {
    expect(parseIngestTime("2026-10-18T07:00:00Z")?.toISOString()).toBe("2026-10-18T07:00:00.000Z");
    expect(parseIngestTime("2026-10-18 12:00")?.toISOString()).toBe("2026-10-18T07:00:00.000Z");
    expect(parseIngestTime("2026-10-18T12:00:00")?.toISOString()).toBe("2026-10-18T07:00:00.000Z");
    expect(parseIngestTime("18.10.2026 12:00")?.toISOString()).toBe("2026-10-18T07:00:00.000Z");
    expect(parseIngestTime(1792177200)?.toISOString()).toBe("2026-10-16T19:00:00.000Z");
    expect(parseIngestTime(1792177200000)?.toISOString()).toBe("2026-10-16T19:00:00.000Z");
    expect(parseIngestTime("1792177200")?.toISOString()).toBe("2026-10-16T19:00:00.000Z");
    expect(parseIngestTime("yesterday")).toBeNull();
    expect(parseIngestTime("")).toBeNull();
  });
  it("флаги вендоров → коды QC", () => {
    expect(parseVendorFlag("OK")).toBe(1);
    expect(parseVendorFlag("Invalid")).toBe(3);
    expect(parseVendorFlag("CAL")).toBe(3);
    expect(parseVendorFlag("suspect")).toBe(2);
    expect(parseVendorFlag("missing")).toBe(5);
    expect(parseVendorFlag(3)).toBe(3);
    expect(parseVendorFlag("2")).toBe(2);
    expect(parseVendorFlag("whatever")).toBeNull();
    expect(parseVendorFlag(null)).toBeNull();
  });
});

describe("normalizeIngestRecords", () => {
  it("конвертирует единицы, применяет диапазон и единицу ввода станции", () => {
    const r = normalizeIngestRecords(
      [
        { time: "2026-10-18T07:00:00Z", pollutant: "PM25", value: 42.5 },
        { time: "2026-10-18 15:00", pollutant: "pm2.5", value: "12,5", unit: "ug/m3" },
        { time: "2026-10-18T07:00:00Z", pollutant: "NO2", value: 10 },
        {
          time: "2026-10-18T07:00:00Z",
          pollutant: "no2",
          value: 10,
          unit: "µg/m³",
          averagingMin: 1,
        },
        { time: "2026-10-18T07:00:00Z", pollutant: "CO", value: 1500, unit: "µg/m³" },
        { time: "2026-10-18T08:00:00Z", pollutant: "PM25", value: 2500 },
        { time: "2026-10-18T09:00:00Z", pollutant: "PM2.5", value: "<5" },
      ],
      ctx(),
    );
    expect(r.received).toBe(7);
    expect(r.accepted).toBe(7);
    expect(r.rejected).toBe(0);
    expect(r.invalidRange).toBe(1);
    expect(r.errors).toEqual([]);
    const byKey = (p: number, iso: string, avg = 60) =>
      r.rows.find(
        (x) => x.pollutantId === p && x.time.toISOString() === iso && x.averagingMin === avg,
      );
    expect(byKey(1, "2026-10-18T07:00:00.000Z")?.value).toBe(42.5);
    expect(byKey(1, "2026-10-18T07:00:00.000Z")?.qcFlag).toBe(1);
    expect(byKey(1, "2026-10-18T10:00:00.000Z")?.value).toBe(12.5);
    // NO2 без единицы — единица ввода станции ppb → µg/m³
    expect(byKey(3, "2026-10-18T07:00:00.000Z")?.value).toBeCloseTo(18.815, 2);
    expect(byKey(3, "2026-10-18T07:00:00.000Z", 1)?.value).toBe(10);
    expect(byKey(5, "2026-10-18T07:00:00.000Z")?.value).toBe(1.5);
    const invalid = byKey(1, "2026-10-18T08:00:00.000Z");
    expect(invalid?.qcFlag).toBe(3);
    expect(invalid?.qcReason).toBe("range:0..2000");
    const below = byKey(1, "2026-10-18T09:00:00.000Z");
    expect(below?.value).toBe(2.5);
    expect(below?.qcReason).toBe("belowDetectionLimit:5");
    expect(r.from?.toISOString()).toBe("2026-10-18T07:00:00.000Z");
    expect(r.to?.toISOString()).toBe("2026-10-18T10:00:00.000Z");
    expect(r.pollutantCodes.sort()).toEqual(["CO", "NO2", "PM25"]);
  });

  it("отклоняет ошибки по строкам с причинами, дубликаты — последняя запись", () => {
    const r = normalizeIngestRecords(
      [
        { time: "not a time", pollutant: "PM25", value: 1 },
        { time: "2026-10-18T12:00:00Z", pollutant: "PM25", value: 1 },
        { time: "2020-01-01T00:00:00Z", pollutant: "PM25", value: 1 },
        { time: "2026-10-18T07:00:00Z", pollutant: "XX", value: 1 },
        { time: "2026-10-18T07:00:00Z", pollutant: "PM10", value: 1 },
        { time: "2026-10-18T07:00:00Z", pollutant: "PM25", value: "abc" },
        { time: "2026-10-18T07:00:00Z", pollutant: "PM25", value: null },
        { time: "2026-10-18T07:00:00Z", pollutant: "PM25", value: 1, unit: "pcs" },
        { time: "2026-10-18T07:00:00Z", pollutant: "PM25", value: 1, unit: "ppb" },
        { time: "2026-10-18T07:00:00Z", pollutant: "PM25", value: 1, averagingMin: 0 },
        { time: "2026-10-18T07:00:00Z", pollutant: "PM25", value: 5 },
        { time: "2026-10-18T07:00:00Z", pollutant: "PM25", value: 6 },
      ],
      ctx(),
    );
    expect(r.accepted).toBe(1);
    expect(r.duplicates).toBe(1);
    expect(r.rejected).toBe(10);
    expect(r.rows[0]?.value).toBe(6);
    expect(r.errors.map((e) => `${e.index}:${e.message.split(":")[0]}`)).toEqual([
      "0:time",
      "1:futureTime",
      "2:tooOld",
      "3:unknownPollutant",
      "4:pollutantNotConfigured",
      "5:value",
      "6:emptyValue",
      "7:unit",
      "8:unitConversion",
      "9:averagingMin",
      "10:duplicate",
    ]);
    expect(r.errors[3]?.message).toBe("unknownPollutant:XX");
    expect(r.errors[4]?.message).toBe("pollutantNotConfigured:PM10");
  });

  it("флаги вендора: invalid/suspect сохраняются с причиной, missing без значения", () => {
    const r = normalizeIngestRecords(
      [
        { time: "2026-10-18T07:00:00Z", pollutant: "PM25", value: 10, flag: "CAL" },
        { time: "2026-10-18T08:00:00Z", pollutant: "PM25", value: 10, flag: "warning" },
        { time: "2026-10-18T09:00:00Z", pollutant: "PM25", value: null, flag: "missing" },
        { time: "2026-10-18T10:00:00Z", pollutant: "PM25", value: 3000, flag: "ok" },
        { time: "2026-10-18T06:00:00Z", pollutant: "PM25", value: 10, flag: 0 },
      ],
      ctx(),
    );
    expect(r.accepted).toBe(5);
    const flags = r.rows.map((x) => [x.qcFlag, x.qcReason, x.value]);
    expect(flags).toEqual([
      [3, "vendor:CAL", 10],
      [2, "vendor:warning", 10],
      [5, "vendor:missing", null],
      [3, "range:0..2000", 3000],
      [0, null, 10],
    ]);
  });

  it("разовые пробы: осреднение 20 мин, незнакомые вещества можно разрешить", () => {
    const r = normalizeIngestRecords(
      [{ time: "2026-10-18T02:00:00Z", pollutant: "PM10", value: 7 }],
      {
        ...ctx(),
        station: { id: 1, code: "X", sampling: "discrete", inputUnits: new Map() },
        allowUnconfiguredPollutants: true,
      },
    );
    expect(r.accepted).toBe(1);
    expect(r.rows[0]?.averagingMin).toBe(20);
    expect(r.rows[0]?.value).toBe(7);
  });
});
