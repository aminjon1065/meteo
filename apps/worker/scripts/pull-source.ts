/**
 * Прогон одного pull‑источника станции без очереди BullMQ (отладка маппинга, E2E, runbook):
 *   pnpm --filter @meteo/worker pull-source <id источника> [--force]
 * --force: обработать выключенный источник и перечитать самый свежий файл / весь ответ JSON.
 * Коды выхода: 0 — ok или skipped, 2 — failed, 1 — источник не найден.
 */
import { listStationSources } from "@meteo/db";
import { db } from "../src/db";
import { pullStationSource } from "../src/station-pull/run";

const id = Number(process.argv[2]);
const force = process.argv.includes("--force");
if (!Number.isInteger(id) || id <= 0) {
  console.error("Укажите id источника: pnpm --filter @meteo/worker pull-source <id> [--force]");
  process.exit(1);
}
const [source] = await listStationSources(db, { ids: [id] });
if (!source) {
  console.error(`Источник ${id} не найден`);
  await db.$client.end();
  process.exit(1);
}
const result = await pullStationSource(source, { force });
console.info(JSON.stringify(result));
await db.$client.end();
process.exit(result.status === "failed" ? 2 : 0);
