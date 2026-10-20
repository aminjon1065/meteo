import { describe, expect, it } from "vitest";
import { detectOutliers, detectSpikes, detectStuck, mad, median } from "../qc";

const at = (h: number) => new Date(Date.UTC(2026, 9, 16, h));

describe("median / mad", () => {
  it("считает медиану и MAD", () => {
    expect(median([1, 3, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(mad([1, 2, 3, 4, 100])).toBe(1);
  });
});

describe("detectSpikes", () => {
  it("находит одиночный скачок", () => {
    const samples = [20, 22, 21, 23, 20, 180, 22, 21].map((v, i) => ({ time: at(i), value: v }));
    expect(detectSpikes(samples, { madMultiplier: 6 })).toEqual([5]);
  });
  it("не срабатывает на коротком ряду и на плавных изменениях", () => {
    expect(detectSpikes([20, 200].map((v, i) => ({ time: at(i), value: v })))).toEqual([]);
    const smooth = [20, 25, 30, 35, 40, 45, 50, 55].map((v, i) => ({ time: at(i), value: v }));
    expect(detectSpikes(smooth)).toEqual([]);
  });
});

describe("detectStuck", () => {
  it("помечает серию одинаковых значений длиннее 12 часов", () => {
    const samples = [...Array(14).fill(42), 50, 51].map((v, i) => ({ time: at(i), value: v }));
    expect(detectStuck(samples, { hours: 12 })).toEqual(Array.from({ length: 14 }, (_, i) => i));
  });
  it("игнорирует короткие серии", () => {
    const samples = [42, 42, 42, 50].map((v, i) => ({ time: at(i), value: v }));
    expect(detectStuck(samples, { hours: 12 })).toEqual([]);
  });
});

describe("detectOutliers", () => {
  it("использует базу станции и требует достаточной выборки", () => {
    const samples = [30, 400].map((v, i) => ({ time: at(i), value: v }));
    expect(detectOutliers(samples, { median: 30, mad: 5, n: 100 }, { z: 5 })).toEqual([1]);
    expect(detectOutliers(samples, { median: 30, mad: 5, n: 10 })).toEqual([]);
    expect(detectOutliers(samples, { median: 30, mad: 0, n: 100 })).toEqual([]);
  });
});

describe("правила QC на 10‑минутных рядах датчиков (сеть wwcs.tj)", () => {
  const every10min = (values: number[]) =>
    values.map((v, i) => ({ time: new Date(Date.UTC(2026, 9, 20, 0, 10 * i)), value: v }));
  it("«залипание»: одно значение 12 часов подряд (73 точки по 10 мин) помечается целиком", () => {
    const stuck = every10min([...Array(73).fill(561.6), 12.3, 11.8]);
    expect(detectStuck(stuck, { hours: 12, minRun: 3 })).toEqual(
      Array.from({ length: 73 }, (_, i) => i),
    );
    // 2 часа одинаковых значений — короче порога, не помечается
    expect(detectStuck(every10min([...Array(13).fill(7.2), 7.3]), { hours: 12 })).toEqual([]);
  });
  it("скачок на фоне ровного 10‑минутного ряда помечается, ровный ряд — нет", () => {
    const base = Array.from({ length: 48 }, (_, i) => 8 + Math.sin(i / 5) * 2);
    const withSpike = [...base];
    withSpike[20] = 561.6;
    expect(detectSpikes(every10min(withSpike), { madMultiplier: 6 })).toEqual([20]);
    expect(detectSpikes(every10min(base), { madMultiplier: 6 })).toEqual([]);
  });
});
