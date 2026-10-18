#!/usr/bin/env node
/**
 * Скриншоты интерфейса для руководств (docs/manuals/img/*.png), общие для tg/ru/en.
 *
 *   node docs/manuals/screenshots.mjs prepare   # демо-данные через интерфейс: импорт CSV, пользователи
 *   node docs/manuals/screenshots.mjs capture   # все снимки админки и портала
 *
 * Нужен запущенный портал (production-сборка: PORT=3005 pnpm -C apps/web start) и Chromium Playwright
 * (pnpm --filter @meteo/web exec playwright install chromium). Переменные окружения:
 *   DOCS_BASE_URL       адрес портала (http://localhost:3005)
 *   DOCS_LOCALE         язык интерфейса на снимках (ru)
 *   DOCS_ADMIN_EMAIL / DOCS_ADMIN_PASSWORD  учётная запись администратора (по умолчанию SEED_ADMIN_* из .env)
 *   DOCS_TOTP_SECRET    ключ TOTP, если 2FA уже включена (иначе берётся из файла состояния)
 *   DOCS_DEMO_CSV       CSV для импорта в режиме prepare (по умолчанию генерируется docs/training/make-sample-csv.mjs)
 *   DOCS_STATE_DIR      каталог состояния (сессия, ключ TOTP); по умолчанию во временной папке ОС
 *   DOCS_STEPS          только перечисленные шаги capture, например DOCS_STEPS=map,qc (список — в коде)
 *
 * Если у администратора 2FA ещё не включена, скрипт проходит мастер включения (как E2E) и сохраняет
 * ключ в DOCS_STATE_DIR/totp.secret. Ключ и резервные коды на снимках размываются.
 */
import { createHmac } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const require = createRequire(resolve(repoRoot, "apps/web/package.json"));
const { chromium } = require("@playwright/test");

const mode = process.argv[2] ?? "capture";
if (!["prepare", "capture"].includes(mode)) {
  console.error("Использование: screenshots.mjs prepare | capture");
  process.exit(1);
}

try {
  process.loadEnvFile(resolve(repoRoot, ".env"));
} catch {
  // .env не обязателен, если учётные данные заданы переменными окружения
}

const cfg = {
  baseUrl: (process.env.DOCS_BASE_URL ?? "http://localhost:3005").replace(/\/$/, ""),
  locale: process.env.DOCS_LOCALE ?? "ru",
  email: process.env.DOCS_ADMIN_EMAIL ?? process.env.SEED_ADMIN_EMAIL ?? "admin@meteo.tj",
  password: process.env.DOCS_ADMIN_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD ?? "",
  stateDir: process.env.DOCS_STATE_DIR ?? resolve(tmpdir(), "meteo-docs-screenshots"),
  imgDir: resolve(here, "img"),
  demoCsv: process.env.DOCS_DEMO_CSV ?? "",
};
if (!cfg.password) {
  console.error("Не задан пароль администратора (DOCS_ADMIN_PASSWORD или SEED_ADMIN_PASSWORD).");
  process.exit(1);
}
mkdirSync(cfg.stateDir, { recursive: true });
mkdirSync(cfg.imgDir, { recursive: true });
const STATE_FILE = resolve(cfg.stateDir, "admin-state.json");
const SECRET_FILE = resolve(cfg.stateDir, "totp.secret");

const messages = JSON.parse(
  readFileSync(resolve(repoRoot, `packages/i18n/messages/${cfg.locale}.json`), "utf8"),
);
/** Строка интерфейса по пути "ns.key" (без ICU-интерполяции). */
function t(path) {
  const value = path.split(".").reduce((acc, key) => (acc ? acc[key] : undefined), messages);
  if (typeof value !== "string") throw new Error(`нет перевода ${cfg.locale}:${path}`);
  return value;
}

