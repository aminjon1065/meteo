import { evaluateAlertRules } from "@meteo/db";
import { db } from "../db";
import { env } from "../env";
import { logger } from "../logger";
import type { JobDefinition } from "./types";

/** Оценка правил уведомлений: события превышения и письма в очередь. */
export const thresholdEval: JobDefinition = {
  name: "threshold-eval",
  schedule: { every: 10 * 60_000 },
  async run() {
    const summary = await evaluateAlertRules(db, { publicUrl: env.PUBLIC_URL });
    logger.info({ ...summary }, "threshold evaluation done");
    return summary;
  },
};
