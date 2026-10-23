import { expect, test } from "@playwright/test";
import { trackCspViolations } from "../helpers/console";
import { t } from "../helpers/messages";
import { E2E } from "../setup/fixtures";

test("/map: карта MapLibre, включение слоя SILAM, выбор вещества и ползунок времени", async ({
  page,
}) => {
  const violations = trackCspViolations(page);
  // Станции из API — слой включён всегда; подписка до перехода, иначе ответ может прийти раньше.
  const stationsResponse = page.waitForResponse((r) => r.url().includes("/api/v1/stations"));
  await page.goto("/ru/map");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(t("ru", "map.title"));
  await expect(page.locator(".maplibregl-canvas").first()).toBeVisible({ timeout: 30_000 });
  expect((await stationsResponse).status()).toBe(200);

  // Base UI: id стоит на скрытом <input>, видимый элемент — span[role=checkbox] с именем из label.
  const silam = page.getByRole("checkbox", { name: t("ru", "map.silam") });
  await expect(silam).toBeEnabled();
  const pngRequest = page.waitForRequest((r) =>
    /\/silam\/\d{10}\/[A-Z0-9]+\/\d{3}\.png$/.test(r.url()),
  );
  await silam.click();
  await expect(silam).toHaveAttribute("aria-checked", "true");
  await pngRequest;
  const pollutant = page.getByRole("combobox", { name: t("ru", "silam.pollutant") });
  await expect(pollutant).toBeVisible();
  await pollutant.selectOption("PM10");
  const slider = page.getByRole("slider", { name: t("ru", "silam.time") });
  await expect(slider).toBeVisible();
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("button", { name: t("ru", "silam.play") })).toBeVisible();

  // Слой предупреждений включён (есть действующее CAP) и подписан числом.
  await expect(page.getByRole("checkbox", { name: t("ru", "map.warnings") })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.waitForLoadState("networkidle");
  expect(violations()).toEqual([]);
});

/** Контейнер карты с экземпляром MapLibre для диагностики (MapDiagnosticsElement в station-map.tsx). */
type MapDiagnosticsElement = HTMLElement & {
  __maplibreMap?: { project(lngLat: [number, number]): { x: number; y: number } };
};

