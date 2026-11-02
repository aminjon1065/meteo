#!/usr/bin/env node
/**
 * MBTiles (растровые тайлы GDAL) → PMTiles v3 — для подложки «Спутник» (fetch-basemap-layers.sh).
 * Тайлы переносятся как есть, без перекодирования; строки MBTiles в схеме TMS переворачиваются в XYZ.
 * Запуск: node infra/data/mbtiles-to-pmtiles.mjs <вход.mbtiles> <выход.pmtiles> [attribution]
 */
import { statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { TILE_TYPE, writePmtiles } from "./pmtiles-writer.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(resolve(ROOT, "apps/web/package.json"));
const { zxyToTileId } = require("pmtiles");

const [input, output, attribution = ""] = process.argv.slice(2);
if (!input || !output) {
  console.error(
    "использование: mbtiles-to-pmtiles.mjs <вход.mbtiles> <выход.pmtiles> [attribution]",
  );
  process.exit(1);
}

const db = new DatabaseSync(input, { readOnly: true });
const meta = Object.fromEntries(
  db
    .prepare("select name, value from metadata")
    .all()
    .map((r) => [r.name, r.value]),
);
const format = String(meta.format ?? "png").toLowerCase();
const tileType = TILE_TYPE[format === "jpg" ? "jpeg" : format] ?? TILE_TYPE.unknown;
const bounds = String(meta.bounds ?? "-180,-85,180,85")
  .split(",")
  .map(Number);

const tiles = [];
for (const row of db
  .prepare("select zoom_level z, tile_column x, tile_row y, tile_data d from tiles")
  .iterate()) {
  const z = Number(row.z);
  const y = 2 ** z - 1 - Number(row.y);
  tiles.push({ tileId: zxyToTileId(z, Number(row.x), y), z, data: Buffer.from(row.d) });
}
db.close();
if (tiles.length === 0) {
  console.error(`[mbtiles] в ${input} нет тайлов`);
  process.exit(1);
}

const zooms = tiles.map((t) => t.z);
writePmtiles(output, {
  tiles,
  tileType,
  bounds,
  metadata: {
    name: meta.name ?? "",
    type: meta.type ?? "baselayer",
    format,
    minzoom: Math.min(...zooms),
    maxzoom: Math.max(...zooms),
    attribution: attribution || meta.attribution || "",
  },
});
console.info(
  `[mbtiles] ${output}: ${tiles.length} тайлов, z${Math.min(...zooms)}–${Math.max(...zooms)}, ${(statSync(output).size / 1e6).toFixed(1)} МБ`,
);
