import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  getByPath,
  historyUrl,
  isJsonFeedMapping,
  type JsonFeedMapping,
  parseJsonTime,
  parseStationJsonFeed,
  planHistoryFetch,
  validateJsonFeedMapping,
} from "../station-json";

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/wwcs/${name}`, import.meta.url), "utf8")) as unknown;

/** Маппинг сети PM‑датчиков Агентства (wwcs.tj): местное время без смещения, 10‑минутные значения. */
const wwcs: JsonFeedMapping = {
  format: "json",
  stationField: "stationID",
  time: { field: "timestamp", timezone: "Asia/Dushanbe", roundMin: 10 },
  pollutants: {
    PM25: { field: "PM25", unit: "µg/m³" },
    PM10: { field: "PM10", unit: "µg/m³" },
  },
  averagingMin: 10,
  history: { url: "https://wwcs.tj/services/airquality/history?hours={hours}", hours: 24 },
};
const now = new Date("2026-10-20T12:30:00Z");

describe("validateJsonFeedMapping / isJsonFeedMapping", () => {
  it("принимает маппинг wwcs и отличает его от маппинга файлов", () => {
    expect(validateJsonFeedMapping(wwcs)).toEqual([]);
    expect(isJsonFeedMapping(wwcs)).toBe(true);
    expect(isJsonFeedMapping({ layout: "wide", time: { column: "t" } })).toBe(false);
  });
  it("находит ошибки структуры", () => {
    expect(validateJsonFeedMapping(null)).toHaveLength(1);
    expect(
      validateJsonFeedMapping({
        format: "csv",
        time: { field: "", timezone: "Mars/Olympus", roundMin: 0 },
        pollutants: { PM25: { field: "" } },
        stations: { A: "" },
        averagingMin: 0,
        history: { url: "ftp://x", hours: 999 },
      }),
    ).toEqual([
      'format: ожидается "json"',
      "stations.A: нужен код станции портала",
      "time.field: путь к времени записи",
      "time.timezone: часовой пояс «Mars/Olympus» не поддерживается (Asia/Dushanbe, UTC или смещение +HH:MM)",
      "time.roundMin: целое число минут 1–1440",
      "pollutants.PM25: нужен field",
      "averagingMin: целое число минут 1–1440",
      "history.url: ожидается http(s)://",
      "history.hours: целое число часов 1–168",
    ]);
    expect(
      validateJsonFeedMapping({ format: "json", time: { field: "t" }, pollutants: {} }),
    ).toEqual(["pollutants: нужно хотя бы одно поле вещества"]);
  });
});

describe("getByPath / parseJsonTime / historyUrl", () => {
  it("путь с ключами и индексами", () => {
    const obj = { data: { items: [{ v: 1 }, { v: 2 }] }, n: null };
    expect(getByPath(obj, "data.items.1.v")).toBe(2);
    expect(getByPath(obj, "")).toBe(obj);
    expect(getByPath(obj, "n.x")).toBeUndefined();
    expect(getByPath(obj, "data.items.x")).toBeUndefined();
  });
  it("местное время без смещения, epoch, округление", () => {
    const t = { field: "t", timezone: "Asia/Dushanbe", roundMin: 10 };
    expect(parseJsonTime("2026-10-20T16:40:03", t)?.toISOString()).toBe("2026-10-20T11:40:00.000Z");
    expect(parseJsonTime("2026-10-20T16:44:59", t)?.toISOString()).toBe("2026-10-20T11:40:00.000Z");
    expect(parseJsonTime("2026-10-20T16:45:00", t)?.toISOString()).toBe("2026-10-20T11:50:00.000Z");
    expect(parseJsonTime(1792177200, { field: "t" })?.toISOString()).toBe(
      "2026-10-16T19:00:00.000Z",
    );
    expect(parseJsonTime("1792177200000", { field: "t" })?.toISOString()).toBe(
      "2026-10-16T19:00:00.000Z",
    );
    expect(
      parseJsonTime("2026-10-20T11:40:00Z", { field: "t", timezone: "UTC" })?.toISOString(),
    ).toBe("2026-10-20T11:40:00.000Z");
    expect(
      parseJsonTime("20.10.2026 16:40", { field: "t", format: "DD.MM.YYYY HH:mm" })?.toISOString(),
    ).toBe("2026-10-20T11:40:00.000Z");
    expect(parseJsonTime("yesterday", { field: "t" })).toBeNull();
    expect(parseJsonTime(null, { field: "t" })).toBeNull();
  });
  it("подставляет глубину истории", () => {
    expect(historyUrl("https://x/history?hours={hours}", 24)).toBe("https://x/history?hours=24");
    expect(historyUrl("https://x/history", 6)).toBe("https://x/history?hours=6");
    expect(historyUrl("https://x/history?a=1", 2.4)).toBe("https://x/history?a=1&hours=2");
  });
});

describe("parseStationJsonFeed", () => {
  it("разбирает ответ /airquality/stations: 9 станций, 18 значений, время UTC", () => {
    const result = parseStationJsonFeed(fixture("stations.json"), wwcs, { now });
    expect(result.errors).toEqual([]);
    expect(result.total).toBe(9);
    expect(result.records).toHaveLength(18);
    expect(result.stations).toHaveLength(9);
    expect(result.stations).toContain("DYU006_ECO");
    const dyu01 = result.records.filter((r) => r.stationCode === "DYU01_ECO");
    expect(dyu01.map((r) => r.pollutant).sort()).toEqual(["PM10", "PM25"]);
    expect(dyu01[0]).toMatchObject({
      time: "2026-10-20T11:50:00.000Z",
      unit: "µg/m³",
      averagingMin: 10,
      row: 1,
    });
    // 16:50:01 местного → округление к 16:50 → 11:50 UTC
    const school = result.records.find((r) => r.stationCode === "DYU008_ECO");
    expect(school?.time).toBe("2026-10-20T11:50:00.000Z");
    expect(result.from).toBe("2026-10-19T23:30:00.000Z"); // Куляб: 04:30 местного
    expect(result.to).toBe("2026-10-20T11:50:00.000Z");
  });
  it("история: массив по всем станциям, дубликаты ключа и соответствие кодов", () => {
    const mapping: JsonFeedMapping = {
      ...wwcs,
      stations: { HIS003_ECO: "HISOR-01" },
      pollutants: { "PM2.5": { field: "PM25" } },
    };
    const payload = fixture("history.json") as unknown[];
    const result = parseStationJsonFeed([...payload, payload[0]], mapping, { now });
    expect(result.errors).toEqual([]);
    expect(result.total).toBe(9);
    expect(result.duplicates).toBe(1);
    expect(result.records).toHaveLength(8);
    expect(result.stations.sort()).toEqual(["HISOR-01", "VAH001_ECO"]);
    expect(result.records[0]).toMatchObject({ stationCode: "HISOR-01", pollutant: "PM25" });
    expect(result.records[0]?.unit).toBeUndefined();
  });
  it("вложенный массив, запись без кода станции, статус, null и пустые значения, будущее время", () => {
    const mapping: JsonFeedMapping = {
      format: "json",
      recordsPath: "data.items",
      stationField: "meta.id",
      time: { field: "ts", timezone: "UTC" },
      pollutants: { PM25: { field: "pm25", scale: 0.001, unit: "mg/m³" }, NO2: { field: "no2" } },
      statusField: "status",
      invalidStatuses: ["ERR"],
      missingValues: ["-999"],
    };
    const payload = {
      data: {
        items: [
          { meta: { id: "A" }, ts: "2026-10-20T10:00:00Z", pm25: 12000, no2: null, status: "OK" },
          { meta: { id: "A" }, ts: "2026-10-20T10:10:00Z", pm25: "-999", no2: "x", status: "OK" },
          { meta: { id: "" }, ts: "2026-10-20T10:20:00Z", pm25: 1 },
          { meta: { id: "B" }, ts: "2099-01-01T00:00:00Z", pm25: 1 },
          { meta: { id: "B" }, ts: "nope", pm25: 1 },
          { meta: { id: "B" }, ts: "2026-10-20T10:00:00Z", pm25: 5, status: "ERR" },
          "junk",
        ],
      },
    };
    const result = parseStationJsonFeed(payload, mapping, { now });
    expect(result.total).toBe(7);
    expect(result.records).toHaveLength(2);
    expect(result.records[0]).toMatchObject({
      stationCode: "A",
      pollutant: "PM25",
      value: 12,
      unit: "mg/m³",
    });
    expect(result.records[1]).toMatchObject({ stationCode: "B", flag: "invalid:ERR" });
    expect(result.empty).toBe(1); // вторая запись A: -999 и мусор
    expect(result.errors.map((e) => `${e.row}:${e.message}`)).toEqual([
      "2:value:NO2:x",
      "3:station:(пусто)",
      "4:futureTime",
      "5:time:nope",
      "7:record",
    ]);
  });
  it("без stationField записи относятся к станции источника; неверный путь к массиву — ошибка", () => {
    const mapping: JsonFeedMapping = {
      format: "json",
      time: { field: "t" },
      pollutants: { PM10: { field: "v" } },
    };
    const ok = parseStationJsonFeed([{ t: "2026-10-20 10:00", v: "12,5" }], mapping, { now });
    expect(ok.records).toEqual([
      {
        time: "2026-10-20T05:00:00.000Z",
        pollutant: "PM10",
        value: 12.5,
        stationCode: null,
        row: 1,
      },
    ]);
    const bad = parseStationJsonFeed({ items: [] }, mapping, { now });
    expect(bad.records).toEqual([]);
    expect(bad.errors[0]?.message).toContain("records:");
    const badMapping = parseStationJsonFeed([], { ...mapping, pollutants: {} }, { now });
    expect(badMapping.errors[0]?.message).toBe(
      "mapping:pollutants: нужно хотя бы одно поле вещества",
    );
  });
});

describe("planHistoryFetch", () => {
  const base = { intervalMin: 10, hours: 24, maxHours: 72, now };
  it("полная глубина при первом запуске/ручной проверке", () => {
    expect(planHistoryFetch({ ...base, full: true, cursors: [] })).toBe(24);
    expect(planHistoryFetch({ ...base, full: true, hours: 100, cursors: [] })).toBe(72);
  });
  it("без пропусков история не нужна", () => {
    const newest = new Date("2026-10-20T12:20:00Z");
    expect(
      planHistoryFetch({
        ...base,
        full: false,
        cursors: [{ station: "A", last: new Date("2026-10-20T12:10:00Z"), newest }],
      }),
    ).toBeNull();
    // станция «зависла»: свежая запись = курсор
    expect(
      planHistoryFetch({ ...base, full: false, cursors: [{ station: "A", last: newest, newest }] }),
    ).toBeNull();
  });
  it("пропуск больше двух интервалов — догрузка на глубину пропуска, не больше maxHours", () => {
    const newest = new Date("2026-10-20T12:20:00Z");
    expect(
      planHistoryFetch({
        ...base,
        full: false,
        cursors: [
          { station: "A", last: new Date("2026-10-20T12:10:00Z"), newest },
          { station: "B", last: new Date("2026-10-20T09:40:00Z"), newest },
        ],
      }),
    ).toBe(4);
    expect(
      planHistoryFetch({
        ...base,
        full: false,
        cursors: [{ station: "A", last: new Date("2026-10-10T00:00:00Z"), newest }],
      }),
    ).toBe(72);
    // станция без курсора (новая) — отсчёт от hours назад
    expect(
      planHistoryFetch({ ...base, full: false, cursors: [{ station: "A", last: null, newest }] }),
    ).toBe(25);
  });
});
