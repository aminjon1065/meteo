#!/usr/bin/env node
/**
 * Миниатюры для меню «Тип карты» (public/map-types/{тип}.jpg): одно и то же место у Душанбе на каждой
 * подложке, без станций, границ и маски поверх. Нужен запущенный портал с тайлами всех подложек
 * (infra/data/fetch-basemap-layers.sh) и Chromium Playwright.
 * Запуск: node apps/web/scripts/map-type-previews.mjs [http://localhost:3000]
 */
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(resolve(WEB, "package.json"));
const { chromium } = require("@playwright/test");

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = resolve(WEB, "public/map-types");
const TYPES = ["scheme", "gray", "relief", "satellite"];
/** Восток Душанбе и предгорья: лесопарк, дороги, склоны — различия подложек видны сразу. */
const VIEW = { center: [68.83, 38.57], zoom: 10.3 };
/** Миниатюра 96×64 в меню; снимается с плотностью 2× (файл 192×128) для чётких экранов. */
const SIZE = { width: 96, height: 64 };

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
try {
  for (const type of TYPES) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 2,
      colorScheme: "light",
    });
    await context.addInitScript((b) => localStorage.setItem("meteo-basemap", b), type);
    const page = await context.newPage();
    await page.goto(`${BASE}/ru`, { waitUntil: "domcontentloaded" });
    const map = page.locator("[data-map-layers]").first();
    await map.waitFor({ timeout: 60_000 });
    await page.waitForFunction(
      (b) => document.querySelector("[data-map-layers]")?.getAttribute("data-basemap") === b,
      type,
      { timeout: 30_000 },
    );
    // Только фактура подложки: слои портала и подписи скрываются (в 96×64 подпись заняла бы кадр).
    // Повторяется перед снимком: после смены стиля слои портала добавляются заново.
    const onlyBasemap = () =>
      map.evaluate((el, view) => {
        const m = el.__maplibreMap;
        const own = /^(stations|regions|districts|country|warnings|silam|weather)/;
        for (const l of m.getStyle().layers) {
          if (own.test(l.id) || l.type === "symbol")
            m.setLayoutProperty(l.id, "visibility", "none");
        }
        m.jumpTo(view);
      }, VIEW);
    await page.waitForTimeout(3000);
    await onlyBasemap();
    await page.waitForTimeout(4000);
    await onlyBasemap();
    await page.waitForTimeout(1500);
    const box = await map.boundingBox();
    if (!box) throw new Error("нет размеров карты");
    const path = resolve(OUT, `${type}.jpg`);
    await page.screenshot({
      path,
      type: "jpeg",
      quality: 82,
      clip: {
        x: box.x + box.width / 2 - SIZE.width / 2,
        y: box.y + box.height / 2 - SIZE.height / 2,
        ...SIZE,
      },
    });
    console.info(`[previews] ${type} → ${path}`);
    await context.close();
  }
} finally {
  await browser.close();
}
