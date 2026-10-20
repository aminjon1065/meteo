import { describe, expect, it } from "vitest";
import { applyRangeRule, QC_FLAG } from "../qc";
import { slugify, transliterate } from "../slug";
import { dushanbeLocalToUtc, parseMeasurementTime, utcToDushanbeLocal } from "../time";
import {
  convertConcentration,
  displayScaleFor,
  displayUnitFor,
  isConcentrationDisplayMode,
  normalizeUnit,
  roundTo,
  toDisplayValue,
} from "../units";

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

describe("units: единицы отображения (настройка портала)", () => {
  it("режим native не меняет единицу и точность", () => {
    expect(displayUnitFor("µg/m³", "native")).toBe("µg/m³");
    expect(displayUnitFor("mg/m³", "native")).toBe("mg/m³");
    expect(displayScaleFor("µg/m³", 1, "native")).toEqual({
      unit: "µg/m³",
      decimals: 1,
      factor: 1,
    });
    expect(toDisplayValue(42.55, displayScaleFor("µg/m³", 1, "native"))).toBe(42.6);
  });
  it("режим mg/m³ переводит µg/m³ в мг/м³ с тремя дополнительными знаками, как в бюллетенях", () => {
    const scale = displayScaleFor("µg/m³", 1, "mg/m³");
    expect(scale).toEqual({ unit: "mg/m³", decimals: 4, factor: 0.001 });
    expect(toDisplayValue(55, scale)).toBe(0.055);
    expect(toDisplayValue(35, scale)).toBe(0.035);
    expect(toDisplayValue(1.6, displayScaleFor("µg/m³", 2, "mg/m³"))).toBe(0.0016);
  });
  it("CO (mg/m³), ppm и ppb режим не затрагивает", () => {
    expect(displayScaleFor("mg/m³", 2, "mg/m³")).toEqual({ unit: "mg/m³", decimals: 2, factor: 1 });
    expect(displayScaleFor("ppm", 0, "mg/m³")).toEqual({ unit: "ppm", decimals: 0, factor: 1 });
    expect(displayScaleFor("ppb", 1, "mg/m³")).toEqual({ unit: "ppb", decimals: 1, factor: 1 });
  });
  it("null и NaN остаются пустыми; режим валидируется", () => {
    const scale = displayScaleFor("µg/m³", 1, "mg/m³");
    expect(toDisplayValue(null, scale)).toBeNull();
    expect(toDisplayValue(Number.NaN, scale)).toBeNull();
    expect(isConcentrationDisplayMode("mg/m³")).toBe(true);
    expect(isConcentrationDisplayMode("native")).toBe(true);
    expect(isConcentrationDisplayMode("ppm")).toBe(false);
  });
});