/* ---------------------------------------------------------------- TOTP (RFC 6238) */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Decode(input) {
  const clean = input.toUpperCase().replace(/[\s=]/g, "");
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error(`base32: недопустимый символ ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
function totp(secret, at = Date.now()) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac("sha1", base32Decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 0x0f;
  const code =
    ((h[o] & 0x7f) << 24) |
    ((h[o + 1] & 0xff) << 16) |
    ((h[o + 2] & 0xff) << 8) |
    (h[o + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}
let lastTotpCounter = -1;
/** Код TOTP, не совпадающий с уже использованным в этом запуске (сервер не принимает код повторно). */
async function freshTotp(secret) {
  let counter = Math.floor(Date.now() / 30_000);
  if (counter === lastTotpCounter) {
    await sleep((counter + 1) * 30_000 - Date.now() + 800);
    counter += 1;
  }
  lastTotpCounter = counter;
  return totp(secret);
}
function totpSecret() {
  if (process.env.DOCS_TOTP_SECRET) return process.env.DOCS_TOTP_SECRET;
  if (existsSync(SECRET_FILE)) return readFileSync(SECRET_FILE, "utf8").trim();
  return null;
}

/* ---------------------------------------------------------------- helpers */
const url = (path) => `${cfg.baseUrl}/${cfg.locale}${path}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function settle(page, ms = 400) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await sleep(ms);
}

/** Ждёт, пока исчезнут всплывающие уведомления (toast). */
async function noToasts(page) {
  await page
    .locator("[data-sonner-toast]")
    .first()
    .waitFor({ state: "hidden", timeout: 8000 })
    .catch(() => {});
}

async function blur(page, selectors) {
  await page.evaluate((list) => {
    for (const sel of list) {
      for (const el of document.querySelectorAll(sel)) {
        el.style.filter = "blur(7px)";
      }
    }
  }, selectors);
}

/** Размывает «листовые» элементы, текст которых подходит под шаблон (резервные коды, ключи). */
async function blurText(page, pattern) {
  await page.evaluate((source) => {
    const re = new RegExp(source);
    for (const el of document.querySelectorAll("body *")) {
      if (el.children.length === 0 && re.test((el.textContent ?? "").trim())) {
        el.style.filter = "blur(6px)";
      }
    }
  }, pattern.source);
}

async function shot(page, name, options = {}) {
  const { fullPage = false, clip } = options;
  if (!clip) await page.evaluate(() => window.scrollTo(0, 0));
  await settle(page);
  const file = resolve(cfg.imgDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage, clip, animations: "disabled" });
  console.info(`  ✓ ${name}.png`);
}

async function selectByText(select, re) {
  const option = select.locator("option", { hasText: re }).first();
  const value = await option.getAttribute("value");
  if (value === null) throw new Error(`option ${re} не найден`);
  await select.selectOption(value);
}

/* ---------------------------------------------------------------- вход администратора */
const BACKUP_CODE = /^[A-Za-z0-9]{4,8}-[A-Za-z0-9]{4,8}$/;

/** Вход; возвращает true, если пришлось пройти мастер включения 2FA. */
async function signIn(page, { shots } = { shots: false }) {
  let wizard = false;
  await page.goto(url("/admin/login"));
  await settle(page);
  if (shots) await shot(page, "admin-login");
  await page.getByLabel(t("auth.email")).fill(cfg.email);
  await page.getByLabel(t("auth.password")).fill(cfg.password);
  await page.getByRole("button", { name: t("auth.signIn"), exact: true }).click();

  const totpInput = page.getByLabel(t("auth.totpTitle"));
  const setupPassword = page.locator("#tf-pw");
  const adminTitle = page.getByText(t("admin.title")).first();
  await totpInput.or(setupPassword).or(adminTitle).waitFor({ timeout: 30_000 });

  if (await totpInput.isVisible()) {
    const secret = totpSecret();
    if (!secret) {
      throw new Error(
        "У администратора включена 2FA, а ключ TOTP неизвестен: задайте DOCS_TOTP_SECRET или сбросьте 2FA в «Пользователи».",
      );
    }
    if (shots) await shot(page, "admin-login-2fa");
    await totpInput.fill(await freshTotp(secret));
    await page.getByRole("button", { name: t("auth.verify"), exact: true }).click();
    await page.waitForURL((u) => !u.pathname.includes("/admin/login"), { timeout: 30_000 });
  } else if (await setupPassword.isVisible()) {
    // Обязательная 2FA ещё не включена — проходим мастер и сохраняем ключ.
    wizard = true;
    if (shots) await shot(page, "admin-2fa-required");
    await setupPassword.fill(cfg.password);
    await page.getByRole("button", { name: t("twoFactor.start"), exact: true }).click();
    const code = page.locator("code").first();
    await code.waitFor({ timeout: 30_000 });
    const secret = ((await code.textContent()) ?? "").replace(/\s+/g, "");
    if (secret.length < 16) throw new Error("не удалось прочитать ключ TOTP со страницы");
    writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
    if (shots) {
      await blur(page, [`[aria-label="${t("twoFactor.qrAlt")}"]`, "code", "svg[role=img]"]);
      await blurText(page, BACKUP_CODE);
      await shot(page, "admin-2fa-scan", { fullPage: true });
    }
    await page.locator("#tf-code").fill(await freshTotp(secret));
    await page.getByRole("button", { name: t("twoFactor.verify"), exact: true }).click();
    await page.getByText(t("twoFactor.enabled"), { exact: true }).waitFor({ timeout: 30_000 });
    if (shots) {
      await noToasts(page);
      await blur(page, ["code"]);
      await blurText(page, BACKUP_CODE);
      await shot(page, "admin-2fa-backup-codes");
    }
  }
  await page.goto(url("/admin"));
  try {
    await page.getByText(t("admin.title")).first().waitFor({ timeout: 30_000 });
  } catch (error) {
    const failure = resolve(cfg.stateDir, "login-failure.png");
    await page.screenshot({ path: failure, fullPage: true }).catch(() => {});
    const text = await page
      .locator("body")
      .innerText()
      .catch(() => "");
    console.error(`вход не удался (снимок: ${failure}):\n${text.slice(0, 600)}`);
    throw error;
  }
  await page.context().storageState({ path: STATE_FILE });
  return wizard;
}

