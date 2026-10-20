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
  await expect(page.getByRole("heading", { name: t("ru", "station.about") })).toBeVisible();
  // Плитки веществ с мини‑графиками за сутки и пустые состояния для неизмеряемых веществ.
  await expect(page.getByTestId("pollutant-tiles")).toBeVisible();
  await expect(page.getByTestId("tile-PM10")).toContainText(
    t("ru", "station.dayRange").split(":")[0] ?? "",
  );
  await expect(page.getByText(E2E.station.code)).toBeVisible();
  expect(violations()).toEqual([]);
});

test("страница станции: кратность ПДК по методике Агентства, суммация NO₂+SO₂, без ВЗ/ЭВЗ", async ({
  page,
  request,
}) => {
  await page.goto(`/ru/air/stations/${E2E.station.slug}`);
  const card = page.getByTestId("agency-ratio");
  await expect(card.getByText(t("ru", "index.agency.title"), { exact: true })).toBeVisible();
  // Таблица: по строке на вещество станции (PM2.5, PM10, NO₂, SO₂) с ПДКс.с. из бюллетеня Агентства.
  await expect(card.getByRole("row")).toHaveCount(5);
  await expect(card.getByRole("row", { name: /NO₂/ })).toContainText("40");
  await expect(card.getByRole("row", { name: /NO₂/ })).toContainText("85");
  // Суммация: кратности NO₂ (≈24/40) и SO₂ (≈6/50) — сумма меньше 1, случаев ВЗ/ЭВЗ нет.
  const sum = card.getByTestId("agency-sum");
  await expect(sum).toContainText(t("ru", "index.agency.sum"));
  await expect(sum).toContainText(/0,[4-9]\d?/);
  await expect(card.getByText(t("ru", "index.agency.noCases"))).toBeVisible();

  // Те же показатели в API по шкале кратности ПДК.
  const res = await request.get("/api/v1/index/current?scale=RATIO_TO_LIMIT");
  expect(res.status()).toBe(200);
  const body = (await res.json()) as {
    units: Record<string, string>;
    stations: Array<{
      slug: string;
      indicators: {
        no2so2Sum: number | null;
        highPollution: boolean;
        extremeHighPollution: boolean;
        maxSingle: Record<string, { value: number; ratio: number | null }>;
      } | null;
      subIndices: Record<string, { index: number }>;
    }>;
  };
  expect(body.units.NO2).toBe("µg/m³");
  const station = body.stations.find((s) => s.slug === E2E.station.slug);
  expect(station?.indicators?.no2so2Sum).toBeGreaterThan(0.4);
  expect(station?.indicators?.no2so2Sum).toBeLessThan(1);
  expect(station?.indicators?.highPollution).toBe(false);
  expect(station?.indicators?.extremeHighPollution).toBe(false);
  expect(station?.indicators?.maxSingle.NO2?.ratio).toBeGreaterThan(0);
  expect(station?.subIndices.NO2?.index).toBeGreaterThan(0.4);
});
