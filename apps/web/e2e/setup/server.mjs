/**
 * Команда webServer для Playwright и startServerCommand для Lighthouse CI:
 *  1. пересоздаёт базу E2E и наполняет её (prepare-db.ts);
 *  2. собирает production-сборку, если её нет (или E2E_BUILD=1);
 *  3. запускает `next start` на E2E_PORT с окружением E2E.
 * Переменные: E2E_PORT (3100), E2E_DATABASE_URL, E2E_SKIP_PREPARE=1 (не трогать БД), E2E_BUILD=1.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { resolveE2eEnv, serverEnv, WEB_DIR } from "./env.mjs";

const e2e = resolveE2eEnv();
const env = { ...process.env, ...serverEnv(e2e) };
for (const dir of [e2e.silamDir, e2e.uploadsDir, e2e.importsDir])
  mkdirSync(dir, { recursive: true });

function run(label, command, args, childEnv = env) {
  console.info(`[e2e] ${label}: ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { cwd: WEB_DIR, env: childEnv, stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`[e2e] ${label} завершился с кодом ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

if (process.env.E2E_SKIP_PREPARE !== "1") {
  // prepare-db сам вычисляет окружение E2E: ему нужен DATABASE_URL основной базы, а не e2e.
  run("prepare-db", "pnpm", ["exec", "tsx", "e2e/setup/prepare-db.ts"], process.env);
}
if (process.env.E2E_BUILD === "1" || !existsSync(resolve(WEB_DIR, ".next/BUILD_ID"))) {
  run("build", "pnpm", ["run", "build"]);
}

console.info(
  `[e2e] start: next start -p ${e2e.port} (${e2e.baseUrl}, db ${e2e.databaseUrl.replace(/:[^:@/]+@/, ":***@")})`,
);
// Без -H: hostname сервера и заголовок Host должны совпадать (иначе rewrite next-intl считается внешним).
const server = spawn("pnpm", ["exec", "next", "start", "-p", String(e2e.port)], {
  cwd: WEB_DIR,
  env,
  stdio: "inherit",
});
const stop = (signal) => {
  server.kill(signal);
};
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
server.on("exit", (code) => process.exit(code ?? 0));
