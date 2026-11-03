import { expect, type Locator, type Page, test } from "@playwright/test";
import { trackCspViolations } from "../helpers/console";
import { t } from "../helpers/messages";
import { E2E } from "../setup/fixtures";

const SILAM_PNG = /\/silam\/\d{10}\/[A-Z0-9]+\/\d{3}\.png$/;

/** Контейнер карты с экземпляром MapLibre для диагностики (MapDiagnosticsElement в station-map.tsx). */
type MapDiagnosticsElement = HTMLElement & {
  __maplibreMap?: {
    project(lngLat: [number, number]): { x: number; y: number };
    jumpTo(opts: { center: [number, number]; zoom: number }): void;
  };
};

/** Клик по точке карты (lon, lat) — повторяется, пока не появится ожидаемый попап. */
async function clickMapAt(page: Page, mapEl: Locator, lngLat: [number, number], popup: Locator) {
  await expect(async () => {
    const point = await mapEl.evaluate((el, ll) => {
      const map = (el as MapDiagnosticsElement).__maplibreMap;
      if (!map) throw new Error("карта не инициализирована");
      const p = map.project(ll);
      const r = el.getBoundingClientRect();
      return { x: r.left + p.x, y: r.top + p.y };
    }, lngLat);
    await page.mouse.click(point.x, point.y);
    await expect(popup).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

test("главная: «Воздух · Сейчас» по умолчанию, карточка города, плашка предупреждений, прогноз SILAM", async ({
  page,
}) => {
  const violations = trackCspViolations(page);
  await page.goto("/ru");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(t("ru", "map.title"));
  await expect(page.locator(".maplibregl-canvas").first()).toBeVisible({ timeout: 30_000 });

  // Одна тема за раз: станции видны, погода в городах — нет; соседние страны приглушены.
  await expect(page.getByRole("radio", { name: t("ru", "map.topics.air") })).toBeChecked();
  await expect(page.getByRole("radio", { name: t("ru", "map.views.now") })).toBeChecked();
  const mapEl = page.locator("[data-map-layers]").first();
  await expect(mapEl).toHaveAttribute("data-map-layers", /\bstations\b/);
  await expect(mapEl).toHaveAttribute("data-map-layers", /\boutline\b/);
  await expect(mapEl).not.toHaveAttribute("data-map-layers", /\bcities\b/);
  await expect(page.locator("[data-city]")).toHaveCount(0);

  // Карточка выбранного города: уровень словом и шкала-легенда; ссылка на раздел воздуха.
  const card = page.getByTestId("city-air");
  await expect(card.getByRole("heading", { name: "Душанбе" })).toBeVisible();
  await expect(card.getByTestId("level-gauge")).toBeVisible();
  await expect(card.getByRole("link", { name: t("ru", "map.card.airMore") })).toHaveAttribute(
    "href",
    "/ru/air",
  );

  // Действующее CAP-предупреждение: слой на карте, плашка со ссылкой на раздел и легенда уровней
  // (уровень цифрой — «3», высокая опасность).
  await expect(mapEl).toHaveAttribute("data-map-layers", /\bwarnings\b/);
  const chip = page.getByTestId("warnings-chip").filter({ visible: true });
  await expect(chip).toHaveText(/^1 предупреждение$/);
  await expect(chip).toHaveAttribute("href", "/ru/warnings");
  await expect(chip).toHaveAttribute("data-state", "active");
  const legend = page.getByTestId("warnings-legend");
  await expect(legend).toContainText(`3${t("ru", "warnings.severity.Severe")}`);

  // Уровни различимы без цвета (FR1.3): значки-«лица» в шкале карточки и на маркерах станций.
  await expect(card.getByTestId("level-gauge").locator("[data-aq-icon]").first()).toBeVisible();
  await expect
    .poll(() =>
      mapEl.evaluate((el) => {
        const map = (
          el as MapDiagnosticsElement & {
            __maplibreMap?: { getLayer(id: string): unknown };
          }
        ).__maplibreMap;
        return Boolean(map?.getLayer("stations-faces"));
      }),
    )
    .toBe(true);
  // Карта и её кнопки подписаны на языке страницы; есть ссылка на список станций без карты.
  await expect(mapEl).toHaveAttribute("aria-label", t("ru", "map.mapRegion"));
  await expect(page.getByRole("link", { name: t("ru", "map.stationList") })).toHaveAttribute(
    "href",
    "/ru/air",
  );
  await expect(page.getByRole("button", { name: t("ru", "map.controls.zoomIn") })).toBeVisible();

  // Прогноз: слой SILAM вместо станций, вещество и ползунок времени, адрес ?layer=silam.
  const pngRequest = page.waitForRequest((r) => SILAM_PNG.test(r.url()));
  await page.getByRole("radio", { name: t("ru", "map.views.forecast") }).check();
  await pngRequest;
  await expect(page).toHaveURL(/\/ru\?layer=silam$/);
  await expect(mapEl).toHaveAttribute("data-map-layers", /\bsilam\b/);
  await expect(mapEl).not.toHaveAttribute("data-map-layers", /\bstations\b/);
  const panel = page.getByRole("region", { name: t("ru", "weather.airForecast") });
  await panel.getByRole("combobox", { name: t("ru", "silam.pollutant") }).selectOption("PM10");
  const slider = panel.getByRole("slider", { name: t("ru", "silam.time") });
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(panel.getByRole("button", { name: t("ru", "silam.play") })).toBeVisible();

  // Обратно к измерениям — адрес без параметра.
  await page.getByRole("radio", { name: t("ru", "map.views.now") }).check();
  await expect(page).toHaveURL(/\/ru$/);
  await expect(mapEl).toHaveAttribute("data-map-layers", /\bstations\b/);
  await page.waitForLoadState("networkidle");
  expect(violations()).toEqual([]);
});

test("ссылка из раздела предупреждений /?layer=warnings приближает карту к их областям", async ({
  page,
}) => {
  await page.goto("/ru?layer=warnings");
  const mapEl = page.locator("[data-map-layers]").first();
  await expect(mapEl).toHaveAttribute("data-map-layers", /\bwarnings\b/, { timeout: 30_000 });
  // Полигон фикстуры — окрестности Душанбе: карта приближается сильнее масштаба всей страны.
  await expect
    .poll(
      () =>
        mapEl.evaluate(
          (el) =>
            (
              el as HTMLElement & { __maplibreMap?: { getZoom(): number } }
            ).__maplibreMap?.getZoom() ?? 0,
        ),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(8);
});

test("старый адрес /map ведёт на главную и открывает прогноз из ?layer=silam", async ({ page }) => {
  await page.goto("/ru/map?layer=silam");
  await expect(page).toHaveURL(/\/ru\?layer=silam$/);
  await expect(page.getByRole("radio", { name: t("ru", "map.views.forecast") })).toBeChecked();
  await expect(page.locator("[data-map-layers]").first()).toHaveAttribute(
    "data-map-layers",
    /\bsilam\b/,
    { timeout: 30_000 },
  );
});

test("главная: попап станции с уровнем словом, границы регионов всегда видны, попап области", async ({
  page,
}) => {
  const violations = trackCspViolations(page);
  const regionsResponse = page.waitForResponse((r) => r.url().endsWith("/api/v1/regions"));
  await page.goto("/ru");
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

  // Контуры областей — часть карты, а не переключаемый слой: галочек на главной нет.
  const mapEl = page.locator("[data-map-layers]").first();
  await expect(mapEl).toHaveAttribute("data-map-layers", /\bregions\b/);
  await expect(page.getByRole("checkbox")).toHaveCount(0);

  // Попап области: клик по Хатлону вдали от станции и полигона предупреждения.
  const regionPopup = page.locator(".maplibregl-popup [data-popup='region']");
  await clickMapAt(page, mapEl, [69.9, 37.4], regionPopup);
  await expect(regionPopup).toContainText(E2E.regionName.KT.ru);
  await expect(regionPopup).toContainText(`${t("ru", "map.regionStations")}: 1`);
  await expect(regionPopup.getByRole("link", { name: t("ru", "map.regionOpen") })).toHaveAttribute(
    "href",
    "/ru/air",
  );

  // Попап станции: приближаемся к станции Душанбе (на масштабе страны она может быть в кластере).
  await mapEl.evaluate((el) => {
    (el as MapDiagnosticsElement).__maplibreMap?.jumpTo({ center: [68.78, 38.56], zoom: 12 });
  });
  const stationPopup = page.locator(".maplibregl-popup [data-popup='station']");
  await clickMapAt(page, mapEl, [68.78, 38.56], stationPopup);
  await expect(
    stationPopup.getByRole("link", { name: t("ru", "map.stationMore") }),
  ).toHaveAttribute("href", `/ru/air/stations/${E2E.station.slug}`);
  // Уровень — словом (не только цветом) и время обновления.
  await expect(stationPopup).toContainText(
    new RegExp(["1", "2", "3", "4", "5", "6"].map((l) => t("ru", `levels.${l}`)).join("|")),
  );
  await expect(stationPopup).toContainText(
    t("ru", "map.card.updated").replace("{time}", "").trim(),
  );
  expect(violations()).toEqual([]);
});

test("главная: тема «Погода» — значки и температура в городах вместо станций", async ({ page }) => {
  await page.goto("/ru");
  await expect(page.locator(".maplibregl-canvas").first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole("radio", { name: t("ru", "map.topics.weather") }).check();
  await expect(page).toHaveURL(/\/ru\?layer=weather$/);
  const mapEl = page.locator("[data-map-layers]").first();
  await expect(mapEl).toHaveAttribute("data-map-layers", /\bcities\b/);
  await expect(mapEl).not.toHaveAttribute("data-map-layers", /\bstations\b/);
  await expect(page.locator('[data-city="dushanbe"]')).toHaveAttribute("aria-current", "true");
  const card = page.getByTestId("city-weather-card");
  await expect(card.getByRole("heading", { name: "Душанбе" })).toBeVisible();
  await expect(card.getByRole("link", { name: t("ru", "weather.openForecast") })).toHaveAttribute(
    "href",
    "/ru/weather/dushanbe",
  );
});

test("главная: тип карты — схема и серая всегда, рельеф и спутник при наличии файлов, выбор запоминается", async ({
  page,
}) => {
  await page.goto("/ru");
  await expect(page.locator(".maplibregl-canvas").first()).toBeVisible({ timeout: 30_000 });
  const mapEl = page.locator("[data-map-layers]").first();
  await expect(mapEl).toHaveAttribute("data-basemap", "scheme");

  const picker = page.getByTestId("basemap-picker");
  const option = (b: string) =>
    page.getByRole("menuitemradio", { name: t("ru", `map.basemap.${b}`), exact: true });
  await picker.click();
  await expect(option("scheme")).toBeVisible();
  // Рельеф и спутник предлагаются, только если их тайлы есть на сервере (в CI файлов нет).
  for (const [b, file] of [
    ["relief", "terrain"],
    ["satellite", "satellite"],
  ] as const) {
    const exists = (await page.request.head(`/tiles/${file}.pmtiles`)).ok();
    await expect(option(b)).toHaveCount(exists ? 1 : 0);
  }
  await option("gray").click();
  await expect(mapEl).toHaveAttribute("data-basemap", "gray");
  await expect(picker).toHaveAccessibleName(
    `${t("ru", "map.basemap.title")}: ${t("ru", "map.basemap.gray")}`,
  );

  // Выбор хранится в браузере: после перезагрузки — та же подложка.
  await page.reload();
  await expect(page.locator("[data-map-layers]").first()).toHaveAttribute("data-basemap", "gray", {
    timeout: 30_000,
  });
});

test("/api/v1/regions, /api/v1/districts и /api/v1/regions/outline: GeoJSON, кэш, ETag и 304", async ({
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

  // Контур страны — объединение областей одним MultiPolygon, кэш сутки.
  const outline = await request.get("/api/v1/regions/outline");
  expect(outline.ok()).toBeTruthy();
  expect(outline.headers()["cache-control"]).toContain("max-age=86400");
  const feature = (await outline.json()) as {
    type: string;
    geometry: { type: string; coordinates: unknown[] } | null;
  };
  expect(feature.type).toBe("Feature");
  expect(feature.geometry?.type).toBe("MultiPolygon");
  expect(feature.geometry?.coordinates.length).toBeGreaterThan(0);
  const outlineEtag = outline.headers().etag ?? "";
  const outlineCached = await request.get("/api/v1/regions/outline", {
    headers: { "If-None-Match": outlineEtag },
  });
  expect(outlineCached.status()).toBe(304);
});

test.describe("телефон", () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  test("главная: переключатели сверху, карточка города внизу над атрибуцией, прогноз SILAM в карточке", async ({
    page,
  }) => {
    const violations = trackCspViolations(page);
    await page.goto("/ru");
    await expect(page.locator(".maplibregl-canvas").first()).toBeVisible({ timeout: 30_000 });
    const mapEl = page.locator("[data-map-layers]").first();
    const mapBox = await mapEl.boundingBox();
    if (!mapBox) throw new Error("нет размеров карты");

    // Карточка не перекрывает нижнюю строку карты (атрибуция OSM обязательна по лицензии).
    // Атрибуцию сравниваем, только если она видна: без тайлов подложки (в CI файла .pmtiles нет)
    // MapLibre прячет пустую атрибуцию.
    const assertAboveAttribution = async (box: { y: number; height: number } | null) => {
      if (!box) throw new Error("нет размеров карточки");
      const bottom = box.y + box.height;
      expect(bottom).toBeLessThanOrEqual(mapBox.y + mapBox.height - 32);
      const attrib = page.locator(".maplibregl-ctrl-attrib");
      if (await attrib.isVisible()) {
        const attribBox = await attrib.boundingBox();
        if (attribBox) expect(bottom).toBeLessThanOrEqual(attribBox.y);
      }
    };
    const card = page.getByTestId("city-air");
    await expect(card).toBeVisible();
    const cardBox = await card.boundingBox();
    if (!cardBox) throw new Error("нет размеров карточки города");
    expect(cardBox.y).toBeGreaterThan(mapBox.y + mapBox.height / 2);
    await assertAboveAttribution(cardBox);

    // Тема и срок помещаются в одну строку сверху (375 px).
    const topic = page.getByRole("group", { name: t("ru", "map.topic") });
    const view = page.getByRole("group", { name: t("ru", "map.view") });
    const [topicBox, viewBox] = [await topic.boundingBox(), await view.boundingBox()];
    expect(Math.abs((topicBox?.y ?? 0) - (viewBox?.y ?? 100))).toBeLessThan(4);

    const pngRequest = page.waitForRequest((r) => SILAM_PNG.test(r.url()));
    await page.getByRole("radio", { name: t("ru", "map.views.forecast") }).check();
    await pngRequest;
    const panel = page.getByRole("region", { name: t("ru", "weather.airForecast") });
    await expect(panel).toBeVisible();
    await panel.getByRole("combobox", { name: t("ru", "silam.pollutant") }).selectOption("PM10");
    const slider = panel.getByRole("slider", { name: t("ru", "silam.time") });
    await slider.focus();
    await page.keyboard.press("ArrowRight");
    await expect(panel.getByRole("button", { name: t("ru", "silam.play") })).toBeVisible();
    await assertAboveAttribution(await panel.boundingBox());
    expect(violations()).toEqual([]);
  });
});
