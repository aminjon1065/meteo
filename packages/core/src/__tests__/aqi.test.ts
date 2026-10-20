import { describe, expect, it } from "vitest";
import {
  type BreakpointRow,
  computeAgencyIndicators,
  computeBreakpointIndex,
  computeIza,
  computeRatioIndex,
  levelForBands,
  ratioToLimit,
  subIndexForValue,
  windowMax,
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

describe("windowMax", () => {
  const hour = 3_600_000;
  const end = new Date("2026-10-19T19:00:00Z");
  const points = [0, 1, 2, 23, 24, 25].map((h) => ({
    time: new Date(end.getTime() - h * hour),
    value: h === 2 ? 178 : 40 + h,
  }));
  it("берёт максимум за сутки (окно (t − 24 ч, t]) и игнорирует более старые точки", () => {
    expect(windowMax(points, end, 1440)).toBe(178);
    expect(
      windowMax(
        points.filter((p) => p.value !== 178),
        end,
        1440,
      ),
    ).toBe(63);
  });
  it("без точек в окне — null", () => {
    expect(windowMax([], end, 1440)).toBeNull();
    expect(windowMax(points, new Date(end.getTime() + 48 * hour), 1440)).toBeNull();
  });
});

describe("ratioToLimit", () => {
  it("делит на норматив и округляет до сотых; без норматива — null", () => {
    expect(ratioToLimit(55, 40)).toBe(1.38);
    expect(ratioToLimit(0.65, 3)).toBe(0.22);
    expect(ratioToLimit(10, undefined)).toBeNull();
    expect(ratioToLimit(10, 0)).toBeNull();
    expect(ratioToLimit(null, 40)).toBeNull();
  });
});

describe("computeAgencyIndicators (бюллетень Душанбе 19.10.2026, µg/m³)", () => {
  // id: NO2 = 3, SO2 = 4, O3 = 6, PM10 = 2
  const dailyLimits = [
    { pollutantId: 3, limit: 40 },
    { pollutantId: 4, limit: 50 },
    { pollutantId: 6, limit: 30 },
    { pollutantId: 2, limit: 60 },
  ];
  const maxSingleLimits = [
    { pollutantId: 3, limit: 85 },
    { pollutantId: 4, limit: 500 },
    { pollutantId: 6, limit: 160 },
    { pollutantId: 2, limit: 300 },
  ];
  it("суммация NO₂+SO₂ — сумма кратностей ПДКс.с. (1,37 + 0,12 = 1,49 ≈ бюллетень без округления 0,66 для своих данных)", () => {
    const r = computeAgencyIndicators({
      dailyMeans: [
        { pollutantId: 3, value: 55 },
        { pollutantId: 4, value: 6 },
        { pollutantId: 6, value: 38 },
      ],
      maxSingle: [
        { pollutantId: 3, value: 101 },
        { pollutantId: 4, value: 19 },
        { pollutantId: 6, value: 93 },
      ],
      dailyLimits,
      maxSingleLimits,
      no2Id: 3,
      so2Id: 4,
    });
    expect(r.no2so2Sum).toBe(1.5); // 1.38 + 0.12
    expect(r.maxSingle["3"]).toEqual({ value: 101, ratio: 1.19 });
    expect(r.maxSingle["4"]).toEqual({ value: 19, ratio: 0.04 });
    expect(r.maxSingle["6"]?.ratio).toBe(0.58);
    expect(r.highPollution).toBe(false);
    expect(r.extremeHighPollution).toBe(false);
    expect(r.flagged).toEqual({});
  });
  it("без одного из веществ суммация не считается", () => {
    const r = computeAgencyIndicators({
      dailyMeans: [{ pollutantId: 3, value: 55 }],
      maxSingle: [],
      dailyLimits,
      maxSingleLimits,
      no2Id: 3,
      so2Id: 4,
    });
    expect(r.no2so2Sum).toBeNull();
    expect(
      computeAgencyIndicators({
        dailyMeans: [
          { pollutantId: 3, value: 55 },
          { pollutantId: 4, value: 6 },
        ],
        maxSingle: [],
        dailyLimits,
        maxSingleLimits,
      }).no2so2Sum,
    ).toBeNull();
  });
  it("ВЗ при ≥ 10 ПДКм.р., ЭВЗ при ≥ 50; вещество без ПДКм.р. не флагуется", () => {
    const vz = computeAgencyIndicators({
      dailyMeans: [],
      maxSingle: [
        { pollutantId: 2, value: 3000 },
        { pollutantId: 3, value: 849 },
        { pollutantId: 99, value: 1e6 },
      ],
      dailyLimits,
      maxSingleLimits,
    });
    expect(vz.highPollution).toBe(true);
    expect(vz.extremeHighPollution).toBe(false);
    expect(vz.flagged).toEqual({ "2": 10 });
    expect(vz.maxSingle["99"]).toEqual({ value: 1e6, ratio: null });
    const evz = computeAgencyIndicators({
      dailyMeans: [],
      maxSingle: [{ pollutantId: 4, value: 25_000 }],
      dailyLimits,
      maxSingleLimits,
    });
    expect(evz.highPollution).toBe(true);
    expect(evz.extremeHighPollution).toBe(true);
    expect(evz.flagged).toEqual({ "4": 50 });
  });
});

describe("шестиуровневая шкала (US AQI)", () => {
  it("уровень 6 не обрезается до 5, под‑индекс и индекс станции считаются по шести интервалам", () => {
    const rows: BreakpointRow[] = [
      [1, 0, 9.1],
      [2, 9.1, 35.5],
      [3, 35.5, 55.5],
      [4, 55.5, 125.5],
      [5, 125.5, 225.5],
      [6, 225.5, null],
    ].map(([level, lo, hi]) => ({
      pollutantId: 1,
      level: level as number,
      lo: lo as number,
      hi: hi as number | null,
      averagingMin: 1440,
    }));
    expect(subIndexForValue(5, rows)?.level).toBe(1);
    expect(subIndexForValue(35.5, rows)?.level).toBe(3);
    expect(subIndexForValue(561.6, rows)?.level).toBe(6);
    expect(subIndexForValue(561.6, rows)?.index).toBeCloseTo(6.99, 2);
    const result = computeBreakpointIndex([{ pollutantId: 1, value: 300 }], rows);
    expect(result.level).toBe(6);
    expect(result.dominantPollutantId).toBe(1);
  });
});
