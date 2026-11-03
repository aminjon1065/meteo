import { expect, test } from "@playwright/test";
import { E2E } from "../setup/fixtures";

/**
 * Приёмка M6 «адаптив 375/768/1280»: 375 px проверяют home.spec и map.spec, здесь — планшет и
 * ноутбук: ни одна основная страница не шире экрана (нет горизонтальной прокрутки).
 */
const PAGES = [
  "/ru",
  "/ru/air",
  `/ru/air/stations/${E2E.station.slug}`,
  "/ru/weather",
  "/ru/weather/dushanbe",
  "/ru/warnings",
  "/ru/news",
  `/ru/news/${E2E.news.slug}`,
  "/ru/health",
  "/ru/air/bulletins",
  "/ru/air/index",
  "/ru/data",
  "/ru/data/api",
  "/ru/about",
];

for (const width of [768, 1280]) {
  test.describe(`ширина ${width} px`, () => {
    test.use({ viewport: { width, height: 900 } });
    for (const path of PAGES) {
      test(`${path} без горизонтальной прокрутки`, async ({ page }) => {
        const res = await page.goto(path, { waitUntil: "domcontentloaded" });
        expect(res?.status()).toBe(200);
        await page.waitForLoadState("load");
        const size = await page.evaluate(() => ({
          doc: document.documentElement.scrollWidth,
          view: document.documentElement.clientWidth,
        }));
        expect(size.doc, `ширина документа на ${path}`).toBeLessThanOrEqual(size.view);
      });
    }
  });
}
