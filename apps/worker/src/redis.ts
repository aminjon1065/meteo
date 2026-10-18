import IORedis from "ioredis";
import { env } from "./env";
import { logger } from "./logger";

/**
 * Общее соединение с Redis для очереди. BullMQ сам дублирует его для блокирующих
 * операций Worker'а. maxRetriesPerRequest: null — требование BullMQ.
 */
export function createRedis(): IORedis {
  const client = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
  });
  client.on("error", (error) => logger.error({ err: error }, "redis error"));
  client.on("ready", () => logger.info("redis ready"));
  return client;
}