async function adminContext(browser, { shots } = { shots: false }) {
  const base = {
    viewport: { width: 1280, height: 800 },
    locale: cfg.locale === "tg" ? "tg-TJ" : cfg.locale === "en" ? "en-GB" : "ru-RU",
    timezoneId: "Asia/Dushanbe",
    colorScheme: "light",
    reducedMotion: "reduce",
  };
  let context;
  if (existsSync(STATE_FILE)) {
    context = await browser.newContext({ ...base, storageState: STATE_FILE });
    const page = await context.newPage();
    await page.goto(url("/admin"));
    const ok = await page
      .getByText(t("admin.title"))
      .first()
      .waitFor({ timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (ok && !shots) return { context, page };
    await context.close();
  }
  context = await browser.newContext(base);
  let page = await context.newPage();
  const wizard = await signIn(page, { shots });
  if (wizard && shots) {
    // 2FA только что включена: повторный вход с другого «устройства» даёт снимок запроса кода.
    await context.close();
    context = await browser.newContext(base);
    page = await context.newPage();
    await signIn(page, { shots });
  }
  return { context, page };
}

/* ---------------------------------------------------------------- импорт CSV */
async function importCsv(page, file, { apply, shots }) {
  await page.goto(url("/admin/measurements/import"));
  await page.locator("#file").setInputFiles(file);
  if (shots) await shot(page, "admin-import-step1");
  await page.getByRole("button", { name: t("measurements.import.preview"), exact: true }).click();
  await page.getByText(t("measurements.import.reportTitle")).waitFor({ timeout: 60_000 });
  if (shots) await shot(page, "admin-import-report", { fullPage: true });
  const applyRe = new RegExp(`^${t("measurements.import.apply").replace(" ({count})", "")}`);
  if (apply) {
    await page.getByRole("button", { name: applyRe }).click();
    await page.locator("[data-sonner-toast]").first().waitFor({ timeout: 60_000 });
    console.info("  импорт применён");
  } else {
    await page.getByRole("button", { name: t("measurements.import.cancel"), exact: true }).click();
  }
  await noToasts(page);
}

/* ---------------------------------------------------------------- prepare */
async function prepare(browser) {
  const { context, page } = await adminContext(browser, { shots: true });
  let csv = cfg.demoCsv;
  if (!csv) {
    csv = resolve(cfg.stateDir, "measurements-demo.csv");
    const { makeSampleCsv } = await import(resolve(repoRoot, "docs/training/make-sample-csv.mjs"));
    writeFileSync(csv, makeSampleCsv({ stations: ["DU-01", "SU-01", "KT-01"], minute: 30 }));
  }
  console.info(`импорт ${csv}`);
  await importCsv(page, csv, { apply: true, shots: true });

  // Пользователи для снимков: оператор и редактор (пароли показываются только в диалоге).
  await page.goto(url("/admin/users"));
  for (const u of [
    { name: "Оператор мониторинга", email: "operator.demo@meteo.tj", role: "operator" },
    { name: "Редактор новостей", email: "editor.demo@meteo.tj", role: "editor" },
  ]) {
    if (
      await page
        .getByText(u.email)
        .first()
        .isVisible()
        .catch(() => false)
    )
      continue;
    await page.getByRole("button", { name: t("usersAdmin.create"), exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("#nu-name").fill(u.name);
    await dialog.locator("#nu-email").fill(u.email);
    await dialog.locator("#nu-role").selectOption(u.role);
    await dialog.getByRole("button", { name: t("usersAdmin.generate"), exact: true }).click();
    if (u.role === "operator") {
      await blur(page, ["#nu-password"]);
      await shot(page, "admin-user-create");
    }
    await dialog.locator("button[type=submit]").click();
    await dialog.waitFor({ state: "hidden", timeout: 30_000 });
    await noToasts(page);
  }
  await context.close();
}

/* ---------------------------------------------------------------- шаги с продолжением при ошибке */
const failures = [];
const onlySteps = process.env.DOCS_STEPS ? process.env.DOCS_STEPS.split(",") : null;
/** Шаг снимков; DOCS_STEPS=map,qc ограничивает запуск перечисленными шагами. */
async function step(name, fn) {
  if (onlySteps && !onlySteps.includes(name)) return;
  try {
    await fn();
  } catch (error) {
    failures.push(name);
    console.error(`  ✗ ${name}: ${error instanceof Error ? error.message.split("\n")[0] : error}`);
  }
}

/** Первая ссылка на странице, подходящая под шаблон href. */
async function firstHref(page, re) {
  return page.locator("a[href]").evaluateAll((els, source) => {
    const r = new RegExp(source);
    return els.map((e) => e.getAttribute("href") ?? "").find((h) => r.test(h)) ?? null;
  }, re.source);
}

/* ---------------------------------------------------------------- capture: админка */
async function captureAdmin(browser) {
  const { context, page } = await adminContext(browser, { shots: true });

  await step("dashboard", async () => {
    await page.goto(url("/admin"));
    await shot(page, "admin-dashboard", { fullPage: true });
  });

  await step("stations", async () => {
    await page.goto(url("/admin/stations"));
    await shot(page, "admin-stations");
    const href = await firstHref(page, /\/admin\/stations\/\d+$/);
    if (href) {
      await page.goto(`${cfg.baseUrl}${href}`);
      await shot(page, "admin-station-edit", { fullPage: true });
    }
  });

  await step("station-new", async () => {
    await page.goto(url("/admin/stations/new"));
    await page.locator("#code").fill("GB-01");
    await page.locator("#name-ru").fill("Хорог, пост № 1");
    await page.locator("#lat").fill("37.49");
    await page.locator("#lon").fill("71.55");
    await selectByText(page.locator("#regionId"), /Бадахшан/);
    await shot(page, "admin-station-new", { fullPage: true });
  });

  await step("measurements", async () => {
    await page.goto(url("/admin/measurements"));
    await shot(page, "admin-measurements");
  });

  await step("entry", async () => {
    await page.goto(url("/admin/measurements/entry"));
    await selectByText(page.locator("#station"), /DU-01/);
    for (const [label, value] of [
      ["07:00 PM2.5", "42,5"],
      ["07:00 PM10", "88"],
      ["07:00 NO₂", "31"],
      ["13:00 PM2.5", "37,1"],
    ]) {
      await page
        .getByLabel(label, { exact: true })
        .fill(value)
        .catch(() => {});
    }
    await shot(page, "admin-entry", { fullPage: true });
  });

  await step("import", async () => {
    const demoCsv = resolve(cfg.stateDir, "measurements-demo.csv");
    if (existsSync(demoCsv)) await importCsv(page, demoCsv, { apply: false, shots: true });
  });

  await step("browse", async () => {
    await page.goto(url("/admin/measurements/browse"));
    await shot(page, "admin-browse");
  });

  await step("qc", async () => {
    await page.goto(url("/admin/measurements/qc"));
    await shot(page, "admin-qc");
    const correct = page.getByRole("button", { name: t("qc.correct"), exact: true }).first();
    if (await correct.isVisible().catch(() => false)) {
      await correct.click();
      await page.getByRole("dialog").waitFor();
      await page
        .getByLabel(t("qc.newValue"))
        .fill("48")
        .catch(() => {});
      await page
        .getByLabel(t("qc.reasonLabel"))
        .fill("Ошибка ввода: лишний ноль, перепроверено по журналу поста")
        .catch(() => {});
      await shot(page, "admin-qc-correct");
      await page.keyboard.press("Escape");
    }
  });

  await step("audit", async () => {
    await page.goto(url("/admin/audit"));
    await shot(page, "admin-audit");
  });

  await step("scales", async () => {
    await page.goto(url("/admin/scales"));
    await shot(page, "admin-scales");
    const href = await firstHref(page, /\/admin\/scales\/\d+$/);
    if (href) {
      await page.goto(`${cfg.baseUrl}${href}`);
      await shot(page, "admin-scale-edit", { fullPage: true });
    }
    await page.goto(url("/admin/scales/limits"));
    await shot(page, "admin-limits");
  });

  await step("health-advice", async () => {
    await page.goto(url("/admin/health-advice"));
    await shot(page, "admin-health-advice");
  });

  await step("alerts", async () => {
    await page.goto(url("/admin/alerts"));
    await shot(page, "admin-alerts");
    await page.goto(url("/admin/alerts/new"));
    await page.locator("#name").fill("PM2.5 выше 50 µg/m³ (Душанбе)");
    await page.locator("#kind").selectOption("pollutant");
    await selectByText(page.locator("#pollutantId"), /PM2\.5/);
    await page.locator("#threshold").fill("50");
    await page.locator("#averagingMin").selectOption("60");
    await page.locator("#scope").selectOption("station");
    await selectByText(page.locator("#stationId"), /DU-01/);
    await page.locator("#cooldownMin").fill("120");
    await shot(page, "admin-alert-new", { fullPage: true });
    await page.goto(url("/admin/alerts/events"));
    await shot(page, "admin-alert-events");
  });

  await step("cap", async () => {
    await page.goto(url("/admin/cap"));
    await shot(page, "admin-cap");
    const href = await firstHref(page, /\/admin\/cap\/\d+$/);
    if (href) {
      await page.goto(`${cfg.baseUrl}${href}`);
      await shot(page, "admin-cap-detail", { fullPage: true });
    }
    await page.goto(url("/admin/cap/events"));
    await shot(page, "admin-cap-events");
  });

  await step("news", async () => {
    await page.goto(url("/admin/news"));
    await shot(page, "admin-news");
    const href = await firstHref(page, /\/admin\/news\/\d+$/);
    if (href) {
      await page.goto(`${cfg.baseUrl}${href}`);
      await shot(page, "admin-news-edit", { fullPage: true });
    }
    await page.goto(url("/admin/news/categories"));
    await shot(page, "admin-news-categories");
  });

  await step("media", async () => {
    await page.goto(url("/admin/media"));
    await shot(page, "admin-media");
  });

  await step("bulletins", async () => {
    await page.goto(url("/admin/bulletins"));
    await shot(page, "admin-bulletins");
    await page.goto(url("/admin/bulletins/new"));
    await shot(page, "admin-bulletin-new", { fullPage: true });
  });

  await step("subscribers", async () => {
    await page.goto(url("/admin/subscribers"));
    await shot(page, "admin-subscribers");
  });

  await step("users", async () => {
    await page.goto(url("/admin/users"));
    await shot(page, "admin-users");
    const row = page.getByRole("row").filter({ hasText: "operator.demo@meteo.tj" }).first();
    const actions = row.getByRole("button").last();
    if (await actions.isVisible().catch(() => false)) {
      await actions.click();
      await page.getByRole("menu").waitFor({ timeout: 5000 });
      await shot(page, "admin-user-actions");
      await page.keyboard.press("Escape");
    }
  });

  await step("settings", async () => {
    await page.goto(url("/admin/settings"));
    await shot(page, "admin-settings", { fullPage: true });
  });

  await step("two-factor-page", async () => {
    await page.goto(url("/admin/two-factor"));
    await blurText(page, BACKUP_CODE);
    await shot(page, "admin-two-factor-page", { fullPage: true });
  });

  await context.close();
}

/* ---------------------------------------------------------------- capture: портал */
async function waitCanvas(page, selector) {
  const block = page.locator(selector).first();
  if (!(await block.isVisible().catch(() => false))) return;
  await block.scrollIntoViewIfNeeded().catch(() => {});
  await block
    .locator("canvas")
    .first()
    .waitFor({ timeout: 30_000 })
    .catch(() => {});
  await sleep(1500);
}

async function capturePublic(browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: "ru-RU",
    timezoneId: "Asia/Dushanbe",
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();

  await step("home", async () => {
    await page.goto(url("/"));
    await shot(page, "user-home");
    await shot(page, "user-home-full", { fullPage: true });
  });

  await step("language", async () => {
    await page
      .getByRole("button", { name: t("common.language") })
      .first()
      .click();
    await page
      .getByRole("menu")
      .waitFor({ timeout: 5000 })
      .catch(() => {});
    await shot(page, "user-language", { clip: { x: 0, y: 0, width: 1280, height: 320 } });
    await page.keyboard.press("Escape");
  });

  await step("air", async () => {
    await page.goto(url("/air"));
    await shot(page, "user-air");
  });

  await step("station", async () => {
    await page.goto(url("/air/stations/dushanbe-post-no-1"));
    await waitCanvas(page, "[data-deferred='chart']");
    await shot(page, "user-station", { fullPage: true });
    const chart = page.locator("[data-deferred='chart']").first();
    if (await chart.isVisible().catch(() => false)) {
      await chart.scrollIntoViewIfNeeded();
      await sleep(500);
      const box = await chart.boundingBox();
      if (box) {
        await shot(page, "user-station-chart", {
          clip: {
            x: Math.max(0, box.x - 8),
            y: Math.max(0, box.y - 8),
            width: Math.min(1280, box.width + 16),
            height: Math.min(800, box.height + 16),
          },
        });
      }
    }
  });

  await step("map", async () => {
    await page.goto(url("/map"));
    await waitCanvas(page, "[data-deferred='map']");
    const silamToggle = page.getByRole("checkbox", { name: t("map.silam") }).first();
    if (await silamToggle.isVisible().catch(() => false)) {
      await silamToggle.click();
      await sleep(2500);
    }
    await shot(page, "user-map");
  });

  await step("weather", async () => {
    await page.goto(url("/weather"));
    await shot(page, "user-weather", { fullPage: true });
    await page.goto(url("/weather/dushanbe"));
    await waitCanvas(page, "[data-deferred='weather-chart']");
    await shot(page, "user-weather-city", { fullPage: true });
  });

  await step("warnings", async () => {
    await page.goto(url("/warnings"));
    await shot(page, "user-warnings", { fullPage: true });
  });

  await step("news", async () => {
    await page.goto(url("/news"));
    await shot(page, "user-news");
  });

  await step("health", async () => {
    await page.goto(url("/health"));
    await shot(page, "user-health", { fullPage: true });
  });

  await step("subscribe", async () => {
    await page.goto(url("/subscribe"));
    await shot(page, "user-subscribe", { fullPage: true });
  });

  await step("data", async () => {
    await page.goto(url("/data"));
    await shot(page, "user-data", { fullPage: true });
    await page.goto(url("/data/api"));
    await shot(page, "user-api");
  });

  await step("about-index", async () => {
    await page.goto(url("/air/index"));
    await shot(page, "user-about-index", { fullPage: true });
  });

  await step("embed", async () => {
    await page.setViewportSize({ width: 420, height: 300 });
    await page.goto(url("/embed/aqi?station=dushanbe-post-no-1"));
    await shot(page, "user-embed-aqi");
    await page.goto(url("/embed/forecast?location=dushanbe"));
    await shot(page, "user-embed-forecast");
    await page.setViewportSize({ width: 420, height: 420 });
    await page.goto(url("/embed/alerts"));
    await shot(page, "user-embed-alerts");
  });

  await step("mobile", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url("/"));
    await shot(page, "user-mobile-home");
  });

  await context.close();
}

/* ---------------------------------------------------------------- main */
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader"] });
try {
  if (mode === "prepare") {
    await prepare(browser);
  } else {
    await captureAdmin(browser);
    await capturePublic(browser);
  }
} finally {
  await browser.close();
}
if (failures.length) {
  console.error(`Не удались шаги: ${failures.join(", ")}`);
  process.exitCode = 1;
}
console.info(`Готово: ${cfg.imgDir}`);
