import { localDateOf, shiftIsoDate } from "@meteo/core";
import { eq } from "@meteo/db";
import { ecoBulletins, newsPosts } from "@meteo/db/schema";
import { expect, test } from "@playwright/test";
import { closeE2eDb, e2eDb } from "../helpers/db";
import { selectByText } from "../helpers/forms";
import { t } from "../helpers/messages";
import { E2E } from "../setup/fixtures";

test.afterAll(async () => {
  await closeE2eDb();
});

/**
 * Экобюллетень: расчёт за вчерашние сутки по станции E2E (48 часов данных в фикстурах),
 * гамма‑фон, скачивание DOCX/HTML, публикация → архив портала, новость и публичные файлы.
 */
test("экобюллетень: формирование, гамма-фон, скачивание DOCX, публикация и архив на портале", async ({
  page,
}) => {
  const date = shiftIsoDate(localDateOf(new Date()), -1);
  await page.goto("/ru/admin/eco-bulletins");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(t("ru", "ecoBulletin.title"));
  await page.locator("#date").fill(date);
  await selectByText(page.locator("#stationId"), /E2E-DU-01/);
  await page.getByRole("button", { name: t("ru", "ecoBulletin.generate"), exact: true }).click();
  await expect(page).toHaveURL(/\/ru\/admin\/eco-bulletins\/\d+(\?.*)?$/);
  const id = Number(/eco-bulletins\/(\d+)/.exec(page.url())?.[1]);
  expect(id).toBeGreaterThan(0);

  // Предпросмотр бюллетеня города (ru): таблица с веществами станции и текст сравнения.
  const preview = page.getByTestId("eco-doc-preview");
  await expect(preview).toContainText("ЭКОЛОГИЧЕСКИЙ БЮЛЛЕТЕНЬ");
  await expect(preview).toContainText("Взвешенные частицы РМ-10");
  await expect(preview).toContainText("Диоксид азота");
  await expect(preview).toContainText("среднесуточных концентраций");
  await expect(page.getByTestId("eco-status")).toHaveText(t("ru", "ecoBulletin.status.draft"));

  // Гамма‑фон попадает в документ.
  await page.locator("#gamma").fill("0,014");
  await page.getByRole("button", { name: t("ru", "ecoBulletin.saveGamma"), exact: true }).click();
  await expect(page.locator("[data-sonner-toast]").first()).toContainText(
    t("ru", "ecoBulletin.gammaSaved"),
  );
  await expect(preview).toContainText("0,014 мР/ч");

  // Таджикская версия и форма 4а.
  await page.goto(`/ru/admin/eco-bulletins/${id}?doc=city&lang=tg`);
  await expect(page.getByTestId("eco-doc-preview")).toContainText("Шарҳи ҳолати ифлосшавии ҳаво");
  await page.goto(`/ru/admin/eco-bulletins/${id}?doc=form4a&lang=tg`);
  await expect(page.getByTestId("eco-doc-preview")).toContainText("Намунаи 4а");

  // Скачивание: DOCX (ZIP‑сигнатура PK) и HTML.
  const docx = await page.request.get(`/api/admin/eco-bulletins/${id}/city-ru.docx`);
  expect(docx.status()).toBe(200);
  expect(docx.headers()["content-type"]).toContain("wordprocessingml");
  expect(docx.headers()["content-disposition"]).toContain(`eco-bulletin-${date}-city-ru.docx`);
  const bytes = await docx.body();
  expect(bytes.subarray(0, 2).toString("latin1")).toBe("PK");
  expect(bytes.length).toBeGreaterThan(2000);
  const html = await page.request.get(`/api/admin/eco-bulletins/${id}/summary-ru.html`);
  expect(html.status()).toBe(200);
  expect(await html.text()).toContain("Загрязнение атмосферного воздуха");
  // До публикации документы недоступны публично.
  expect((await page.request.get(`/api/v1/eco-bulletins/${id}/city-ru.docx`)).status()).toBe(404);

  // Публикация → статус, новость и файлы в архиве портала.
  await page.goto(`/ru/admin/eco-bulletins/${id}`);
  await page.getByRole("button", { name: t("ru", "ecoBulletin.publish"), exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: t("ru", "ecoBulletin.publish"), exact: true })
    .click();
  await expect(page.locator("[data-sonner-toast]").first()).toContainText(
    t("ru", "ecoBulletin.published"),
  );
  await expect(page.getByTestId("eco-status")).toHaveText(t("ru", "ecoBulletin.status.published"));

  const db = e2eDb();
  const [row] = await db.select().from(ecoBulletins).where(eq(ecoBulletins.id, id));
  expect(row?.status).toBe("published");
  expect(row?.gamma).toBe("0,014");
  expect(row?.files.map((f) => f.name)).toEqual(
    expect.arrayContaining(["city-tg.docx", "city-ru.docx", "summary-tg.docx", "form4a-ru.docx"]),
  );
  expect(row?.postId).not.toBeNull();
  const [post] = await db
    .select()
    .from(newsPosts)
    .where(eq(newsPosts.id, row?.postId ?? 0));
  expect(post?.status).toBe("published");
  expect(post?.slug).toContain(E2E.station.slug);

  // Публичный архив, страница бюллетеня и файлы.
  await page.goto("/ru/air/bulletins");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    t("ru", "ecoBulletin.public.title"),
  );
  // Кнопка-ссылка Base UI (render={<Link/>}) имеет role="button", поэтому ищем по тексту.
  await page.getByText(t("ru", "ecoBulletin.public.view"), { exact: true }).first().click();
  await expect(page).toHaveURL(new RegExp(`/ru/air/bulletins/${id}`));
  await expect(page.getByTestId("eco-doc-preview")).toContainText("0,014 мР/ч");
  const publicDocx = await page.request.get(`/api/v1/eco-bulletins/${id}/city-tg.docx`);
  expect(publicDocx.status()).toBe(200);
  expect((await publicDocx.body()).subarray(0, 2).toString("latin1")).toBe("PK");
  const publicHtml = await page.request.get(`/api/v1/eco-bulletins/${id}/form4a-ru.html`);
  expect(publicHtml.status()).toBe(200);
  expect(await publicHtml.text()).toContain("Форма 4а");
});
