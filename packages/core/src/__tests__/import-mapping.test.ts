import { describe, expect, it } from "vitest";
import {
  type HistoryImportContext,
  type HistoryImportMapping,
  mapHistoryRows,
  parseImportTime,
  parseImportValue,
  timezoneOffsetMinutes,
  validateMapping,
} from "../import-mapping";

type PollutantEntry = HistoryImportContext["pollutants"] extends Map<string, infer V> ? V : never;

function ctx(): HistoryImportContext {
  const pm25: PollutantEntry = { id: 1, code: "PM25", unit: "µg/m³", decimals: 1, molarMass: null };
  const pm10: PollutantEntry = { id: 2, code: "PM10", unit: "µg/m³", decimals: 1, molarMass: null };
  const no2: PollutantEntry = {
    id: 3,
    code: "NO2",
    unit: "µg/m³",
    decimals: 1,
    molarMass: 46.0055,
  };
  const co: PollutantEntry = { id: 5, code: "CO", unit: "mg/m³", decimals: 2, molarMass: 28.01 };
  return {
    stations: new Map([
      ["DU-01", { id: 10, sampling: "discrete", inputUnits: new Map([[3, "ppb" as const]]) }],
      ["KH-02", { id: 20, sampling: "continuous", inputUnits: new Map() }],
    ]),
    pollutants: new Map([
      ["PM25", pm25],
      ["PM10", pm10],
      ["NO2", no2],
      ["CO", co],
    ]),
    ranges: new Map([[1, { min: 0, max: 2000 }]]),
    now: new Date("2026-10-17T12:00:00Z"),
  };
}

describe("parseImportTime", () => {
  it("формат с токенами в зоне Душанбе → UTC", () => {
    expect(parseImportTime("05.01.2024 07:00", { format: "DD.MM.YYYY HH:mm" })?.toISOString()).toBe(
      "2024-01-05T02:00:00.000Z",
    );
    expect(
      parseImportTime("2024-01-05 7:5", {
        format: "YYYY-MM-DD H:m",
        timezone: "UTC",
      })?.toISOString(),
    ).toBe("2024-01-05T07:05:00.000Z");
  });
  it("без формата: ISO со зоной как есть, без зоны — по маппингу, DD.MM.YYYY", () => {
    expect(parseImportTime("2024-01-05T07:00:00+05:00", {})?.toISOString()).toBe(
      "2024-01-05T02:00:00.000Z",
    );
    expect(parseImportTime("2024-01-05T07:00:00", { timezone: "+03:00" })?.toISOString()).toBe(
      "2024-01-05T04:00:00.000Z",
    );
    expect(parseImportTime("05.01.2024", { defaultTime: "13:00" })?.toISOString()).toBe(
      "2024-01-05T08:00:00.000Z",
    );
    expect(parseImportTime("бред", {})).toBeNull();
    expect(parseImportTime("31.02.2024", {})).toBeNull();
  });
  it("серийная дата Excel и отдельный столбец времени", () => {
    expect(parseImportTime(45296, { timeValue: "19:00", timezone: "UTC" })?.toISOString()).toBe(
      "2024-01-05T19:00:00.000Z",
    );
    expect(parseImportTime(45296.5, { timezone: "UTC" })?.toISOString()).toBe(
      "2024-01-05T12:00:00.000Z",
    );
    expect(parseImportTime("05.01.2024", { timeValue: 0.25, timezone: "UTC" })?.toISOString()).toBe(
      "2024-01-05T06:00:00.000Z",
    );
  });
  it("часовые пояса", () => {
    expect(timezoneOffsetMinutes(undefined)).toBe(300);
    expect(timezoneOffsetMinutes("UTC")).toBe(0);
    expect(timezoneOffsetMinutes("-03:30")).toBe(-210);
    expect(() => timezoneOffsetMinutes("Europe/Helsinki")).toThrow();
  });
});

describe("parseImportValue", () => {
  const missing = new Set(["", "-", "н/д"]);
  it("десятичная запятая, маркеры пропуска, ниже предела обнаружения, мусор", () => {
    expect(parseImportValue("12,5", missing)).toEqual({ value: 12.5 });
    expect(parseImportValue(" 7 ", missing)).toEqual({ value: 7 });
    expect(parseImportValue(3.25, missing)).toEqual({ value: 3.25 });
    expect(parseImportValue("н/д", missing)).toBeNull();
    expect(parseImportValue("<5", missing)).toEqual({ value: 2.5, belowLimit: 5 });
    expect(parseImportValue("abc", missing)).toBeNaN();
    expect(parseImportValue(null, missing)).toBeNull();
  });
});

describe("validateMapping", () => {
  it("находит ошибки структуры", () => {
    expect(validateMapping({ layout: "wide", station: {}, time: {} })).toEqual([
      "station: нужен column или value",
      "time: нужен column или dateColumn",
      "pollutants: для широкого формата нужен хотя бы один столбец вещества",
    ]);
    expect(
      validateMapping({ layout: "long", station: { value: "DU-01" }, time: { column: "t" } }),
    ).toEqual([
      "pollutantColumn: обязателен для длинного формата",
      "valueColumn: обязателен для длинного формата",
    ]);
  });
});

