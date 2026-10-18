import { describe, expect, it } from "vitest";
import {
  type FeedMapping,
  filePatternToRegExp,
  normalizeDelimiter,
  parseStationFeed,
  validateFeedMapping,
} from "../station-feed";

const now = new Date("2026-10-18T10:00:00Z");

describe("validateFeedMapping", () => {
  it("находит ошибки структуры", () => {
    expect(validateFeedMapping(null)).toHaveLength(1);
    expect(validateFeedMapping({ layout: "wide", time: { column: "t" } })).toEqual([
      "pollutants: для широкого формата нужен хотя бы один столбец вещества",
    ]);
    expect(validateFeedMapping({ layout: "long", time: {} })).toEqual([
      "time: нужен column или dateColumn",
      "pollutantColumn: обязателен для длинного формата",
      "valueColumn: обязателен для длинного формата",
    ]);
    expect(
      validateFeedMapping({
        layout: "wide",
        headerRow: 0,
        time: { column: "Time", timezone: "Mars/Olympus" },
        pollutants: { PM25: { column: 1 } },
      }),
    ).toEqual([
      "time.timezone: часовой пояс «Mars/Olympus» не поддерживается (Asia/Dushanbe, UTC или смещение +HH:MM)",
      "headerRow: 0 — без заголовка все колонки задаются индексами",
    ]);
    expect(
      validateFeedMapping({
        layout: "wide",
        time: { column: "Time" },
        pollutants: { "PM2.5": { column: "pm25" } },
      }),
    ).toEqual([]);
  });
});

describe("parseStationFeed: широкий формат", () => {
  const mapping: FeedMapping = {
    layout: "wide",
    delimiter: ";",
    time: { column: "Дата/время", format: "DD.MM.YYYY HH:mm" },
    pollutants: {
      "PM2.5": { column: "PM2.5 (мкг/м3)" },
      PM10: { column: "PM10 (мкг/м3)", flagColumn: "PM10 статус" },
      CO: { column: "CO", unit: "mg/m3", scale: 1 },
    },
    statusColumn: "Статус",
    invalidStatuses: ["CAL", "ERR"],
  };
  const text = [
    "﻿Дата/время;PM2.5 (мкг/м3);PM10 (мкг/м3);PM10 статус;CO;Статус",
    "18.10.2026 12:00;12,5;30;OK;1,2;OK",
    "18.10.2026 13:00;;31;;1,3;OK",
    "18.10.2026 14:00;abc;<4;;;CAL",
    "18.10.2026 14:00;9;32;S;;OK",
    "",
    "bad time;1;2;;;OK",
  ].join("\r\n");

  it("даёт записи с ISO-временем, единицами, флагами и дедупликацией", () => {
    const r = parseStationFeed(text, mapping, { now });
    expect(r.total).toBe(5);
    expect(r.errors).toEqual([
      { row: 4, message: "value:PM25:abc" },
      { row: 6, message: "time:bad time" },
    ]);
    expect(r.duplicates).toBe(1);
    expect(r.records.map((x) => [x.time, x.pollutant, x.value, x.unit, x.flag])).toEqual([
      ["2026-10-18T07:00:00.000Z", "PM25", 12.5, undefined, undefined],
      ["2026-10-18T07:00:00.000Z", "PM10", 30, undefined, "OK"],
      ["2026-10-18T07:00:00.000Z", "CO", 1.2, "mg/m3", undefined],
      ["2026-10-18T08:00:00.000Z", "PM10", 31, undefined, undefined],
      ["2026-10-18T08:00:00.000Z", "CO", 1.3, "mg/m3", undefined],
      ["2026-10-18T09:00:00.000Z", "PM10", 32, undefined, "S"],
      ["2026-10-18T09:00:00.000Z", "PM25", 9, undefined, undefined],
    ]);
    expect(r.records.find((x) => x.row === 2)?.row).toBe(2);
    expect(r.from).toBe("2026-10-18T07:00:00.000Z");
    expect(r.to).toBe("2026-10-18T09:00:00.000Z");
  });

  it("строка со статусом CAL отдаёт значения с флагом invalid, а не теряет их", () => {
    const r = parseStationFeed(
      "Дата/время;PM2.5 (мкг/м3);PM10 (мкг/м3);PM10 статус;CO;Статус\n18.10.2026 14:00;5;<4;;;CAL",
      mapping,
      { now },
    );
    expect(r.records.map((x) => [x.pollutant, x.value, x.flag])).toEqual([
      ["PM25", 5, "invalid:CAL"],
      ["PM10", "<4", "invalid:CAL"],
    ]);
  });
});

