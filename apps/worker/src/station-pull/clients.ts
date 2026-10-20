/**
 * Клиенты источников станций: единый интерфейс «список файлов → чтение файла» поверх
 * SFTP (ssh2), FTP/FTPS (basic-ftp) и HTTP(S) (fetch). Сетевая часть задачи station-pull.
 */
import { readFile, stat } from "node:fs/promises";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { Client as FtpClient } from "basic-ftp";
import { type SFTPWrapper, Client as SshClient } from "ssh2";
import { fetchWithRetry } from "../resilience";
import { httpHeaders } from "./shared";
import { assertAllowedTarget, ForbiddenTargetError } from "./target";

export interface RemoteFile {
  name: string;
  size: number | null;
  mtime: Date | null;
  /** HTTP: ETag/Last-Modified для условных запросов. */
  etag?: string | null;
}

export interface RemoteRead {
  /** null — файл не изменился (HTTP 304). */
  body: Buffer | null;
  etag?: string | null;
  lastModified?: Date | null;
}

export interface RemoteClient {
  list(dir: string): Promise<RemoteFile[]>;
  read(dir: string, name: string, maxBytes: number, conditional?: RemoteFile): Promise<RemoteRead>;
  close(): Promise<void>;
}

export interface ClientConfig {
  kind: "sftp" | "ftp" | "ftps" | "http";
  host: string;
  port: number | null;
  username: string | null;
  password: string | null;
  privateKey: string | null;
  hostFingerprint: string | null;
  timeoutMs: number;
}

export class FileTooLargeError extends Error {
  constructor(name: string, size: number, maxBytes: number) {
    super(`Файл ${name} слишком большой: ${size} байт (предел ${maxBytes})`);
    this.name = "FileTooLargeError";
  }
}

function joinRemote(dir: string, name: string): string {
  if (!dir || dir === ".") return name;
  return `${dir.replace(/\/+$/, "")}/${name}`;
}

/** Нормализует отпечаток SHA‑256 ключа хоста (SHA256:base64 из ssh-keygen или hex с двоеточиями) в hex. */
export function normalizeFingerprint(raw: string): string {
  const s = raw.trim();
  if (/^SHA256:/i.test(s)) {
    let b64 = s.slice(7).trim();
    while (b64.length % 4 !== 0) b64 += "=";
    return Buffer.from(b64, "base64").toString("hex");
  }
  return s
    .replace(/^sha256[:=]/i, "")
    .replace(/[:\s]/g, "")
    .toLowerCase();
}

// ---------------------------------------------------------------------------------------------
// SFTP
// ---------------------------------------------------------------------------------------------

async function openSftp(cfg: ClientConfig): Promise<RemoteClient> {
  const expected = cfg.hostFingerprint ? normalizeFingerprint(cfg.hostFingerprint) : null;
  const conn = new SshClient();
  await new Promise<void>((resolve, reject) => {
    conn
      .on("ready", () => resolve())
      .on("error", (error) => reject(error))
      .connect({
        host: cfg.host,
        port: cfg.port ?? 22,
        username: cfg.username ?? undefined,
        password: cfg.password ?? undefined,
        privateKey: cfg.privateKey ?? undefined,
        readyTimeout: cfg.timeoutMs,
        keepaliveInterval: 10_000,
        hostHash: "sha256",
        hostVerifier: (hash: string | Buffer) => {
          if (!expected) return true;
          const actual = (typeof hash === "string" ? hash : hash.toString("hex")).toLowerCase();
          return actual === expected;
        },
      });
  });
  const sftp = await new Promise<SFTPWrapper>((resolve, reject) =>
    conn.sftp((error, wrapper) => (error ? reject(error) : resolve(wrapper))),
  );
  return {
    async list(dir) {
      const entries = await new Promise<Awaited<ReturnType<typeof readdirAsync>>>(
        (resolve, reject) =>
          sftp.readdir(dir || ".", (error, list) => (error ? reject(error) : resolve(list))),
      );
      return entries
        .filter((e) => {
          const attrs = e.attrs as { isFile?: () => boolean; mode?: number };
          if (typeof attrs.isFile === "function") return attrs.isFile();
          return typeof attrs.mode === "number" ? (attrs.mode & 0o170000) === 0o100000 : true;
        })
        .map((e) => ({
          name: e.filename,
          size: typeof e.attrs.size === "number" ? e.attrs.size : null,
          mtime: typeof e.attrs.mtime === "number" ? new Date(e.attrs.mtime * 1000) : null,
        }));
    },
    async read(dir, name, maxBytes) {
      const remote = joinRemote(dir, name);
      const stat = await new Promise<{ size?: number }>((resolve, reject) =>
        sftp.stat(remote, (error, st) => (error ? reject(error) : resolve(st))),
      );
      if (typeof stat.size === "number" && stat.size > maxBytes)
        throw new FileTooLargeError(name, stat.size, maxBytes);
      const body = await new Promise<Buffer>((resolve, reject) =>
        sftp.readFile(remote, (error, data) => (error ? reject(error) : resolve(data))),
      );
      if (body.length > maxBytes) throw new FileTooLargeError(name, body.length, maxBytes);
      return { body };
    },
    async close() {
      conn.end();
    },
  };
}

type ReaddirEntry = { filename: string; attrs: { size?: number; mtime?: number } };
async function readdirAsync(): Promise<ReaddirEntry[]> {
  return [];
}

// ---------------------------------------------------------------------------------------------
// FTP / FTPS
// ---------------------------------------------------------------------------------------------

