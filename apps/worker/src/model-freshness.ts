/**
 * Свежесть прогона модели SmartMet (GFS). Синхронизация может проходить успешно, когда загрузка GFS
 * на сервере SmartMet остановилась: сервер продолжает отдавать старый прогон. Если originTime старше
 * SMARTMET_MAX_RUN_AGE_H, администраторам уходит письмо (одно на «застрявший» прогон), после
 * появления свежего прогона — письмо о восстановлении. Состояние — settings «smartmet.model».
 */
import { isModelRunStale } from "@meteo/core";
import { emailOutbox, getSetting, setSetting } from "@meteo/db";
import { db } from "./db";
import { env } from "./env";
import { logger } from "./logger";
import { adminAlertRecipients } from "./resilience";

export const MODEL_FRESHNESS_KEY = "smartmet.model";

export interface ModelFreshnessState {
  /** Время прогона, о котором уже отправлено письмо «устарел». */
  staleOrigin: string | null;
  alertedAt: string | null;
}

async function queue(kind: "stale" | "fresh", origin: Date, now: Date): Promise<void> {
  const to = await adminAlertRecipients();
  if (to.length === 0) {
    logger.warn({ kind }, "no admin recipients for model freshness alert");
    return;
  }
  const payload = {
    kind,
    origin: origin.toISOString(),
    at: now.toISOString(),
    maxHours: env.SMARTMET_MAX_RUN_AGE_H,
    producer: env.SMARTMET_PRODUCER ?? null,
    dashboardUrl: `${env.PUBLIC_URL}/admin`,
  };
  await db
    .insert(emailOutbox)
    .values(
      to.map((r) => ({
        to: r.email,
        locale: r.locale,
        template: "modelStale",
        payload,
        dedupKey: `model:${kind}:${origin.toISOString()}:${r.email}`,
      })),
    )
    .onConflictDoNothing();
  logger.info({ kind, origin, recipients: to.length }, "model freshness alert queued");
}

/** Вызывается после успешной синхронизации прогноза с временем прогона (originTime). */
export async function checkModelFreshness(origin: Date | null, now = new Date()): Promise<boolean> {
  if (!origin) return false;
  const stale = isModelRunStale(origin, now, env.SMARTMET_MAX_RUN_AGE_H);
  const state = (await getSetting<ModelFreshnessState>(db, MODEL_FRESHNESS_KEY)) ?? {
    staleOrigin: null,
    alertedAt: null,
  };
  if (stale && state.staleOrigin !== origin.toISOString()) {
    logger.warn({ origin, maxHours: env.SMARTMET_MAX_RUN_AGE_H }, "model run is stale");
    await queue("stale", origin, now);
    await setSetting(db, MODEL_FRESHNESS_KEY, {
      staleOrigin: origin.toISOString(),
      alertedAt: now.toISOString(),
    } satisfies ModelFreshnessState);
  } else if (!stale && state.staleOrigin) {
    await queue("fresh", origin, now);
    await setSetting(db, MODEL_FRESHNESS_KEY, {
      staleOrigin: null,
      alertedAt: null,
    } satisfies ModelFreshnessState);
  }
  return stale;
}
