#!/usr/bin/env node
/**
 * Рельеф для подложки «Рельеф» (ADR-003, самостоятельный хостинг): тайлы высот Mapterhorn
 * (Copernicus DEM GLO-30, лицензия Copernicus — свободная, с указанием источника; Terrarium, WebP
 * 512 px) по bbox Таджикистана → infra/data/tiles/terrain.pmtiles.
 *
 * Тайлы копируются байт в байт из открытого архива https://download.mapterhorn.com/planet.pmtiles
 * (range-запросы через библиотеку pmtiles), архив пишется здесь же — без сторонних бинарников.
 *
 * Переменные: BBOX (lon_min,lat_min,lon_max,lat_max; по умолчанию как у векторных тайлов),
 * TERRAIN_MAXZOOM (10: ≈ 75 м на пиксель на широте Душанбе — достаточно для затенения гор),
 * TERRAIN_SOURCE (URL архива), TILES_DIR (каталог вывода), CONCURRENCY (8).
 * Запуск: node infra/data/build-terrain.mjs   (или через infra/data/fetch-basemap-layers.sh)
 */
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writePmtiles } from "./pmtiles-writer.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(resolve(ROOT, "apps/web/package.json"));
const { FetchSource, PMTiles, zxyToTileId } = require("pmtiles");

const SOURCE = process.env.TERRAIN_SOURCE ?? "https://download.mapterhorn.com/planet.pmtiles";
const TILES_DIR = process.env.TILES_DIR ?? resolve(ROOT, "infra/data/tiles");
const [west, south, east, north] = (process.env.BBOX ?? "66.5,36.5,75.5,41.5")
  .split(",")
  .map(Number);
const MAXZOOM = Number(process.env.TERRAIN_MAXZOOM ?? 10);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 8);
const ATTRIBUTION =
  "Copernicus DEM GLO-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA; tiles: Mapterhorn";

const log = (...a) => console.info("[terrain]", ...a);

/** Номера тайлов, покрывающих bbox на масштабе z (Web Mercator). */
function tileRange(z) {
  const n = 2 ** z;
  const x = (lon) => Math.min(n - 1, Math.max(0, Math.floor(((lon + 180) / 360) * n)));
  const y = (lat) => {
    const r = (lat * Math.PI) / 180;
    const v = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
    return Math.min(n - 1, Math.max(0, Math.floor(v)));
  };
  return { x0: x(west), x1: x(east), y0: y(north), y1: y(south) };
}

// --- копирование ---

const source = new PMTiles(new FetchSource(SOURCE));
const header = await source.getHeader();
const maxZoom = Math.min(MAXZOOM, header.maxZoom);
log(`источник ${SOURCE}: z${header.minZoom}–${header.maxZoom}, тип ${header.tileType}`);
log(`bbox ${west},${south},${east},${north}, z0–${maxZoom}`);

const jobs = [];
for (let z = 0; z <= maxZoom; z++) {
  const { x0, x1, y0, y1 } = tileRange(z);
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push({ z, x, y });
}
log(`тайлов к загрузке: ${jobs.length}`);

const tiles = [];
let done = 0;
let next = 0;
async function worker() {
  while (next < jobs.length) {
    const job = jobs[next++];
    for (let attempt = 1; ; attempt++) {
      try {
        const r = await source.getZxy(job.z, job.x, job.y);
        if (r?.data) {
          tiles.push({
            tileId: zxyToTileId(job.z, job.x, job.y),
            z: job.z,
            data: Buffer.from(r.data),
          });
        }
        break;
      } catch (error) {
        if (attempt >= 4) throw error;
        await new Promise((ok) => setTimeout(ok, 1000 * attempt));
      }
    }
    done++;
    if (done % 100 === 0 || done === jobs.length) log(`${done}/${jobs.length}`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

mkdirSync(TILES_DIR, { recursive: true });
const out = resolve(TILES_DIR, "terrain.pmtiles");
writePmtiles(out, {
  tiles,
  tileType: header.tileType,
  tileCompression: header.tileCompression,
  bounds: [west, south, east, north],
  metadata: {
    name: "terrain",
    type: "baselayer",
    format: "webp",
    encoding: "terrarium",
    tileSize: 512,
    minzoom: 0,
    maxzoom: maxZoom,
    attribution: ATTRIBUTION,
    source: SOURCE,
  },
});
writeFileSync(
  resolve(TILES_DIR, "terrain.json"),
  `${JSON.stringify({
    source: SOURCE,
    bbox: [west, south, east, north].join(","),
    maxzoom: maxZoom,
    tiles: tiles.length,
    attribution: ATTRIBUTION,
    extractedAt: new Date().toISOString(),
  })}\n`,
);
log(`готово: ${out}, ${tiles.length} тайлов, ${(statSync(out).size / 1e6).toFixed(1)} МБ`);
