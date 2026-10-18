import { describe, expect, it } from "vitest";
import { applyRangeRule, QC_FLAG } from "../qc";
import { slugify, transliterate } from "../slug";
import { dushanbeLocalToUtc, parseMeasurementTime, utcToDushanbeLocal } from "../time";
import { convertConcentration, normalizeUnit, roundTo } from "../units";

describe("units", () => {
  it("конвертирует ppb → µg/m³ для NO2", () => {
    expect(roundTo(convertConcentration(10, "ppb", "µg/m³", 46.0055), 2)).toBe(18.82);
  });
  it("конвертирует mg/m³ ↔ µg/m³", () => {
    expect(convertConcentration(3, "mg/m³", "µg/m³")).toBe(3000);
    expect(convertConcentration(1500, "µg/m³", "mg/m³")).toBe(1.5);
  });
  it("требует молярную массу для ppb", () => {
    expect(() => convertConcentration(1, "ppb", "µg/m³", null)).toThrow();
  });
  it("нормализует написание единиц", () => {
    expect(normalizeUnit("ug/m3")).toBe("µg/m³");
    expect(normalizeUnit("мкг/м³")).toBe("µg/m³");
    expect(normalizeUnit("MG/M3")).toBe("mg/m³");
    expect(normalizeUnit("t/ha")).toBeNull();
  });
});

describe("slug", () => {
  it("транслитерирует таджикские буквы", () => {
    expect(transliterate("Хуҷанд")).toBe("khujand");
    expect(slugify("Кӯлоб")).toBe("kulob");
    expect(slugify("Шаҳри Душанбе, пост № 1")).toBe("shahri-dushanbe-post-no-1");
  });
});

describe("time", () => {
  it("переводит местное время Душанбе в UTC и обратно", () => {
    const utc = dushanbeLocalToUtc("2026-10-16", "07:00");
    expect(utc.toISOString()).toBe("2026-10-16T02:00:00.000Z");
    expect(utcToDushanbeLocal(utc)).toEqual({ date: "2026-10-16", time: "07:00" });
  });
  it("разбирает форматы времени", () => {
    expect(parseMeasurementTime("2026-10-16T02:00:00Z")?.toISOString()).toBe(
      "2026-10-16T02:00:00.000Z",
    );
    expect(parseMeasurementTime("2026-10-16 07:00")?.toISOString()).toBe(
      "2026-10-16T02:00:00.000Z",
    );
    expect(parseMeasurementTime("nonsense")).toBeNull();
  });
});

describe("qc", () => {
  it("помечает выход за диапазон", () => {
    expect(applyRangeRule(2500, { min: 0, max: 2000 }).flag).toBe(QC_FLAG.invalid);
    expect(applyRangeRule(15, { min: 0, max: 2000 }).flag).toBe(QC_FLAG.valid);
    expect(applyRangeRule(null, { min: 0, max: 2000 }).flag).toBe(QC_FLAG.missing);
  });
});
