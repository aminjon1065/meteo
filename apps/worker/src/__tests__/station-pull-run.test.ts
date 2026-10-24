import { describe, expect, it, vi } from "vitest";

// Запрещённый адрес у источника http — ошибка настройки всего источника: статус «failed» с причиной,
// а не «ok» с ошибкой одного файла в сводке (иначе в админке источник выглядит исправным).
const markStationSourceRun = vi.fn(async () => {});
vi.mock("@meteo/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@meteo/db")>()),
  markStationSourceRun,
  loadIngestContext: vi.fn(async () => ({})),
  ingestMeasurements: vi.fn(),
}));
vi.mock("../db", () => ({ db: { insert: vi.fn() } }));

const { pullStationSource } = await import("../station-pull/run");

describe("pullStationSource: запрещённый адрес", () => {
  it("http-источник на loopback помечается сбойным целиком", async () => {
    const source = {
      id: 42,
      enabled: true,
      kind: "http",
      host: "",
      port: null,
      username: null,
      secret: null,
      privateKey: null,
      hostFingerprint: null,
      path: "http://127.0.0.1:5432/feed.csv",
      filePattern: "*.csv",
      mapping: { layout: "wide", time: { column: "time" }, pollutants: {} },
      files: {},
      station: { id: 1, code: "DU-01", status: "active" },
    };
    const result = await pullStationSource(source as never, { now: new Date() });
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/запрещён/);
    expect(markStationSourceRun).toHaveBeenCalledWith(
      expect.anything(),
      42,
      expect.objectContaining({ status: "failed", error: expect.stringMatching(/запрещён/) }),
    );
  });
});
