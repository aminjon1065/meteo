import { describe, expect, it } from "vitest";
import {
  type BreakpointRow,
  computeBreakpointIndex,
  computeIza,
  computeRatioIndex,
  levelForBands,
  subIndexForValue,
  windowMean,
} from "../aqi";

const pm25: BreakpointRow[] = [
  { pollutantId: 1, level: 1, lo: 0, hi: 10, averagingMin: 60 },
  { pollutantId: 1, level: 2, lo: 10, hi: 25, averagingMin: 60 },
  { pollutantId: 1, level: 3, lo: 25, hi: 50, averagingMin: 60 },
  { pollutantId: 1, level: 4, lo: 50, hi: 75, averagingMin: 60 },
  { pollutantId: 1, level: 5, lo: 75, hi: null, averagingMin: 60 },
];
const no2: BreakpointRow[] = [
  { pollutantId: 3, level: 1, lo: 0, hi: 40, averagingMin: 60 },
  { pollutantId: 3, level: 2, lo: 40, hi: 70, averagingMin: 60 },
  { pollutantId: 3, level: 3, lo: 70, hi: 150, averagingMin: 60 },
  { pollutantId: 3, level: 4, lo: 150, hi: 200, averagingMin: 60 },
  { pollutantId: 3, level: 5, lo: 200, hi: null, averagingMin: 60 },
];

describe("subIndexForValue", () => {
  it("границы полуоткрытые: 10 → уровень 2, 9.99 → уровень 1, 75 → уровень 5", () => {
    expect(subIndexForValue(9.99, pm25)?.level).toBe(1);
    expect(subIndexForValue(10, pm25)?.level).toBe(2);
    expect(subIndexForValue(74.9, pm25)?.level).toBe(4);
    expect(subIndexForValue(75, pm25)?.level).toBe(5);
    expect(subIndexForValue(0, pm25)?.level).toBe(1);
  });
  it("непрерывный индекс растёт внутри интервала и не выходит за уровень", () => {
    expect(subIndexForValue(17.5, pm25)?.index).toBe(2.5);
    expect(subIndexForValue(24.99, pm25)?.index).toBeLessThan(3);
    expect(subIndexForValue(1000, pm25)?.index).toBe(5.99);
  });
  it("отрицательные значения попадают в первый уровень", () => {
    expect(subIndexForValue(-1, pm25)?.level).toBe(1);
  });
});

describe("computeBreakpointIndex", () => {
  it("берёт худший под‑индекс и доминирующее вещество", () => {
    const r = computeBreakpointIndex(
      [
        { pollutantId: 1, value: 30 },
        { pollutantId: 3, value: 160 },
      ],
      [...pm25, ...no2],
    );
    expect(r.level).toBe(4);
    expect(r.dominantPollutantId).toBe(3);
    expect(r.subIndices["1"]?.level).toBe(3);
    expect(r.value).toBeCloseTo(4.2, 1);
  });
  it("без данных — уровень 0", () => {
    expect(computeBreakpointIndex([{ pollutantId: 1, value: null }], pm25).level).toBe(0);
    expect(computeBreakpointIndex([{ pollutantId: 99, value: 5 }], pm25).level).toBe(0);
  });
});

describe("computeRatioIndex", () => {
  const bands = [
    { level: 1, lo: 0, hi: 1 },
    { level: 2, lo: 1, hi: 2 },
    { level: 3, lo: 2, hi: 3 },
    { level: 4, lo: 3, hi: 5 },
    { level: 5, lo: 5, hi: null },
  ];
  it("кратность ПДК и уровень по интервалам", () => {
    const r = computeRatioIndex(
      [
        { pollutantId: 1, value: 70 },
        { pollutantId: 3, value: 20 },
      ],
      [
        { pollutantId: 1, limit: 35 },
        { pollutantId: 3, limit: 40 },
      ],
      bands,
    );
    expect(r.value).toBe(2);
    expect(r.level).toBe(3);
    expect(r.dominantPollutantId).toBe(1);
    expect(r.subIndices["3"]?.index).toBe(0.5);
  });
  it("levelForBands: за пределами последнего интервала — последний уровень", () => {
    expect(levelForBands(100, bands)).toBe(5);
    expect(levelForBands(0.2, bands)).toBe(1);
  });
});

describe("computeIza", () => {
  const bands = [
    { level: 1, lo: 0, hi: 5 },
    { level: 2, lo: 5, hi: 7 },
    { level: 4, lo: 7, hi: 14 },
    { level: 5, lo: 14, hi: null },
  ];
  const limits = [
    { pollutantId: 1, limit: 35, hazardClass: 3 },
    { pollutantId: 2, limit: 60, hazardClass: 3 },
    { pollutantId: 6, limit: 30, hazardClass: 1 },
  ];
  it("суммирует нормированные концентрации с показателем по классу опасности", () => {
    const r = computeIza(
      [
        { pollutantId: 1, value: 70 }, // 2^1.0 = 2
        { pollutantId: 2, value: 120 }, // 2^1.0 = 2
        { pollutantId: 6, value: 60 }, // 2^1.7 ≈ 3.25
      ],
      limits,
      bands,
    );
    expect(r.value).toBeCloseTo(7.25, 1);
    expect(r.level).toBe(4);
    expect(r.dominantPollutantId).toBe(6);
    expect(r.pollutantsUsed).toBe(3);
  });
  it("ИЗА5 учитывает только пять наибольших вкладов", () => {
    const many = Array.from({ length: 7 }, (_, i) => ({
      pollutantId: 100 + i,
      value: 10 * (i + 1),
    }));
    const manyLimits = many.map((m) => ({ pollutantId: m.pollutantId, limit: 10, hazardClass: 3 }));
    const r = computeIza(many, manyLimits, bands);
    expect(r.pollutantsUsed).toBe(5);
    expect(r.value).toBe(7 + 6 + 5 + 4 + 3);
  });
});

describe("windowMean", () => {
  const end = new Date("2026-10-16T12:00:00Z");
  const hourly = Array.from({ length: 24 }, (_, i) => ({
    time: new Date(end.getTime() - i * 3_600_000),
    value: i < 12 ? 20 : 40,
  }));
  it("считает скользящее среднее по окну", () => {
    expect(windowMean(hourly, end, 60)).toBe(20);
    expect(windowMean(hourly, end, 24 * 60)).toBe(30);
  });
  it("возвращает null при недостаточной полноте", () => {
    expect(windowMean(hourly.slice(0, 2), end, 24 * 60, 0.25)).toBeNull();
    expect(windowMean([], end, 60)).toBeNull();
  });
});
