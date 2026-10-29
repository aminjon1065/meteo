import { expect, test } from "@playwright/test";
import { trackCspViolations } from "../helpers/console";
import { type E2eLocale, t } from "../helpers/messages";

/**
 * «SmartMet (SILAM)» (/air/silam): карты FMI идут с внешнего сервера silam.fmi.fi, поэтому тест
 * принимает оба состояния — просмотр карт или сообщение о недоступности FMI; тексты, ссылки
 * и отсутствие нарушений CSP проверяются всегда.
 */
test("/air/silam: карты SILAM от FMI, кнопки показателей и пояснения на трёх языках", async ({
  page,
}) => {
  const violations = trackCspViolations(page);
  for (const locale of ["tg", "ru", "en"] as E2eLocale[]) {
    await page.goto(`${locale === "tg" ? "" : `/${locale}`}/air/silam`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(t(locale, "silamPage.title"));
    for (const key of ["about", "read", "levels", "source"]) {
      await expect(
        page.getByRole("heading", { name: t(locale, `silamPage.${key}.heading`) }),
      ).toBeVisible();
    }
  }

  await page.goto("/ru/air/silam");
  const viewer = page.getByTestId("silam-fmi");
  await expect(viewer.or(page.getByTestId("silam-fmi-unavailable"))).toBeVisible();
  if (await viewer.isVisible()) {
    const img = viewer.locator("img");
    // У AQI только карта индекса (одна картинка), без карты определяющего вещества.
    await expect(img).toHaveCount(1);
    await viewer.getByRole("link", { name: "PM10", exact: true }).click();
    await expect(page).toHaveURL(/[?&]param=PM10\b/);
    await expect(img).toHaveAttribute("src", /^\/silam-fmi\/\d{8}\/PM10\/\d{3}\.png$/);
    // Ползунка нет: час листается колесом мыши над картой и стрелками, когда карта в фокусе.
    await expect(viewer.locator("input[type=range]")).toHaveCount(0);
    const map = viewer.getByRole("slider", { name: t("ru", "silamPage.viewer.time") });
    await map.focus();
    await page.keyboard.press("Home");
    await expect(map).toHaveAttribute("aria-valuenow", "0");
    await map.hover();
    const scrollY = await page.evaluate(() => window.scrollY);
    await page.mouse.wheel(0, 100);
    await expect(map).toHaveAttribute("aria-valuenow", "1");
    await expect(img).toHaveAttribute("src", /\/PM10\/001\.png$/);
    // Над картой колесо листает часы, а не страницу.
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);
    await page.mouse.wheel(0, -100);
    await expect(map).toHaveAttribute("aria-valuenow", "0");
    await page.keyboard.press("ArrowRight");
    await expect(map).toHaveAttribute("aria-valuenow", "1");
  }
  expect(violations()).toEqual([]);
});
