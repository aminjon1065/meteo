import "server-only";
import { getRedis } from "@/lib/redis";

/**
 * Кэш ответов публичного API (docs/02-architecture.md §12): JSON в Redis с TTL, общий для всех
 * экземпляров web; без Redis — ограниченный кэш в памяти процесса. Ключи разделяются по запросу
 * (slug, параметры), TTL совпадает с s-maxage в Cache-Control ответа.
 */
const PREFIX = "meteo:cache:";
const MEMORY_MAX = 500;
const memory = new Map<string, { expiresAt: number; value: string }>();

function memoryGet(key: string): string | null {
  const entry = memory.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    memory.delete(key);
    return null;
  }
  return entry.value;
}

function memorySet(key: string, value: string, ttlSec: number): void {
  if (memory.size >= MEMORY_MAX) {
    const oldest = memory.keys().next().value;
    if (oldest !== undefined) memory.delete(oldest);
  }
  memory.set(key, { expiresAt: Date.now() + ttlSec * 1000, value });
}

export interface CachedResult<T> {
  value: T;
  hit: boolean;
}

/**
 * Возвращает значение из кэша или вычисляет его через `load` и сохраняет на ttlSec.
 * Ошибки Redis не влияют на ответ: используется память процесса.
 */
export async function cachedJson<T>(
  key: string,
  ttlSec: number,
  load: () => Promise<T>,
): Promise<CachedResult<T>> {
  const fullKey = PREFIX + key;
  const redis = getRedis();
  if (redis) {
    try {
      const raw = await redis.get(fullKey);
      if (raw !== null) return { value: JSON.parse(raw) as T, hit: true };
    } catch {
      // Redis недоступен — ниже проверим память процесса.
    }
  }
  const local = memoryGet(fullKey);
  if (local !== null) return { value: JSON.parse(local) as T, hit: true };

  const value = await load();
  const serialized = JSON.stringify(value);
  memorySet(fullKey, serialized, ttlSec);
  if (redis) {
    redis.set(fullKey, serialized, "EX", ttlSec).catch(() => undefined);
  }
  return { value, hit: false };
}

/** Удаляет записи по префиксу ключа (после ручного ввода/импорта — свежий индекс без ожидания TTL). */
export async function invalidateCache(prefix: string): Promise<void> {
  for (const key of memory.keys()) if (key.startsWith(PREFIX + prefix)) memory.delete(key);
  const redis = getRedis();
  if (!redis) return;
  try {
    const keys = await redis.keys(`${PREFIX}${prefix}*`);
    if (keys.length) await redis.del(...keys);
  } catch {
    // недоступен — записи истекут по TTL
  }
}
