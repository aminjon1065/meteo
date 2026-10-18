/**
 * Устойчивость внешних интеграций (I/O‑часть): повторы HTTP‑запросов с экспоненциальной
 * задержкой, circuit breaker с состоянием в settings и уведомление администраторов по e‑mail
 * при серии сбоев. Чистая логика решений — в @meteo/core (resilience.ts).
 */
import {
  backoffDelayMs,
  circuitAllows,
  type IntegrationName,
  type IntegrationState,
  isRetryableStatus,
  markAlerted,
  markRecoveredAlerted,
  type ResilienceOptions,
  recordFailure,
  recordSkipped,
  recordSuccess,
  summarizeError,
} from "@meteo/core";
import {
  emailOutbox,
  getIntegrationState,
  listAdminRecipients,
  setIntegrationState,
} from "@meteo/db";
import { type Job, UnrecoverableError } from "bullmq";
import { db } from "./db";
import { env } from "./env";
import { logger } from "./logger";

export const resilienceOptions: ResilienceOptions = {
  circuitFailureThreshold: env.INTEGRATION_CIRCUIT_FAILURES,
  circuitCooldownMs: env.INTEGRATION_CIRCUIT_COOLDOWN_MIN * 60_000,
  circuitMaxCooldownMs: env.INTEGRATION_CIRCUIT_MAX_COOLDOWN_MIN * 60_000,
  alertFailureThreshold: env.INTEGRATION_ALERT_FAILURES,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Сетевые и временные ошибки fetch, которые имеет смысл повторить. */
export function isTransientError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError" || error.name === "TimeoutError") return true;
  if (error instanceof TypeError && /fetch failed|network/i.test(error.message)) return true;
  const code = (error as { code?: string }).code ?? (error.cause as { code?: string })?.code;
  return (
    typeof code === "string" &&
    /^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE|UND_ERR_)/.test(code)
  );
}

export interface FetchRetryOptions {
  /** Число повторов после первой попытки (по умолчанию 2). */
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Таймаут одной попытки, мс. */
  timeoutMs?: number;
  /** Подпись для логов. */
  label?: string;
}

/**
 * fetch с повторами: транзиентные ошибки сети/таймауты и статусы 408/425/429/5xx повторяются
 * с экспоненциальной задержкой; прочие ответы возвращаются как есть (ok проверяет вызывающий).
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  opts: FetchRetryOptions = {},
): Promise<Response> {
  const retries = opts.retries ?? 2;
  const base = opts.baseDelayMs ?? 1_000;
  const max = opts.maxDelayMs ?? 15_000;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        signal: opts.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : init.signal,
      });
      if (isRetryableStatus(res.status) && attempt < retries) {
        await res.body?.cancel().catch(() => {});
        const delay = backoffDelayMs(attempt + 1, base, max);
        logger.warn(
          { label: opts.label, status: res.status, attempt: attempt + 1, delay },
          "retrying request after HTTP error",
        );
        await sleep(delay);
        continue;
      }
      return res;
    } catch (error) {
      if (attempt >= retries || !isTransientError(error)) throw error;
      const delay = backoffDelayMs(attempt + 1, base, max);
      logger.warn(
        { label: opts.label, err: summarizeError(error), attempt: attempt + 1, delay },
        "retrying request after network error",
      );
      await sleep(delay);
    }
  }
}

export interface RunIntegrationOptions<T> {
  /** Ручной запуск: игнорировать разомкнутую цепь. */
  force?: boolean;
  /** Адрес источника без учётных данных (для админки). */
  source?: string | null;
  /** Краткая сводка успешного запуска для дашборда. */
  summarize?: (result: T) => Record<string, unknown> | null;
}

export type SkippedRun = { skipped: true; reason: "circuit-open"; until: string | null };

/**
 * Выполняет запуск интеграции под circuit breaker:
 *  - при разомкнутой цепи запуск пропускается (кроме force);
 *  - успех/сбой фиксируются в settings (`integration.<name>`);
 *  - при N сбоях подряд администраторам ставится письмо в очередь, при восстановлении — ещё одно;
 *  - сбой пробрасывается как UnrecoverableError: повторы BullMQ не нужны, следующая попытка —
 *    по расписанию (внутренние повторы HTTP делает fetchWithRetry).
 */
