#!/usr/bin/env node
/**
 * Скриншоты интерфейса для руководств (docs/manuals/img/*.png), общие для tg/ru/en.
 *
 *   node docs/manuals/screenshots.mjs prepare   # демо-данные через интерфейс: импорт CSV, пользователи, приём по API
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
 *   DOCS_INGEST_STATION код станции для демо‑приёма по API и снимков раздела 4.3 руководства (DU-01)
 *   DOCS_STEPS          только перечисленные шаги, например DOCS_STEPS=map,qc (список — в коде); действует
 *                       и для prepare (import, users, ingest); снимки входа и 2FA — шаг login
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
  ingestStation: process.env.DOCS_INGEST_STATION ?? "DU-01",
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

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Область окна, охватывающая прямоугольники с отступом (для clip). */
function clipAround(boxes, viewport, pad = 12) {
  const x = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad);
  const y = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad);
  const right = Math.min(viewport.width, Math.max(...boxes.map((b) => b.x + b.width)) + pad);
  const bottom = Math.min(viewport.height, Math.max(...boxes.map((b) => b.y + b.height)) + pad);
  return { x, y, width: right - x, height: bottom - y };
}

/** Снимок верха страницы, обрезанный до перечисленных элементов (заголовок + карточка и т. п.). */
async function shotRegion(page, locators, name) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await settle(page);
  const boxes = (await Promise.all(locators.map((l) => l.boundingBox()))).filter(Boolean);
  if (boxes.length === 0) throw new Error(`${name}: элементы для снимка не найдены`);
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
  await shot(page, name, { clip: clipAround(boxes, viewport) });
}

/** Снимок одного элемента (карточки) целиком: окно временно увеличивается, если элемент выше него. */
async function shotElement(locator, name) {
  const page = locator.page();
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
  const size = await locator.boundingBox();
  if (size && size.height + 48 > viewport.height) {
    await page.setViewportSize({
      width: viewport.width,
      height: Math.min(4000, Math.ceil(size.height) + 48),
    });
  }
  await locator.scrollIntoViewIfNeeded();
  await settle(page);
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${name}: элемент для снимка не найден`);
  await shot(page, name, {
    clip: clipAround([box], page.viewportSize() ?? viewport),
  });
  await page.setViewportSize(viewport);
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

/* ---------------------------------------------------------------- шаги с продолжением при ошибке */
const failures = [];
const onlySteps = process.env.DOCS_STEPS ? process.env.DOCS_STEPS.split(",") : null;
/** Снимки входа и 2FA делаются при полном прогоне или по шагу login. */
const loginShots = !onlySteps || onlySteps.includes("login");
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

/* ---------------------------------------------------------------- демо‑приём по API (раздел 4.3) */
/** Идентификатор станции по коду — через публичный API портала. */
async function stationIdByCode(code) {
  const res = await fetch(`${cfg.baseUrl}/api/v1/stations`);
  if (!res.ok) throw new Error(`/api/v1/stations: HTTP ${res.status}`);
  const { features } = await res.json();
  const found = features.find((f) => f.properties?.code === code);
  if (!found) throw new Error(`станция ${code} не найдена (DOCS_INGEST_STATION)`);
  return found.properties.id;
}

/** Новый ключ API через карточку станции («Сгенерировать ключ» / «Обновить ключ»); прежний ключ перестаёт действовать. */
async function rotateApiKey(page, stationId) {
  await page.goto(url(`/admin/stations/${stationId}`));
  const card = page.locator("[data-slot=card]").filter({
    has: page.locator("[data-slot=card-title]", { hasText: t("stations.apiKey.title") }),
  });
  const buttonName = new RegExp(
    `^(${escapeRe(t("stations.apiKey.generate"))}|${escapeRe(t("stations.apiKey.rotate"))})$`,
  );
  await card.getByRole("button", { name: buttonName }).click();
  const key = card.getByText(/^mst_[A-Za-z0-9_-]+$/);
  await key.waitFor({ timeout: 30_000 });
  await noToasts(page);
  return ((await key.textContent()) ?? "").trim();
}

/** Демонстрационные измерения за последние три часа с шагом 20 минут — как их прислал бы агент станции. */
function demoIngestRecords(now = Date.now()) {
  const STEP = 20 * 60_000;
  const last = Math.floor(now / STEP) * STEP - STEP;
  const series = {
    PM25: [34, 6, 1],
    PM10: [71, 12, 1],
    NO2: [28, 7, 1],
    SO2: [8, 2, 1],
    CO: [0.9, 0.2, 2],
    O3: [52, 9, 1],
  };
  const records = [];
  for (let i = 9; i >= 0; i -= 1) {
    const time = new Date(last - i * STEP).toISOString();
    for (const [pollutant, [base, amplitude, digits]] of Object.entries(series)) {
      const value = Number((base + amplitude * Math.sin((i + base) / 2)).toFixed(digits));
      records.push({ time, pollutant, value });
    }
  }
  return records;
}

/** POST /api/v1/ingest/{code} с заголовками агента станции. */
async function postDemoIngest(stationCode, apiKey) {
  const agent = JSON.parse(
    readFileSync(resolve(repoRoot, "apps/station-agent/package.json"), "utf8"),
  );
  const res = await fetch(`${cfg.baseUrl}/api/v1/ingest/${stationCode}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "user-agent": `meteo-station-agent/${agent.version} (${stationCode}; node ${process.version})`,
    },
    body: JSON.stringify(demoIngestRecords()),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(
      `ingest ${stationCode}: HTTP ${res.status} ${body.message ?? body.error ?? ""}`,
    );
  console.info(`  приём ${stationCode}: принято ${body.accepted}, отклонено ${body.rejected}`);
}

