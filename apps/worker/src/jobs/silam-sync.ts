import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  buildSilamSubsetUrl,
  DUSHANBE_OFFSET_MINUTES,
  decodeTimeAxis,
  type Grid,
  gridBounds,
  levelForThresholds,
  maskUrl,
  rasterizeLevels,
  SILAM_VARIABLES,
  sampleGrid,
  toMicrograms,
} from "@meteo/core";
import {
  and,
  desc,
  eq,
  inArray,
  loadIndexConfig,
  ne,
  notInArray,
  publicThresholds,
} from "@meteo/db";
import {
  forecastLocations,
  pollutants,
  silamFields,
  silamPointForecast,
  silamRuns,
  stations,
} from "@meteo/db/schema";
import { NetCDFReader } from "netcdfjs";
import { db } from "../db";
import { env } from "../env";
import { withLock } from "../lock";
import { logger } from "../logger";
import { encodePng } from "../png";
import { fetchWithRetry, runIntegration } from "../resilience";
import type { JobDefinition } from "./types";

interface SilamSyncData {
  /** Перекачать даже если прогон с таким origin уже загружен. */
  force?: boolean;
}

const HOUR = 3_600_000;
const FORECAST_HOURS = 121;
const DOWNLOAD_TIMEOUT_MS = 180_000;
const RASTER_SCALE = 8;

