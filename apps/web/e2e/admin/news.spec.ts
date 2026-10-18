import { eq } from "@meteo/db";
import { newsPosts } from "@meteo/db/schema";
import { expect, test } from "@playwright/test";
import { closeE2eDb, e2eDb } from "../helpers/db";
import { t } from "../helpers/messages";

test.afterAll(async () => {
  await closeE2eDb();
});

test("новость: черновик из формы → публикация кнопкой → видна на портале", async ({ page }) => {
  const stamp = Date.now().toString().slice(-6);
  const slug = `e2e-admin-news-${stamp}`;
  const title = `Новость из админки ${stamp}`;
  await page.goto("/ru/admin/news/new");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(t("ru", "newsAdmin.new"));
  await page.locator("#title-ru").fill(title);
  await page.locator("#excerpt-ru").fill("Анонс новости, созданной сквозным тестом.");
  await page
    .locator("#body-ru")
    .fill("## Публикация\n\nТекст новости в **Markdown** из формы админки.");
  await page.locator("#slug").fill(slug);
  await page.locator("#categoryId").selectOption({ label: "Новости" });
  await page.getByRole("button", { name: t("ru", "common.actions.save") }).click();
  await expect(page).toHaveURL(/\/ru\/admin\/news\/\d+$/);

  const db = e2eDb();
  const [draft] = await db.select().from(newsPosts).where(eq(newsPosts.slug, slug));
  expect(draft?.status).toBe("draft");

  // Черновик не виден публично.
  const hidden = await page.request.get(`/ru/news/${slug}`);
  expect(hidden.status()).toBe(404);

  await page.getByRole("button", { name: t("ru", "newsAdmin.publish"), exact: true }).click();
  await expect(page.locator("[data-sonner-toast]").first()).toContainText(
    t("ru", "newsAdmin.saved"),
  );
  await expect(
    page.getByRole("button", { name: t("ru", "newsAdmin.unpublish"), exact: true }),
  ).toBeVisible();
  const [published] = await db.select().from(newsPosts).where(eq(newsPosts.slug, slug));
  expect(published?.status).toBe("published");
  expect(published?.publishedAt).not.toBeNull();

  await page.goto("/ru/news");
  await expect(page.getByRole("link", { name: title }).first()).toBeVisible();
  await page.goto(`/ru/news/${slug}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  await expect(page.getByRole("heading", { name: "Публикация" })).toBeVisible();
  await expect(page.locator("strong", { hasText: "Markdown" })).toBeVisible();
});
