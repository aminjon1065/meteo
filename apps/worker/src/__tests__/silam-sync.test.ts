import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Перезагрузка прогона SILAM (force) не должна оставлять карту без слоя: прежний прогон удаляется
// только после того, как новый скачан, разобран и отрисован. Сеть, NetCDF и база — подменены.

const silamDir = mkdtempSync(join(tmpdir(), "silam-sync-"));
process.env.SILAM_DIR = silamDir;
afterAll(() => rmSync(silamDir, { recursive: true, force: true }));

/** NetCDF подменён JSON-описанием переменных: { имя: { dims?, attrs?, data } }. */
interface FakeVariable {
  dims?: number[];
  attrs?: Record<string, string>;
  data: number[] | number[][];
}
vi.mock("netcdfjs", () => ({
  NetCDFReader: class {
    dimensions = [{ name: "time" }, { name: "lat" }, { name: "lon" }];
    variables: Array<{ name: string; dimensions: number[]; attributes: unknown[] }>;
    private spec: Record<string, FakeVariable>;
    constructor(buffer: Buffer) {
      this.spec = JSON.parse(buffer.toString()) as Record<string, FakeVariable>;
      this.variables = Object.entries(this.spec).map(([name, v]) => ({
        name,
        dimensions: v.dims ?? [],
        attributes: Object.entries(v.attrs ?? {}).map(([n, value]) => ({ name: n, value })),
      }));
    }
    getDataVariable(name: string) {
      return this.spec[name]?.data;
    }
  },
}));

/** Ответы THREDDS по очереди: первый — проба времени прогона, второй — полная выгрузка. */
const downloads: Array<() => Response> = [];
vi.mock("../resilience", () => ({
  fetchWithRetry: vi.fn(async () => {
    const next = downloads.shift();
    if (!next) throw new Error("лишний запрос");
    return next();
  }),
  runIntegration: vi.fn(),
}));

vi.mock("@meteo/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@meteo/db")>()),
  loadIndexConfig: vi.fn(async () => ({})),
  publicThresholds: () => new Map(),
}));

