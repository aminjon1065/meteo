/**
 * Индекс станции в базе: строка индекса за час появляется только при измерениях в этом часе.
 * Нужна база с миграциями и сидом (пороги оперативной шкалы):
 * TEST_DATABASE_URL=postgres://meteo:meteo@localhost:5432/meteo pnpm --filter @meteo/db test
 * Без TEST_DATABASE_URL тесты пропускаются; свои строки тест удаляет за собой.
 */
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createDb } from "../client";
import * as s from "../schema";
import { computeStationIndexes } from "../services/station-index";

const url = process.env.TEST_DATABASE_URL;
const H = 3_600_000;
const run = `t${Date.now().toString(36)}`;

describe.skipIf(!url)("computeStationIndexes", () => {
  const db = url ? createDb(url) : (null as never);
  let stationId = 0;

  afterAll(async () => {
    if (!url || !stationId) return;
    await db.delete(s.stationIndex).where(eq(s.stationIndex.stationId, stationId));
    await db.delete(s.measurements).where(eq(s.measurements.stationId, stationId));
    await db.delete(s.stations).where(eq(s.stations.id, stationId));
  });

  it("не создаёт строку за час без измерений (только CO из 8-часового окна)", async () => {
    const [station] = await db
      .insert(s.stations)
      .values({
        code: `IDX-${run}`.slice(0, 32),
        slug: `idx-${run}`,
        name: { tg: run, ru: run, en: run },
        geom: { x: 68.78, y: 38.56 },
      })
      .returning({ id: s.stations.id });
    if (!station) throw new Error("станция не создана");
    stationId = station.id;
    const pollutants = await db
      .select({ id: s.pollutants.id, code: s.pollutants.code })
      .from(s.pollutants)
      .where(inArray(s.pollutants.code, ["PM25", "CO"]));
    const id = Object.fromEntries(pollutants.map((p) => [p.code, p.id]));
    const pm25 = id.PM25;
    const co = id.CO;
    if (pm25 === undefined || co === undefined) throw new Error("нет PM25/CO в справочнике");

    // Три часа данных (PM2.5 и CO), последний - 3 часа назад; затем пересчёт «до последнего + 1 ч»,
    // как после ручного ввода или импорта.
    const last = new Date(Math.floor(Date.now() / H) * H - 3 * H);
    const rows = [0, 1, 2].flatMap((k) => {
      const time = new Date(last.getTime() - k * H + 30 * 60_000);
      return [
        { time, stationId, pollutantId: pm25, value: 30, qcFlag: 1 },
        { time, stationId, pollutantId: co, value: 1, qcFlag: 1 },
      ];
    });
    await db.insert(s.measurements).values(rows);
    await computeStationIndexes(db, {
      stationIds: [stationId],
      since: new Date(last.getTime() - 24 * H),
      until: new Date(last.getTime() + 30 * 60_000 + H),
    });

    const [scale] = await db
      .select({ id: s.indexScales.id })
      .from(s.indexScales)
      .where(eq(s.indexScales.code, "NATIONAL_OPERATIONAL"));
    if (!scale) throw new Error("нет шкалы NATIONAL_OPERATIONAL");
    const stored = await db
      .select({ time: s.stationIndex.time, subIndices: s.stationIndex.subIndices })
      .from(s.stationIndex)
      .where(and(eq(s.stationIndex.stationId, stationId), eq(s.stationIndex.scaleId, scale.id)));
    const times = stored.map((r) => r.time.getTime()).sort();
    expect(times).toEqual([last.getTime() - 2 * H, last.getTime() - H, last.getTime()]);
    const latest = stored.find((r) => r.time.getTime() === last.getTime());
    expect(Object.keys(latest?.subIndices ?? {})).toContain(String(pm25));
  });
});
