import { and, eq } from "@meteo/db";
import { auditLog, measurements, stations } from "@meteo/db/schema";
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
