/**
 * Контрольные примеры индекса для приёмки M1 (docs/aqi-test-cases.md): пороги шкал — значения
 * seed (packages/db/src/seed.ts, разделы 2–3, ПДК — бюллетень Агентства 19.10.2026). Тест
 * проверяет и движок, и то, что каждая строка таблицы в документе совпадает с примером здесь.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type BreakpointRow,
  computeAgencyIndicators,
  computeBreakpointIndex,
  computeIza,
  computeRatioIndex,
} from "../aqi";

const ID = { PM25: 1, PM10: 2, NO2: 3, SO2: 4, CO: 5, O3: 6 } as const;
type Code = keyof typeof ID;

function rows(code: Code, lows: number[], averagingMin: number): BreakpointRow[] {
  return lows.map((lo, i) => ({
    pollutantId: ID[code],
    level: i + 1,
    lo,
    hi: i < lows.length - 1 ? (lows[i + 1] as number) : null,
    averagingMin,
  }));
}

const SCALES: Record<"NATIONAL_OPERATIONAL" | "WHO_24H" | "US_AQI", BreakpointRow[]> = {
  NATIONAL_OPERATIONAL: [
    ...rows("PM25", [0, 10, 25, 50, 75], 60),
    ...rows("PM10", [0, 20, 50, 100, 200], 60),
    ...rows("NO2", [0, 40, 70, 150, 200], 60),
    ...rows("SO2", [0, 20, 80, 250, 350], 60),
    ...rows("O3", [0, 60, 100, 140, 180], 60),
    ...rows("CO", [0, 4, 8, 20, 30], 480),
  ],
  WHO_24H: [
    ...rows("PM25", [0, 15, 25, 37.5, 75], 1440),
    ...rows("PM10", [0, 45, 75, 100, 150], 1440),
    ...rows("NO2", [0, 25, 50, 120, 200], 1440),
    ...rows("SO2", [0, 40, 125, 250, 350], 1440),
    ...rows("O3", [0, 100, 120, 160, 240], 480),
    ...rows("CO", [0, 4, 7, 10, 20], 1440),
  ],
  US_AQI: [
    ...rows("PM25", [0, 9.1, 35.5, 55.5, 125.5, 225.5], 1440),
    ...rows("PM10", [0, 55, 155, 255, 355, 425], 1440),
    ...rows("O3", [0, 108, 139, 169, 208, 393], 480),
    ...rows("NO2", [0, 102, 190, 679, 1223, 2352], 60),
    ...rows("SO2", [0, 94, 199, 487, 799, 1585], 60),
    ...rows("CO", [0, 5.2, 10.9, 14.3, 17.8, 34.9], 480),
  ],
};

/** ПДК Агентства, µg/m³ (CO — mg/m³): среднесуточная и максимальная разовая; класс опасности. */
const LIMITS: Record<Code, { daily: number; maxSingle: number; hazardClass: number }> = {
  PM25: { daily: 35, maxSingle: 160, hazardClass: 3 },
  PM10: { daily: 60, maxSingle: 300, hazardClass: 3 },
  NO2: { daily: 40, maxSingle: 85, hazardClass: 3 },
  SO2: { daily: 50, maxSingle: 500, hazardClass: 3 },
  CO: { daily: 3, maxSingle: 5, hazardClass: 4 },
  O3: { daily: 30, maxSingle: 160, hazardClass: 1 },
};
const RATIO_BANDS = [
  { level: 1, lo: 0, hi: 1 },
  { level: 2, lo: 1, hi: 2 },
  { level: 3, lo: 2, hi: 3 },
  { level: 4, lo: 3, hi: 5 },
  { level: 5, lo: 5, hi: null },
];
const IZA_BANDS = [
  { level: 1, lo: 0, hi: 5 },
  { level: 2, lo: 5, hi: 7 },
  { level: 4, lo: 7, hi: 14 },
  { level: 5, lo: 14, hi: null },
];

const LABEL: Record<Code, string> = {
  PM25: "PM2.5",
  PM10: "PM10",
  NO2: "NO₂",
  SO2: "SO₂",
  CO: "CO",
  O3: "O₃",
};

/** Пример: id, шкала, значения веществ, ожидаемый уровень (и доминирующее вещество). */
interface Case {
  id: string;
  scale: keyof typeof SCALES;
  values: Partial<Record<Code, number>>;
  level: number;
  dominant?: Code;
}

