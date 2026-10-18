import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { FeedRecord } from "@meteo/core/station-feed";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type AgentConfig,
  AgentError,
  Logger,
  listFiles,
  loadState,
  resolveApiKey,
  runOnce,
  selectNewRecords,
  sendBatch,
  validateConfig,
} from "../agent";

const EXAMPLES = resolve(import.meta.dirname, "../../examples");
const quiet = new Logger(null, 1024, "error");
const noSleep = async () => undefined;

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function records(n: number, startRow = 2): FeedRecord[] {
  return Array.from({ length: n }, (_, i) => ({
    time: `2026-10-17T0${i % 10}:00:00.000Z`,
    pollutant: "PM25",
    value: 10 + i,
    row: startRow + i,
  }));
}

describe("validateConfig / resolveApiKey", () => {
  it("находит пропуски и проверяет маппинг", () => {
    expect(validateConfig(null)).toEqual(["ожидается объект JSON"]);
    const errors = validateConfig({
      portalUrl: "ftp://x",
      stationCode: "!",
      watchDir: "",
      mapping: {},
    });
    expect(errors.some((e) => e.startsWith("portalUrl"))).toBe(true);
    expect(errors.some((e) => e.startsWith("stationCode"))).toBe(true);
    expect(errors.some((e) => e.startsWith("apiKey"))).toBe(true);
    expect(errors.some((e) => e.startsWith("watchDir"))).toBe(true);
    expect(errors.some((e) => e.startsWith("mapping.layout"))).toBe(true);
    for (const file of [
      "config.wide-semicolon.json",
      "config.long-format.json",
      "config.tsv-iso-utc.json",
      "config.split-date-time.json",
      "config.local-test.json",
    ]) {
      expect(validateConfig(JSON.parse(readFileSync(join(EXAMPLES, file), "utf8"))), file).toEqual(
        [],
      );
    }
  });
  it("ключ из конфига или из окружения", () => {
    const base = {
      portalUrl: "https://p",
      stationCode: "DU-01",
      watchDir: ".",
      mapping: {},
    } as AgentConfig;
    expect(resolveApiKey({ ...base, apiKey: "mst_x" })).toBe("mst_x");
    process.env.METEO_TEST_KEY = "mst_env";
    expect(resolveApiKey({ ...base, apiKeyEnv: "METEO_TEST_KEY" })).toBe("mst_env");
    process.env.METEO_TEST_KEY = "";
    expect(() => resolveApiKey({ ...base, apiKeyEnv: "METEO_TEST_KEY" })).toThrow(AgentError);
  });
});

describe("selectNewRecords", () => {
  const prev = {
    mtime: 1,
    size: 100,
    head: "h",
    lastRow: 4,
    lastSentAt: "",
    accepted: 0,
    rejected: 0,
  };
  it("дописанный файл: только строки после последней отправленной", () => {
    const sel = selectNewRecords(records(5), prev, 150, "h");
    expect(sel.mode).toBe("append");
    expect(sel.records.map((r) => r.row)).toEqual([5, 6]);
  });
  it("переписанный файл (другой заголовок или меньше) — всё заново; без изменений — ничего", () => {
    expect(selectNewRecords(records(5), prev, 150, "other").mode).toBe("all");
    expect(selectNewRecords(records(5), prev, 50, "h").mode).toBe("all");
    expect(selectNewRecords(records(3), prev, 100, "h").mode).toBe("none");
    expect(selectNewRecords(records(2), undefined, 10, "h").mode).toBe("all");
  });
});

describe("sendBatch", () => {
  const base = {
    url: "https://p/api/v1/ingest/DU-01",
    apiKey: "k",
    timeoutMs: 1000,
    retries: 2,
    agent: "t",
    logger: quiet,
    sleepImpl: noSleep,
  };

  it("200: принятые/отклонённые с номерами строк", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse(200, {
        accepted: 2,
        rejected: 1,
        errors: [{ index: 1, message: "unit:x" }],
      });
    }) as typeof fetch;
    const r = await sendBatch(records(3), { ...base, fetchImpl });
    expect(r).toEqual({ accepted: 2, rejected: 1, errors: [{ row: 3, message: "unit:x" }] });
    expect(calls[0]?.url).toBe(base.url);
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer k");
    expect(JSON.parse(String(calls[0]?.init.body))[0]).not.toHaveProperty("row");
  });

  it("5xx и сеть повторяются, потом успех; 401 — фатально", async () => {
    let n = 0;
    const flaky = (async () => {
      n += 1;
      if (n === 1) throw new TypeError("fetch failed");
      if (n === 2) return jsonResponse(503, { error: "down" });
      return jsonResponse(200, { accepted: 1, rejected: 0, errors: [] });
    }) as typeof fetch;
    expect((await sendBatch(records(1), { ...base, fetchImpl: flaky })).accepted).toBe(1);
    expect(n).toBe(3);
    const denied = (async () => jsonResponse(401, { error: "unauthorized" })) as typeof fetch;
    await expect(sendBatch(records(1), { ...base, fetchImpl: denied })).rejects.toMatchObject({
      exitCode: 2,
    });
    const dead = (async () => jsonResponse(502, {})) as typeof fetch;
    await expect(sendBatch(records(1), { ...base, fetchImpl: dead })).rejects.toMatchObject({
      exitCode: 3,
    });
  });

  it("413 делит пакет пополам; 429 ждёт Retry-After", async () => {
    const sizes: number[] = [];
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      const len = (JSON.parse(String(init?.body)) as unknown[]).length;
      sizes.push(len);
      if (len > 2) return jsonResponse(413, { error: "payload_too_large" });
      return jsonResponse(200, { accepted: len, rejected: 0, errors: [] });
    }) as typeof fetch;
    const r = await sendBatch(records(5), { ...base, fetchImpl });
    expect(r.accepted).toBe(5);
    expect(sizes).toEqual([5, 3, 2, 1, 2]);
    const waits: number[] = [];
    let n = 0;
    const limited = (async () => {
      n += 1;
      return n === 1
        ? jsonResponse(429, { error: "rate_limited" }, { "retry-after": "7" })
        : jsonResponse(200, { accepted: 1, rejected: 0, errors: [] });
    }) as typeof fetch;
    await sendBatch(records(1), {
      ...base,
      fetchImpl: limited,
      sleepImpl: async (ms) => {
        waits.push(ms);
      },
    });
    expect(waits).toEqual([7000]);
  });
});

