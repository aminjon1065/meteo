import IORedis from "ioredis";

/**
 * Клиент Redis для web: rate limiting и кэш публичного API. Единственный экземпляр на процесс.
 * Без REDIS_URL возвращает null — вызывающий код работает с памятью процесса. Очередь офлайн-команд
 * отключена: при недоступном Redis команды отклоняются сразу, а не висят до таймаута.
 */
const globalRef = globalThis as unknown as {
  __meteoRedis?: IORedis | null;
  __meteoRedisWarnAt?: number;
};

export function getRedis(): IORedis | null {
  if (globalRef.__meteoRedis !== undefined) return globalRef.__meteoRedis;
  const url = process.env.REDIS_URL;
  if (!url) {
    globalRef.__meteoRedis = null;
    return null;
  }
  const client = new IORedis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2_000,
    retryStrategy: (times) => Math.min(30_000, 500 * 2 ** Math.min(times, 6)),
  });
  client.on("error", (error) => {
    // Не чаще раза в минуту: ioredis повторяет подключение и шлёт error на каждую попытку.
    const now = Date.now();
    if ((globalRef.__meteoRedisWarnAt ?? 0) + 60_000 < now) {
      globalRef.__meteoRedisWarnAt = now;
      console.error("[redis] недоступен, используется память процесса:", error.message);
    }
  });
  client.connect().catch(() => undefined);
  globalRef.__meteoRedis = client;
  return client;
}
