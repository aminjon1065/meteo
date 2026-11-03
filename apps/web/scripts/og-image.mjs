#!/usr/bin/env node
/**
 * Картинка для соцсетей по умолчанию (public/og/default.jpg, 1200×630): эмблема Агентства,
 * «Метеопортал», подзаголовок на трёх языках и силуэт Таджикистана. Её показывают Telegram,
 * Facebook, WhatsApp и поисковики, когда у страницы нет своей картинки (lib/seo.ts). Там же —
 * эмблема в PNG (public/og/logo.png) для publisher.logo в JSON-LD новостей: Google ждёт PNG/JPG.
 * Шрифты — те же Inter / Inter Tight, что на сайте (@font-face берутся со страницы портала).
 * Нужен запущенный портал (контур страны берётся из /api/v1/regions/outline) и Chromium Playwright.
 * Запуск: node apps/web/scripts/og-image.mjs [http://localhost:3000] [havo.tj]
 */
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(WEB, "../..");
const require = createRequire(resolve(WEB, "package.json"));
const { chromium } = require("@playwright/test");

const BASE = process.argv[2] ?? "http://localhost:3000";
const DOMAIN = process.argv[3] ?? "havo.tj";
const OUT = resolve(WEB, "public/og/default.jpg");
const LOGO = resolve(WEB, "public/og/logo.png");
const W = 1200;
const H = 630;

const msg = (l) =>
  JSON.parse(readFileSync(resolve(ROOT, `packages/i18n/messages/${l}.json`), "utf8"));
const [tg, ru, en] = ["tg", "ru", "en"].map((l) => msg(l).common);
const emblem = `data:image/webp;base64,${readFileSync(resolve(WEB, "public/brand/hydromet-emblem-384.webp")).toString("base64")}`;

/** Контур страны → путь SVG в равнопромежуточной проекции с поправкой на широту. */
async function outlinePath(box) {
  const res = await fetch(`${BASE}/api/v1/regions/outline`);
  if (!res.ok) throw new Error(`outline: HTTP ${res.status}`);
  const geo = await res.json();
  const polys =
    geo.geometry.type === "Polygon" ? [geo.geometry.coordinates] : geo.geometry.coordinates;
  const pts = polys.flat(2);
  const lons = pts.map((p) => p[0]);
  const lats = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [
    Math.min(...lons),
    Math.max(...lons),
    Math.min(...lats),
    Math.max(...lats),
  ];
  const k = Math.cos((((y0 + y1) / 2) * Math.PI) / 180);
  const scale = Math.min(box.w / ((x1 - x0) * k), box.h / (y1 - y0));
  const ox = box.x + (box.w - (x1 - x0) * k * scale) / 2;
  const oy = box.y + (box.h - (y1 - y0) * scale) / 2;
  const project = ([lon, lat]) => [ox + (lon - x0) * k * scale, oy + (y1 - lat) * scale];
  const d = polys
    .flatMap((poly) =>
      poly.map(
        (ring) =>
          `M${ring
            .map(project)
            .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
            .join("L")}Z`,
      ),
    )
    .join("");
  return { d, project };
}

