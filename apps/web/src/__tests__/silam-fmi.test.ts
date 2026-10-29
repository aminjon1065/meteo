import { fmiSilamProduct } from "@meteo/core/silam-fmi";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Прокси карт SILAM от FMI (lib/silam-fmi): прогон по Last-Modified, кадр не того прогона не
 * отдаётся под чужим адресом, при смене суток кадр находится на каталог дальше, повторно у FMI
 * не скачивается.
 */
vi.mock("@/lib/redis", () => ({ getRedis: () => null }));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const ISSUED_28 = "Wed, 28 Oct 2026 02:03:49 GMT"; // прогон от 27.10
const ISSUED_29 = "Thu, 29 Oct 2026 02:02:56 GMT"; // прогон от 28.10

function png(lastModified: string) {
  return new Response(PNG, {
    status: 200,
    headers: {
      "content-type": "image/png",
      "content-length": String(PNG.byteLength),
      "last-modified": lastModified,
    },
  });
}

async function load() {
  vi.resetModules();
  return import("@/lib/silam-fmi");
}

describe("silam-fmi", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("SILAM_FMI_URL", "https://fmi.test/roux/TAJ/");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("каталог: прогон — 00 UTC суток перед выпуском", async () => {
    fetchMock.mockResolvedValueOnce(png(ISSUED_29));
    const { loadFmiSilamCatalog } = await load();
    expect(await loadFmiSilamCatalog()).toEqual({
      originTime: "2026-10-28T00:00:00.000Z",
      issuedAt: "2026-10-29T02:02:56.000Z",
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://fmi.test/roux/TAJ/000/AQI_000.png");
    expect(init?.method).toBe("HEAD");
  });

  it("каталог: FMI не ответил — null и минуту без повторных запросов", async () => {
    fetchMock.mockRejectedValue(new Error("timeout"));
    const { loadFmiSilamCatalog } = await load();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await loadFmiSilamCatalog()).toBeNull();
    expect(await loadFmiSilamCatalog()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("каталог: SILAM_FMI_URL=off — раздел без карт и без запросов", async () => {
    vi.stubEnv("SILAM_FMI_URL", "off");
    const { loadFmiSilamCatalog } = await load();
    expect(await loadFmiSilamCatalog()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("кадр: в 000 уже новый прогон — берётся из 001, второй раз из памяти", async () => {
    const pm10 = fmiSilamProduct("PM10");
    if (!pm10) throw new Error("нет PM10");
    fetchMock.mockImplementation(async (input) =>
      String(input).includes("/000/") ? png(ISSUED_29) : png(ISSUED_28),
    );
    const { loadFmiSilamFrame } = await load();
    const origin = new Date("2026-10-27T00:00:00Z");
    const first = await loadFmiSilamFrame(pm10, origin, 24, [0, 1]);
    expect(first.status).toBe("ok");
    expect(fetchMock.mock.calls.map(([u]) => String(u))).toEqual([
      "https://fmi.test/roux/TAJ/000/PM10_surf_024.png",
      "https://fmi.test/roux/TAJ/001/PM10_surf_024.png",
    ]);
    const again = await loadFmiSilamFrame(pm10, origin, 24, [0, 1]);
    expect(again).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("кадр: одновременные запросы одного кадра идут к FMI один раз", async () => {
    const aqi = fmiSilamProduct("AQI");
    if (!aqi) throw new Error("нет AQI");
    fetchMock.mockImplementation(async () => png(ISSUED_29));
    const { loadFmiSilamFrame } = await load();
    const origin = new Date("2026-10-28T00:00:00Z");
    const results = await Promise.all([
      loadFmiSilamFrame(aqi, origin, 0, [0]),
      loadFmiSilamFrame(aqi, origin, 0, [0]),
    ]);
    expect(results.map((r) => r.status)).toEqual(["ok", "ok"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("кадр: не PNG или без Last-Modified не отдаётся", async () => {
    const so2 = fmiSilamProduct("SO2");
    if (!so2) throw new Error("нет SO2");
    const { loadFmiSilamFrame } = await load();
    const origin = new Date("2026-10-28T00:00:00Z");
    fetchMock.mockResolvedValueOnce(
      new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }),
    );
    expect((await loadFmiSilamFrame(so2, origin, 1, [0])).status).toBe("error");
    fetchMock.mockResolvedValueOnce(
      new Response(PNG, { status: 200, headers: { "content-type": "image/png" } }),
    );
    expect((await loadFmiSilamFrame(so2, origin, 2, [0])).status).toBe("missing");
    fetchMock.mockResolvedValueOnce(new Response("not found", { status: 404 }));
    expect((await loadFmiSilamFrame(so2, origin, 3, [0])).status).toBe("missing");
  });
});
