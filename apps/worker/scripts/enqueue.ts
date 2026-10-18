/**
 * Ручной запуск фоновой задачи: pnpm --filter @meteo/worker enqueue <job> '<json>'
 * Примеры: enqueue silam-sync '{"force":true}', enqueue smartmet-sync '{"slugs":["dushanbe"]}',
 * enqueue cap-sync '{"force":true}', enqueue station-pull '{"sourceId":1,"force":true}'.
 */
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { env } from "../src/env";

const name = process.argv[2];
if (!name) {
  console.error(
    "Укажите имя задачи: heartbeat | smartmet-sync | silam-sync | cap-sync | station-pull | index-compute | qc-batch | threshold-eval | mailer",
  );
  process.exit(1);
}
const data = JSON.parse(process.argv[3] ?? "{}") as Record<string, unknown>;
const queue = new Queue("meteo-jobs", {
  connection: new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null }),
});
const job = await queue.add(name, data, { jobId: `${name}:manual:${Date.now()}` });
console.info(`[enqueue] ${name} → job ${job.id}`, data);
await queue.close();
process.exit(0);
