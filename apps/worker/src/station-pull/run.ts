/**
 * Обработка одного источника станции: список файлов → новые/изменившиеся → загрузка → разбор
 * маппингом (@meteo/core parseStationFeed, тот же, что у агента) → запись через ingestMeasurements
 * → реестр файлов и статус источника. Повторная обработка файла безопасна (upsert по ключу).
 */
import {
  filePatternToRegExp,
  isJsonFeedMapping,
  parseStationFeed,
  summarizeError,
} from "@meteo/core";
import {
  ingestMeasurements,
  loadIngestContext,
  markStationSourceRun,
  type StationSourceWithStation,
  trimFileRegistry,
} from "@meteo/db";
import {
  auditLog,
  type StationSourceFileState,
  type StationSourceRunSummary,
} from "@meteo/db/schema";
import { db } from "../db";
import { env } from "../env";
import { logger } from "../logger";
import { decodeFeed, FileTooLargeError, openRemoteClient, type RemoteFile } from "./clients";
import { pullJsonSource } from "./json";
import {
  MAX_SUMMARY_ERRORS,
  type PullSourceOptions,
  type PullSourceResult,
  resolveSourceSecrets,
} from "./shared";

export type { PullSourceOptions, PullSourceResult } from "./shared";

const MAX_FILES_PER_RUN = 25;
/** Файл, изменённый менее 30 с назад, может ещё дописываться вендорским ПО — берём в следующий раз. */
const SETTLE_MS = 30_000;

function registryKey(kind: string, path: string, file: RemoteFile): string {
  return kind === "http" ? path : file.name;
}

function changed(prev: StationSourceFileState | undefined, file: RemoteFile): boolean {
  if (!prev) return true;
  const mtime = file.mtime ? file.mtime.toISOString() : null;
  if (mtime !== null && prev.mtime !== null && mtime !== prev.mtime) return true;
  if (file.size !== null && prev.size !== null && file.size !== prev.size) return true;
  // Нет ни даты, ни размера (HTTP): перечитываем, условные заголовки отсекут 304.
  return mtime === null && file.size === null;
}

