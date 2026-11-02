import { createHash } from "node:crypto";
import { eq } from "@meteo/db";
import { forecastLocations, stationPollutants, stationSources, stations } from "@meteo/db/schema";
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

test("станция далеко от городов списка сразу получает свой город: в выборе в шапке и в базе", async ({
  page,
}) => {
  const suffix = Date.now().toString().slice(-6);
  const code = `E2E-FAR-${suffix}`;
  const name = `Пенджикент E2E ${suffix}`;
  await page.goto("/ru/admin/stations/new");
  await page.locator("#code").fill(code);
  await page.locator("#name-ru").fill(name);
  // Пенджикент: больше 60 км от ближайшего города списка (Истаравшан, Худжанд).
  await page.locator("#lat").fill("39.495");
  await page.locator("#lon").fill("67.61");
  await page.getByRole("button", { name: t("ru", "common.actions.save") }).click();
  await expect(page).toHaveURL(/\/ru\/admin\/stations\/\d+$/);

  const db = e2eDb();
  // Района в фикстурах здесь нет — город называется как станция. (Свой город получает и фикстурный
  // датчик B сети JSON — он тоже далеко от городов списка.)
  const city = (
    await db.select().from(forecastLocations).where(eq(forecastLocations.kind, "station"))
  ).find((c) => c.name.ru === name);
  try {
    expect(city?.name.ru).toBe(name);
    expect(city?.geom).toEqual({ x: 67.61, y: 39.495 });
    expect(city?.active).toBe(true);

    await page.goto("/ru");
    // Меню выбора города открывается после гидратации — кликаем, пока не откроется.
    const citySelect = page.getByRole("button", {
      name: `Душанбе · ${t("ru", "common.city")}`,
      exact: true,
    });
    await expect(async () => {
      await citySelect.click();
      await expect(page.getByRole("menuitem").first()).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await expect(page.getByRole("menuitem", { name })).toBeVisible();
  } finally {
    await db.delete(stations).where(eq(stations.code, code));
    if (city) await db.delete(forecastLocations).where(eq(forecastLocations.id, city.id));
  }
});

test("дубликат кода станции отклоняется с ошибкой поля", async ({ page }) => {
  await page.goto("/ru/admin/stations/new");
  await page.locator("#code").fill("E2E-DU-01");
  await page.locator("#name-ru").fill("Дубликат");
  await page.getByRole("button", { name: t("ru", "common.actions.save") }).click();
  await expect(page.locator("#code")).toHaveAttribute("aria-invalid", "true");
  await expect(page).toHaveURL(/\/admin\/stations\/new$/);
});

test("карточка станции: блок автоматического приёма и источник SFTP с зашифрованным паролем", async ({
  page,
  request,
}) => {
  const db = e2eDb();
  const [station] = await db
    .select({ id: stations.id })
    .from(stations)
    .where(eq(stations.code, "E2E-DU-01"));
  const apiKey = "mst_e2e-admin-card-key-0123456789";
  await db
    .update(stations)
    .set({ apiKeyHash: createHash("sha256").update(apiKey).digest("hex") })
    .where(eq(stations.id, station?.id ?? -1));
  const posted = await request.post("/api/v1/ingest/E2E-DU-01", {
    headers: { Authorization: `Bearer ${apiKey}` },
    data: [{ time: new Date(Date.now() - 3_600_000).toISOString(), pollutant: "PM25", value: 21 }],
  });
  expect(posted.status()).toBe(200);

  await page.goto(`/ru/admin/stations/${station?.id}`);
  const ingestCard = page.getByTestId("station-ingest-card");
  await expect(ingestCard).toContainText(t("ru", "stations.ingest.title"));
  await expect(ingestCard).toContainText(t("ru", "stations.ingest.state.fresh"));
  await expect(ingestCard).toContainText("POST /api/v1/ingest/E2E-DU-01");

  // Источник SFTP: форма → запись в station_sources, пароль зашифрован, в ответе страницы его нет.
  await page.getByRole("button", { name: t("ru", "stations.sources.add") }).click();
  const form = page.getByTestId("station-source-form");
  await form.locator("#src-kind").selectOption("sftp");
  await form.locator("#src-label").fill("E2E SFTP");
  await form.locator("#src-host").fill("sftp.e2e.local");
  await form.locator("#src-username").fill("station");
  await form.locator("#src-password").fill("s3cret-password");
  await form.locator("#src-path").fill("/export/DU-01");
  await form.locator("#src-pattern").fill("*.csv");
  await form.locator("#src-mapping").fill(
    JSON.stringify({
      layout: "wide",
      time: { column: "Time" },
      pollutants: { PM25: { column: "PM2.5" } },
    }),
  );
  await form.getByRole("button", { name: t("ru", "common.actions.save") }).click();
  await expect(page.getByText(t("ru", "stations.sources.saved")).first()).toBeVisible();
  await expect(page.getByText("E2E SFTP")).toBeVisible();

  const [source] = await db
    .select()
    .from(stationSources)
    .where(eq(stationSources.stationId, station?.id ?? -1));
  expect(source?.kind).toBe("sftp");
  expect(source?.host).toBe("sftp.e2e.local");
  expect(source?.secret?.startsWith("enc:v1:")).toBe(true);
  expect(source?.secret).not.toContain("s3cret-password");
  expect(source?.mapping).toMatchObject({ layout: "wide" });
  const html = await page.content();
  expect(html).not.toContain("s3cret-password");
  expect(html).not.toContain("enc:v1:");

  // Ошибка маппинга показывается у поля.
  await page
    .getByRole("button", { name: t("ru", "common.actions.edit") })
    .first()
    .click();
  await page.getByTestId("station-source-form").locator("#src-mapping").fill('{"layout":"wide"}');
  await page
    .getByTestId("station-source-form")
    .getByRole("button", { name: t("ru", "common.actions.save") })
    .click();
  await expect(page.getByTestId("station-source-form").locator("#src-mapping")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
});
