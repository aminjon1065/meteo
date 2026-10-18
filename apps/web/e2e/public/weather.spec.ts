import { expect, test } from "@playwright/test";
import { trackCspViolations } from "../helpers/console";
import { t } from "../helpers/messages";

test("/weather: карточки городов с температурой из прогноза", async ({ page }) => {
  await page.goto("/ru/weather");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(t("ru", "weather.title"));
  await expect(page.getByText(t("ru", "weather.noForecast"))).toHaveCount(0);
  const card = page.locator('[data-slot="card"]', { hasText: "Душанбе" }).first();
  await expect(card).toBeVisible();
  await expect(card).toContainText(/-?\d+°/);
  await card.getByRole("link", { name: "Душанбе", exact: true }).click();
  await expect(page).toHaveURL(/\/ru\/weather\/dushanbe$/);
});

test("/weather/dushanbe: текущая погода, лента 24 ч, график, таблица дней", async ({ page }) => {
  const violations = trackCspViolations(page);
  await page.goto("/ru/weather/dushanbe");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Душанбе");
  await expect(page.getByText(t("ru", "weather.noForecast"))).toHaveCount(0);
  await expect(page.getByRole("heading", { name: t("ru", "weather.next24h") })).toBeVisible();
  await expect(page.getByText(t("ru", "weather.hourly"), { exact: true })).toBeVisible();
  await page.locator('[data-deferred^="weather-chart"]').scrollIntoViewIfNeeded();
  await expect(page.locator("[role=img] canvas").first()).toBeVisible();
  await expect(page.getByText(t("ru", "weather.wind")).first()).toBeVisible();
  // Для города есть действующее предупреждение из фикстуры CAP.
  await expect(page.getByText("Сильный ветер в Душанбе (E2E)").first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(violations()).toEqual([]);
});