const B = (id: string, scale: Case["scale"], code: Code, value: number, level: number): Case => ({
  id,
  scale,
  values: { [code]: value },
  level,
});

const BREAKPOINT_CASES: Case[] = [
  // Оперативный пятиуровневый индекс (публичная шкала по умолчанию), часовые средние; CO — 8 ч.
  B("N1", "NATIONAL_OPERATIONAL", "PM25", 9.9, 1),
  B("N2", "NATIONAL_OPERATIONAL", "PM25", 10, 2),
  B("N3", "NATIONAL_OPERATIONAL", "PM25", 25, 3),
  B("N4", "NATIONAL_OPERATIONAL", "PM25", 50, 4),
  B("N5", "NATIONAL_OPERATIONAL", "PM25", 74.9, 4),
  B("N6", "NATIONAL_OPERATIONAL", "PM25", 75, 5),
  B("N7", "NATIONAL_OPERATIONAL", "PM10", 19.9, 1),
  B("N8", "NATIONAL_OPERATIONAL", "PM10", 20, 2),
  B("N9", "NATIONAL_OPERATIONAL", "PM10", 100, 4),
  B("N10", "NATIONAL_OPERATIONAL", "PM10", 200, 5),
  B("N11", "NATIONAL_OPERATIONAL", "NO2", 39.9, 1),
  B("N12", "NATIONAL_OPERATIONAL", "NO2", 70, 3),
  B("N13", "NATIONAL_OPERATIONAL", "NO2", 200, 5),
  B("N14", "NATIONAL_OPERATIONAL", "SO2", 80, 3),
  B("N15", "NATIONAL_OPERATIONAL", "SO2", 350, 5),
  B("N16", "NATIONAL_OPERATIONAL", "O3", 140, 4),
  B("N17", "NATIONAL_OPERATIONAL", "CO", 3.9, 1),
  B("N18", "NATIONAL_OPERATIONAL", "CO", 20, 4),
  {
    id: "N19",
    scale: "NATIONAL_OPERATIONAL",
    values: { PM25: 30, NO2: 160 },
    level: 4,
    dominant: "NO2",
  },
  // ВОЗ (суточные средние, рекомендации WHO 2021).
  B("W1", "WHO_24H", "PM25", 14.9, 1),
  B("W2", "WHO_24H", "PM25", 15, 2),
  B("W3", "WHO_24H", "PM25", 37.5, 4),
  B("W4", "WHO_24H", "PM10", 45, 2),
  B("W5", "WHO_24H", "NO2", 120, 4),
  // US AQI (EPA 2024), шесть категорий.
  B("U1", "US_AQI", "PM25", 9, 1),
  B("U2", "US_AQI", "PM25", 9.1, 2),
  B("U3", "US_AQI", "PM25", 35.5, 3),
  B("U4", "US_AQI", "PM25", 55.5, 4),
  B("U5", "US_AQI", "PM25", 125.5, 5),
  B("U6", "US_AQI", "PM25", 225.5, 6),
  B("U7", "US_AQI", "PM10", 155, 3),
];

const fmt = (n: number) => String(n).replace(".", ",");
const valuesText = (values: Partial<Record<Code, number>>) =>
  Object.entries(values)
    .map(([code, v]) => `${LABEL[code as Code]} ${fmt(v as number)}`)
    .join(" + ");

/** Строки таблицы документа: «| N1 | PM2.5 9,9 | 1 |». */
function caseRow(c: Case): string {
  const dominant = c.dominant ? ` (${LABEL[c.dominant]})` : "";
  return `| ${c.id} | ${valuesText(c.values)} | ${c.level}${dominant} |`;
}

const DOC = readFileSync(
  resolve(import.meta.dirname, "../../../../docs/aqi-test-cases.md"),
  "utf8",
);

