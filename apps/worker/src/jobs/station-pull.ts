import { listStationSources } from "@meteo/db";
import { db } from "../db";
import { withLock } from "../lock";
import { logger } from "../logger";
import { type PullSourceResult, pullStationSource } from "../station-pull/run";
import { checkStationDataStaleness } from "../station-pull/stale";
import type { JobDefinition } from "./types";

interface StationPullData {
  /** Один источник (кнопка «Проверить сейчас» в карточке станции). */
  sourceId?: number;
  /** Все источники одной станции. */
  stationId?: number;
  /** Обработать источник, даже если он выключен, и перечитать самый свежий файл. */
  force?: boolean;
}

/**
 * Pull‑адаптер станций: каждые 10 минут забирает новые файлы экспорта по SFTP/FTP(S)/HTTP(S)
 * из station_sources, разбирает их маппингом (тем же, что у агента станции) и записывает через
 * ingestMeasurements; затем проверяет, у каких станций давно нет данных, и ставит письма
 * администраторам. Под замком: ручной запуск и расписание не обрабатывают источники параллельно.
 */
export const stationPull: JobDefinition<StationPullData> = {
  name: "station-pull",
  schedule: { every: 10 * 60_000 },
  async run(job) {
    const data = job.data ?? {};
    const manual = data.sourceId !== undefined || data.stationId !== undefined;
    const lockName = manual
      ? `station-pull:${data.sourceId ?? `station-${data.stationId}`}`
      : "station-pull";
    const result = await withLock(lockName, 9 * 60, async () => {
      const sources = await listStationSources(db, {
        ids: data.sourceId !== undefined ? [data.sourceId] : undefined,
        stationId: data.stationId,
        runnable: !data.force,
      });
      const results: PullSourceResult[] = [];
      for (const source of sources) {
        results.push(await pullStationSource(source, { force: data.force }));
      }
      const stale = manual ? { alerted: 0, recovered: 0 } : await checkStationDataStaleness();
      const summary = {
        sources: sources.length,
        ok: results.filter((r) => r.status === "ok").length,
        failed: results.filter((r) => r.status === "failed").length,
        files: results.reduce((n, r) => n + r.files, 0),
        accepted: results.reduce((n, r) => n + r.accepted, 0),
        rejected: results.reduce((n, r) => n + r.rejected, 0),
        ...stale,
      };
      logger.info(summary, "station-pull done");
      return summary;
    });
    if (result === null) {
      logger.info({ lock: lockName }, "station-pull already running, skipped");
      return { skipped: true };
    }
    return result;
  },
};
