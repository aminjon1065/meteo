import { eq } from "@meteo/db";
import { stationPollutants, stations } from "@meteo/db/schema";
import { expect, test } from "@playwright/test";
import { closeE2eDb, e2eDb } from "../helpers/db";
import { t } from "../helpers/messages";

test.describe.configure({ mode: "serial" });
test.afterAll(async () => {
  await closeE2eDb();
});

test("создание станции через форму: валидация, вещества, редирект на карточку, публичный список", async ({
  page,
}) => {
  const code = `E2E-NEW-${Date.now().toString().slice(-6)}`;
  const slug = code.toLowerCase();
  await page.goto("/ru/admin/stations/new");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(t("ru", "stations.add"));

  // Пустая форма не отправляется: ошибка у кода станции.
  await page.getByRole("button", { name: t("ru", "common.actions.save") }).click();
  await expect(page.locator("#code")).toHaveAttribute("aria-invalid", "true");

  await page.locator("#code").fill(code);
  await page.locator("#slug").fill(slug);
  await page.locator("#name-ru").fill(`Новая станция ${code}`);
  await page.getByRole("tab", { name: "TG" }).click();
  await page.locator("#name-tg").fill(`Истгоҳи нав ${code}`);
  await page.locator("#lat").fill("38.57");
  await page.locator("#lon").fill("68.80");
  await page.locator("#regionId").selectOption({ label: "Город Душанбе" });
  await page.locator("#sampling").selectOption("continuous");
  await page.getByRole("checkbox", { name: "PM2.5", exact: true }).click();
  await page.getByRole("checkbox", { name: "NO₂", exact: true }).click();
  await page.getByRole("button", { name: t("ru", "common.actions.save") }).click();

  await expect(page).toHaveURL(/\/ru\/admin\/stations\/\d+$/);
  await expect(page.getByText(t("ru", "stations.saved")).first()).toBeVisible();

  const db = e2eDb();
  const [row] = await db.select().from(stations).where(eq(stations.code, code));
  expect(row?.slug).toBe(slug);
  expect(row?.sampling).toBe("continuous");
  expect(row?.geom).toEqual({ x: 68.8, y: 38.57 });
  const linked = await db
    .select()
    .from(stationPollutants)
    .where(eq(stationPollutants.stationId, row?.id ?? -1));
  expect(linked).toHaveLength(2);

  // Станция видна в публичном списке и на своей странице.
  await page.goto("/ru/air");
  await expect(page.getByRole("link", { name: `Новая станция ${code}` })).toBeVisible();
  await page.goto(`/ru/air/stations/${slug}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(`Новая станция ${code}`);
});

test("дубликат кода станции отклоняется с ошибкой поля", async ({ page }) => {
  await page.goto("/ru/admin/stations/new");
  await page.locator("#code").fill("E2E-DU-01");
  await page.locator("#name-ru").fill("Дубликат");
  await page.getByRole("button", { name: t("ru", "common.actions.save") }).click();
  await expect(page.locator("#code")).toHaveAttribute("aria-invalid", "true");
  await expect(page).toHaveURL(/\/admin\/stations\/new$/);
});