async function download(url: string): Promise<Buffer> {
  const res = await fetchWithRetry(
    url,
    { headers: { "user-agent": "meteoportal-worker/0.1 (+meteo.tj)" } },
    {
      retries: 2,
      baseDelayMs: 5_000,
      maxDelayMs: 30_000,
      timeoutMs: DOWNLOAD_TIMEOUT_MS,
      label: "silam",
    },
  );
  if (!res.ok)
    throw new Error(`SILAM NCSS HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

type Reader = InstanceType<typeof NetCDFReader>;
/** В типах netcdfjs attributes объявлены как пустой кортеж — уточняем. */
interface NcAttribute {
  name: string;
  value: number | string | null;
}

function attr(reader: Reader, variable: string, name: string): string | undefined {
  const v = reader.variables.find((x) => x.name === variable);
  const a = (v?.attributes as NcAttribute[] | undefined)?.find((x) => x.name === name);
  return a?.value === undefined || a.value === null ? undefined : String(a.value);
}

/** Плоский массив значений переменной (netcdfjs отдаёт record‑переменные по записям). */
function flat(reader: Reader, variable: string): number[] {
  const data = reader.getDataVariable(variable) as unknown;
  if (!Array.isArray(data)) return Array.from(data as ArrayLike<number>);
  if (data.length && Array.isArray(data[0])) return (data as number[][]).flat();
  return data as number[];
}

function dimOrder(reader: Reader, variable: string): string[] {
  const v = reader.variables.find((x) => x.name === variable);
  if (!v) throw new Error(`Нет переменной ${variable}`);
  return v.dimensions.map((d) => reader.dimensions[d]?.name ?? "?");
}

/** Местная полночь (UTC+5) текущих суток в UTC. */
function localMidnightUtc(now: Date): Date {
  const shifted = new Date(now.getTime() + DUSHANBE_OFFSET_MINUTES * 60_000);
  const day = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  return new Date(day - DUSHANBE_OFFSET_MINUTES * 60_000);
}

function runKey(origin: Date): string {
  return origin.toISOString().replace(/[-:]/g, "").slice(0, 11).replace("T", "");
}

interface ParsedField {
  timeIndex: number;
  values: Float32Array;
}

/** Читает NetCDF‑3 ответ NCSS: оси, время запуска и поля по веществам в единицах портала. */
function parseSubset(buffer: Buffer, unitByCode: Map<string, string>) {
  const reader = new NetCDFReader(buffer);
  const lat = flat(reader, "lat");
  const lon = flat(reader, "lon");
  const timeUnits = attr(reader, "time", "units") ?? "";
  const times = decodeTimeAxis(timeUnits, flat(reader, "time"));
  const runUnits = attr(reader, "time_run", "units") ?? timeUnits;
  const runTimes = reader.variables.some((v) => v.name === "time_run")
    ? decodeTimeAxis(runUnits, flat(reader, "time_run"))
    : [];
  const origin = runTimes.reduce<Date | null>((m, t) => (!m || t > m ? t : m), null);
  if (lat.length < 2 || lon.length < 2) throw new Error("Сетка SILAM пуста");
  const latAsc = (lat[1] as number) > (lat[0] as number);
  const ny = lat.length;
  const nx = lon.length;
  const dy = Math.abs((lat[1] as number) - (lat[0] as number));
  const dx = (lon[1] as number) - (lon[0] as number);
  const gridBase = {
    nx,
    ny,
    lon0: lon[0] as number,
    lat0: latAsc ? (lat[0] as number) : (lat[ny - 1] as number),
    dx,
    dy,
  };
  const order = dimOrder(reader, "air_dens");
  if (order.join(",") !== "time,lat,lon") {
    throw new Error(`Неожиданный порядок измерений SILAM: ${order.join(",")}`);
  }
  const cells = nx * ny;
  const airDens = flat(reader, "air_dens");

  const fields = new Map<string, ParsedField[]>();
  for (const spec of SILAM_VARIABLES) {
    if (!reader.variables.some((v) => v.name === spec.variable)) continue;
    const raw = flat(reader, spec.variable);
    const divisor = unitByCode.get(spec.code) === "mg/m³" ? 1000 : 1;
    const list: ParsedField[] = [];
    for (let t = 0; t < times.length; t++) {
      const values = new Float32Array(cells);
      for (let j = 0; j < ny; j++) {
        // В растре строки идут с юга на север; при нисходящей широте переворачиваем.
        const srcRow = latAsc ? j : ny - 1 - j;
        for (let i = 0; i < nx; i++) {
          const k = t * cells + srcRow * nx + i;
          const v = toMicrograms(spec.kind, raw[k] as number, airDens[k] as number, spec.molarMass);
          values[j * nx + i] = Number.isFinite(v) ? v / divisor : Number.NaN;
        }
      }
      list.push({ timeIndex: t, values });
    }
    fields.set(spec.code, list);
  }
  return { times, origin, gridBase, fields };
}

/**
 * Загрузка прогноза SILAM (THREDDS NCSS, NetCDF‑3) за текущие сутки + 5 дней:
 * PNG‑слои уровней по веществам и часам → silam_fields, точечный прогноз для городов и станций →
 * silam_point_forecast. Хранятся SILAM_KEEP_RUNS последних прогонов. Проверка каждый час; новый
 * прогон появляется примерно раз в сутки. Загрузка повторяется при сетевых сбоях; серия неудач
 * размыкает circuit breaker и уведомляет администраторов (см. ../resilience.ts).
 */
export const silamSync: JobDefinition<SilamSyncData> = {
  name: "silam-sync",
  schedule: { pattern: "20 * * * *" },
  async run(job) {
    const data = job.data ?? {};
    const result = await withLock("silam-sync", 15 * 60, () =>
      runIntegration("silam", job, () => syncSilam(data), {
        force: data.force,
        source: maskUrl(`${env.SILAM_NCSS_URL}${env.SILAM_DATASET}`),
        summarize: (r) =>
          r && typeof r === "object" && "runId" in r
            ? { origin: r.origin, hours: r.hours, fields: r.fields, points: r.points }
            : r && typeof r === "object" && "skipped" in r
              ? { skipped: true, origin: (r as { origin?: string }).origin ?? null }
              : null,
      }),
    );
    if (result === null) {
      logger.info("silam-sync already running, skipped");
      return { skipped: true, reason: "locked" };
    }
    return result;
  },
};

async function syncSilam(data: SilamSyncData) {
  {
    const now = new Date();
    const start = localMidnightUtc(now);
    const end = new Date(start.getTime() + FORECAST_HOURS * HOUR);
    const base = { baseUrl: env.SILAM_NCSS_URL, dataset: env.SILAM_DATASET };

    // 1. Дешёвая проверка: время запуска последнего прогона по одному шагу.
    const probeStart = new Date(Math.floor(now.getTime() / HOUR) * HOUR);
    const probe = new NetCDFReader(
      await download(
        buildSilamSubsetUrl({
          ...base,
          variables: ["air_dens"],
          timeStart: probeStart,
          timeEnd: new Date(probeStart.getTime() + HOUR),
        }),
      ),
    );
    const probeUnits = attr(probe, "time_run", "units") ?? attr(probe, "time", "units") ?? "";
    const probeRuns = decodeTimeAxis(probeUnits, flat(probe, "time_run"));
    const origin = probeRuns.reduce<Date | null>((m, t) => (!m || t > m ? t : m), null);
    if (!origin) throw new Error("SILAM: не удалось определить время запуска прогона");

    const existing = await db
      .select({ id: silamRuns.id, status: silamRuns.status })
      .from(silamRuns)
      .where(eq(silamRuns.originTime, origin))
      .then((r) => r[0]);
    if (existing?.status === "ok" && !data.force) {
      logger.info({ origin: origin.toISOString() }, "silam run already loaded");
      return { skipped: true, origin: origin.toISOString() };
    }
    if (existing) {
      await db.delete(silamRuns).where(eq(silamRuns.id, existing.id));
      await rm(join(env.SILAM_DIR, runKey(origin)), { recursive: true, force: true });
    }

    // 2. Полная выгрузка и разбор.
    const [pollutantRows, config] = await Promise.all([
      db
        .select({ id: pollutants.id, code: pollutants.code, unit: pollutants.unit })
        .from(pollutants),
      loadIndexConfig(db),
    ]);
    const pollutantByCode = new Map(pollutantRows.map((p) => [p.code, p]));
    const unitByCode = new Map(pollutantRows.map((p) => [p.code, p.unit]));
    const thresholds = publicThresholds(config);
    const url = buildSilamSubsetUrl({
      ...base,
      variables: [...SILAM_VARIABLES.map((v) => v.variable), "air_dens"],
      timeStart: start,
      timeEnd: end,
    });
    const started = Date.now();
    const buffer = await download(url);
    const parsed = parseSubset(buffer, unitByCode);
    logger.info(
      { bytes: buffer.length, hours: parsed.times.length, ms: Date.now() - started },
      "silam subset downloaded",
    );
    const bounds = gridBounds(parsed.gridBase);
    const grid = { nx: parsed.gridBase.nx, ny: parsed.gridBase.ny, ...bounds };

    const [run] = await db
      .insert(silamRuns)
      .values({
        originTime: origin,
        status: "running",
        hours: parsed.times.length,
        grid,
        meta: { dataset: env.SILAM_DATASET, url: env.SILAM_NCSS_URL, bytes: buffer.length },
      })
      .returning({ id: silamRuns.id });
    if (!run) throw new Error("Не удалось создать silam_runs");
    const key = runKey(origin);
    const runDir = resolve(env.SILAM_DIR, key);

    // 3. Растры по веществам и часам.
    const fieldRows: (typeof silamFields.$inferInsert)[] = [];
    for (const [code, list] of parsed.fields) {
      const pollutant = pollutantByCode.get(code);
      if (!pollutant) continue;
      const th = thresholds.get(pollutant.id) ?? [];
      const dir = join(runDir, code);
      await mkdir(dir, { recursive: true });
      for (const field of list) {
        const g: Grid = { ...parsed.gridBase, values: field.values };
        const raster = rasterizeLevels(g, th, { scale: RASTER_SCALE, alpha: 0.55 });
        const file = `${key}/${code}/${String(field.timeIndex).padStart(3, "0")}.png`;
        await writeFile(
          resolve(env.SILAM_DIR, file),
          encodePng(raster.width, raster.height, raster.data),
        );
        fieldRows.push({
          runId: run.id,
          pollutantId: pollutant.id,
          time: parsed.times[field.timeIndex] as Date,
          file,
          stats: raster.stats,
        });
      }
    }
    for (let i = 0; i < fieldRows.length; i += 500) {
      await db
        .insert(silamFields)
        .values(fieldRows.slice(i, i + 500))
        .onConflictDoNothing();
    }

    // 4. Точечный прогноз: города и станции.
    const [locationRows, stationRows] = await Promise.all([
      db
        .select({ id: forecastLocations.id, geom: forecastLocations.geom })
        .from(forecastLocations)
        .where(eq(forecastLocations.active, true)),
      db
        .select({ id: stations.id, geom: stations.geom })
        .from(stations)
        .where(and(eq(stations.isPublic, true), ne(stations.status, "decommissioned"))),
    ]);
    const targets = [
      ...locationRows.map((l) => ({ locationId: l.id, stationId: null, x: l.geom.x, y: l.geom.y })),
      ...stationRows.map((s) => ({ locationId: null, stationId: s.id, x: s.geom.x, y: s.geom.y })),
    ].filter(
      (t) => t.x >= bounds.west && t.x <= bounds.east && t.y >= bounds.south && t.y <= bounds.north,
    );
    const pointRows: (typeof silamPointForecast.$inferInsert)[] = [];
    for (const [code, list] of parsed.fields) {
      const pollutant = pollutantByCode.get(code);
      if (!pollutant) continue;
      const th = thresholds.get(pollutant.id) ?? [];
      for (const field of list) {
        const g: Grid = { ...parsed.gridBase, values: field.values };
        const time = parsed.times[field.timeIndex] as Date;
        for (const target of targets) {
          const value = sampleGrid(g, target.x, target.y);
          if (!Number.isFinite(value)) continue;
          pointRows.push({
            runId: run.id,
            locationId: target.locationId,
            stationId: target.stationId,
            pollutantId: pollutant.id,
            time,
            value: Math.round(value * 100) / 100,
            level: levelForThresholds(value, th),
          });
        }
      }
    }
    for (let i = 0; i < pointRows.length; i += 2000) {
      await db
        .insert(silamPointForecast)
        .values(pointRows.slice(i, i + 2000))
        .onConflictDoNothing();
    }

    await db.update(silamRuns).set({ status: "ok" }).where(eq(silamRuns.id, run.id));

    // 5. Ретенция: оставляем последние N успешных прогонов, остальные удаляем вместе с файлами.
    const keep = await db
      .select({ id: silamRuns.id })
      .from(silamRuns)
      .where(eq(silamRuns.status, "ok"))
      .orderBy(desc(silamRuns.originTime))
      .limit(env.SILAM_KEEP_RUNS);
    const stale = await db
      .select({ id: silamRuns.id, originTime: silamRuns.originTime })
      .from(silamRuns)
      .where(
        keep.length
          ? notInArray(
              silamRuns.id,
              keep.map((k) => k.id),
            )
          : undefined,
      );
    if (stale.length) {
      await db.delete(silamRuns).where(
        inArray(
          silamRuns.id,
          stale.map((s) => s.id),
        ),
      );
      for (const s of stale) {
        await rm(join(env.SILAM_DIR, runKey(s.originTime)), { recursive: true, force: true });
      }
    }

    const summary = {
      runId: run.id,
      origin: origin.toISOString(),
      hours: parsed.times.length,
      fields: fieldRows.length,
      points: pointRows.length,
      targets: targets.length,
      removedRuns: stale.length,
      ms: Date.now() - started,
    };
    logger.info(summary, "silam synced");
    return summary;
  }
}
