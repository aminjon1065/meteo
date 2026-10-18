import { Queue, Worker } from "bullmq";
import { db } from "./db";
import { env } from "./env";
import { healthState, startHealthServer } from "./health";
import { jobByName, jobs } from "./jobs";
import type { JobName } from "./jobs/types";
import { logger } from "./logger";
import { createRedis } from "./redis";

const QUEUE_NAME = "meteo-jobs";
const connection = createRedis();

const queue = new Queue(QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 500,
    attempts: 3,
    backoff: { type: "exponential", delay: 30_000 },
  },
});

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const definition = jobByName.get(job.name as JobName);
    if (!definition) {
      throw new Error(`Неизвестная задача: ${job.name}`);
    }
    const started = Date.now();
    const result = await definition.run(job as never);
    if (job.name === "heartbeat") healthState.lastHeartbeatAt = new Date();
    logger.info({ job: job.name, id: job.id, ms: Date.now() - started }, "job done");
    return result;
  },
  { connection, concurrency: env.WORKER_CONCURRENCY },
);

worker.on("failed", (job, error) =>
  logger.error({ job: job?.name, id: job?.id, err: error }, "job failed"),
);
worker.on("error", (error) => logger.error({ err: error }, "worker error"));
worker.on("ready", () => {
  healthState.queueReady = true;
  logger.info({ queue: QUEUE_NAME, concurrency: env.WORKER_CONCURRENCY }, "worker ready");
});

/** Регистрирует расписания задач (идемпотентно: один scheduler на имя задачи). */
async function registerSchedules() {
  for (const job of jobs) {
    if (!job.schedule) continue;
    await queue.upsertJobScheduler(`schedule:${job.name}`, job.schedule, {
      name: job.name,
      data: {},
    });
    logger.info({ job: job.name, schedule: job.schedule }, "schedule registered");
  }
}

const healthServer = startHealthServer();

async function shutdown(signal: string) {
  if (healthState.shuttingDown) return;
  healthState.shuttingDown = true;
  logger.info({ signal }, "shutting down");
  await Promise.allSettled([worker.close(), queue.close()]);
  connection.disconnect();
  healthServer.close();
  await db.$client.end({ timeout: 5 });
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await registerSchedules();
// Первый heartbeat сразу, не дожидаясь интервала.
await queue.add("heartbeat", {}, { jobId: `heartbeat:boot:${process.pid}` });
// При старте пересчитываем индекс за 30 дней (бэкфилл после импорта/простоя).
await queue.add(
  "index-compute",
  { hours: 24 * 30 },
  { jobId: `index-compute:boot:${process.pid}` },
);
// Догоняем контроль качества и правила уведомлений сразу после старта.
await queue.add("qc-batch", { hours: 48 }, { jobId: `qc-batch:boot:${process.pid}` });
await queue.add("threshold-eval", {}, { jobId: `threshold-eval:boot:${process.pid}` });
await queue.add("mailer", {}, { jobId: `mailer:boot:${process.pid}` });
// Прогнозы: SmartMet сразу, SILAM — проверка нового прогона (пропускается, если уже загружен).
await queue.add("smartmet-sync", {}, { jobId: `smartmet-sync:boot:${process.pid}` });
await queue.add("silam-sync", {}, { jobId: `silam-sync:boot:${process.pid}` });
// Предупреждения CAP: первая синхронизация сразу после старта.
await queue.add("cap-sync", {}, { jobId: `cap-sync:boot:${process.pid}` });
logger.info({ env: env.NODE_ENV }, "worker started");
