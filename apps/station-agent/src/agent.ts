/**
 * Агент станционного компьютера (apps/station-agent): следит за папкой экспорта вендорского ПО,
 * разбирает новые строки CSV/TSV по маппингу колонок (общий парсер @meteo/core/station-feed —
 * тот же, что в pull‑адаптере worker'а) и отправляет их на POST /api/v1/ingest/{station}
 * с ключом станции. Журнал отправленного (state.json) не даёт слать строки повторно; при сбоях
 * сети — повторы с экспоненциальной задержкой; повторная отправка на сервере идемпотентна.
 *
 * Запуск: node station-agent.mjs --config config.json [--once] [--dry-run] [--check] [--verbose]
 * Сборка в один файл: pnpm --filter @meteo/station-agent build (README.md / README.ru.md).
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  type FeedMapping,
  type FeedRecord,
  filePatternToRegExp,
  parseStationFeed,
  validateFeedMapping,
} from "@meteo/core/station-feed";

export const AGENT_VERSION = "0.1.0";

export interface AgentConfig {
  /** Адрес портала, например https://portal.meteo.tj */
  portalUrl: string;
  /** Код станции из реестра (DU-01). */
  stationCode: string;
  /** Ключ API станции (карточка станции в панели администратора) или имя переменной окружения с ним. */
  apiKey?: string;
  apiKeyEnv?: string;
  /** Папка экспорта вендорского ПО (абсолютный путь или относительно config.json). */
  watchDir: string;
  /** Маска файлов: *.csv, DU-01_*.txt … */
  filePattern?: string;
  /** Искать файлы и во вложенных папках. */
  recursive?: boolean;
  /** Описание формата файла (тот же формат, что в источниках станции в админке). */
  mapping: FeedMapping;
  /** Период опроса папки, с (по умолчанию 60); 0 — один проход и выход (Task Scheduler/cron). */
  pollIntervalSec?: number;
  /** Записей в одном запросе (≤ 1000; по умолчанию 500). */
  batchSize?: number;
  timeoutMs?: number;
  /** Повторов запроса при сетевых ошибках и ответах 5xx/429 (по умолчанию 5). */
  retries?: number;
  maxFileMb?: number;
  /** При первом запуске обрабатывать только файлы, изменённые за последние N дней (7). */
  lookbackDays?: number;
  /** Не трогать файлы, изменённые менее N секунд назад — их ещё дописывает ПО (5). */
  settleSec?: number;
  /** Журнал отправленного (по умолчанию station-agent.state.json рядом с config.json). */
  stateFile?: string;
  /** Файл лога (по умолчанию только stdout); ротация при logMaxMb (5 МБ). */
  logFile?: string;
  logMaxMb?: number;
  verbose?: boolean;
}

interface FileState {
  mtime: number;
  size: number;
  /** Отпечаток первой строки: изменился — файл переписан, отправляем заново. */
  head: string;
  /** Последняя отправленная строка файла (номер строки). */
  lastRow: number;
  lastSentAt: string;
  accepted: number;
  rejected: number;
}

interface AgentState {
  version: 1;
  stationCode: string;
  files: Record<string, FileState>;
  lastRunAt: string | null;
  lastOkAt: string | null;
  totals: { sent: number; accepted: number; rejected: number };
}

interface IngestResponse {
  accepted: number;
  rejected: number;
  inserted?: number;
  updated?: number;
  duplicates?: number;
  errors: Array<{ index: number; message: string }>;
  error?: string;
  message?: string;
}

export class AgentError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number,
  ) {
    super(message);
    this.name = "AgentError";
  }
}

// ---------------------------------------------------------------------------------------------
// Лог
// ---------------------------------------------------------------------------------------------

