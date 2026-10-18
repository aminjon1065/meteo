import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test as setup } from "@playwright/test";
import { t } from "./helpers/messages";
import { totp } from "./helpers/totp";
import { resolveE2eEnv } from "./setup/env.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const ADMIN_STATE = resolve(here, ".auth/admin.json");
const SECRET_FILE = resolve(here, ".auth/admin-totp.secret");
const e2e = resolveE2eEnv();

async function signIn(page: Page): Promise<void> {
  await page.goto("/ru/admin/login");
  await page.getByLabel(t("ru", "auth.email")).fill(e2e.adminEmail);
  await page.getByLabel(t("ru", "auth.password")).fill(e2e.adminPassword);
  await page.getByRole("button", { name: t("ru", "auth.signIn"), exact: true }).click();
}

/**
 * Вход администратора. В свежей базе E2E у admin@meteo.tj нет 2FA: после пароля портал требует
 * настроить TOTP — проходим мастер (пароль → ключ → код), код считаем по RFC 6238 из показанного ключа.
 * Если сервер переиспользован (2FA уже включена), берём ключ из .auth/admin-totp.secret.
 */
setup(
  "администратор входит (с настройкой обязательной 2FA) и сохраняет сессию",
  async ({ page }) => {
    mkdirSync(dirname(ADMIN_STATE), { recursive: true });
    await signIn(page);

    const totpStage = page.getByLabel(t("ru", "auth.totpTitle"));
    const twoFactorSetup = page.locator("#tf-pw");
    await expect(
      totpStage.or(twoFactorSetup).or(page.getByText(t("ru", "admin.title")).first()),
    ).toBeVisible();

    if (await totpStage.isVisible()) {
      // 2FA уже включена в этой базе (сервер переиспользован) — нужен сохранённый ключ.
      if (!existsSync(SECRET_FILE)) {
        throw new Error(
          "У администратора включена 2FA, но ключа в e2e/.auth нет. Перезапустите сервер E2E (prepare-db пересоздаст базу).",
        );
      }
      await totpStage.fill(totp(readFileSync(SECRET_FILE, "utf8").trim()));
      await page.getByRole("button", { name: t("ru", "auth.verify"), exact: true }).click();
    } else if (await twoFactorSetup.isVisible()) {
      await expect(page).toHaveURL(/\/admin\/two-factor/);
      await twoFactorSetup.fill(e2e.adminPassword);
      await page.getByRole("button", { name: t("ru", "twoFactor.start"), exact: true }).click();
      const secretText = (await page.locator("code").first().textContent()) ?? "";
      const secret = secretText.replace(/\s+/g, "");
      expect(secret.length).toBeGreaterThanOrEqual(16);
      writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
      await page.locator("#tf-code").fill(totp(secret));
      await page.getByRole("button", { name: t("ru", "twoFactor.verify"), exact: true }).click();
      await expect(page.getByText(t("ru", "twoFactor.enabled"), { exact: true })).toBeVisible();
    }

    await page.goto("/ru/admin");
    await expect(page).toHaveURL(/\/ru\/admin$/);
    await expect(page.getByText(t("ru", "admin.title")).first()).toBeVisible();
    await page.context().storageState({ path: ADMIN_STATE });
  },
);