describe("parseStationFeed: длинный формат, TSV, без заголовка, раздельные дата/время", () => {
  it("TSV с ISO UTC и колонкой единиц", () => {
    const mapping: FeedMapping = {
      layout: "long",
      delimiter: "tab",
      time: { column: "timestamp", timezone: "UTC" },
      pollutantColumn: "parameter",
      valueColumn: "value",
      unitColumn: "unit",
      flagColumn: "qc",
      pollutantAliases: { "Ozone 1h": "O3" },
    };
    const text = [
      "timestamp\tparameter\tvalue\tunit\tqc",
      "2026-10-18T07:00:00\tPM2.5\t12.5\tug/m3\tvalid",
      "2026-10-18T07:00:00\tOzone 1h\t40\tppb\t",
      "2026-10-18T07:00:00\t\t1\t\t",
    ].join("\n");
    const r = parseStationFeed(text, mapping, { now });
    expect(r.records.map((x) => [x.time, x.pollutant, x.value, x.unit, x.flag])).toEqual([
      ["2026-10-18T07:00:00.000Z", "PM25", 12.5, "ug/m3", "valid"],
      ["2026-10-18T07:00:00.000Z", "O3", 40, "ppb", undefined],
    ]);
    expect(r.errors).toEqual([{ row: 4, message: "pollutant:(пусто)" }]);
  });

  it("без заголовка: индексы колонок, комментарии, пропуск строк, дата + время раздельно", () => {
    const mapping: FeedMapping = {
      layout: "wide",
      headerRow: 0,
      commentPrefix: "#",
      time: { dateColumn: 0, timeColumn: 1, format: "YYYY/MM/DD", timeFormat: "HH:mm:ss" },
      pollutants: { so2: { column: 2, unit: "ppb" }, no2: { column: 3 } },
      missingValues: ["-999"],
      averagingMin: 60,
    };
    const text = [
      "# logger export",
      "2026/10/18,12:00:00,3.5,-999",
      "2026/10/18,13:00:00,4,15",
    ].join("\n");
    const r = parseStationFeed(text, mapping, { now });
    expect(r.errors).toEqual([]);
    expect(r.records.map((x) => [x.time, x.pollutant, x.value, x.unit, x.averagingMin])).toEqual([
      ["2026-10-18T07:00:00.000Z", "SO2", 3.5, "ppb", 60],
      ["2026-10-18T08:00:00.000Z", "SO2", 4, "ppb", 60],
      ["2026-10-18T08:00:00.000Z", "NO2", 15, undefined, 60],
    ]);
    expect(r.empty).toBe(0);
  });

  it("неизвестная колонка и будущие даты", () => {
    const r = parseStationFeed("t,v\n2026-10-18 12:00,1", {
      layout: "wide",
      time: { column: "time" },
      pollutants: { PM25: { column: "v" } },
    });
    expect(r.errors[0]?.message).toContain("column:");
    const future = parseStationFeed("t,v\n2027-01-01 12:00,1", {
      layout: "wide",
      time: { column: "t" },
      pollutants: { PM25: { column: "v" } },
    });
    expect(future.errors).toEqual([{ row: 2, message: "futureTime" }]);
  });
});

describe("filePatternToRegExp / normalizeDelimiter", () => {
  it("маски файлов", () => {
    expect(filePatternToRegExp("*.csv").test("DU-01_2026.CSV")).toBe(true);
    expect(filePatternToRegExp("*.csv").test("data.txt")).toBe(false);
    expect(filePatternToRegExp("DU-01_????.txt").test("DU-01_2026.txt")).toBe(true);
    expect(filePatternToRegExp("DU-01_????.txt").test("DU-01_26.txt")).toBe(false);
    expect(filePatternToRegExp("").test("anything")).toBe(true);
    expect(filePatternToRegExp("a.b").test("axb")).toBe(false);
  });
  it("слова-разделители", () => {
    expect(normalizeDelimiter("tab")).toBe("\t");
    expect(normalizeDelimiter("semicolon")).toBe(";");
    expect(normalizeDelimiter(";")).toBe(";");
    expect(normalizeDelimiter(undefined)).toBeUndefined();
  });
});
