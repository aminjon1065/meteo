/**
 * FR1.5: правило порога → событие превышения → письмо в email_outbox, повторный прогон без дублей,
 * закрытие при возврате ниже порога, cooldown и закрытие, когда данные перестали приходить.
 *
 * Тест работает с настоящим PostgreSQL (TimescaleDB): всё выполняется в транзакции, которая в конце
 * откатывается, поэтому база не меняется. Адрес — ALERTS_TEST_DATABASE_URL или DATABASE_URL из
 * корневого .env; если база недоступна (CI без PostgreSQL в этом шаге), тест пропускается.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createDb, type Database, evaluateAlertRules } from "@meteo/db";
import * as s from "@meteo/db/schema";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

function databaseUrl(): string | null {
  if (process.env.ALERTS_TEST_DATABASE_URL) return process.env.ALERTS_TEST_DATABASE_URL;
  const file = resolve(import.meta.dirname, "../../../../.env");
  if (!existsSync(file)) return null;
  const line = readFileSync(file, "utf8")
    .split("\n")
    .find((l) => l.startsWith("DATABASE_URL="));
  return line
    ? line
        .slice("DATABASE_URL=".length)
        .trim()
        .replace(/^["']|["']$/g, "")
    : null;
}

const url = databaseUrl();
const db = url ? createDb(url, { max: 1 }) : null;
const available = db
  ? await db.$client`select 1 from alert_rules limit 1`.then(
      () => true,
      () => false,
    )
  : false;

afterAll(async () => {
  await db?.$client.end({ timeout: 1 });
});

class Rollback extends Error {}
const HOUR = 3_600_000;

describe.skipIf(!available)("evaluateAlertRules на базе (транзакция с откатом)", () => {
  it("событие, письмо без дублей, закрытие, cooldown, закрытие без данных", async () => {
    const database = db as Database;
    // Фиксированное «сейчас» далеко от реальных данных базы — чужие измерения в окно не попадают.
    const t0 = new Date("2031-03-10T09:10:00Z");
    const hour = (h: number) => new Date(Date.UTC(2031, 2, 10, h, 0, 0));
    await database
      .transaction(async (tx) => {
        const q = tx as unknown as Database;
        const [pm10] = await q.select().from(s.pollutants).where(eq(s.pollutants.code, "PM10"));
        expect(pm10).toBeTruthy();
        const [station] = await q
          .insert(s.stations)
          .values({
            code: "TEST-ALERTS-01",
            slug: "test-alerts-01",
            name: { ru: "Тест уведомлений", tg: "Санҷиш", en: "Alerts test" },
            geom: { x: 68.78, y: 38.56 },
            status: "active",
            isPublic: true,
            sampling: "continuous",
          })
          .returning();
        const [rule] = await q
          .insert(s.alertRules)
          .values({
            name: "TEST PM10 > 100",
            scope: "station",
            stationId: station?.id,
            kind: "pollutant",
            pollutantId: pm10?.id,
            threshold: 100,
            averagingMin: 60,
            cooldownMin: 120,
            channels: ["portal", "email"],
            enabled: true,
          })
          .returning();
        const [sub] = await q
          .insert(s.subscribers)
          .values({
            email: "alerts-test@example.org",
            locale: "ru",
            status: "confirmed",
            confirmToken: `t-confirm-${Date.now()}`,
            unsubscribeToken: `t-unsub-${Date.now()}`,
            topics: { stations: [station?.id as number] },
            confirmedAt: t0,
          })
          .returning();
        const measure = (h: number, value: number) =>
          q.insert(s.measurements).values({
            time: hour(h),
            stationId: station?.id as number,
            pollutantId: pm10?.id as number,
            averagingMin: 60,
            value,
            qcFlag: 1,
            source: 4,
          });
        const events = () =>
          q
            .select()
            .from(s.alertEvents)
            .where(eq(s.alertEvents.ruleId, rule?.id as number));
        // Письма именно по событиям тестового правила (в базе могут быть и общие правила).
        const mails = async () => {
          const ids = new Set((await events()).map((e) => `alert:${e.id}:${sub?.id}`));
          const rows = await q
            .select()
            .from(s.emailOutbox)
            .where(
              and(eq(s.emailOutbox.to, sub?.email as string), eq(s.emailOutbox.template, "alert")),
            );
          return rows.filter((r) => r.dedupKey !== null && ids.has(r.dedupKey));
        };
        const run = (now: Date) => evaluateAlertRules(q, { now, publicUrl: "https://example.org" });

        // 1. Превышение: открывается событие, подписчику — письмо.
        await measure(7, 90);
        await measure(8, 130);
        await run(t0);
        let ev = await events();
        expect(ev).toHaveLength(1);
        expect(ev[0]?.status).toBe("active");
        expect(ev[0]?.lastValue).toBe(130);
        let m = await mails();
        expect(m).toHaveLength(1);
        expect(m[0]?.dedupKey).toBe(`alert:${ev[0]?.id}:${sub?.id}`);
        expect((m[0]?.payload as { threshold: number }).threshold).toBe(100);

        // 2. Повторный прогон в том же часе — без нового события и без второго письма.
        await run(new Date(t0.getTime() + 5 * 60_000));
        expect(await events()).toHaveLength(1);
        expect(await mails()).toHaveLength(1);

        // 3. Значение ниже порога — событие закрывается.
        await measure(9, 60);
        await run(new Date(t0.getTime() + HOUR));
        ev = await events();
        expect(ev[0]?.status).toBe("resolved");
        expect(ev[0]?.lastValue).toBe(60);

        // 4. Снова выше порога через час — cooldown 120 мин: новое событие не открывается.
        await measure(10, 150);
        await run(new Date(t0.getTime() + 2 * HOUR));
        expect(await events()).toHaveLength(1);

        // 5. После cooldown — новое событие и новое письмо.
        await measure(11, 160);
        await measure(12, 170);
        await run(new Date(t0.getTime() + 4 * HOUR));
        ev = await events();
        expect(ev).toHaveLength(2);
        expect(ev.filter((e) => e.status === "active")).toHaveLength(1);
        m = await mails();
        expect(m).toHaveLength(2);

        // 6. Данные перестали приходить (> 6 ч) — событие закрывается, последнее значение сохраняется.
        await run(new Date(t0.getTime() + 12 * HOUR));
        ev = await events();
        expect(ev.every((e) => e.status === "resolved")).toBe(true);
        expect(ev.find((e) => e.peakValue === 170)?.lastValue).toBe(170);

        throw new Rollback();
      })
      .catch((error: unknown) => {
        if (!(error instanceof Rollback)) throw error;
      });
  });
});
