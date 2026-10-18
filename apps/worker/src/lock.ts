import { createRedis } from "./redis";

let client: ReturnType<typeof createRedis> | null = null;

function redis() {
  client ??= createRedis();
  return client;
}

/**
 * Единственный экземпляр задачи одновременно (SET NX + TTL в Redis): планировщик, boot‑задача
 * и ручной запуск одной и той же синхронизации не должны качать источник параллельно.
 * Если замок занят — возвращает null, задача завершается как «пропущена».
 */
export async function withLock<T>(
  name: string,
  ttlSeconds: number,
  fn: () => Promise<T>,
): Promise<T | null> {
  const key = `meteo:lock:${name}`;
  const token = `${process.pid}:${Date.now()}`;
  const acquired = await redis().set(key, token, "EX", ttlSeconds, "NX");
  if (acquired !== "OK") return null;
  try {
    return await fn();
  } finally {
    // Снимаем только свой замок (TTL мог истечь и перейти к другому процессу).
    await redis().eval(
      'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) end return 0',
      1,
      key,
      token,
    );
  }
}
