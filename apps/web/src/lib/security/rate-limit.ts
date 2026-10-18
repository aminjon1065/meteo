/**
 * Ограничение частоты запросов (docs/02-architecture.md §10): фиксированное окно на ключ
 * (обычно IP + группа маршрутов). Счётчики — в Redis (общие для всех экземпляров web);
 * без Redis или при его недоступности — в памяти процесса (fail-open с локальным лимитом).
 */
export interface RateLimitRule {
  /** Максимум запросов в окне; 0 — ограничение выключено. */
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Момент сброса окна (epoch, мс). */
  resetAt: number;
}

export interface RateLimitStore {
  /** Увеличивает счётчик ключа и возвращает его значение и оставшееся время окна. */
  hit(key: string, windowMs: number): Promise<{ count: number; ttlMs: number }>;
}

/** Хранилище в памяти процесса: для разработки, тестов и как fallback без Redis. */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();
  private lastSweep = 0;

  constructor(private readonly now: () => number = Date.now) {}

  async hit(key: string, windowMs: number): Promise<{ count: number; ttlMs: number }> {
    const now = this.now();
    this.sweep(now);
    const current = this.buckets.get(key);
    if (!current || current.resetAt <= now) {
      const bucket = { count: 1, resetAt: now + windowMs };
      this.buckets.set(key, bucket);
      return { count: 1, ttlMs: windowMs };
    }
    current.count += 1;
    return { count: current.count, ttlMs: current.resetAt - now };
  }

  /** Удаляет истёкшие окна не чаще раза в секунду, чтобы Map не рос бесконечно. */
  private sweep(now: number): void {
    if (now - this.lastSweep < 1000) return;
    this.lastSweep = now;
    for (const [key, bucket] of this.buckets) if (bucket.resetAt <= now) this.buckets.delete(key);
  }

  get size(): number {
    return this.buckets.size;
  }
}

/** Минимальный интерфейс клиента Redis (ioredis), чтобы модуль тестировался без соединения. */
export interface RedisLike {
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
}

/** INCR + PEXPIRE в одном Lua-скрипте: атомарно создаёт окно при первом запросе. */
const HIT_SCRIPT = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end
return {c, ttl}
`;

export class RedisRateLimitStore implements RateLimitStore {
  constructor(
    private readonly redis: RedisLike,
    private readonly prefix = "meteo:rl:",
  ) {}

  async hit(key: string, windowMs: number): Promise<{ count: number; ttlMs: number }> {
    const result = (await this.redis.eval(HIT_SCRIPT, 1, this.prefix + key, windowMs)) as [
      number | string,
      number | string,
    ];
    return { count: Number(result[0]), ttlMs: Number(result[1]) };
  }
}

/**
 * Проверяет ключ по правилу. Ошибка хранилища (Redis недоступен) не блокирует запрос:
 * считаем через fallback-хранилище, если оно передано, иначе пропускаем.
 */
export async function checkRateLimit(
  store: RateLimitStore,
  key: string,
  rule: RateLimitRule,
  fallback?: RateLimitStore,
  now: () => number = Date.now,
): Promise<RateLimitResult> {
  if (rule.limit <= 0) {
    return { allowed: true, limit: 0, remaining: Number.POSITIVE_INFINITY, resetAt: now() };
  }
  let hit: { count: number; ttlMs: number };
  try {
    hit = await store.hit(key, rule.windowMs);
  } catch {
    if (!fallback) {
      return { allowed: true, limit: rule.limit, remaining: rule.limit, resetAt: now() };
    }
    hit = await fallback.hit(key, rule.windowMs);
  }
  return {
    allowed: hit.count <= rule.limit,
    limit: rule.limit,
    remaining: Math.max(0, rule.limit - hit.count),
    resetAt: now() + Math.max(0, hit.ttlMs),
  };
}

/** Заголовки ответа по RFC draft-ietf-httpapi-ratelimit-headers (X-RateLimit-*). */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  if (result.limit <= 0) return {};
  const resetSec = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
  const headers: Record<string, string> = {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(resetSec),
  };
  if (!result.allowed) headers["Retry-After"] = String(resetSec);
  return headers;
}

/** IP клиента: первый адрес X-Forwarded-For (ставит Caddy), иначе X-Real-IP, иначе "local". */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first;
  return headers.get("x-real-ip")?.trim() || "local";
}
