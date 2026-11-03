import { DISPLAY_KEY, eq } from "@meteo/db";
import { settings } from "@meteo/db/schema";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { closeE2eDb, e2eDb } from "../helpers/db";
import { t } from "../helpers/messages";
import { E2E } from "../setup/fixtures";

/**
 * FR7.1, негативные тесты ролей: оператор и редактор входят сами (без сессии администратора) и
 * получают «доступ запрещён» на чужих страницах, 403 на /api/admin, а server action, вызванный
 * напрямую с их cookie (повтор запроса администратора), не меняет данные.
 */
test.describe.configure({ mode: "serial" });
test.use({ storageState: { cookies: [], origins: [] } });
test.afterAll(async () => {
  await closeE2eDb();
});

type Role = keyof typeof E2E.users;

async function signInAs(page: Page, role: Role): Promise<void> {
  await page.goto("/ru/admin/login");
  await page.getByLabel(t("ru", "auth.email")).fill(E2E.users[role].email);
  await page.getByLabel(t("ru", "auth.password")).fill(E2E.users[role].password);
  await page.getByRole("button", { name: t("ru", "auth.signIn"), exact: true }).click();
  await expect(page).toHaveURL(/\/ru\/admin$/);
}

async function expectForbidden(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page, path).toHaveURL(/\/ru\/admin\/forbidden$/);
  await expect(page.getByRole("heading", { name: t("ru", "auth.forbidden") })).toBeVisible();
}

async function expectAllowed(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page, path).toHaveURL(new RegExp(`${path.replace(/[/]/g, "\\/")}$`));
}

/** Страницы только администратора: пользователи, станции (изменение), шкалы, настройки, аудит… */
const ADMIN_ONLY_PAGES = [
  "/ru/admin/users",
  "/ru/admin/stations/new",
  "/ru/admin/scales",
  "/ru/admin/scales/limits",
  "/ru/admin/health-advice",
  "/ru/admin/alerts",
  "/ru/admin/cap",
  "/ru/admin/subscribers",
  "/ru/admin/settings",
  "/ru/admin/audit",
  "/ru/admin/qc-rules",
];

test("оператор: ввод и QC данных доступны, контент и администрирование — запрет", async ({
  page,
}) => {
  await signInAs(page, "operator");
  for (const path of [
    ...ADMIN_ONLY_PAGES,
    "/ru/admin/news/new",
    "/ru/admin/media",
    "/ru/admin/bulletins/new",
  ]) {
    await expectForbidden(page, path);
  }
  for (const path of [
    "/ru/admin/measurements",
    "/ru/admin/measurements/entry",
    "/ru/admin/measurements/qc",
  ]) {
    await expectAllowed(page, path);
  }
  // Route handlers админки: 403, а не данные.
  expect((await page.request.get("/api/admin/subscribers.csv")).status()).toBe(403);
  expect((await page.request.get("/api/admin/cap/1/xml")).status()).toBe(403);
  const upload = await page.request.post("/api/admin/media", {
    multipart: {
      file: { name: "x.png", mimeType: "image/png", buffer: Buffer.from("89504e47", "hex") },
    },
  });
  expect(upload.status()).toBe(403);
});

test("редактор: контент доступен, данные мониторинга и администрирование — запрет", async ({
  page,
}) => {
  await signInAs(page, "editor");
  for (const path of [
    ...ADMIN_ONLY_PAGES,
    "/ru/admin/measurements",
    "/ru/admin/measurements/entry",
    "/ru/admin/measurements/qc",
  ]) {
    await expectForbidden(page, path);
  }
  for (const path of ["/ru/admin/news", "/ru/admin/news/new", "/ru/admin/media"]) {
    await expectAllowed(page, path);
  }
  expect((await page.request.get("/api/admin/subscribers.csv")).status()).toBe(403);
  expect((await page.request.get("/api/admin/cap/1/xml")).status()).toBe(403);
});

test("без входа: /api/admin — 401, страницы админки — на вход", async ({ page }) => {
  expect((await page.request.get("/api/admin/subscribers.csv")).status()).toBe(401);
  await page.goto("/ru/admin/users");
  await expect(page).toHaveURL(/\/ru\/admin\/login/);
});

