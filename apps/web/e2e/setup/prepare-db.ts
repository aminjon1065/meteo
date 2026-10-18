/**
 * Подготовка базы E2E: DROP/CREATE `<db>_e2e`, миграции и seed @meteo/db, затем фикстуры сценариев
 * (станции с измерениями, прогноз, слои SILAM, CAP-предупреждение, новость). Запускается из server.mjs
 * перед стартом сервера; идемпотентен — каждый прогон начинается с чистой базы.
 */
import { spawnSync } from "node:child_process";
import { createDb } from "@meteo/db";
import { REPO_ROOT, resolveE2eEnv, serverEnv } from "./env.mjs";
import { seedE2eFixtures } from "./fixtures";

const e2e = resolveE2eEnv();
const env = { ...process.env, ...serverEnv(e2e) } as NodeJS.ProcessEnv;
const dbName = new URL(e2e.databaseUrl).pathname.replace(/^\//, "");
if (!/^[a-z0-9_]+$/.test(dbName)) throw new Error(`Недопустимое имя базы E2E: ${dbName}`);

const started = Date.now();
const admin = createDb(e2e.adminDatabaseUrl, { max: 1 }).$client;
console.info(`[e2e] пересоздаю базу ${dbName}`);
await admin.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
await admin.unsafe(`CREATE DATABASE "${dbName}"`);
await admin.end();

function runDbScript(script: string) {
  const result = spawnSync("pnpm", ["--filter", "@meteo/db", script], {
    cwd: REPO_ROOT,
    env,
    stdio: "inherit",
  });
  if (result.status !== 0)
    throw new Error(`[e2e] pnpm --filter @meteo/db ${script} → код ${result.status}`);
}
runDbScript("migrate");
runDbScript("seed");

await seedE2eFixtures({
  databaseUrl: e2e.databaseUrl,
  silamDir: e2e.silamDir,
  adminEmail: e2e.adminEmail,
  appUrl: e2e.baseUrl,
});
console.info(`[e2e] база ${dbName} готова за ${Math.round((Date.now() - started) / 100) / 10} с`);
