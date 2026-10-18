import { expect, test } from "@playwright/test";
import { t } from "../helpers/messages";
import { E2E } from "../setup/fixtures";

test("/news: список опубликованных новостей и страница новости с JSON-LD", async ({ page }) => {
  await page.goto("/ru/news");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(t("ru", "news.title"));
  const link = page.getByRole("link", { name: E2E.news.title.ru }).first();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/ru/news/${E2E.news.slug}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(E2E.news.title.ru);
  await expect(page.getByRole("heading", { name: "Тестовый текст" })).toBeVisible();
  const jsonLd = await page.locator('script[type="application/ld+json"]').textContent();
  expect(jsonLd).toContain('"NewsArticle"');
  await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute(
    "href",
    new RegExp(`/en/news/${E2E.news.slug}`),
  );
});

test("RSS новостей отдаёт XML с фикстурой", async ({ request }) => {
  const rss = await request.get("/api/v1/news/rss.xml?locale=ru");
  expect(rss.ok()).toBeTruthy();
  expect(rss.headers()["content-type"]).toMatch(/xml/);
  expect(await rss.text()).toContain(E2E.news.title.ru);
});
