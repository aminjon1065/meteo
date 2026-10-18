/**
 * Сборка worker'а: один ESM‑бандл на точку входа. Пакеты монорепозитория (@meteo/*)
 * включаются в бандл (они распространяются как TS‑исходники), внешние зависимости
 * остаются в node_modules.
 */
import { readFileSync } from "node:fs";
import { build } from "esbuild";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const external = Object.keys(pkg.dependencies ?? {}).filter((name) => !name.startsWith("@meteo/"));

const entries = {
  index: "src/index.ts",
  migrate: "../../packages/db/src/migrate.ts",
  seed: "../../packages/db/src/seed.ts",
};

await build({
  entryPoints: entries,
  outdir: "dist",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  external,
  logLevel: "info",
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