/** Drizzle-запросы thenable: цепочка возвращает себя, результат — очередной из selectResults. */
const selectResults: unknown[][] = [];
function query(rows: unknown[]) {
  const q = {
    from: () => q,
    where: () => q,
    orderBy: () => q,
    limit: () => q,
    // biome-ignore lint/suspicious/noThenProperty: подмена thenable-запроса Drizzle
    then: (ok: (v: unknown[]) => unknown, fail: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(ok, fail),
  };
  return q;
}
const ops: string[] = [];
const insertedFields: Array<{ runId: number; file: string }> = [];
const tx = {
  delete: () => ({ where: async () => void ops.push("delete-old-run") }),
  insert: () => ({
    values: (v: unknown) => ({
      returning: async () => {
        ops.push(`insert-run:${(v as { status: string }).status}`);
        return [{ id: 8 }];
      },
      onConflictDoNothing: async () => {
        insertedFields.push(...(v as Array<{ runId: number; file: string }>));
      },
    }),
  }),
};
const db = {
  select: vi.fn(() => query(selectResults.shift() ?? [])),
  delete: vi.fn(() => ({ where: async () => {} })),
  transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
};
vi.mock("../db", () => ({ db }));

const { replaceDirectory, removeLeftoverDirs, syncSilam } = await import("../jobs/silam-sync");

const ORIGIN_UNITS = "hours since 2026-10-24 00:00:00";
const RUN_DIR = join(silamDir, "2026102400");

function json(body: unknown): () => Response {
  return () => new Response(JSON.stringify(body), { status: 200 });
}
const probe = json({ time_run: { attrs: { units: ORIGIN_UNITS }, data: [0] } });
/** Сетка 2×2 у Душанбе, один час, PM2.5. */
const subset = json({
  lat: { data: [38.5, 38.6] },
  lon: { data: [68.7, 68.8] },
  time: { attrs: { units: ORIGIN_UNITS }, data: [0] },
  time_run: { attrs: { units: ORIGIN_UNITS }, data: [0] },
  air_dens: { dims: [0, 1, 2], data: [1.1, 1.1, 1.1, 1.1] },
  cnc_PM2_5: { dims: [0, 1, 2], data: [2e-8, 3e-8, 4e-8, 5e-8] },
});
const PM25 = { id: 1, code: "PM25", unit: "µg/m³" };

function oldRunOnDisk() {
  mkdirSync(join(RUN_DIR, "PM25"), { recursive: true });
  writeFileSync(join(RUN_DIR, "PM25", "000.png"), "old");
  writeFileSync(join(RUN_DIR, "old-marker"), "1");
}

beforeEach(() => {
  rmSync(silamDir, { recursive: true, force: true });
  mkdirSync(silamDir, { recursive: true });
  downloads.length = 0;
  selectResults.length = 0;
  ops.length = 0;
  insertedFields.length = 0;
  vi.clearAllMocks();
});

describe("syncSilam: перезагрузка прогона", () => {
  it("THREDDS не отдал полный файл — прежний прогон остаётся и в базе, и на диске", async () => {
    oldRunOnDisk();
    downloads.push(probe, () => {
      throw new Error("THREDDS timeout");
    });
    selectResults.push([{ id: 7, status: "ok" }], [PM25]);

    await expect(syncSilam({ force: true })).rejects.toThrow("THREDDS timeout");
    expect(db.delete).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
    expect(existsSync(join(RUN_DIR, "old-marker"))).toBe(true);
    expect(readdirSync(silamDir)).toEqual(["2026102400"]);
  });

  it("битый ответ (не та сетка) тоже ничего не удаляет", async () => {
    oldRunOnDisk();
    downloads.push(
      probe,
      json({
        lat: { data: [38.5] },
        lon: { data: [68.7] },
        time: { attrs: { units: ORIGIN_UNITS }, data: [0] },
      }),
    );
    selectResults.push([{ id: 7, status: "ok" }], [PM25]);

    await expect(syncSilam({ force: true })).rejects.toThrow(/Сетка SILAM пуста/);
    expect(db.transaction).not.toHaveBeenCalled();
    expect(existsSync(join(RUN_DIR, "old-marker"))).toBe(true);
  });

  it("успешная перезагрузка: каталог подменён целиком, записи заменены одной транзакцией", async () => {
    oldRunOnDisk();
    // посторонний временный каталог от прерванного запуска — убирается
    mkdirSync(join(silamDir, "2026102300.tmp-1-1700000000000"));
    downloads.push(probe, subset);
    // existing, pollutants, forecast_locations, stations, keep, stale
    selectResults.push([{ id: 7, status: "ok" }], [PM25], [], [], [{ id: 8 }], []);

    const summary = await syncSilam({ force: true });
    expect(summary).toMatchObject({ runId: 8, fields: 1, removedRuns: 0 });
    expect(ops).toEqual(["delete-old-run", "insert-run:ok"]);
    expect(insertedFields).toEqual([
      expect.objectContaining({ runId: 8, file: "2026102400/PM25/000.png" }),
    ]);
    expect(existsSync(join(RUN_DIR, "old-marker"))).toBe(false);
    expect(existsSync(join(RUN_DIR, "PM25", "000.png"))).toBe(true);
    expect(readdirSync(silamDir)).toEqual(["2026102400"]);
  });

  it("новый прогон без записи в базе (транзакция упала) не оставляет файлов", async () => {
    downloads.push(probe, subset);
    selectResults.push([], [PM25], [], []);
    db.transaction.mockRejectedValueOnce(new Error("deadlock"));

    await expect(syncSilam({})).rejects.toThrow("deadlock");
    expect(readdirSync(silamDir)).toEqual([]);
  });

  it("загруженный прогон без force не перекачивается", async () => {
    downloads.push(probe);
    selectResults.push([{ id: 7, status: "ok" }]);
    await expect(syncSilam({})).resolves.toMatchObject({ skipped: true });
    expect(downloads).toHaveLength(0);
  });
});

describe("каталоги SILAM", () => {
  it("replaceDirectory ставит новый каталог и когда прежнего нет", async () => {
    const tmp = join(silamDir, "x.tmp");
    mkdirSync(tmp);
    writeFileSync(join(tmp, "f"), "new");
    await replaceDirectory(tmp, join(silamDir, "x"));
    expect(readdirSync(silamDir)).toEqual(["x"]);
    expect(existsSync(join(silamDir, "x", "f"))).toBe(true);
  });

  it("removeLeftoverDirs трогает только временные каталоги прогонов", async () => {
    for (const name of [
      "2026102400",
      "2026102400.tmp-12-1761264000000",
      "2026102300.old-1-1761177600000",
      "notes.tmp-1-2",
    ]) {
      mkdirSync(join(silamDir, name));
    }
    await expect(removeLeftoverDirs(silamDir)).resolves.toBe(2);
    expect(readdirSync(silamDir).sort()).toEqual(["2026102400", "notes.tmp-1-2"]);
    await expect(removeLeftoverDirs(join(silamDir, "нет"))).resolves.toBe(0);
  });
});
