import { expect, test } from "@playwright/test";
import { trackCspViolations } from "../helpers/console";
import { t } from "../helpers/messages";

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
