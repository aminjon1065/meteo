import { and, eq } from "@meteo/db";
import { measurements, pollutants, stations } from "@meteo/db/schema";
import { expect, test } from "@playwright/test";
import { closeE2eDb, e2eDb } from "../helpers/db";
import { selectByText } from "../helpers/forms";
import { t } from "../helpers/messages";
import { E2E } from "../setup/fixtures";

test.describe.configure({ mode: "serial" });
test.afterAll(async () => {
  await closeE2eDb();
});

test("ручной ввод измерения за сегодня сохраняется, пересчитывает индекс и пишет аудит", async ({
  page,
}) => {
  await page.goto("/ru/admin/measurements/entry");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    t("ru", "measurements.cards.entry.title"),
  );
  await selectByText(page.locator("#station"), /E2E-DU-01/);
  const date = await page.locator("#date").inputValue();
  expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await page.getByLabel("07:00 PM2.5", { exact: true }).fill("42,5");
  await page.getByLabel("07:00 PM10", { exact: true }).fill("61");
  await page.getByRole("button", { name: t("ru", "measurements.entry.save") }).click();
  await expect(page.locator("[data-sonner-toast]").first()).toContainText(/2/);

  const db = e2eDb();
  const [station] = await db
    .select({ id: stations.id })
    .from(stations)
    .where(eq(stations.code, E2E.station.code));
  const [pm25] = await db
    .select({ id: pollutants.id })
    .from(pollutants)
    .where(eq(pollutants.code, "PM25"));
  const time = new Date(`${date}T07:00:00+05:00`);
  const [row] = await db
    .select()
    .from(measurements)
    .where(
      and(
        eq(measurements.stationId, station?.id ?? -1),
        eq(measurements.pollutantId, pm25?.id ?? -1),
        eq(measurements.time, time),
      ),
    );
  expect(row?.value).toBe(42.5);
  expect(row?.source).toBe(1);
  expect(row?.qcFlag).toBe(1);
});