describe("mapHistoryRows — широкий формат", () => {
  const mapping: HistoryImportMapping = {
    layout: "wide",
    station: { column: "Пост" },
    time: { dateColumn: "Дата", timeColumn: "Срок", format: "DD.MM.YYYY" },
    pollutants: {
      "PM2.5": { column: "Пыль мелкая" },
      PM10: { column: "PM10, мкг/м3" },
      "Диоксид азота": { column: "NO2" },
      CO: { column: "CO, мг/м3", unit: "mg/m3" },
    },
    pollutantAliases: { "Диоксид азота": "NO2" },
  };
  const table = {
    header: ["Дата", "Срок", "Пост", "Пыль мелкая", "PM10, мкг/м3", "NO2", "CO, мг/м3"],
    rows: [
      ["05.01.2024", "07:00", "DU-01", "45,2", "80", "20", "1,5"],
      ["05.01.2024", "13:00", "DU-01", "-", "<10", "abc", ""],
      ["05.01.2024", "13:00", "DU-01", "3000", "", "", ""],
      ["05.01.2024", "19:00", "XX-99", "1", "2", "3", "4"],
      ["32.01.2024", "19:00", "DU-01", "1", "2", "3", "4"],
      ["", "", "", "", "", "", ""],
      ["05.01.2024", "07:00", "DU-01", "45,2", "", "", ""],
    ],
  };

  it("конвертирует единицы, применяет диапазоны, считает дубликаты и ошибки", () => {
    const r = mapHistoryRows(table, mapping, ctx());
    expect(r.total).toBe(6);
    expect(r.ok).toBe(6);
    expect(r.duplicates).toBe(1);
    expect(r.invalidRange).toBe(1);
    expect(r.errors.map((e) => e.message)).toEqual([
      "value:NO2:abc",
      "unknownStation:XX-99",
      "time:32.01.2024",
    ]);
    const first = r.rows.filter((x) => x.time.toISOString() === "2024-01-05T02:00:00.000Z");
    expect(first.map((x) => [x.pollutantId, x.value, x.averagingMin])).toEqual([
      [1, 45.2, 20],
      [2, 80, 20],
      [3, 37.632, 20], // 20 ppb NO2 → µg/m³ (единица станции)
      [5, 1.5, 20],
    ]);
    const second = r.rows.filter((x) => x.time.toISOString() === "2024-01-05T08:00:00.000Z");
    expect(second.find((x) => x.pollutantId === 2)).toMatchObject({
      value: 5,
      qcReason: "belowDetectionLimit:10",
      qcFlag: 1,
    });
    expect(second.find((x) => x.pollutantId === 1)).toMatchObject({ value: 3000, qcFlag: 3 });
    expect(r.stationIds).toEqual([10]);
    expect(r.from?.toISOString()).toBe("2024-01-05T02:00:00.000Z");
    expect(r.to?.toISOString()).toBe("2024-01-05T08:00:00.000Z");
  });

  it("qcFlag 0 оставляет значения сырыми для автоконтроля, индексы колонок и фиксированная станция", () => {
    const r = mapHistoryRows(
      { header: ["a", "b"], rows: [["2024-01-05 07:00", "12"]] },
      {
        layout: "wide",
        station: { value: "kh-02" },
        time: { column: 0 },
        pollutants: { PM25: { column: 1 } },
        qcFlag: 0,
        averagingMin: 1440,
      },
      ctx(),
    );
    expect(r.rows).toEqual([
      {
        time: new Date("2024-01-05T02:00:00.000Z"),
        stationId: 20,
        pollutantId: 1,
        averagingMin: 1440,
        value: 12,
        qcFlag: 0,
        qcReason: null,
      },
    ]);
  });

  it("неизвестная колонка или вещество в маппинге — ошибка конфигурации", () => {
    expect(() =>
      mapHistoryRows(
        { header: ["t"], rows: [] },
        {
          layout: "wide",
          station: { value: "DU-01" },
          time: { column: "t" },
          pollutants: { PM25: { column: "нет" } },
        },
        ctx(),
      ),
    ).toThrow(/не найдена/);
    expect(() =>
      mapHistoryRows(
        { header: ["t", "v"], rows: [] },
        {
          layout: "wide",
          station: { value: "DU-01" },
          time: { column: "t" },
          pollutants: { HG: { column: "v" } },
        },
        ctx(),
      ),
    ).toThrow(/не найдено в справочнике/);
  });
});

describe("mapHistoryRows — длинный формат", () => {
  it("вещество/значение/единица в строке, будущее время отклоняется", () => {
    const r = mapHistoryRows(
      {
        header: ["station", "time", "parameter", "value", "unit"],
        rows: [
          ["DU-01", "2024-01-05T07:00:00Z", "NO₂", "0.02", "ppm"],
          ["DU-01", "2024-01-05T07:00:00Z", "pm 10", "90", ""],
          ["DU-01", "2024-01-05T07:00:00Z", "SO2", "5", ""],
          ["DU-01", "2099-01-05T07:00:00Z", "PM10", "5", ""],
          ["DU-01", "2024-01-05T07:00:00Z", "PM25", "5", "кг"],
        ],
      },
      {
        layout: "long",
        station: { column: "station" },
        time: { column: "time" },
        pollutantColumn: "parameter",
        valueColumn: "value",
        unitColumn: "unit",
      },
      ctx(),
    );
    expect(r.ok).toBe(2);
    expect(r.rows[0]).toMatchObject({ pollutantId: 3, value: 37.632 });
    expect(r.rows[1]).toMatchObject({ pollutantId: 2, value: 90 });
    expect(r.errors.map((e) => e.message)).toEqual([
      "unknownPollutant:SO2",
      "futureTime",
      "unit:кг",
    ]);
  });
});
