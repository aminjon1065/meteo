import { expect, test } from "@playwright/test";
import { trackCspViolations } from "../helpers/console";
import { type E2eLocale, HTML_LANG, prefix, t } from "../helpers/messages";
import { E2E } from "../setup/fixtures";

const locales: E2eLocale[] = ["tg", "ru", "en"];

for (const locale of locales) {
  test(`главная на языке ${locale}: заголовок, навигация, виджеты, без нарушений CSP`, async ({
    page,
  }) => {
    const violations = trackCspViolations(page);
    const response = await page.goto(`${prefix(locale)}/`);
    expect(response?.status()).toBe(200);
    await expect(page.locator("html")).toHaveAttribute("lang", HTML_LANG[locale]);
    // h1 — надзаголовок полосы состояния: «Качество воздуха сейчас · <город>».
    await expect(page.getByRole("heading", { level: 1 })).toContainText(t(locale, "home.airNow"));
    await expect(page.getByTestId("status-level")).toBeVisible();
    const nav = page.getByRole("navigation", { name: t(locale, "common.mainNav") });
    // exact: по‑таджикски «Ҳаво» (воздух) — подстрока «Обу ҳаво» (погода).
    await expect(
      nav.getByRole("link", { name: t(locale, "nav.airShort"), exact: true }),
    ).toBeVisible();
    await expect(
      nav.getByRole("link", { name: t(locale, "nav.weather"), exact: true }),
    ).toBeVisible();
    // Карточки: погода по городам из фикстуры, действующее CAP-предупреждение, новость.
    await expect(page.getByText(t(locale, "home.forecastToday"))).toBeVisible();
    await expect(page.getByText(E2E.capHeadline[locale]).first()).toBeVisible();
    await expect(page.getByRole("link", { name: E2E.news.title[locale] })).toBeVisible();
    // Карта станций (MapLibre) грузится лениво при прокрутке; инициализируется — WebGL и worker не заблокированы политикой.
    await page.locator('[data-deferred^="map"]').first().scrollIntoViewIfNeeded();
    await expect(page.locator(".maplibregl-canvas").first()).toBeVisible({ timeout: 30_000 });
    await page.waitForLoadState("networkidle");
    expect(violations()).toEqual([]);
  });
}

test("переключатель языка ведёт на /ru и /en", async ({ page }) => {
  await page.goto("/");
  // Переключатель — три ссылки «TJ · RU · EN» в навигации «Язык» (шапка; на телефоне — в листе «Ещё»).
  const switcher = (locale: E2eLocale) =>
    page.getByRole("navigation", { name: t(locale, "common.language") }).first();
  await switcher("tg")
    .getByRole("link", { name: /Русский/ })
    .click();
  await expect(page).toHaveURL(/\/ru$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(t("ru", "home.airNow"));
  await switcher("ru")
    .getByRole("link", { name: /English/ })
    .click();
  await expect(page).toHaveURL(/\/en$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(t("en", "home.airNow"));
});

test("выбор города в шапке запоминается в cookie и меняет полосу состояния", async ({ page }) => {
  await page.goto("/ru");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Душанбе");
  await page.getByRole("button", { name: /Душанбе/ }).click();
  await page.getByRole("menuitem", { name: "Худжанд" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Худжанд");
  const cookie = (await page.context().cookies()).find((c) => c.name === "meteo-city");
  expect(cookie?.value).toBe("khujand");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Худжанд");
});

test.describe("телефон 375 px", () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  for (const locale of locales) {
    test(`главная (${locale}): без горизонтальной прокрутки, слово уровня целиком, нижняя навигация`, async ({
      page,
    }) => {
      await page.goto(`${prefix(locale)}/`);
      await expect(page.getByTestId("status-level")).toBeVisible();
      // Длинные подписи («Удовлетворительное», «Қаноатбахш», «Satisfactory») ужимаются под ширину колонки.
      const level = page.getByTestId("status-level");
      expect(await level.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      // Документ не шире экрана — ни один блок не вылезает за правый край.
      const widths = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth,
        view: document.documentElement.clientWidth,
      }));
      expect(widths.doc).toBeLessThanOrEqual(widths.view);
      // Нижняя навигация из пяти пунктов вместо бургера; язык — в листе «Ещё».
      const bottom = page.getByRole("navigation", { name: t(locale, "common.menu") }).first();
      await expect(bottom).toBeVisible();
      await expect(bottom.getByRole("link")).toHaveCount(4);
      await bottom.getByRole("button", { name: t(locale, "common.more") }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(
        page.getByRole("dialog").getByRole("link", { name: t(locale, "nav.health") }),
      ).toBeVisible();
    });
  }
});