test("прямой вызов server action с cookie оператора и редактора отклоняется", async ({
  browser,
}) => {
  const db = e2eDb();
  const displayValue = async () =>
    (await db.select().from(settings).where(eq(settings.key, DISPLAY_KEY)))[0]?.value ?? null;

  // 1. Администратор сохраняет единицы отображения (без изменений) — берём запрос действия.
  const captured = await captureDisplayAction(browser);
  const before = await displayValue();
  expect(before).not.toBeNull();
  const actionId = captured.headers()["next-action"];
  expect(actionId).toBeTruthy();
  const body = captured.postData() ?? "";
  expect(body).toContain("concentrationUnit");
  // Подделка — противоположное значение: если бы проверка прав не сработала, настройка изменилась бы.
  const target = body.includes('"concentrationUnit":"native"') ? "mg/m³" : "native";
  const forged = body.replace(/"concentrationUnit":"[^"]*"/, `"concentrationUnit":"${target}"`);
  expect(forged).not.toBe(body);

  // 2. Тот же запрос с cookie оператора и редактора: редирект на «доступ запрещён», данные прежние.
  for (const role of ["operator", "editor"] as const) {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await signInAs(page, role);
    const res = await page.request.post(new URL(captured.url()).pathname, {
      headers: {
        "Next-Action": actionId as string,
        "Content-Type": captured.headers()["content-type"] ?? "text/plain;charset=UTF-8",
        Accept: "text/x-component",
        Origin: new URL(captured.url()).origin,
      },
      data: forged,
    });
    const redirect = `${res.headers()["x-action-redirect"] ?? ""} ${res.url()}`;
    expect(redirect, `${role}: ответ действия`).toContain("/admin/forbidden");
    expect(await displayValue()).toEqual(before);
    await context.close();
  }
});

async function captureDisplayAction(browser: Browser) {
  const context = await browser.newContext({ storageState: "e2e/.auth/admin.json" });
  const page = await context.newPage();
  await page.goto("/ru/admin/settings");
  const form = page.locator("form").filter({ has: page.locator("#display-concentration-unit") });
  const requestPromise = page.waitForRequest(
    (r) => r.method() === "POST" && Boolean(r.headers()["next-action"]),
  );
  await form.getByRole("button", { name: t("ru", "common.actions.save"), exact: true }).click();
  const request = await requestPromise;
  await expect(page.getByText(t("ru", "settingsAdmin.display.saved")).first()).toBeVisible();
  await context.close();
  return request;
}

test("эндпоинты плагина admin better-auth закрыты по HTTP даже для администратора", async ({
  browser,
}) => {
  const context = await browser.newContext({ storageState: "e2e/.auth/admin.json" });
  for (const path of ["/api/auth/admin/set-role", "/api/auth/admin/ban-user"]) {
    const res = await context.request.post(path, { data: { userId: "x", role: "admin" } });
    expect(res.status(), path).toBe(404);
  }
  await context.close();
});

test("вход и неудачная попытка входа попадают в журнал аудита", async ({ page }) => {
  const db = e2eDb();
  const { auditLog } = await import("@meteo/db/schema");
  const { and, desc } = await import("@meteo/db");
  const email = E2E.users.editor.email;
  const lastAction = async (action: string) =>
    (
      await db
        .select({ action: auditLog.action, actorEmail: auditLog.actorEmail })
        .from(auditLog)
        .where(and(eq(auditLog.action, action), eq(auditLog.actorEmail, email)))
        .orderBy(desc(auditLog.id))
        .limit(1)
    )[0] ?? null;

  await page.goto("/ru/admin/login");
  await page.getByLabel(t("ru", "auth.email")).fill(email);
  await page.getByLabel(t("ru", "auth.password")).fill("wrong-password-123");
  await page.getByRole("button", { name: t("ru", "auth.signIn"), exact: true }).click();
  await expect(page.getByText(t("ru", "auth.invalidCredentials"))).toBeVisible();
  await expect.poll(() => lastAction("auth.signIn.failed")).not.toBeNull();

  await signInAs(page, "editor");
  await expect.poll(() => lastAction("auth.signIn")).not.toBeNull();
});