export async function pullStationSource(
  source: StationSourceWithStation,
  opts: PullSourceOptions = {},
): Promise<PullSourceResult> {
  const now = opts.now ?? new Date();
  const base: PullSourceResult = {
    sourceId: source.id,
    stationCode: source.station.code,
    status: "skipped",
    files: 0,
    accepted: 0,
    rejected: 0,
  };
  if (!source.enabled && !opts.force) return base;
  if (source.station.status === "decommissioned") return base;
  // JSON API (сеть датчиков): свой цикл — запросы вместо файлов, станции по коду из записей.
  if (source.kind === "json") return pullJsonSource(source, opts);
  if (isJsonFeedMapping(source.mapping)) {
    const message = "Описание полей JSON API у файлового источника: смените тип на «JSON API»";
    await markStationSourceRun(db, source.id, { at: now, status: "failed", error: message });
    return { ...base, status: "failed", error: message };
  }
  const mapping = source.mapping;

  const summary: StationSourceRunSummary = {
    at: now.toISOString(),
    files: 0,
    received: 0,
    accepted: 0,
    rejected: 0,
    errors: [],
  };
  const pushError = (file: string, message: string, row?: number) => {
    if (summary.errors.length < MAX_SUMMARY_ERRORS)
      summary.errors.push(row !== undefined ? { file, row, message } : { file, message });
  };
  const files: Record<string, StationSourceFileState> = { ...source.files };
  const maxBytes = Math.round(env.STATION_PULL_MAX_FILE_MB * 1024 * 1024);

  try {
    const { password, privateKey } = resolveSourceSecrets(source);
    const client = await openRemoteClient({
      kind: source.kind,
      host: source.host,
      port: source.port,
      username: source.username,
      password,
      privateKey,
      hostFingerprint: source.hostFingerprint,
      timeoutMs: env.STATION_PULL_TIMEOUT_MS,
    });
    try {
      const pattern = filePatternToRegExp(source.filePattern || "*");
      const listed = await client.list(source.path);
      const firstRun = Object.keys(files).length === 0;
      const lookback = now.getTime() - env.STATION_PULL_LOOKBACK_DAYS * 86_400_000;
      let candidates = listed
        .filter((f) => source.kind === "http" || pattern.test(f.name))
        .filter((f) => !(firstRun && f.mtime && f.mtime.getTime() < lookback))
        .filter((f) => !(f.mtime && now.getTime() - f.mtime.getTime() < SETTLE_MS))
        .sort(
          (a, b) =>
            (a.mtime?.getTime() ?? 0) - (b.mtime?.getTime() ?? 0) || a.name.localeCompare(b.name),
        );
      if (opts.force && candidates.length > 0) {
        const newest = candidates[candidates.length - 1] as RemoteFile;
        delete files[registryKey(source.kind, source.path, newest)];
      }
      candidates = candidates.filter((f) =>
        changed(files[registryKey(source.kind, source.path, f)], f),
      );
      if (candidates.length > MAX_FILES_PER_RUN) candidates = candidates.slice(-MAX_FILES_PER_RUN);

      const context = await loadIngestContext(db, source.station, { now });
      for (const file of candidates) {
        const rk = registryKey(source.kind, source.path, file);
        const prev = files[rk];
        try {
          const conditional: RemoteFile | undefined =
            source.kind === "http" && prev
              ? {
                  name: file.name,
                  size: null,
                  mtime: prev.mtime ? new Date(prev.mtime) : null,
                  etag: prev.etag ?? null,
                }
              : undefined;
          const read = await client.read(source.path, file.name, maxBytes, conditional);
          if (read.body === null) continue; // 304 Not Modified
          const text = decodeFeed(read.body, mapping.encoding);
          const parsed = parseStationFeed(text, mapping, { now });
          for (const e of parsed.errors) pushError(file.name, e.message, e.row);
          const records = parsed.records.map(({ row: _row, ...rec }) => rec);
          let accepted = 0;
          let rejected = parsed.errors.length;
          if (records.length > 0) {
            const result = await ingestMeasurements(db, {
              station: source.station,
              records,
              source: "pull",
              now,
              context,
              meta: { sourceId: source.id, file: file.name },
            });
            accepted = result.accepted;
            rejected += result.rejected;
            for (const e of result.errors) {
              if (e.message === "duplicate") continue;
              pushError(file.name, e.message, parsed.records[e.index]?.row);
            }
            summary.received += result.received;
          }
          summary.files += 1;
          summary.accepted += accepted;
          summary.rejected += rejected;
          files[rk] = {
            mtime: read.lastModified?.toISOString() ?? file.mtime?.toISOString() ?? null,
            size: file.size ?? read.body.length,
            etag: read.etag ?? null,
            at: now.toISOString(),
            rows: parsed.total,
            accepted,
            rejected,
          };
          logger.info(
            {
              source: source.id,
              station: source.station.code,
              file: file.name,
              rows: parsed.total,
              accepted,
              rejected,
            },
            "station-pull: file processed",
          );
        } catch (error) {
          const message = summarizeError(error);
          pushError(file.name, message);
          if (error instanceof FileTooLargeError) {
            // Не пытаться скачивать его снова каждые 10 минут.
            files[rk] = {
              mtime: file.mtime?.toISOString() ?? null,
              size: file.size,
              at: now.toISOString(),
              rows: 0,
              accepted: 0,
              rejected: 0,
            };
          }
          logger.warn(
            { source: source.id, station: source.station.code, file: file.name, err: message },
            "station-pull: file failed",
          );
        }
      }
    } finally {
      await client.close().catch(() => undefined);
    }
  } catch (error) {
    const message = summarizeError(error);
    await markStationSourceRun(db, source.id, {
      at: now,
      status: "failed",
      error: message,
      summary: { ...summary, errors: [...summary.errors, { file: "", message }] },
      files,
    });
    logger.error(
      { source: source.id, station: source.station.code, err: message },
      "station-pull: source failed",
    );
    return { ...base, status: "failed", error: message };
  }

  await markStationSourceRun(db, source.id, {
    at: now,
    status: "ok",
    summary,
    files: trimFileRegistry(files),
    gotData: summary.accepted > 0,
  });
  if (summary.files > 0) {
    await db.insert(auditLog).values({
      actorEmail: `station:${source.station.code}`,
      actorRole: "station",
      action: "measurements.pull",
      entity: "station_sources",
      entityId: String(source.id),
      after: {
        source: "station",
        stationCode: source.station.code,
        kind: source.kind,
        host: source.host,
        path: source.path,
        files: summary.files,
        received: summary.received,
        accepted: summary.accepted,
        rejected: summary.rejected,
        errors: summary.errors,
      },
    });
  }
  return {
    ...base,
    status: "ok",
    files: summary.files,
    accepted: summary.accepted,
    rejected: summary.rejected,
  };
}