export async function runIntegration<T>(
  name: IntegrationName,
  job: Job,
  run: () => Promise<T>,
  opts: RunIntegrationOptions<T> = {},
): Promise<T | SkippedRun> {
  const now = new Date();
  let state = await getIntegrationState(db, name);
  const gate = circuitAllows(state, now);
  if (!gate.allow && !opts.force) {
    state = recordSkipped(state, now);
    await setIntegrationState(db, state);
    logger.warn(
      { integration: name, until: state.circuit.until, failures: state.consecutiveFailures },
      "integration circuit open, run skipped",
    );
    return { skipped: true, reason: "circuit-open", until: state.circuit.until };
  }
  if (gate.halfOpen) logger.info({ integration: name }, "integration circuit half-open: probing");

  const started = Date.now();
  try {
    const result = await run();
    const done = new Date();
    const ok = recordSuccess(state, done, {
      durationMs: Date.now() - started,
      summary: opts.summarize ? opts.summarize(result) : undefined,
      source: opts.source,
    });
    state = ok.state;
    if (ok.recovered) {
      await notifyAdmins("recovered", state, done);
      state = markRecoveredAlerted(state, done);
    }
    await setIntegrationState(db, state);
    return result;
  } catch (error) {
    const failedAt = new Date();
    const failure = recordFailure(state, error, failedAt, resilienceOptions, {
      source: opts.source,
    });
    state = failure.state;
    if (failure.shouldAlert) {
      await notifyAdmins("failed", state, failedAt);
      state = markAlerted(state, failedAt);
    }
    await setIntegrationState(db, state);
    logger.error(
      {
        integration: name,
        err: state.lastError,
        failures: state.consecutiveFailures,
        circuitOpen: state.circuit.open,
        until: state.circuit.until,
        jobId: job.id,
      },
      "integration run failed",
    );
    throw new UnrecoverableError(`${name}: ${state.lastError ?? "unknown error"}`);
  }
}

/** Получатели служебных уведомлений: администраторы портала + ADMIN_ALERT_EMAILS. */
export async function adminAlertRecipients(): Promise<Array<{ email: string; locale: string }>> {
  const admins = await listAdminRecipients(db);
  const extra = (env.ADMIN_ALERT_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes("@"));
  const seen = new Set<string>();
  const out: Array<{ email: string; locale: string }> = [];
  for (const a of admins) {
    const email = a.email.toLowerCase();
    if (seen.has(email)) continue;
    seen.add(email);
    out.push({ email, locale: a.locale });
  }
  for (const email of extra) {
    if (seen.has(email)) continue;
    seen.add(email);
    out.push({ email, locale: "ru" });
  }
  return out;
}

/** Ставит в очередь письмо о сбое/восстановлении интеграции (одно на серию, dedup_key). */
async function notifyAdmins(
  kind: "failed" | "recovered",
  state: IntegrationState,
  at: Date,
): Promise<void> {
  const to = await adminAlertRecipients();
  if (to.length === 0) {
    logger.warn({ integration: state.name, kind }, "no admin recipients for integration alert");
    return;
  }
  const streak = state.failureStreakStartedAt ?? state.lastErrorAt ?? at.toISOString();
  const payload = {
    kind,
    integration: state.name,
    failures: state.consecutiveFailures,
    since: streak,
    at: at.toISOString(),
    error: state.lastError,
    lastSuccessAt: state.lastSuccessAt,
    circuitUntil: state.circuit.until,
    dashboardUrl: `${env.PUBLIC_URL}/admin`,
  };
  await db
    .insert(emailOutbox)
    .values(
      to.map((r) => ({
        to: r.email,
        locale: r.locale,
        template: "integration",
        payload,
        dedupKey: `integration:${kind}:${state.name}:${streak}:${r.email}`,
      })),
    )
    .onConflictDoNothing();
  logger.info({ integration: state.name, kind, recipients: to.length }, "integration alert queued");
}