/** Демо‑приём для снимков раздела 4.3: ключ API через карточку и отправка измерений от имени агента. */
async function prepareIngest(page) {
  const id = await stationIdByCode(cfg.ingestStation);
  const apiKey = await rotateApiKey(page, id);
  await postDemoIngest(cfg.ingestStation, apiKey);
}

/* ---------------------------------------------------------------- prepare */
async function prepare(browser) {
  const { context, page } = await adminContext(browser, { shots: loginShots });

  await step("import", async () => {
    let csv = cfg.demoCsv;
    if (!csv) {
      csv = resolve(cfg.stateDir, "measurements-demo.csv");
      const { makeSampleCsv } = await import(
        resolve(repoRoot, "docs/training/make-sample-csv.mjs")
      );
      writeFileSync(csv, makeSampleCsv({ stations: ["DU-01", "SU-01", "KT-01"], minute: 30 }));
    }
    console.info(`импорт ${csv}`);
    await importCsv(page, csv, { apply: true, shots: true });
  });

  // Пользователи для снимков: оператор и редактор (пароли показываются только в диалоге).
  await step("users", async () => {
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
  });

  // Раздел 4.3 руководства: ключ API станции и измерения, отправленные как агентом станции.
  await step("ingest", () => prepareIngest(page));

  await context.close();
}

/* ---------------------------------------------------------------- capture: админка */
async function captureAdmin(browser) {
  const { context, page } = await adminContext(browser, { shots: loginShots });

  await step("dashboard", async () => {
    await page.goto(url("/admin"));
    await shot(page, "admin-dashboard", { fullPage: true });
  });

  await step("dashboard-ingest", async () => {
    await page.goto(url("/admin"));
    const table = page.getByRole("table", { name: t("admin.freshness.title") });
    await table.waitFor({ timeout: 30_000 });
    await shotElement(
      table.locator("xpath=ancestor::*[@data-slot='card'][1]"),
      "admin-dashboard-ingest",
    );
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

  // Раздел 4.3: блок «Автоматический приём данных» после демо‑приёма (prepare, шаг ingest).
  await step("station-ingest", async () => {
    const id = await stationIdByCode(cfg.ingestStation);
    await page.goto(url(`/admin/stations/${id}`));
    const card = page.locator("[data-testid=station-ingest-card]");
    await card.waitFor({ timeout: 30_000 });
    const header = page.locator("h1").first().locator("xpath=ancestor::div[2]");
    await shotRegion(page, [header, card], "admin-station-ingest");
  });

  // Раздел 4.3: открытая форма «Добавить источник» с примером SFTP (не сохраняется).
  await step("station-source", async () => {
    const id = await stationIdByCode(cfg.ingestStation);
    await page.goto(url(`/admin/stations/${id}`));
    await page.getByRole("button", { name: t("stations.sources.add"), exact: true }).click();
    const form = page.locator("[data-testid=station-source-form]");
    await form.waitFor({ timeout: 10_000 });
    await form.locator("#src-label").fill("Экспорт вендора, пост № 1");
    await form.locator("#src-host").fill("sftp.vendor.example");
    await form.locator("#src-path").fill(`/export/${cfg.ingestStation}`);
    await form.locator("#src-pattern").fill(`${cfg.ingestStation}_*.csv`);
    await form.locator("#src-username").fill("meteo");
    await form.locator("#src-password").fill("demo-password");
    await form.locator("#src-fp").fill("SHA256:7Qk3pZtX9mVbLwRn2sDhG5yUaJcE1fK8oTiB4vNxM0W");
    await form
      .getByRole("button", { name: t("stations.sources.templates.wide"), exact: true })
      .click();
    await shotElement(
      form.locator("xpath=ancestor::*[@data-slot='card'][1]"),
      "admin-station-source-form",
    );
    await form.getByRole("button", { name: t("common.actions.cancel"), exact: true }).click();
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
