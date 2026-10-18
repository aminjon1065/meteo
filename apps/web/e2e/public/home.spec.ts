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
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(t(locale, "home.title"));
    const nav = page.getByRole("navigation", { name: t(locale, "common.mainNav") });
    await expect(nav.getByRole("link", { name: t(locale, "nav.air") })).toBeVisible();
    await expect(nav.getByRole("link", { name: t(locale, "nav.weather") })).toBeVisible();
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
  await page.getByRole("button", { name: t("tg", "common.language") }).click();
  await page.getByRole("menuitem", { name: "Русский" }).click();
  await expect(page).toHaveURL(/\/ru$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(t("ru", "home.title"));
  await page.getByRole("button", { name: t("ru", "common.language") }).click();
  await page.getByRole("menuitem", { name: "English" }).click();
  await expect(page).toHaveURL(/\/en$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(t("en", "home.title"));
});