type Level = "debug" | "info" | "warn" | "error";
const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export class Logger {
  constructor(
    private readonly file: string | null,
    private readonly maxBytes: number,
    private readonly minLevel: Level,
  ) {}

  log(level: Level, message: string, data?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;
    const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}${
      data && Object.keys(data).length ? ` ${JSON.stringify(data)}` : ""
    }`;
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.info(line);
    if (this.file) {
      try {
        if (existsSync(this.file) && statSync(this.file).size > this.maxBytes) {
          renameSync(this.file, `${this.file}.1`);
        }
        appendFileSync(this.file, `${line}\n`);
      } catch {
        // лог‑файл недоступен — stdout остаётся
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Конфигурация и состояние
// ---------------------------------------------------------------------------------------------

export function loadConfig(path: string): { config: AgentConfig; dir: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
  } catch (error) {
    throw new AgentError(`Не удалось прочитать конфиг ${path}: ${(error as Error).message}`, 1);
  }
  const problems = validateConfig(raw);
  if (problems.length) throw new AgentError(`Конфиг ${path}:\n  - ${problems.join("\n  - ")}`, 1);
  return { config: raw as AgentConfig, dir: dirname(resolve(path)) };
}

export function validateConfig(raw: unknown): string[] {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object") return ["ожидается объект JSON"];
  const c = raw as Partial<AgentConfig>;
  if (typeof c.portalUrl !== "string" || !/^https?:\/\/\S+$/.test(c.portalUrl))
    errors.push("portalUrl: нужен адрес http(s)://…");
  if (typeof c.stationCode !== "string" || !/^[A-Za-z0-9_-]{2,32}$/.test(c.stationCode))
    errors.push("stationCode: код станции (латиница, цифры, дефис, 2–32 символа)");
  if (!c.apiKey && !c.apiKeyEnv) errors.push("apiKey или apiKeyEnv: ключ станции не задан");
  if (typeof c.watchDir !== "string" || !c.watchDir) errors.push("watchDir: папка экспорта");
  if (c.filePattern !== undefined && typeof c.filePattern !== "string")
    errors.push("filePattern: строка‑маска, например *.csv");
  for (const m of validateFeedMapping(c.mapping)) errors.push(`mapping.${m}`);
  const num = (name: keyof AgentConfig, min: number, max: number) => {
    const v = c[name];
    if (v !== undefined && (typeof v !== "number" || v < min || v > max))
      errors.push(`${name}: число от ${min} до ${max}`);
  };
  num("pollIntervalSec", 0, 86_400);
  num("batchSize", 1, 1000);
  num("timeoutMs", 1_000, 600_000);
  num("retries", 0, 20);
  num("maxFileMb", 0.1, 500);
  num("lookbackDays", 0, 3650);
  num("settleSec", 0, 3600);
  num("logMaxMb", 0.1, 1000);
  return errors;
}

export function resolveApiKey(config: AgentConfig): string {
  if (config.apiKey) return config.apiKey;
  const name = config.apiKeyEnv as string;
  const value = process.env[name];
  if (!value) throw new AgentError(`Переменная окружения ${name} с ключом станции не задана`, 1);
  return value;
}

function emptyState(stationCode: string): AgentState {
  return {
    version: 1,
    stationCode,
    files: {},
    lastRunAt: null,
    lastOkAt: null,
    totals: { sent: 0, accepted: 0, rejected: 0 },
  };
}

export function loadState(path: string, stationCode: string): AgentState {
  if (!existsSync(path)) return emptyState(stationCode);
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<AgentState>;
    if (parsed.version !== 1 || parsed.stationCode !== stationCode) return emptyState(stationCode);
    return { ...emptyState(stationCode), ...parsed, files: parsed.files ?? {} };
  } catch {
    return emptyState(stationCode);
  }
}

export function saveState(path: string, state: AgentState): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, path);
}

// ---------------------------------------------------------------------------------------------
// Файлы
// ---------------------------------------------------------------------------------------------

export interface WatchedFile {
  /** Ключ в журнале: путь относительно папки экспорта. */
  key: string;
  path: string;
  mtime: number;
  size: number;
}

export function listFiles(
  dir: string,
  pattern: RegExp,
  recursive: boolean,
  maxBytes: number,
): WatchedFile[] {
  const out: WatchedFile[] = [];
  const entries = readdirSync(dir, { withFileTypes: true, recursive });
  for (const entry of entries) {
    if (!entry.isFile() || !pattern.test(entry.name)) continue;
    const parent =
      (entry as { parentPath?: string; path?: string }).parentPath ?? entry.path ?? dir;
    const full = join(parent, entry.name);
    const st = statSync(full);
    if (st.size > maxBytes) continue;
    out.push({
      key: relative(dir, full).split(sep).join("/"),
      path: full,
      mtime: st.mtimeMs,
      size: st.size,
    });
  }
  return out.sort((a, b) => a.mtime - b.mtime || a.key.localeCompare(b.key));
}

function headSignature(text: string): string {
  const first = text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
  return first.length > 512 ? `${first.slice(0, 512)}#${first.length}` : first;
}