describe("runOnce: папка экспорта, журнал, дозапись", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "meteo-agent-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("отправляет новые строки, пропускает уже отправленные, учитывает дозапись", async () => {
    const config = JSON.parse(
      readFileSync(join(EXAMPLES, "config.local-test.json"), "utf8"),
    ) as AgentConfig;
    config.watchDir = dir;
    config.stateFile = join(dir, "state.json");
    config.apiKey = "mst_test";
    config.settleSec = 0;
    const header =
      "Дата/время;PM2.5 (мкг/м3);PM10 (мкг/м3);NO2 (мкг/м3);SO2 (мкг/м3);CO (мг/м3);O3 (мкг/м3);Статус\n";
    const file = join(dir, "export.csv");
    writeFileSync(
      file,
      `${header}17.10.2026 12:00;12,5;30;18;7;0,8;41;OK\n17.10.2026 13:00;14;33;21;6,9;0,9;44;OK\n`,
    );
    const sent: unknown[][] = [];
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      const batch = JSON.parse(String(init?.body)) as unknown[];
      sent.push(batch);
      return jsonResponse(200, { accepted: batch.length, rejected: 0, errors: [] });
    }) as typeof fetch;
    const state = loadState(config.stateFile, config.stationCode);
    const base = {
      config,
      configDir: dir,
      state,
      logger: quiet,
      dryRun: false,
      fetchImpl,
      sleepImpl: noSleep,
    };

    const first = await runOnce({ ...base, now: () => new Date("2026-10-18T10:00:00Z") });
    expect(first).toEqual({ files: 1, sent: 12, accepted: 12, rejected: 0 });
    expect(sent).toHaveLength(1);
    expect(listFiles(dir, /.*/, false, 1e9)).toHaveLength(2); // export.csv + state.json

    // Без изменений — ничего не отправляется.
    const second = await runOnce({ ...base, now: () => new Date("2026-10-18T10:01:00Z") });
    expect(second.sent).toBe(0);

    // Дозапись строки: уходят только 6 новых записей (одна строка × 6 веществ).
    writeFileSync(file, `${readFileSync(file, "utf8")}17.10.2026 14:00;13;31;17;6,5;0,7;45;OK\n`);
    const third = await runOnce({ ...base, now: () => new Date("2026-10-18T10:02:00Z") });
    expect(third).toEqual({ files: 1, sent: 6, accepted: 6, rejected: 0 });
    const saved = JSON.parse(readFileSync(config.stateFile, "utf8")) as {
      files: Record<string, { lastRow: number; accepted: number }>;
      totals: { sent: number };
    };
    expect(saved.files["export.csv"]?.lastRow).toBe(4);
    expect(saved.files["export.csv"]?.accepted).toBe(18);
    expect(saved.totals.sent).toBe(18);

    // Файл переписан с меньшим числом строк — отправляется заново целиком.
    writeFileSync(file, `${header}18.10.2026 09:00;9;20;10;5;0,5;30;OK\n`);
    const fourth = await runOnce({ ...base, now: () => new Date("2026-10-18T10:03:00Z") });
    expect(fourth.sent).toBe(6);
  });

  it("dry-run ничего не шлёт и не пишет журнал; ключ не требуется", async () => {
    const config = JSON.parse(
      readFileSync(join(EXAMPLES, "config.local-test.json"), "utf8"),
    ) as AgentConfig;
    config.watchDir = dir;
    config.stateFile = join(dir, "state.json");
    config.settleSec = 0;
    writeFileSync(
      join(dir, "a.csv"),
      "Дата/время;PM2.5 (мкг/м3);PM10 (мкг/м3);NO2 (мкг/м3);SO2 (мкг/м3);CO (мг/м3);O3 (мкг/м3);Статус\n17.10.2026 12:00;1;2;3;4;0,5;6;OK\n",
    );
    const fetchImpl = (async () => {
      throw new Error("must not be called");
    }) as typeof fetch;
    const state = loadState(config.stateFile, config.stationCode);
    const r = await runOnce({
      config,
      configDir: dir,
      state,
      logger: quiet,
      dryRun: true,
      fetchImpl,
    });
    expect(r.files).toBe(1);
    expect(r.sent).toBe(0);
    expect(listFiles(dir, /state/, false, 1e9)).toHaveLength(0);
  });
});
