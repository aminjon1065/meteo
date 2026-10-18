import { eq } from "@meteo/db";
import { alertRules } from "@meteo/db/schema";
import { expect, test } from "@playwright/test";
import { closeE2eDb, e2eDb } from "../helpers/db";
import { selectByText } from "../helpers/forms";
import { t } from "../helpers/messages";

test.afterAll(async () => {
  await closeE2eDb();
});

test("создание правила уведомлений: валидация порога, сохранение, список", async ({ page }) => {
  const name = `E2E PM2.5 > 50 ${Date.now().toString().slice(-5)}`;
  await page.goto("/ru/admin/alerts/new");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(t("ru", "alerts.add"));
  await page.locator("#name").fill(name);
  await page.locator("#kind").selectOption("pollutant");
  await selectByText(page.locator("#pollutantId"), /PM2\.5/);
  await page.getByRole("button", { name: t("ru", "alerts.save") }).click();
  await expect(page.locator("#threshold")).toHaveAttribute("aria-invalid", "true");

  await page.locator("#threshold").fill("50");
  await page.locator("#averagingMin").selectOption("60");
  await page.locator("#scope").selectOption("station");
  await selectByText(page.locator("#stationId"), /E2E-DU-01/);
  await page.locator("#cooldownMin").fill("120");
  await page.getByRole("button", { name: t("ru", "alerts.save") }).click();
  await expect(page).toHaveURL(/\/ru\/admin\/alerts$/);
  await expect(page.getByText(name)).toBeVisible();

  const [rule] = await e2eDb().select().from(alertRules).where(eq(alertRules.name, name));
  expect(rule?.threshold).toBe(50);
  expect(rule?.scope).toBe("station");
  expect(rule?.channels).toEqual(["portal", "email"]);
  expect(rule?.cooldownMin).toBe(120);
  expect(rule?.enabled).toBe(true);
});
