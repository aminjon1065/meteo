import "server-only";
import { Queue } from "bullmq";
import IORedis from "ioredis";

/**
 * Постановка фоновых задач worker'а из web (очередь BullMQ `meteo-jobs`): пересчёт правил
 * уведомлений сразу после приёма данных, запуск pull‑источника по кнопке в админке.
 * Без REDIS_URL или при недоступном Redis возвращает false — вызывающий код выбирает запасной путь.
 */
const QUEUE_NAME = "meteo-jobs";
const globalRef = globalThis as unknown as { __meteoJobQueue?: Queue | null };

function queue(): Queue | null {
  if (globalRef.__meteoJobQueue !== undefined) return globalRef.__meteoJobQueue;
  const url = process.env.REDIS_URL;
  if (!url) {
    globalRef.__meteoJobQueue = null;
    return null;
  }
  const connection = new IORedis(url, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
    connectTimeout: 2_000,
    retryStrategy: (times) => Math.min(30_000, 500 * 2 ** Math.min(times, 6)),
  });
  connection.on("error", () => undefined);
  globalRef.__meteoJobQueue = new Queue(QUEUE_NAME, { connection });
  return globalRef.__meteoJobQueue;
}

export type EnqueueableJob = "threshold-eval" | "station-pull" | "index-compute" | "qc-batch";

/** Ставит задачу в очередь; jobId защищает от дублей (одна задача на ключ, пока она не выполнена). */
export async function enqueueJob(
  name: EnqueueableJob,
  data: Record<string, unknown> = {},
  opts: { jobId?: string; timeoutMs?: number } = {},
): Promise<boolean> {
  const q = queue();
  if (!q) return false;
  const timeoutMs = opts.timeoutMs ?? 3_000;
  try {
    await Promise.race([
      q.add(name, data, { jobId: opts.jobId, removeOnComplete: 100, removeOnFail: 100 }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("enqueue timeout")), timeoutMs).unref(),
      ),
    ]);
    return true;
  } catch (error) {
    console.warn("[jobs] не удалось поставить задачу", name, (error as Error).message);
    return false;
  }
}
