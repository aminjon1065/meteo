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
