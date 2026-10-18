/**
 * Сборка агента в один файл без зависимостей: src/agent.ts + парсер форматов из @meteo/core
 * (station-feed, import-mapping, csv, units …) → station-agent.mjs (ESM, Node 22).
 * Файл коммитится в репозиторий: на станционный компьютер копируются только он и config.json.
 */
import { build } from "esbuild";

await build({
  entryPoints: ["src/agent.ts"],
  outfile: "station-agent.mjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  minify: false,
  legalComments: "none",
  banner: {
    js: [
      "#!/usr/bin/env node",
      "// Метеопортал — агент станции. Собрано из apps/station-agent/src/agent.ts и @meteo/core;",
      "// не редактируйте вручную: pnpm --filter @meteo/station-agent build.",
    ].join("\n"),
  },
  logLevel: "info",
});
