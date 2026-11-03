import { and, eq } from "@meteo/db";
import { auditLog, measurements, pollutants, qcRules, stations } from "@meteo/db/schema";
import { expect, test } from "@playwright/test";
import { closeE2eDb, e2eDb } from "../helpers/db";
import { t } from "../helpers/messages";
import { E2E } from "../setup/fixtures";

test.afterAll(async () => {
  await closeE2eDb();
});

test("очередь QC: подозрительное значение подтверждается оператором и блокируется для автоконтроля", async ({
  page,
}) => {
  await page.goto("/ru/admin/measurements/qc");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(t("ru", "qc.title"));
  const row = page
    .getByRole("row")
    .filter({ hasText: E2E.station.code })
    .filter({ hasText: "PM2.5" });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("480");
  await row.getByRole("button", { name: t("ru", "qc.confirm") }).click();
  await expect(page.locator("[data-sonner-toast]").first()).toContainText(t("ru", "qc.done"));
  await expect(row).toHaveCount(0);
  await expect(page.getByText(t("ru", "qc.empty"))).toBeVisible();

  const db = e2eDb();
  const [station] = await db
    .select({ id: stations.id })
    .from(stations)
    .where(eq(stations.code, E2E.station.code));
  const locked = await db
    .select()
    .from(measurements)
    .where(and(eq(measurements.stationId, station?.id ?? -1), eq(measurements.qcLocked, true)));
  expect(locked).toHaveLength(1);
  expect(locked[0]?.qcFlag).toBe(1);
  expect(locked[0]?.qcReason).toMatch(/^confirmed:/);
  const audit = await db.select().from(auditLog).where(eq(auditLog.action, "measurement.confirm"));
  expect(audit.length).toBeGreaterThan(0);
});

test("правила QC: диапазон вещества и порог скачков меняются в админке с записью в аудит", async ({
  page,
}) => {
  const db = e2eDb();
  const [pm10] = await db.select().from(pollutants).where(eq(pollutants.code, "PM10"));
  const rangeOf = async () =>
    (
      await db
        .select({ params: qcRules.params })
        .from(qcRules)
        .where(and(eq(qcRules.kind, "range"), eq(qcRules.pollutantId, pm10?.id as number)))
    )[0]?.params ?? null;
  const before = await rangeOf();
  expect(before).not.toBeNull();

  await page.goto("/ru/admin/qc-rules");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(t("ru", "qcRules.title"));
  const max = page.getByLabel(`PM10 ${t("ru", "qcRules.ranges.max")}`);
  // Минимум больше максимума — ошибка проверки, ничего не сохраняется.
  await page.getByLabel(`PM10 ${t("ru", "qcRules.ranges.min")}`).fill("5000");
  await page.getByRole("button", { name: t("ru", "qcRules.save"), exact: true }).click();
  await expect(page.getByText(t("ru", "qcRules.errors.validation")).first()).toBeVisible();
  expect(await rangeOf()).toEqual(before);

  await page.getByLabel(`PM10 ${t("ru", "qcRules.ranges.min")}`).fill(String(before?.min ?? 0));
  await max.fill("2500");
  await page.locator("#qc-spike-madMultiplier").fill("7");
  await page.getByRole("button", { name: t("ru", "qcRules.save"), exact: true }).click();
  await expect(page.getByText(t("ru", "qcRules.saved")).first()).toBeVisible();
  await expect.poll(async () => (await rangeOf())?.max).toBe(2500);
  const [spike] = await db.select().from(qcRules).where(eq(qcRules.kind, "spike"));
  expect(spike?.params.madMultiplier).toBe(7);
  // Параметры из seed, которых нет в форме, сохраняются.
  expect(spike?.params.windowHours).toBe(24);
  const [audit] = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.action, "qcRules.update"))
    .orderBy(auditLog.id);
  expect(audit).toBeTruthy();

  // Возвращаем значения, чтобы не влиять на другие сценарии.
  await max.fill(String(before?.max));
  await page.locator("#qc-spike-madMultiplier").fill("6");
  await page.getByRole("button", { name: t("ru", "qcRules.save"), exact: true }).click();
  await expect.poll(async () => (await rangeOf())?.max).toBe(before?.max);
});
