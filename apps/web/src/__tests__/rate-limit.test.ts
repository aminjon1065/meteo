import { describe, expect, it } from "vitest";
import {
  checkRateLimit,
  clientIp,
  MemoryRateLimitStore,
  type RateLimitStore,
  RedisRateLimitStore,
  rateLimitHeaders,
} from "@/lib/security/rate-limit";

function clock(start = 1_000_000) {
  let now = start;
  return { now: () => now, tick: (ms: number) => (now += ms) };
}

describe("MemoryRateLimitStore + checkRateLimit", () => {
  it("пропускает до лимита, затем отвечает 429 до конца окна", async () => {
    const c = clock();
    const store = new MemoryRateLimitStore(c.now);
    const rule = { limit: 3, windowMs: 60_000 };
    const results = [];
    for (let i = 0; i < 4; i += 1)
      results.push(await checkRateLimit(store, "api:1.2.3.4", rule, undefined, c.now));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results.map((r) => r.remaining)).toEqual([2, 1, 0, 0]);
    expect(results[3]?.resetAt).toBe(c.now() + 60_000);
    c.tick(60_001);
    const again = await checkRateLimit(store, "api:1.2.3.4", rule, undefined, c.now);
    expect(again.allowed).toBe(true);
    expect(again.remaining).toBe(2);
  });

  it("ключи независимы и истёкшие окна вычищаются", async () => {
    const c = clock();
    const store = new MemoryRateLimitStore(c.now);
    const rule = { limit: 1, windowMs: 1_000 };
    expect((await checkRateLimit(store, "a", rule, undefined, c.now)).allowed).toBe(true);
    expect((await checkRateLimit(store, "b", rule, undefined, c.now)).allowed).toBe(true);
    expect((await checkRateLimit(store, "a", rule, undefined, c.now)).allowed).toBe(false);
    c.tick(2_000);
    await checkRateLimit(store, "c", rule, undefined, c.now);
    expect(store.size).toBe(1);
  });

  it("лимит 0 выключает ограничение", async () => {
    const store = new MemoryRateLimitStore();
    const r = await checkRateLimit(store, "x", { limit: 0, windowMs: 1000 });
    expect(r.allowed).toBe(true);
    expect(rateLimitHeaders(r)).toEqual({});
  });

  it("при ошибке основного хранилища считает через fallback, без него — пропускает", async () => {
    const broken: RateLimitStore = {
      hit: async () => {
        throw new Error("redis down");
      },
    };
    const fallback = new MemoryRateLimitStore();
    const rule = { limit: 1, windowMs: 60_000 };
    expect((await checkRateLimit(broken, "k", rule, fallback)).allowed).toBe(true);
    expect((await checkRateLimit(broken, "k", rule, fallback)).allowed).toBe(false);
    expect((await checkRateLimit(broken, "k", rule)).allowed).toBe(true);
  });
});

describe("RedisRateLimitStore", () => {
  it("вызывает Lua-скрипт с префиксом ключа и разбирает ответ", async () => {
    const calls: unknown[][] = [];
    const redis = {
      eval: async (...args: unknown[]) => {
        calls.push(args);
        return ["7", "59000"];
      },
    };
    const store = new RedisRateLimitStore(redis, "t:");
    const hit = await store.hit("api:ip", 60_000);
    expect(hit).toEqual({ count: 7, ttlMs: 59_000 });
    expect(calls[0]?.[1]).toBe(1);
    expect(calls[0]?.[2]).toBe("t:api:ip");
    expect(calls[0]?.[3]).toBe(60_000);
  });
});

describe("rateLimitHeaders / clientIp", () => {
  it("формирует X-RateLimit-* и Retry-After при отказе", () => {
    const h = rateLimitHeaders({
      allowed: false,
      limit: 10,
      remaining: 0,
      resetAt: Date.now() + 30_000,
    });
    expect(h["X-RateLimit-Limit"]).toBe("10");
    expect(h["X-RateLimit-Remaining"]).toBe("0");
    expect(Number(h["X-RateLimit-Reset"])).toBeGreaterThanOrEqual(29);
    expect(h["Retry-After"]).toBe(h["X-RateLimit-Reset"]);
  });

  it("берёт первый адрес X-Forwarded-For, иначе X-Real-IP, иначе local", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" }))).toBe(
      "203.0.113.5",
    );
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.7" }))).toBe("198.51.100.7");
    expect(clientIp(new Headers())).toBe("local");
  });
});
