import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Redis в памяти с постраничным SCAN (по 2 ключа за шаг, как бывает на большой базе). KEYS
 * специально бросает ошибку: сброс кэша не должен блокировать общий Redis полным обходом.
 */
class FakeRedis {
  data = new Map<string, string>();
  scanCalls = 0;
  private snapshot: string[] = [];
  keys = vi.fn(async () => {
    throw new Error("KEYS запрещён");
  });
  unlink = vi.fn(async (...keys: string[]) => {
    for (const k of keys) this.data.delete(k);
    return keys.length;
  });
  async scan(cursor: string, _match: "MATCH", pattern: string, _count: "COUNT", _n: number) {
    this.scanCalls += 1;
    // Шаблон вида «буквальный префикс*»: снимаем экранирование, сравниваем начало ключа.
    if (!pattern.endsWith("*") || /(^|[^\\])[*?[]/.test(pattern.slice(0, -1))) {
      throw new Error(`неожиданный шаблон ${pattern}`);
    }
    const literal = pattern.slice(0, -1).replace(/\\(.)/g, "$1");
    // Как в Redis: ключи, существовавшие весь обход, возвращаются, даже если между шагами
    // удалены другие — поэтому обход идёт по снимку, взятому на нулевом курсоре.
    if (cursor === "0") this.snapshot = [...this.data.keys()].sort();
    const all = this.snapshot;
    const start = Number(cursor);
    const page = all.slice(start, start + 2).filter((k) => k.startsWith(literal));
    const next = start + 2 >= all.length ? "0" : String(start + 2);
    return [next, page] as [string, string[]];
  }
  async get(key: string) {
    return this.data.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.data.set(key, value);
    return "OK";
  }
}

const state = vi.hoisted(() => ({ redis: null as FakeRedis | null }));
vi.mock("@/lib/redis", () => ({ getRedis: () => state.redis }));

const { cachedJson, escapeRedisGlob, invalidateCache } = await import("@/lib/cache");

describe("invalidateCache", () => {
  let redis: FakeRedis;
  beforeEach(() => {
    redis = new FakeRedis();
    state.redis = redis;
  });

  it("удаляет ключи префикса курсором SCAN по всем страницам, без KEYS", async () => {
    for (const k of ["index:a", "index:b", "index:c", "index:d", "stations:1", "warnings"]) {
      redis.data.set(`meteo:cache:${k}`, "{}");
    }
    redis.data.set("meteo:lock:mailer", "token");

    await invalidateCache("index:");
    expect([...redis.data.keys()].sort()).toEqual([
      "meteo:cache:stations:1",
      "meteo:cache:warnings",
      "meteo:lock:mailer",
    ]);
    expect(redis.scanCalls).toBeGreaterThan(1);
    expect(redis.keys).not.toHaveBeenCalled();
  });

  it("спецсимволы glob в префиксе сравниваются буквально", async () => {
    redis.data.set("meteo:cache:q*:1", "{}");
    redis.data.set("meteo:cache:qa:1", "{}");
    await invalidateCache("q*");
    expect([...redis.data.keys()]).toEqual(["meteo:cache:qa:1"]);
    expect(escapeRedisGlob("a*b?[c]\\")).toBe("a\\*b\\?\\[c\\]\\\\");
  });

  it("ошибка Redis не роняет вызов", async () => {
    redis.scan = async () => {
      throw new Error("connection closed");
    };
    await expect(invalidateCache("index:")).resolves.toBeUndefined();
  });

  it("сбрасывает и кэш в памяти процесса (без Redis)", async () => {
    state.redis = null;
    const load = vi.fn(async () => ({ n: load.mock.calls.length }));
    expect((await cachedJson("mem:1", 60, load)).hit).toBe(false);
    expect((await cachedJson("mem:1", 60, load)).hit).toBe(true);
    await invalidateCache("mem:");
    expect((await cachedJson("mem:1", 60, load)).hit).toBe(false);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
