import { defineConfig, devices } from "@playwright/test";
import { resolveE2eEnv } from "./e2e/setup/env.mjs";

/**
 * E2E (docs/04-delivery-plan.md, неделя 8): production-сборка на отдельном порту и отдельной базе
 * `<db>_e2e` (см. e2e/setup/server.mjs). Проекты: setup — вход администратора с настройкой 2FA
 * (storageState), public — публичные сценарии без входа, admin — сценарии админки.
 */
const e2e = resolveE2eEnv();
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.(spec|setup)\.ts$/,
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: 2,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: isCI
    ? [["github"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  outputDir: "test-results",
  use: {
    baseURL: e2e.baseUrl,
    locale: "ru-RU",
    timezoneId: "Asia/Dushanbe",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts$/, use: { ...devices["Desktop Chrome"] } },
    {
      name: "public",
      testMatch: /e2e\/public\/.*\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "admin",
      testMatch: /e2e\/admin\/.*\.spec\.ts$/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/admin.json" },
    },
  ],
  webServer: {
    command: "node e2e/setup/server.mjs",
    url: `${e2e.baseUrl}/api/healthz`,
    reuseExistingServer: !isCI,
    timeout: 420_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