export function decode(buffer: Buffer, encoding: string | undefined): string {
  return new TextDecoder((encoding ?? "utf-8").trim().toLowerCase()).decode(buffer);
}

/** Какие записи файла ещё не отправлялись: после последней отправленной строки, если файл только дописывался. */
export function selectNewRecords(
  records: FeedRecord[],
  prev: FileState | undefined,
  size: number,
  head: string,
): { records: FeedRecord[]; mode: "all" | "append" | "none" } {
  if (!prev || prev.head !== head || size < prev.size) return { records, mode: "all" };
  const fresh = records.filter((r) => r.row > prev.lastRow);
  return { records: fresh, mode: fresh.length ? "append" : "none" };
}

// ---------------------------------------------------------------------------------------------
// Отправка
// ---------------------------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface SendOptions {
  url: string;
  apiKey: string;
  timeoutMs: number;
  retries: number;
  agent: string;
  logger: Logger;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<unknown>;
}

export interface SendResult {
  accepted: number;
  rejected: number;
  errors: Array<{ row: number | undefined; message: string }>;
}

/** Отправляет пакет записей; сетевые ошибки, 5xx и 429 повторяются; 401/403 — фатально. */
export async function sendBatch(records: FeedRecord[], opts: SendOptions): Promise<SendResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const wait = opts.sleepImpl ?? sleep;
  const body = JSON.stringify(records.map(({ row: _row, ...rec }) => rec));
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await doFetch(opts.url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${opts.apiKey}`,
          "content-type": "application/json",
          "user-agent": opts.agent,
        },
        body,
        signal: AbortSignal.timeout(opts.timeoutMs),
      });
    } catch (error) {
      if (attempt >= opts.retries)
        throw new AgentError(`Портал недоступен: ${(error as Error).message}`, 3);
      const delay = Math.min(60_000, 2_000 * 2 ** attempt);
      opts.logger.log("warn", "сеть: повтор отправки", {
        attempt: attempt + 1,
        delayMs: delay,
        error: (error as Error).message,
      });
      await wait(delay);
      continue;
    }
    const text = await res.text();
    let json: IngestResponse | null = null;
    try {
      json = JSON.parse(text) as IngestResponse;
    } catch {
      json = null;
    }
    if (res.status === 401 || res.status === 403) {
      throw new AgentError(
        `Портал отклонил ключ станции (${res.status} ${json?.error ?? ""}): проверьте stationCode и apiKey`,
        2,
      );
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= opts.retries)
        throw new AgentError(`Портал отвечает ${res.status} после ${attempt + 1} попыток`, 3);
      const retryAfter = Number(res.headers.get("retry-after"));
      const delay =
        res.status === 429 && Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(120_000, retryAfter * 1000)
          : Math.min(60_000, 2_000 * 2 ** attempt);
      opts.logger.log("warn", `портал: ${res.status}, повтор`, {
        attempt: attempt + 1,
        delayMs: delay,
      });
      await wait(delay);
      continue;
    }
    if (res.status === 413 && records.length > 1) {
      const half = Math.ceil(records.length / 2);
      opts.logger.log("warn", "пакет слишком большой: делим пополам", { size: records.length });
      const a = await sendBatch(records.slice(0, half), opts);
      const b = await sendBatch(records.slice(half), opts);
      return {
        accepted: a.accepted + b.accepted,
        rejected: a.rejected + b.rejected,
        errors: [...a.errors, ...b.errors],
      };
    }
    if (res.status === 200 || res.status === 422) {
      const errors = (json?.errors ?? []).map((e) => ({
        row: records[e.index]?.row,
        message: e.message,
      }));
      return { accepted: json?.accepted ?? 0, rejected: json?.rejected ?? records.length, errors };
    }
    // 400 и прочее: данные пакета не приняты и не будут — пропускаем, чтобы не зациклиться.
    opts.logger.log("error", `портал отклонил пакет: ${res.status}`, {
      error: json?.error ?? text.slice(0, 300),
      message: json?.message,
    });
    return {
      accepted: 0,
      rejected: records.length,
      errors: [{ row: undefined, message: `http:${res.status}` }],
    };
  }
}

// ---------------------------------------------------------------------------------------------
// Цикл обработки
// ---------------------------------------------------------------------------------------------

export interface RunOptions {
  config: AgentConfig;
  configDir: string;
  state: AgentState;
  logger: Logger;
  dryRun: boolean;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<unknown>;
  now?: () => Date;
}

export interface RunSummary {
  files: number;
  sent: number;
  accepted: number;
  rejected: number;
}

function resolvePath(base: string, value: string): string {
  return resolve(base, value);
}

function groupErrors(
  errors: Array<{ row: number | undefined; message: string }>,
): Record<string, string> {
  const groups = new Map<string, number[]>();
  for (const e of errors) {
    const kind = e.message.split(":")[0] ?? e.message;
    const key = e.message.length > 60 ? kind : e.message;
    const rows = groups.get(key) ?? [];
    if (e.row !== undefined && rows.length < 10) rows.push(e.row);
    groups.set(key, rows);
  }
  return Object.fromEntries(
    [...groups.entries()].map(([k, rows]) => [k, rows.length ? `строки ${rows.join(",")}` : ""]),
  );
}

/** Один проход: новые/изменившиеся файлы → разбор → отправка → журнал. */
export async function runOnce(opts: RunOptions): Promise<RunSummary> {
  const { config, logger, state } = opts;
  const now = (opts.now ?? (() => new Date()))();
  const watchDir = resolvePath(opts.configDir, config.watchDir);
  if (!existsSync(watchDir)) throw new AgentError(`Папка экспорта не найдена: ${watchDir}`, 1);
  const maxBytes = Math.round((config.maxFileMb ?? 20) * 1024 * 1024);
  const settleMs = (config.settleSec ?? 5) * 1000;
  const lookbackMs = (config.lookbackDays ?? 7) * 86_400_000;
  const firstRun = Object.keys(state.files).length === 0;
  const files = listFiles(
    watchDir,
    filePatternToRegExp(config.filePattern ?? "*.csv"),
    config.recursive ?? false,
    maxBytes,
  ).filter((f) => {
    if (settleMs > 0 && now.getTime() - f.mtime < settleMs) return false;
    if (firstRun && lookbackMs > 0 && now.getTime() - f.mtime > lookbackMs) return false;
    const prev = state.files[f.key];
    return !prev || prev.mtime !== f.mtime || prev.size !== f.size;
  });
  const summary: RunSummary = { files: 0, sent: 0, accepted: 0, rejected: 0 };
  const apiKey = opts.dryRun ? "dry-run" : resolveApiKey(config);
  const url = `${config.portalUrl.replace(/\/+$/, "")}/api/v1/ingest/${encodeURIComponent(config.stationCode)}`;
  const agent = `meteo-station-agent/${AGENT_VERSION} (${config.stationCode}; node ${process.version})`;
  const batchSize = Math.min(1000, Math.max(1, config.batchSize ?? 500));

  for (const file of files) {
    const text = decode(readFileSync(file.path), config.mapping.encoding);
    const head = headSignature(text);
    const parsed = parseStationFeed(text, config.mapping, { now });
    const prev = state.files[file.key];
    const selection = selectNewRecords(parsed.records, prev, file.size, head);
    if (parsed.errors.length) {
      logger.log("warn", `разбор ${file.key}: ошибки в строках`, {
        errors: parsed.errors.length,
        sample: parsed.errors.slice(0, 5),
      });
    }
    logger.log(selection.records.length ? "info" : "debug", `файл ${file.key}`, {
      rows: parsed.total,
      records: parsed.records.length,
      toSend: selection.records.length,
      mode: selection.mode,
    });
    summary.files += 1;
    let accepted = 0;
    let rejected = 0;
    const errors: SendResult["errors"] = [];
    if (opts.dryRun) {
      if (selection.records.length) {
        logger.log("info", "dry-run: первые записи", {
          records: selection.records.slice(0, 5),
        });
      }
      continue;
    }
    const ordered = [...selection.records].sort((a, b) => a.row - b.row);
    for (let i = 0; i < ordered.length; i += batchSize) {
      const batch = ordered.slice(i, i + batchSize);
      const result = await sendBatch(batch, {
        url,
        apiKey,
        timeoutMs: config.timeoutMs ?? 30_000,
        retries: config.retries ?? 5,
        agent,
        logger,
        fetchImpl: opts.fetchImpl,
        sleepImpl: opts.sleepImpl,
      });
      accepted += result.accepted;
      rejected += result.rejected;
      errors.push(...result.errors);
      summary.sent += batch.length;
      // Журнал обновляется после каждого пакета: при обрыве следующие пакеты уйдут в следующий раз.
      const lastRow = batch[batch.length - 1]?.row ?? prev?.lastRow ?? 0;
      state.files[file.key] = {
        mtime: file.mtime,
        size: file.size,
        head,
        lastRow: Math.max(lastRow, selection.mode === "append" ? (prev?.lastRow ?? 0) : 0),
        lastSentAt: now.toISOString(),
        accepted: (selection.mode === "append" ? (prev?.accepted ?? 0) : 0) + accepted,
        rejected: (selection.mode === "append" ? (prev?.rejected ?? 0) : 0) + rejected,
      };
      state.totals.sent += batch.length;
      state.totals.accepted += result.accepted;
      state.totals.rejected += result.rejected;
      saveState(resolvePath(opts.configDir, config.stateFile ?? "station-agent.state.json"), state);
    }
    if (ordered.length === 0) {
      state.files[file.key] = {
        mtime: file.mtime,
        size: file.size,
        head,
        lastRow: prev?.lastRow ?? 0,
        lastSentAt: prev?.lastSentAt ?? now.toISOString(),
        accepted: prev?.accepted ?? 0,
        rejected: prev?.rejected ?? 0,
      };
    }
    summary.accepted += accepted;
    summary.rejected += rejected;
    if (ordered.length) {
      logger.log(rejected ? "warn" : "info", `отправлено ${file.key}`, {
        sent: ordered.length,
        accepted,
        rejected,
        ...(errors.length ? { reasons: groupErrors(errors) } : {}),
      });
    }
  }
  state.lastRunAt = now.toISOString();
  state.lastOkAt = now.toISOString();
  if (!opts.dryRun)
    saveState(resolvePath(opts.configDir, config.stateFile ?? "station-agent.state.json"), state);
  return summary;
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

const HELP = `Агент станции Метеопортала ${AGENT_VERSION}
  node station-agent.mjs --config config.json [параметры]
    --config, -c  путь к конфигу (по умолчанию ./config.json)
    --once        один проход и выход (для Планировщика Windows / cron)
    --dry-run     разобрать файлы и показать, что было бы отправлено, ничего не слать
    --check       проверить конфиг, папку и формат самого свежего файла
    --verbose     подробный лог
    --help, -h    эта справка
  Коды выхода: 0 — успех, 1 — ошибка конфига/папки, 2 — ключ станции отклонён, 3 — портал недоступен.`;

async function main(): Promise<number> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      config: { type: "string", short: "c", default: "config.json" },
      once: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      check: { type: "boolean", default: false },
      verbose: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.info(HELP);
    return 0;
  }
  const { config, dir } = loadConfig(resolve(values.config));
  const logger = new Logger(
    config.logFile ? resolve(dir, config.logFile) : null,
    Math.round((config.logMaxMb ?? 5) * 1024 * 1024),
    values.verbose || config.verbose ? "debug" : "info",
  );
  const statePath = resolve(dir, config.stateFile ?? "station-agent.state.json");
  const state = loadState(statePath, config.stationCode);

  if (values.check) {
    const watchDir = resolve(dir, config.watchDir);
    if (!existsSync(watchDir)) throw new AgentError(`Папка экспорта не найдена: ${watchDir}`, 1);
    const files = listFiles(
      watchDir,
      filePatternToRegExp(config.filePattern ?? "*.csv"),
      config.recursive ?? false,
      Math.round((config.maxFileMb ?? 20) * 1024 * 1024),
    );
    logger.log("info", "конфиг в порядке", {
      portal: config.portalUrl,
      station: config.stationCode,
      watchDir,
      files: files.length,
      journal: Object.keys(state.files).length,
    });
    const newest = files[files.length - 1];
    if (newest) {
      const parsed = parseStationFeed(
        decode(readFileSync(newest.path), config.mapping.encoding),
        config.mapping,
      );
      logger.log(parsed.errors.length ? "warn" : "info", `свежий файл ${newest.key}`, {
        rows: parsed.total,
        records: parsed.records.length,
        errors: parsed.errors.slice(0, 10),
        sample: parsed.records.slice(0, 3),
        period: [parsed.from, parsed.to],
      });
      return parsed.records.length > 0 ? 0 : 1;
    }
    logger.log("warn", "в папке нет файлов по маске");
    return 0;
  }

  const once = values.once || (config.pollIntervalSec ?? 60) <= 0 || values["dry-run"];
  const run = () => runOnce({ config, configDir: dir, state, logger, dryRun: values["dry-run"] });
  if (once) {
    const summary = await run();
    logger.log("info", values["dry-run"] ? "dry-run завершён" : "проход завершён", { ...summary });
    return 0;
  }

  let stopping = false;
  const stop = (signal: string) => {
    logger.log("info", `получен ${signal}, завершаю после текущего прохода`);
    stopping = true;
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
  logger.log("info", `агент запущен (опрос каждые ${config.pollIntervalSec ?? 60} с)`, {
    station: config.stationCode,
    portal: config.portalUrl,
  });
  while (!stopping) {
    try {
      const summary = await run();
      if (summary.sent) logger.log("info", "проход завершён", { ...summary });
    } catch (error) {
      const exit = error instanceof AgentError ? error.exitCode : 3;
      logger.log("error", (error as Error).message, { exitCode: exit });
      if (exit === 1) return exit; // конфиг или папка: без вмешательства не починится
    }
    const interval = (config.pollIntervalSec ?? 60) * 1000;
    for (let waited = 0; waited < interval && !stopping; waited += 1000) await sleep(1000);
  }
  logger.log("info", "агент остановлен");
  return 0;
}

const isEntry = (() => {
  try {
    return (
      process.argv[1] !== undefined &&
      resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
})();

if (isEntry || process.env.METEO_AGENT_MAIN === "1") {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      const exit = error instanceof AgentError ? error.exitCode : 3;
      console.error(`${new Date().toISOString()} ERROR ${(error as Error).message}`);
      process.exit(exit);
    });
}
