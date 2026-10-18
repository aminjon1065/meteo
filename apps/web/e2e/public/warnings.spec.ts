import { expect, test } from "@playwright/test";
import { t } from "../helpers/messages";
import { E2E } from "../setup/fixtures";

test("/warnings: матрица регион × день и карточка действующего предупреждения", async ({
  page,
}) => {
  await page.goto("/ru/warnings");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(t("ru", "warnings.title"));
  await expect(page.getByRole("heading", { name: t("ru", "warnings.activeNow") })).toBeVisible();
  await expect(page.getByText(E2E.capHeadline.ru).first()).toBeVisible();
  await expect(page.getByText(t("ru", "warnings.severity.Severe")).first()).toBeVisible();
  // Фильтр по региону Душанбе оставляет предупреждение на месте.
  await page.getByRole("link", { name: "Город Душанбе" }).first().click();
  await expect(page).toHaveURL(/region=DU/);
  await expect(page.getByText(E2E.capHeadline.ru).first()).toBeVisible();
});

test("/en/warnings: английский блок info выбран по локали", async ({ page }) => {
  await page.goto("/en/warnings");
  await expect(page.getByText(E2E.capHeadline.en).first()).toBeVisible();
});

test("/api/v1/alerts отдаёт предупреждение в JSON и GeoJSON", async ({ request }) => {
  const json = await request.get("/api/v1/alerts");
  expect(json.ok()).toBeTruthy();
  expect(JSON.stringify(await json.json())).toContain(E2E.capIdentifier);
  const geo = await request.get("/api/v1/alerts?format=geojson&active=1");
  expect(geo.ok()).toBeTruthy();
  const body = (await geo.json()) as { type: string; features: unknown[] };
  expect(body.type).toBe("FeatureCollection");
  expect(body.features.length).toBeGreaterThan(0);
});