describe("контрольные примеры индекса по шкалам seed (приёмка M1)", () => {
  for (const c of BREAKPOINT_CASES) {
    it(`${c.id}: ${c.scale} ${valuesText(c.values)} → уровень ${c.level}`, () => {
      const r = computeBreakpointIndex(
        Object.entries(c.values).map(([code, value]) => ({
          pollutantId: ID[code as Code],
          value: value as number,
        })),
        SCALES[c.scale],
      );
      expect(r.level).toBe(c.level);
      if (c.dominant) expect(r.dominantPollutantId).toBe(ID[c.dominant]);
      expect(DOC, `строка ${c.id} в docs/aqi-test-cases.md`).toContain(caseRow(c));
    });
  }

  it("R1–R2: кратность ПДКс.с. и уровень шкалы «Кратность ПДК»", () => {
    const limits = (Object.keys(ID) as Code[]).map((c) => ({
      pollutantId: ID[c],
      limit: LIMITS[c].daily,
    }));
    const r1 = computeRatioIndex([{ pollutantId: ID.PM25, value: 70 }], limits, RATIO_BANDS);
    expect(r1.value).toBe(2);
    expect(r1.level).toBe(3);
    const r2 = computeRatioIndex([{ pollutantId: ID.NO2, value: 55 }], limits, RATIO_BANDS);
    expect(r2.value).toBe(1.38);
    expect(r2.level).toBe(2);
    expect(DOC).toContain("| R1 | PM2.5 70 (ПДКс.с. 35) | 2,00 | 3 |");
    expect(DOC).toContain("| R2 | NO₂ 55 (ПДКс.с. 40) | 1,38 | 2 |");
  });

  it("A1–A3: бюллетень 19.10.2026 — суммация NO₂+SO₂, ВЗ и ЭВЗ", () => {
    const dailyLimits = (Object.keys(ID) as Code[]).map((c) => ({
      pollutantId: ID[c],
      limit: LIMITS[c].daily,
    }));
    const maxSingleLimits = (Object.keys(ID) as Code[]).map((c) => ({
      pollutantId: ID[c],
      limit: LIMITS[c].maxSingle,
    }));
    const a1 = computeAgencyIndicators({
      dailyMeans: [
        { pollutantId: ID.NO2, value: 55 },
        { pollutantId: ID.SO2, value: 6 },
      ],
      maxSingle: [{ pollutantId: ID.NO2, value: 101 }],
      dailyLimits,
      maxSingleLimits,
      no2Id: ID.NO2,
      so2Id: ID.SO2,
    });
    expect(a1.no2so2Sum).toBe(1.5);
    expect(a1.maxSingle[String(ID.NO2)]?.ratio).toBe(1.19);
    expect(a1.highPollution).toBe(false);
    const a2 = computeAgencyIndicators({
      dailyMeans: [],
      maxSingle: [{ pollutantId: ID.PM10, value: 3000 }],
      dailyLimits,
      maxSingleLimits,
    });
    expect(a2.highPollution).toBe(true);
    expect(a2.extremeHighPollution).toBe(false);
    const a3 = computeAgencyIndicators({
      dailyMeans: [],
      maxSingle: [{ pollutantId: ID.SO2, value: 25_000 }],
      dailyLimits,
      maxSingleLimits,
    });
    expect(a3.extremeHighPollution).toBe(true);
    expect(DOC).toContain(
      "| A1 | NO₂ 55 + SO₂ 6 (сут.), NO₂ 101 (макс. раз.) | 1,38 + 0,12 = 1,50; NO₂ 1,19 ПДКм.р. | нет ВЗ |",
    );
    expect(DOC).toContain("| A2 | PM10 3000 (макс. раз., ПДКм.р. 300) | 10 ПДКм.р. | ВЗ |");
    expect(DOC).toContain("| A3 | SO₂ 25000 (макс. раз., ПДКм.р. 500) | 50 ПДКм.р. | ЭВЗ |");
  });

  it("I1: ИЗА по среднемесячным — сумма (C/ПДКс.с.)^k по классу опасности", () => {
    const limits = (["PM25", "PM10", "O3"] as Code[]).map((c) => ({
      pollutantId: ID[c],
      limit: LIMITS[c].daily,
      hazardClass: LIMITS[c].hazardClass,
    }));
    const r = computeIza(
      [
        { pollutantId: ID.PM25, value: 70 },
        { pollutantId: ID.PM10, value: 120 },
        { pollutantId: ID.O3, value: 60 },
      ],
      limits,
      IZA_BANDS,
    );
    expect(r.value).toBeCloseTo(7.25, 2);
    expect(r.level).toBe(4);
    expect(r.dominantPollutantId).toBe(ID.O3);
    expect(DOC).toContain("| I1 | PM2.5 70 + PM10 120 + O₃ 60 | 2 + 2 + 3,25 = 7,25 | 4 (O₃) |");
  });
});
