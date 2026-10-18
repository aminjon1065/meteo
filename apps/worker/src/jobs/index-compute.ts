import { computeStationIndexes } from "@meteo/db";
import { db } from "../db";
import { logger } from "../logger";
import type { JobDefinition } from "./types";

interface IndexComputeData {
  hours?: number;
  stationIds?: number[];
}

/**
 * Пересчёт индекса качества воздуха по всем шкалам: каждые 10 минут за последние 48 часов
 * (идемпотентный upsert в station_index) плюс месячный ИЗА.
 */
export const indexCompute: JobDefinition<IndexComputeData> = {
  name: "index-compute",
  schedule: { every: 10 * 60_000 },
  async run(job) {
    const summary = await computeStationIndexes(db, {
      hours: job.data.hours ?? 48,
      stationIds: job.data.stationIds,
    });
    logger.info({ ...summary }, "index computed");
    return summary;
  },
};
