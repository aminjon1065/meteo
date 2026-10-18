import {
  buildDailyUrl,
  buildHourlyUrl,
  type DailyPoint,
  DUSHANBE_OFFSET_MINUTES,
  type HourlyPoint,
  maskUrl,
  nightVariant,
  parseDaily,
  parseHourly,
} from "@meteo/core";
import { eq, lt, sql } from "@meteo/db";
import {
  type ForecastParams,
  forecastLocations,
  forecastPoints,
  forecastRuns,
} from "@meteo/db/schema";
import { db } from "../db";
import { env } from "../env";
import { withLock } from "../lock";
import { logger } from "../logger";
import { fetchWithRetry, runIntegration } from "../resilience";
import type { JobDefinition } from "./types";

interface SmartmetSyncData {
  /** Ограничить синхронизацию отдельными точками (slug). */
  slugs?: string[];
  /** Ручной запуск: игнорировать разомкнутую цепь circuit breaker. */
  force?: boolean;
}

const REQUEST_TIMEOUT_MS = 10_000;
const PARALLEL = 3;
const HOUR = 3_600_000;

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetchWithRetry(
    url,
    { headers: { accept: "application/json", "user-agent": "meteoportal-worker/0.1 (+meteo.tj)" } },
    {
      retries: 2,
      baseDelayMs: 1_000,
      maxDelayMs: 8_000,
      timeoutMs: REQUEST_TIMEOUT_MS,
      label: "smartmet",
    },
  );
  if (!res.ok) throw new Error(`SmartMet HTTP ${res.status} для ${url}`);
  return res.json();
}

/** Местная полночь (UTC+5) текущих суток в UTC. */
function localMidnightUtc(now: Date): Date {
  const shifted = new Date(now.getTime() + DUSHANBE_OFFSET_MINUTES * 60_000);
  const day = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  return new Date(day - DUSHANBE_OFFSET_MINUTES * 60_000);
}

function localHour(d: Date): number {
  return new Date(d.getTime() + DUSHANBE_OFFSET_MINUTES * 60_000).getUTCHours();
}

function hourlyParams(p: HourlyPoint): ForecastParams {
  return {
    t: p.t,
    ws: p.ws,
    wd: p.wd,
    gust: p.gust,
    rh: p.rh,
    p: p.p,
    dew: p.dew,
    precip: p.precip,
    cloud: p.cloud,
    symbol: nightVariant(p.symbol, localHour(p.time)),
  };
}

function dailyParams(p: DailyPoint): ForecastParams {
  return {
    tmax: p.tmax,
    tmin: p.tmin,
    precipSum: p.precipSum,
    ws: p.wsMax,
    cloud: p.cloud,
    symbol: p.symbol,
  };
}

/**
 * Синхронизация прогноза SmartMet (timeseries) для всех активных точек прогноза:
 * часовой ряд (72 ч) и суточные агрегаты (10 дней) → forecast_points (upsert).
 * Каждый запуск пишет строку в forecast_runs со статусом ok / partial / failed. Запросы повторяются
 * при сетевых сбоях; при серии неудачных запусков circuit breaker приостанавливает синхронизацию,
 * а администраторы получают письмо (см. ../resilience.ts).
 */
export const smartmetSync: JobDefinition<SmartmetSyncData> = {
  name: "smartmet-sync",
  schedule: { every: 15 * 60_000 },
  async run(job) {
    const data = job.data ?? {};
    const result = await withLock("smartmet-sync", 5 * 60, () =>
      runIntegration("smartmet", job, () => syncSmartmet(data), {
        force: data.force,
        source: maskUrl(env.SMARTMET_URL),
        summarize: (r) =>
          r && typeof r === "object" && "runId" in r
            ? { locations: r.locations, failed: r.failed, points: r.points, status: r.status }
            : null,
      }),
    );
    if (result === null) {
      logger.info("smartmet-sync already running, skipped");
      return { skipped: true, reason: "locked" };
    }
    return result;
  },
};

