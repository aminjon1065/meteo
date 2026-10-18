import { runQcBatch } from "@meteo/db";
import { db } from "../db";
import { logger } from "../logger";
import type { JobDefinition } from "./types";

/** Пакетный контроль качества за последние 48 часов: скачки, залипание, выбросы → suspect. */
export const qcBatch: JobDefinition<{ hours?: number }> = {
  name: "qc-batch",
  schedule: { every: 15 * 60_000 },
  async run(job) {
    const summary = await runQcBatch(db, { hours: job.data.hours ?? 48 });
    logger.info({ ...summary }, "qc batch done");
    return summary;
  },
};