const box = { x: 650, y: 95, w: 500, h: 440 };
const { d, project } = await outlinePath(box);
// Города — условные точки цветами шкалы (иллюстрация, не данные).
const cities = [
  [68.78, 38.56, "#2f9e5b"], // Душанбе
  [69.62, 40.28, "#d9a80b"], // Худжанд
  [69.78, 37.91, "#2f9e5b"], // Куляб
  [68.78, 37.83, "#ea8a2b"], // Бохтар
  [71.55, 37.49, "#2f9e5b"], // Хорог
  [70.28, 39.02, "#2f9e5b"], // Гарм
];
const dots = cities
  .map(([lon, lat, c]) => {
    const [x, y] = project([lon, lat]);
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="13" fill="${c}" stroke="#fff" stroke-width="4"/>`;
  })
  .join("");

const card = `
<div id="og" style="position:fixed;inset:0;width:${W}px;height:${H}px;overflow:hidden;
  background:linear-gradient(135deg,#0f3a63 0%,#164a7c 55%,#1d5d97 100%);color:#fff;
  font-family:var(--font-inter),system-ui,sans-serif;z-index:2147483647">
  <svg width="${W}" height="${H}" style="position:absolute;inset:0" aria-hidden="true">
    <defs>
      <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
        <path d="M48 0H0V48" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#grid)"/>
    <path d="${d}" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.75)" stroke-width="3" stroke-linejoin="round"/>
    ${dots}
  </svg>
  <div style="position:absolute;left:72px;top:72px;width:600px;display:flex;flex-direction:column;gap:22px">
    <img src="${emblem}" width="132" height="132" alt="" style="border-radius:50%;background:#fff;padding:6px"/>
    <div style="font-family:var(--font-inter-tight),var(--font-inter),sans-serif;font-weight:700;font-size:92px;line-height:1;letter-spacing:-0.02em">${tg.siteName}</div>
    <div style="display:flex;flex-direction:column;gap:8px">
      <div style="font-size:34px;font-weight:600;line-height:1.2">${tg.siteTagline}</div>
      <div style="font-size:26px;line-height:1.25;color:rgba(255,255,255,0.78)">${ru.siteTagline}</div>
      <div style="font-size:26px;line-height:1.25;color:rgba(255,255,255,0.78)">${en.siteTagline}</div>
    </div>
  </div>
  <div style="position:absolute;left:72px;bottom:56px;font-size:28px;font-weight:600;letter-spacing:0.01em;color:#e0b452">${DOMAIN}</div>
</div>`;

mkdirSync(dirname(OUT), { recursive: true });
const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    colorScheme: "light",
  });
  // Шрифты сайта: @font-face и имена семейств next/font берутся со страницы портала, карточка
  // рисуется на чистой странице (живая страница dev-сервера может перерисоваться под снимком).
  const site = await context.newPage();
  await site.goto(`${BASE}/ru/about`, { waitUntil: "load" });
  const fonts = await site.evaluate(() => {
    const faces = [];
    for (const sheet of document.styleSheets) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const r of rules) {
        if (r instanceof CSSFontFaceRule)
          faces.push(
            // Адреса файлов шрифтов — абсолютные: чистая страница открыта как about:blank.
            r.cssText.replace(
              /url\("?([^")]+)"?\)/g,
              (_, u) => `url("${new URL(u, sheet.href ?? location.href).href}")`,
            ),
          );
      }
    }
    const css = getComputedStyle(document.documentElement);
    return {
      faces: faces.join("\n"),
      text: css.getPropertyValue("--font-inter").trim(),
      heading: css.getPropertyValue("--font-inter-tight").trim(),
    };
  });
  await site.close();
  const page = await context.newPage();
  await page.setContent(
    `<!doctype html><html><head><style>${fonts.faces}
      :root{--font-inter:${fonts.text};--font-inter-tight:${fonts.heading}}
      body{margin:0}</style></head><body>${card}</body></html>`,
    { waitUntil: "load" },
  );
  // Заголовок — Inter Tight: ждём, пока все шрифты догрузятся.
  await page.evaluate(() => document.fonts.ready);
  const used = await page.evaluate(() =>
    [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family),
  );
  if (used.length === 0) throw new Error("шрифты сайта не загрузились");
  await page.waitForTimeout(300);
  // JPEG: градиент в PNG весит ~430 КБ, а картинку тянет каждый мессенджер при отправке ссылки.
  await page.locator("#og").screenshot({ path: OUT, type: "jpeg", quality: 88 });
  await page.setContent(
    `<!doctype html><html><body style="margin:0"><img id="logo" src="${emblem}" width="384" height="384" style="display:block;background:#fff;border-radius:50%"></body></html>`,
    { waitUntil: "load" },
  );
  await page.locator("#logo").screenshot({ path: LOGO, type: "png", omitBackground: true });
  process.stdout.write(`og: ${OUT}\nlogo: ${LOGO}\n`);
} finally {
  await browser.close();
}
