/**
 * Копирует worker MapLibre в public/maplibre: Turbopack не умеет собирать worker‑URL библиотеки,
 * поэтому воркер раздаётся как статический файл и подключается через setWorkerUrl().
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const pkgPath = require.resolve("maplibre-gl/package.json");
const dist = resolve(dirname(pkgPath), "dist");
const { version } = JSON.parse(readFileSync(pkgPath, "utf8"));
const target = resolve(import.meta.dirname, "../public/maplibre");
mkdirSync(target, { recursive: true });
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(resolve(dist, file), resolve(target, file));
}
writeFileSync(resolve(target, "version.json"), JSON.stringify({ version }));
console.info(`[maplibre] worker ${version} → public/maplibre`);
