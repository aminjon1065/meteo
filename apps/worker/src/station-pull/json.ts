/**
 * Источник типа json — JSON API сети датчиков (образец: сеть PM‑датчиков Агентства, API wwcs.tj).
 * Один запрос за свежими записями (+ при пропусках или первом запуске — ряд за прошедшие часы),
 * разбор @meteo/core parseStationJsonFeed, раскладка записей по станциям портала по коду,
 * дедупликация по курсору времени каждой станции (files[код].mtime), запись через
 * ingestMeasurements. Станции источника — любые активные станции с подходящим кодом, не только та,
 * в карточке которой он заведён; неизвестные и неактивные станции пропускаются с пометкой в сводке.
 */
import {
  historyUrl,
  isJsonFeedMapping,
  type JsonFeedRecord,
  parseStationJsonFeed,
  planHistoryFetch,
  summarizeError,
  validateJsonFeedMapping,
} from "@meteo/core";
import {
  findStationsByCodes,
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
import { fetchJsonDocument } from "./clients";
import {
  httpHeaders,
  MAX_SUMMARY_ERRORS,
  type PullSourceOptions,
  type PullSourceResult,
  resolveSourceSecrets,
} from "./shared";
import { ForbiddenTargetError } from "./target";

const DEFAULT_HISTORY_HOURS = 24;
const DEFAULT_HISTORY_MAX_HOURS = 72;

function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

function cursorDate(state: StationSourceFileState | undefined): Date | null {
  if (!state?.mtime) return null;
  const d = new Date(state.mtime);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function pullJsonSource(
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

  const summary: StationSourceRunSummary = {
    at: now.toISOString(),
    files: 0,
    received: 0,
    accepted: 0,
    rejected: 0,
    errors: [],
    stations: 0,
    skipped: 0,
  };
  const pushError = (file: string, message: string, row?: number) => {
    if (summary.errors.length < MAX_SUMMARY_ERRORS)
      summary.errors.push(row !== undefined ? { file, row, message } : { file, message });
  };
  // Курсоры: код станции → время последней принятой записи (в files, как реестр файлов).
  const cursors: Record<string, StationSourceFileState> = opts.force ? {} : { ...source.files };
  const firstRun = Object.keys(source.files).length === 0;
  const anchorCode = source.station.code.toUpperCase();
  const ingested: string[] = [];

  try {
    const mapping = source.mapping;
    if (!isJsonFeedMapping(mapping))
      throw new Error('Описание полей не для JSON API: нет "format": "json"');
    const problems = validateJsonFeedMapping(mapping);
    if (problems.length) throw new Error(`mapping: ${problems.join("; ")}`);

    const { password } = resolveSourceSecrets(source);
    const fetchOpts = {
      headers: httpHeaders(source.username, password, "application/json, */*;q=0.5"),
      timeoutMs: env.STATION_PULL_TIMEOUT_MS,
      maxBytes: Math.round(env.STATION_PULL_MAX_FILE_MB * 1024 * 1024),
      allowFile: env.STATION_PULL_ALLOW_FILE_URLS,
    };
    const intervalMin =
      mapping.averagingMin ?? (source.station.sampling === "continuous" ? 60 : 20);

    // 1. Свежие записи.
    const main = await fetchJsonDocument(source.path, fetchOpts);
    summary.files += 1;
    const parsedMain = parseStationJsonFeed(main.body, mapping, { now });
    for (const e of parsedMain.errors) pushError("stations", e.message, e.row || undefined);
    const records: JsonFeedRecord[] = [...parsedMain.records];

    // 2. Ряд за прошедшие часы: первый запуск, ручная проверка или пропуск у какой‑то станции.
    if (mapping.history) {
      const newest = new Map<string, Date>();
      for (const r of parsedMain.records) {
        const code = (r.stationCode ?? anchorCode).toUpperCase();
        const t = new Date(r.time);
        const prev = newest.get(code);
        if (!prev || t > prev) newest.set(code, t);
      }
      const hours = planHistoryFetch({
        cursors: [...newest].map(([station, latest]) => ({
          station,
          last: cursorDate(cursors[station]),
          newest: latest,
        })),
        intervalMin,
        full: Boolean(opts.force) || firstRun,
        hours: mapping.history.hours ?? DEFAULT_HISTORY_HOURS,
        maxHours: mapping.history.maxHours ?? DEFAULT_HISTORY_MAX_HOURS,
        now,
      });
      if (hours) {
        const url = historyUrl(mapping.history.url, hours);
        try {
          const history = await fetchJsonDocument(url, fetchOpts);
          summary.files += 1;
          const parsed = parseStationJsonFeed(history.body, mapping, {
            now,
            recordsPath: mapping.history.recordsPath ?? mapping.recordsPath,
          });
          for (const e of parsed.errors) pushError("history", e.message, e.row || undefined);
          records.push(...parsed.records);
          logger.info(
            { source: source.id, hours, records: parsed.records.length },
            "station-pull: json history fetched",
          );
        } catch (error) {
          // Запрещённый адрес истории — ошибка настройки источника, как и у основного адреса.
          if (error instanceof ForbiddenTargetError) throw error;
          // История — догрузка; без неё свежие записи всё равно принимаются.
          const message = summarizeError(error);
          pushError("history", message);
          logger.warn(
            { source: source.id, url: hostOf(url), err: message },
            "station-pull: history failed",
          );
        }
      }
    }

    // 3. Раскладка по станциям портала.
    const groups = new Map<string, JsonFeedRecord[]>();
    for (const r of records) {
      const code = (r.stationCode ?? anchorCode).toUpperCase();
      const list = groups.get(code) ?? [];
      list.push(r);
      groups.set(code, list);
    }
    const stations = await findStationsByCodes(db, [...groups.keys()]);
    // Пропущенным станциям (нет в реестре, приостановлены) тоже ставим курсор: иначе каждый запуск
    // считал бы их «пропуском» и заново запрашивал историю. Когда станцию заведут/активируют, старые
    // записи догрузит ручная проверка («Проверить сейчас» — история за hours без учёта курсоров).
    const skipStation = (code: string, list: JsonFeedRecord[], reason: string) => {
      summary.skipped = (summary.skipped ?? 0) + list.length;
      pushError(code, reason);
      const newest = list.reduce<string | null>(
        (max, r) => (max === null || r.time > max ? r.time : max),
        null,
      );
      cursors[code] = {
        mtime: newest,
        size: null,
        at: now.toISOString(),
        rows: list.length,
        accepted: 0,
        rejected: 0,
      };
    };
    for (const [code, list] of groups) {
      const station = stations.get(code);
      if (!station) {
        skipStation(code, list, "unknownStation");
        continue;
      }
      if (station.status !== "active") {
        skipStation(code, list, `stationInactive:${station.status}`);
        continue;
      }
      const cursor = cursorDate(cursors[code]);
      const seen = new Set<string>();
      const fresh: JsonFeedRecord[] = [];
      for (const r of list) {
        const key = `${r.time}|${r.pollutant}|${r.averagingMin ?? 0}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (cursor && new Date(r.time).getTime() <= cursor.getTime()) {
          summary.skipped = (summary.skipped ?? 0) + 1;
          continue;
        }
        fresh.push(r);
      }
      if (fresh.length === 0) continue;
      const context = await loadIngestContext(db, station, { now });
      const result = await ingestMeasurements(db, {
        station,
        records: fresh.map(({ row: _row, stationCode: _code, ...rec }) => rec),
        source: "pull",
        now,
        context,
        meta: { sourceId: source.id, file: hostOf(source.path) },
      });
      summary.received += result.received;
      summary.accepted += result.accepted;
      summary.rejected += result.rejected;
      for (const e of result.errors) {
        if (e.message === "duplicate") continue;
        pushError(code, e.message, fresh[e.index]?.row);
      }
      if (result.accepted > 0) {
        summary.stations = (summary.stations ?? 0) + 1;
        ingested.push(station.code);
      }
      const last = result.to && (!cursor || result.to > cursor) ? result.to : cursor;
      cursors[code] = {
        mtime: last?.toISOString() ?? null,
        size: null,
        at: now.toISOString(),
        rows: list.length,
        accepted: result.accepted,
        rejected: result.rejected,
      };
      logger.info(
        {
          source: source.id,
          station: station.code,
          records: fresh.length,
          accepted: result.accepted,
          rejected: result.rejected,
          inserted: result.inserted,
          updated: result.updated,
        },
        "station-pull: json station processed",
      );
    }
  } catch (error) {
    const message = summarizeError(error);
    await markStationSourceRun(db, source.id, {
      at: now,
      status: "failed",
      error: message,
      summary: { ...summary, errors: [...summary.errors, { file: "", message }] },
      files: opts.force ? source.files : cursors,
    });
    logger.error(
      { source: source.id, station: source.station.code, err: message },
      "station-pull: json source failed",
    );
    return { ...base, status: "failed", error: message };
  }

  await markStationSourceRun(db, source.id, {
    at: now,
    status: "ok",
    summary,
    files: trimFileRegistry(cursors),
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
        host: hostOf(source.path),
        path: source.path,
        files: summary.files,
        received: summary.received,
        accepted: summary.accepted,
        rejected: summary.rejected,
        skipped: summary.skipped ?? 0,
        stations: ingested,
        errors: summary.errors,
      },
    });
  }
  logger.info(
    {
      source: source.id,
      requests: summary.files,
      stations: summary.stations,
      accepted: summary.accepted,
      rejected: summary.rejected,
      skipped: summary.skipped,
    },
    "station-pull: json source done",
  );
  return {
    ...base,
    status: "ok",
    files: summary.files,
    accepted: summary.accepted,
    rejected: summary.rejected,
  };
}