async function syncSmartmet(data: SmartmetSyncData) {
  {
    const locations = await db
      .select({
        id: forecastLocations.id,
        slug: forecastLocations.slug,
        geom: forecastLocations.geom,
      })
      .from(forecastLocations)
      .where(eq(forecastLocations.active, true));
    const selected = data.slugs?.length
      ? locations.filter((l) => data.slugs?.includes(l.slug))
      : locations;
    const now = new Date();
    const startLocal = localMidnightUtc(now);
    const currentHour = new Date(Math.floor(now.getTime() / HOUR) * HOUR);
    const base = {
      startTime: currentHour.toISOString(),
      baseUrl: env.SMARTMET_URL,
      producer: env.SMARTMET_PRODUCER,
      apiKey: env.SMARTMET_API_KEY,
      hourlySteps: env.SMARTMET_HOURLY_STEPS,
      dailyDays: env.SMARTMET_DAILY_DAYS,
    };

    const [run] = await db
      .insert(forecastRuns)
      .values({ provider: "smartmet", producer: env.SMARTMET_PRODUCER ?? null, status: "running" })
      .returning({ id: forecastRuns.id });
    if (!run) throw new Error("Не удалось создать forecast_runs");

    const errors: Array<{ slug: string; error: string }> = [];
    let originTime: Date | null = null;
    let pointsWritten = 0;

    const syncOne = async (loc: (typeof selected)[number]) => {
      const q = { ...base, lat: loc.geom.y, lon: loc.geom.x };
      const [hourlyRaw, dailyRaw] = await Promise.all([
        fetchJson(buildHourlyUrl(q)),
        fetchJson(buildDailyUrl(q, startLocal.toISOString())),
      ]);
      const hourly = parseHourly(hourlyRaw);
      const daily = parseDaily(dailyRaw).filter((d) => d.tmax !== null || d.tmin !== null);
      if (hourly.length === 0) throw new Error("пустой часовой ряд");
      for (const h of hourly) {
        if (h.originTime && (!originTime || h.originTime > originTime)) originTime = h.originTime;
      }
      const rows = [
        ...hourly.map((h) => ({
          locationId: loc.id,
          time: h.time,
          stepMin: 60,
          runId: run.id,
          params: hourlyParams(h),
        })),
        ...daily.map((d) => ({
          locationId: loc.id,
          time: d.time,
          stepMin: 1440,
          runId: run.id,
          params: dailyParams(d),
        })),
      ];
      await db
        .insert(forecastPoints)
        .values(rows)
        .onConflictDoUpdate({
          target: [forecastPoints.locationId, forecastPoints.time, forecastPoints.stepMin],
          set: {
            runId: sql`excluded.run_id`,
            params: sql`excluded.params`,
          },
        });
      pointsWritten += rows.length;
    };

    for (let i = 0; i < selected.length; i += PARALLEL) {
      const batch = selected.slice(i, i + PARALLEL);
      const results = await Promise.allSettled(batch.map((loc) => syncOne(loc)));
      results.forEach((r, k) => {
        if (r.status === "rejected") {
          const slug = batch[k]?.slug ?? "?";
          const message = r.reason instanceof Error ? r.reason.message : String(r.reason);
          errors.push({ slug, error: message });
          logger.warn({ slug, err: message }, "smartmet location failed");
        }
      });
    }

    const status =
      errors.length === 0 ? "ok" : errors.length === selected.length ? "failed" : "partial";
    await db
      .update(forecastRuns)
      .set({
        status,
        originTime,
        meta: {
          locations: selected.length,
          failed: errors.length,
          points: pointsWritten,
          url: env.SMARTMET_URL,
          errors: errors.slice(0, 10),
        },
      })
      .where(eq(forecastRuns.id, run.id));

    // Чистим прошлое: точки старше 48 ч и записи о запусках старше 7 дней.
    await db
      .delete(forecastPoints)
      .where(lt(forecastPoints.time, new Date(now.getTime() - 48 * HOUR)));
    await db
      .delete(forecastRuns)
      .where(lt(forecastRuns.fetchedAt, new Date(now.getTime() - 7 * 24 * HOUR)));

    const summary = {
      runId: run.id,
      status,
      locations: selected.length,
      failed: errors.length,
      points: pointsWritten,
    };
    if (status === "failed")
      throw new Error(`SmartMet: все точки завершились ошибкой (${errors[0]?.error})`);
    logger.info(summary, "smartmet synced");
    return summary;
  }
}
