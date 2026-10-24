import { beforeEach, describe, expect, it, vi } from "vitest";

/** Redis в памяти: ровно то, что использует withLock (SET … EX … NX и сравнение токена при снятии). */
const store = new Map<string, string>();
vi.mock("../redis", () => ({
  createRedis: () => ({
    async set(key: string, value: string, _ex: string, _ttl: number, nx: string) {
      if (nx === "NX" && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    },
    async eval(_script: string, _n: number, key: string, token: string) {
      if (store.get(key) === token) {
        store.delete(key);
        return 1;
      }
      return 0;
    },
  }),
}));

const { withLock } = await import("../lock");

describe("withLock", () => {
  beforeEach(() => store.clear());

  it("второй одновременный запуск пропускается, после завершения замок снова доступен", async () => {
    let release!: () => void;
    const first = withLock(
      "mailer",
      60,
      () => new Promise<string>((r) => (release = () => r("a"))),
    );
    // первый держит замок — второй сразу получает null и fn не вызывает
    const fn = vi.fn(async () => "b");
    await expect(withLock("mailer", 60, fn)).resolves.toBeNull();
    expect(fn).not.toHaveBeenCalled();
    release();
    await expect(first).resolves.toBe("a");
    expect(store.has("meteo:lock:mailer")).toBe(false);
    await expect(withLock("mailer", 60, async () => "c")).resolves.toBe("c");
  });

  it("замок снимается и при ошибке задачи", async () => {
    await expect(
      withLock("silam-sync", 60, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(store.size).toBe(0);
  });

  it("чужой замок (истёкший и перехваченный) не снимается", async () => {
    await withLock("cap-sync", 60, async () => {
      store.set("meteo:lock:cap-sync", "другой-процесс");
    });
    expect(store.get("meteo:lock:cap-sync")).toBe("другой-процесс");
  });
});