test("/map: границы регионов включены по умолчанию, выключаются, заливка по уровню и попап области", async ({
  page,
}) => {
  const violations = trackCspViolations(page);
  const regionsResponse = page.waitForResponse((r) => r.url().includes("/api/v1/regions"));
  await page.goto("/ru/map");
  await expect(page.locator(".maplibregl-canvas").first()).toBeVisible({ timeout: 30_000 });
  const regions = await regionsResponse;
  expect(regions.status()).toBe(200);
  const body = (await regions.json()) as {
    type: string;
    features: Array<{ properties: { code: string; stationsCount: number; level: number } }>;
  };
  expect(body.type).toBe("FeatureCollection");
  expect(body.features.map((f) => f.properties.code).sort()).toEqual([
    "DU",
    "GB",
    "KT",
    "RRP",
    "SU",
  ]);
  const du = body.features.find((f) => f.properties.code === "DU")?.properties;
  expect(du?.stationsCount).toBe(1);
  expect(du?.level).toBeGreaterThan(0);
  expect(body.features.find((f) => f.properties.code === "GB")?.properties.stationsCount).toBe(0);

  // Контуры включены по умолчанию; состояние слоёв — в data-map-layers (без доступа к WebGL).
  const toggle = page.getByRole("checkbox", { name: t("ru", "map.regions") });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  const mapEl = page.locator("[data-map-layers]").first();
  await expect(mapEl).toHaveAttribute("data-map-layers", /\bregions\b/);
  await expect(mapEl).toHaveAttribute("data-map-layers", /\bstations\b/);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(mapEl).not.toHaveAttribute("data-map-layers", /\bregions\b/);
  await expect(page.getByRole("checkbox", { name: t("ru", "map.regionsFill") })).toHaveCount(0);
  await toggle.click();
  await expect(mapEl).toHaveAttribute("data-map-layers", /\bregions\b/);

  // Заливка по худшему уровню — отдельный чекбокс, по умолчанию выключен.
  const fill = page.getByRole("checkbox", { name: t("ru", "map.regionsFill") });
  await expect(fill).toHaveAttribute("aria-checked", "false");
  await expect(mapEl).not.toHaveAttribute("data-map-layers", /regions-fill/);
  await fill.click();
  await expect(mapEl).toHaveAttribute("data-map-layers", /regions-fill/);

  // Попап области: клик по Хатлону вдали от станции и полигона предупреждения.
  const popup = page.locator(".maplibregl-popup [data-popup='region']");
  await expect(async () => {
    const point = await mapEl.evaluate(
      (el, lngLat) => {
        const map = (el as MapDiagnosticsElement).__maplibreMap;
        if (!map) throw new Error("карта не инициализирована");
        const p = map.project(lngLat);
        const r = el.getBoundingClientRect();
        return { x: r.left + p.x, y: r.top + p.y };
      },
      [69.9, 37.4] as [number, number],
    );
    await page.mouse.click(point.x, point.y);
    await expect(popup).toContainText(E2E.regionName.KT.ru, { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await expect(popup).toContainText(`${t("ru", "map.regionStations")}: 1`);
  await expect(popup.getByRole("link", { name: t("ru", "map.regionOpen") })).toHaveAttribute(
    "href",
    "/ru/air",
  );
  expect(violations()).toEqual([]);
});

test("/api/v1/regions и /api/v1/districts: GeoJSON, кэш 10 минут, ETag и 304", async ({
  request,
}) => {
  const regions = await request.get("/api/v1/regions");
  expect(regions.ok()).toBeTruthy();
  expect(regions.headers()["cache-control"]).toContain("max-age=600");
  expect(regions.headers()["access-control-allow-origin"]).toBe("*");
  const etag = regions.headers().etag ?? "";
  expect(etag).toMatch(/^W\/"[0-9a-f]{16}"$/);
  const cached = await request.get("/api/v1/regions", { headers: { "If-None-Match": etag } });
  expect(cached.status()).toBe(304);

  const districts = await request.get("/api/v1/districts");
  expect(districts.ok()).toBeTruthy();
  const body = (await districts.json()) as {
    type: string;
    features: Array<{
      geometry: { type: string };
      properties: { code: string; regionCode: string; stationsCount: number; level: number };
    }>;
  };
  expect(body.type).toBe("FeatureCollection");
  expect(body.features).toHaveLength(1);
  expect(body.features[0]?.geometry.type).toBe("MultiPolygon");
  expect(body.features[0]?.properties).toMatchObject({
    code: E2E.district.code,
    regionCode: "DU",
    stationsCount: 1,
  });
  expect(body.features[0]?.properties.level).toBeGreaterThan(0);
});

test.describe("телефон", () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  test("/map: карта на весь экран, слои в шторке, SILAM управляется карточкой внизу", async ({
    page,
  }) => {
    const violations = trackCspViolations(page);
    await page.goto("/ru/map");
    await expect(page.locator(".maplibregl-canvas").first()).toBeVisible({ timeout: 30_000 });
    // Панели слоёв поверх карты нет: только кнопка «Слои» (число — включённые слои сверх станций).
    await expect(page.locator("aside")).toBeHidden();
    await expect(page.getByRole("list", { name: t("ru", "common.legend") })).toBeVisible();
    const layersButton = page.getByRole("button", { name: new RegExp(t("ru", "map.layers")) });
    await expect(layersButton).toBeVisible();

    await layersButton.click();
    const sheet = page.getByRole("dialog", { name: t("ru", "map.layers") });
    await expect(sheet).toBeVisible();
    const pngRequest = page.waitForRequest((r) =>
      /\/silam\/\d{10}\/[A-Z0-9]+\/\d{3}\.png$/.test(r.url()),
    );
    const silam = sheet.getByRole("checkbox", { name: t("ru", "map.silam") });
    await silam.click();
    await expect(silam).toHaveAttribute("aria-checked", "true");
    await pngRequest;
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();

    // Время и вещество — в карточке внизу карты, без открытия шторки.
    const card = page.getByRole("region", { name: t("ru", "map.silam") });
    await expect(card).toBeVisible();
    await card.getByRole("combobox", { name: t("ru", "silam.pollutant") }).selectOption("PM10");
    const slider = card.getByRole("slider", { name: t("ru", "silam.time") });
    await slider.focus();
    await page.keyboard.press("ArrowRight");
    await expect(card.getByRole("button", { name: t("ru", "silam.play") })).toBeVisible();
    // Карточка не перекрывает масштаб и атрибуцию карты.
    const cardBox = await card.boundingBox();
    const attrib = await page.locator(".maplibregl-ctrl-attrib").boundingBox();
    expect(cardBox && attrib && cardBox.y + cardBox.height <= attrib.y).toBeTruthy();
    expect(violations()).toEqual([]);
  });
});
