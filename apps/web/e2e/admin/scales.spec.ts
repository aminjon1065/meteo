import { and, eq } from "@meteo/db";
import { limitValues, pollutants } from "@meteo/db/schema";
import { expect, test } from "@playwright/test";
import { closeE2eDb, e2eDb } from "../helpers/db";
import { t } from "../helpers/messages";

test.describe.configure({ mode: "serial" });
test.afterAll(async () => {
  await closeE2eDb();
});

/**
 * Регрессия ревью 10.2026: при сохранении ПДК пустое значение одного вещества удаляло нормативы
 * этого вида у всех веществ (условие `eq(...) && eq(...)` вместо `and(...)`).
 */
test("ПДК: очистка среднесуточного значения у одного вещества не трогает остальные", async ({
  page,
}) => {
  const db = e2eDb();
  const [pm25] = await db
    .select({ id: pollutants.id })
    .from(pollutants)
    .where(eq(pollutants.code, "PM25"));
  const [pm10] = await db
    .select({ id: pollutants.id })
    .from(pollutants)
    .where(eq(pollutants.code, "PM10"));
  expect(pm25 && pm10).toBeTruthy();
  const dailyOf = async (pollutantId: number) =>
    db
      .select({ value: limitValues.value })
      .from(limitValues)
      .where(and(eq(limitValues.pollutantId, pollutantId), eq(limitValues.kind, "daily")))
      .then((r) => r[0]?.value ?? null);
  const pm25Before = await dailyOf(pm25?.id as number);
  const pm10Before = await dailyOf(pm10?.id as number);
  expect(pm25Before).not.toBeNull();
  expect(pm10Before).not.toBeNull();
  const dailyAll = await db.select().from(limitValues).where(eq(limitValues.kind, "daily"));

  await page.goto("/ru/admin/scales/limits");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(t("ru", "scales.limits.title"));
  const pm25Daily = page.getByLabel(`PM2.5 ${t("ru", "scales.limits.daily")}`);
  await expect(pm25Daily).toHaveValue(String(pm25Before));
  await pm25Daily.fill("");
  await page.getByRole("button", { name: t("ru", "scales.save"), exact: true }).click();
  await expect(page.getByText(t("ru", "scales.saved")).first()).toBeVisible();

  await expect.poll(() => dailyOf(pm25?.id as number)).toBeNull();
  expect(await dailyOf(pm10?.id as number)).toBe(pm10Before);
  const dailyAfter = await db.select().from(limitValues).where(eq(limitValues.kind, "daily"));
  expect(dailyAfter.length).toBe(dailyAll.length - 1);

  // Возвращаем значение, чтобы не влиять на другие сценарии.
  await page.reload();
  await page.getByLabel(`PM2.5 ${t("ru", "scales.limits.daily")}`).fill(String(pm25Before));
  await page.getByRole("button", { name: t("ru", "scales.save"), exact: true }).click();
  await expect(page.getByText(t("ru", "scales.saved")).first()).toBeVisible();
  await expect.poll(() => dailyOf(pm25?.id as number)).toBe(pm25Before);
});
