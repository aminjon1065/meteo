import { expect, test } from "@playwright/test";
import { trackCspViolations } from "../helpers/console";
import { t } from "../helpers/messages";
import { E2E } from "../setup/fixtures";

test("/air: список станций с индексом и переход на страницу станции", async ({ page }) => {
  await page.goto("/ru/air");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(t("ru", "air.title"));
  await expect(page.getByRole("heading", { name: t("ru", "air.stationsHeading") })).toBeVisible();
  const link = page.getByRole("link", { name: "Душанбе — центр (E2E)" });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/ru/air/stations/${E2E.station.slug}$`));
});

test("страница станции: текущий индекс, график ECharts с данными API, CSV, паспорт", async ({
  page,
}) => {
  const violations = trackCspViolations(page);
  await page.goto(`/ru/air/stations/${E2E.station.slug}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Душанбе — центр (E2E)");
  // Индекс рассчитан по фикстуре: уровень 1–5, не «нет данных».
  await expect(page.getByText(t("ru", "levels.0"), { exact: true })).toHaveCount(0);
  // График грузится лениво: ряд запрашивается после прокрутки к блоку.
  const seriesResponse = page.waitForResponse(
    (r) => r.url().includes(`/api/v1/stations/${E2E.station.slug}/measurements`) && r.ok(),
  );
  await page.locator('[data-deferred^="chart"]').scrollIntoViewIfNeeded();
  const series = (await (await seriesResponse).json()) as {
    series: Array<{ points: unknown[] }>;
  };
  expect(series.series[0]?.points.length ?? 0).toBeGreaterThan(20);
  await expect(page.getByText(t("ru", "index.chartTitle"), { exact: true })).toBeVisible();
  await expect(page.locator("[role=img] canvas").first()).toBeVisible();
  // Переключение периода перезапрашивает ряд.
  const weekResponse = page.waitForResponse((r) => r.url().includes("range=7d") && r.ok());
  await page.getByRole("tab", { name: t("ru", "index.ranges.7d") }).click();
  expect((await weekResponse).status()).toBe(200);
  await expect(page.getByRole("link", { name: t("ru", "index.downloadCsv") })).toHaveAttribute(
    "href",
    /format=csv/,
  );
  await expect(page.getByText(t("ru", "station.passport"), { exact: true })).toBeVisible();
  await expect(page.getByText(E2E.station.code)).toBeVisible();
  expect(violations()).toEqual([]);
});