async function openFtp(cfg: ClientConfig): Promise<RemoteClient> {
  const client = new FtpClient(cfg.timeoutMs);
  await client.access({
    host: cfg.host,
    port: cfg.port ?? 21,
    user: cfg.username ?? "anonymous",
    password: cfg.password ?? "anonymous@",
    secure: cfg.kind === "ftps",
  });
  return {
    async list(dir) {
      const entries = await client.list(dir || undefined);
      const out: RemoteFile[] = [];
      for (const e of entries) {
        if (!e.isFile) continue;
        out.push({ name: e.name, size: e.size ?? null, mtime: e.modifiedAt ?? null });
      }
      return out;
    },
    async read(dir, name, maxBytes) {
      const remote = joinRemote(dir, name);
      const size = await client.size(remote).catch(() => null);
      if (size !== null && size > maxBytes) throw new FileTooLargeError(name, size, maxBytes);
      const chunks: Buffer[] = [];
      let total = 0;
      const sink = new Writable({
        write(chunk: Buffer, _enc, cb) {
          total += chunk.length;
          if (total > maxBytes) {
            cb(new FileTooLargeError(name, total, maxBytes));
            return;
          }
          chunks.push(chunk);
          cb();
        },
      });
      await client.downloadTo(sink, remote);
      return { body: Buffer.concat(chunks) };
    },
    async close() {
      client.close();
    },
  };
}

// ---------------------------------------------------------------------------------------------
// HTTP(S): один файл по адресу; условные запросы по ETag / Last-Modified
// ---------------------------------------------------------------------------------------------

export function httpFileName(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : u.hostname;
  } catch {
    return "download";
  }
}

function openHttp(cfg: ClientConfig): RemoteClient {
  const headers = httpHeaders(cfg.username, cfg.password, "text/csv, text/plain, */*");
  return {
    async list(url) {
      return [{ name: httpFileName(url), size: null, mtime: null }];
    },
    async read(url, _name, maxBytes, conditional) {
      assertAllowedTarget("http", url);
      const h = { ...headers };
      if (conditional?.etag) h["if-none-match"] = conditional.etag;
      if (conditional?.mtime) h["if-modified-since"] = conditional.mtime.toUTCString();
      const res = await fetchWithRetry(
        url,
        { headers: h },
        { retries: 2, timeoutMs: cfg.timeoutMs, label: "station-pull" },
      );
      if (res.status === 304) {
        await res.body?.cancel().catch(() => {});
        return { body: null };
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} для ${url}`);
      const declared = Number(res.headers.get("content-length") ?? 0);
      if (declared > maxBytes) {
        await res.body?.cancel().catch(() => {});
        throw new FileTooLargeError(httpFileName(url), declared, maxBytes);
      }
      const body = Buffer.from(await res.arrayBuffer());
      if (body.length > maxBytes)
        throw new FileTooLargeError(httpFileName(url), body.length, maxBytes);
      const lastModified = res.headers.get("last-modified");
      return {
        body,
        etag: res.headers.get("etag"),
        lastModified: lastModified ? new Date(lastModified) : null,
      };
    },
    async close() {},
  };
}

export async function openRemoteClient(cfg: ClientConfig): Promise<RemoteClient> {
  // HTTP проверяется по URL при чтении (host задан в path источника); sftp/ftp — здесь.
  if (cfg.kind !== "http") assertAllowedTarget(cfg.kind, cfg.host);
  switch (cfg.kind) {
    case "sftp":
      return openSftp(cfg);
    case "ftp":
    case "ftps":
      return openFtp(cfg);
    case "http":
      return openHttp(cfg);
  }
}

/** Текст файла в кодировке маппинга (utf-8 по умолчанию; windows-1251, utf-16le …). */
export function decodeFeed(body: Buffer, encoding: string | undefined): string {
  const enc = (encoding ?? "utf-8").trim().toLowerCase();
  try {
    return new TextDecoder(enc).decode(body);
  } catch {
    throw new Error(`Кодировка «${encoding}» не поддерживается`);
  }
}

// ---------------------------------------------------------------------------------------------
// JSON API: один документ по адресу (источники типа json); file:// — только для фикстур и E2E
// ---------------------------------------------------------------------------------------------

export interface FetchJsonOptions {
  headers: Record<string, string>;
  timeoutMs: number;
  maxBytes: number;
  /** Разрешить file:// (STATION_PULL_ALLOW_FILE_URLS — тесты и прогон на сохранённом ответе). */
  allowFile?: boolean;
}

function parseJsonText(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`Ответ ${label} не является JSON: ${(error as Error).message}`);
  }
}

/** Загружает и разбирает JSON по http(s) (повторы, таймаут, предел размера) или из file:// при allowFile. */
export async function fetchJsonDocument(
  url: string,
  opts: FetchJsonOptions,
): Promise<{ body: unknown; bytes: number }> {
  if (/^file:/i.test(url)) {
    if (!opts.allowFile) throw new ForbiddenTargetError(url);
    const path = fileURLToPath(url);
    const info = await stat(path);
    if (info.size > opts.maxBytes) throw new FileTooLargeError(path, info.size, opts.maxBytes);
    const text = await readFile(path, "utf8");
    return { body: parseJsonText(text, path), bytes: Buffer.byteLength(text) };
  }
  assertAllowedTarget("json", url);
  const res = await fetchWithRetry(
    url,
    { headers: opts.headers },
    { retries: 2, timeoutMs: opts.timeoutMs, label: "station-pull" },
  );
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`HTTP ${res.status} для ${url}`);
  }
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > opts.maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw new FileTooLargeError(httpFileName(url), declared, opts.maxBytes);
  }
  const text = await res.text();
  const bytes = Buffer.byteLength(text);
  if (bytes > opts.maxBytes) throw new FileTooLargeError(httpFileName(url), bytes, opts.maxBytes);
  return { body: parseJsonText(text, url), bytes };
}
