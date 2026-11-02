import { gzipSync } from "node:zlib";
import { expect, test } from "@playwright/test";
import { trackCspViolations } from "../helpers/console";
import { type E2eLocale, HTML_LANG, prefix, t } from "../helpers/messages";

const locales: E2eLocale[] = ["tg", "ru", "en"];

for (const locale of locales) {
  test(`главная на языке ${locale}: карта «Воздух · Погода», карточка города, меню ☰, без нарушений CSP`, async ({
    page,
  }) => {
    const violations = trackCspViolations(page);
    const response = await page.goto(`${prefix(locale)}/`);
    expect(response?.status()).toBe(200);
    await expect(page.locator("html")).toHaveAttribute("lang", HTML_LANG[locale]);
    // Главная — карта на весь экран (по образцу data.meteo.uz); подвала нет.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(t(locale, "map.title"));
    await expect(page.locator(".maplibregl-canvas").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("footer")).toHaveCount(0);
    // По умолчанию — качество воздуха: станции и карточка выбранного города.
    await expect(page.getByRole("radio", { name: t(locale, "map.topics.air") })).toBeChecked();
    await expect(page.getByTestId("city-air")).toBeVisible();
    await expect(page.locator("[data-map-layers]").first()).toHaveAttribute(
      "data-map-layers",
      /\bstations\b/,
    );
    // Тема «Погода»: погода в городах из фикстуры, Душанбе выбран по умолчанию и выделен.
    await page.getByRole("radio", { name: t(locale, "map.topics.weather") }).check();
    await expect(page.locator('[data-city="dushanbe"]')).toHaveAttribute("aria-current", "true");
    await expect(page.locator('[data-city="khujand"]')).toBeVisible();
    await expect(page.locator("[data-map-layers]").first()).toHaveAttribute(
      "data-map-layers",
      /\bcities\b/,
    );
    // Попап города: название и ссылка на прогноз.
    await page.locator('[data-city="khujand"]').click();
    const popup = page.locator(".maplibregl-popup [data-popup='city']");
    await expect(
      popup.getByRole("link", { name: t(locale, "weather.openForecast") }),
    ).toHaveAttribute("href", `${prefix(locale)}/weather/khujand`);

    // Меню ☰: разделы по системам SmartMet; «Карта» (главная) — текущая.
    await page.getByRole("button", { name: t(locale, "common.menu") }).click();
    const menu = page.getByRole("dialog", { name: t(locale, "common.menu") });
    await expect(menu).toBeVisible();
    const nav = menu.getByRole("navigation", { name: t(locale, "common.mainNav") });
    for (const [key, path] of [
      ["nav.meteoAlert", "/warnings"],
      ["nav.forecast", "/weather"],
      ["nav.silam", "/air/silam"],
      ["nav.airMonitoring", "/air"],
      ["nav.dataApi", "/data"],
    ] as const) {
      await expect(nav.getByRole("link", { name: t(locale, key), exact: true })).toHaveAttribute(
        "href",
        `${prefix(locale)}${path}`,
      );
    }
    await expect(
      nav.getByRole("link", { name: t(locale, "nav.map"), exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await nav.getByRole("link", { name: t(locale, "nav.meteoAlert"), exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${prefix(locale)}/warnings$`));
    await expect(page.locator("footer")).toBeVisible();
    expect(violations()).toEqual([]);
  });
}

test("стартовый JS главной — без MapLibre и в бюджете", async ({ request }) => {
  // MapLibre (≈300 КБ gzip) грузится лениво, после первой отрисовки (station-map.lazy.tsx). Если
  // его модуль импортировать из кода, который рендерится сразу (так было с basemap-picker →
  // basemap.ts), он уходит в стартовые чанки: на медленной сети LCP и TBT главной растут.
  const html = await (await request.get("/ru")).text();
  const scripts = [...new Set(html.match(/\/_next\/static\/chunks\/[^"'\s]+\.js/g) ?? [])];
  expect(scripts.length).toBeGreaterThan(0);
  let gzipBytes = 0;
  for (const src of scripts) {
    const body = await (await request.get(src)).body();
    expect(body.includes("maplibregl-canvas-container"), `MapLibre в стартовом чанке ${src}`).toBe(
      false,
    );
    gzipBytes += gzipSync(body).length;
  }
  // Сейчас ≈ 330 КБ (база Next.js и React ≈ 290 КБ на любой странице); MapLibre добавил бы ещё 300.
  expect(gzipBytes, `стартовый JS главной, gzip: ${Math.round(gzipBytes / 1024)} КБ`).toBeLessThan(
    360 * 1024,
  );
});

test("переключатель языка ведёт на /ru и /en", async ({ page }) => {
  await page.goto("/");
  // Переключатель — три ссылки «TJ · RU · EN» в навигации «Язык» (шапка; ещё один — в меню ☰).
  const switcher = (locale: E2eLocale) =>
    page.getByRole("navigation", { name: t(locale, "common.language") }).first();
  await switcher("tg")
    .getByRole("link", { name: /Русский/ })
    .click();
  await expect(page).toHaveURL(/\/ru$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(t("ru", "map.title"));
  await switcher("ru")
    .getByRole("link", { name: /English/ })
    .click();
  await expect(page).toHaveURL(/\/en$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(t("en", "map.title"));
});

test("выбор города в шапке запоминается в cookie, выделяет город на карте и меняет карточку", async ({
  page,
}) => {
  await page.goto("/ru?layer=weather");
  const khujand = page.locator('[data-city="khujand"]');
  await expect(khujand).toBeVisible({ timeout: 30_000 });
  await expect(khujand).not.toHaveAttribute("aria-current", "true");
  // Точное имя: у маркеров на карте тоже есть кнопки «Душанбе: …».
  const citySelect = (city: string) =>
    page.getByRole("button", { name: `${city} · ${t("ru", "common.city")}`, exact: true });
  await citySelect("Душанбе").click();
  await page.getByRole("menuitem", { name: "Худжанд" }).click();
  await expect(khujand).toHaveAttribute("aria-current", "true");
  await expect(page.locator('[data-city="dushanbe"]')).not.toHaveAttribute("aria-current", "true");
  await expect(
    page.getByTestId("city-weather-card").getByRole("heading", { name: "Худжанд" }),
  ).toBeVisible();
  const cookie = (await page.context().cookies()).find((c) => c.name === "meteo-city");
  expect(cookie?.value).toBe("khujand");
  await page.reload();
  await expect(citySelect("Худжанд")).toBeVisible();
  await expect(khujand).toHaveAttribute("aria-current", "true", { timeout: 30_000 });
});

test.describe("телефон 375 px", () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  for (const locale of locales) {
    test(`главная (${locale}): карта на весь экран без прокрутки, меню ☰`, async ({ page }) => {
      await page.goto(`${prefix(locale)}/`);
      await expect(page.locator(".maplibregl-canvas").first()).toBeVisible({ timeout: 30_000 });
      // Документ не шире и не выше экрана: шапка и карта, без подвала и нижней панели.
      const size = await page.evaluate(() => ({
        docW: document.documentElement.scrollWidth,
        viewW: document.documentElement.clientWidth,
        docH: document.documentElement.scrollHeight,
        viewH: document.documentElement.clientHeight,
      }));
      expect(size.docW).toBeLessThanOrEqual(size.viewW);
      expect(size.docH).toBeLessThanOrEqual(size.viewH);
      // Язык — в шапке; остальные разделы, тема — в меню ☰.
      await expect(
        page.getByRole("navigation", { name: t(locale, "common.language") }).first(),
      ).toBeVisible();
      await page.getByRole("button", { name: t(locale, "common.menu") }).click();
      const menu = page.getByRole("dialog", { name: t(locale, "common.menu") });
      await expect(menu.getByRole("link", { name: t(locale, "nav.health") })).toBeVisible();
      await expect(
        menu.getByRole("button", { name: t(locale, "common.theme.dark") }),
      ).toBeVisible();
    });
  }
});
