/**
 * Устойчивость внешних интеграций (SmartMet, SILAM, CAP): чистые функции без I/O.
 *
 *  - экспоненциальная задержка повторов для транзиентных ошибок HTTP;
 *  - circuit breaker: после N неудачных запусков подряд источник «размыкается» на время
 *    cooldown (растёт с каждой следующей неудачей, но не выше maxCooldown); по истечении —
 *    одна пробная попытка (half-open), успех замыкает цепь;
 *  - решения об уведомлении администраторов: один раз на серию сбоев при достижении порога
 *    и один раз при восстановлении после отправленного уведомления.
 *
 * Состояние сериализуется в settings (`integration.<name>`) и показывается на дашборде админки.
 */

export const INTEGRATION_NAMES = ["smartmet", "silam", "cap"] as const;
export type IntegrationName = (typeof INTEGRATION_NAMES)[number];

export type IntegrationStatus = "never" | "ok" | "failed" | "circuit-open" | "skipped";

export interface IntegrationState {
  name: IntegrationName;
  /** Итог последнего запуска (или never, если запусков ещё не было). */
  status: IntegrationStatus;
  /** Последняя попытка любого исхода, ISO. */
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastDurationMs: number | null;
  lastError: string | null;
  lastErrorAt: string | null;
  /** Неудачных запусков подряд (сбрасывается успехом). */
  consecutiveFailures: number;
  /** Начало текущей серии сбоев, ISO (null — серии нет). */
  failureStreakStartedAt: string | null;
  /** Пропущенных запусков при разомкнутой цепи (в текущей серии). */
  skippedRuns: number;
  circuit: {
    open: boolean;
    openedAt: string | null;
    /** До какого момента запуски пропускаются, ISO. */
    until: string | null;
    /** Сколько раз цепь размыкалась в текущей серии сбоев. */
    openCount: number;
  };
  alert: {
    /** Когда отправлено уведомление о сбое текущей/последней серии. */
    sentAt: string | null;
    /** Серия, по которой отправлено уведомление (ISO начала). */
    streakStartedAt: string | null;
    /** Когда отправлено уведомление о восстановлении. */
    recoveredSentAt: string | null;
  };
  /** Адрес источника (без учётных данных) — для раздела «Настройки». */
  source?: string | null;
  /** Краткая сводка последнего успешного запуска (число точек, сообщений и т. п.). */
  summary?: Record<string, unknown> | null;
}

export interface ResilienceOptions {
  /** Неудач подряд до размыкания цепи. */
  circuitFailureThreshold: number;
  /** Базовый cooldown разомкнутой цепи, мс. */
  circuitCooldownMs: number;
  /** Верхняя граница cooldown, мс. */
  circuitMaxCooldownMs: number;
  /** Неудач подряд, после которых уведомляются администраторы. */
  alertFailureThreshold: number;
}

export const DEFAULT_RESILIENCE: ResilienceOptions = {
  circuitFailureThreshold: 3,
  circuitCooldownMs: 30 * 60_000,
  circuitMaxCooldownMs: 4 * 60 * 60_000,
  alertFailureThreshold: 3,
};

export function createIntegrationState(name: IntegrationName): IntegrationState {
  return {
    name,
    status: "never",
    lastRunAt: null,
    lastSuccessAt: null,
    lastDurationMs: null,
    lastError: null,
    lastErrorAt: null,
    consecutiveFailures: 0,
    failureStreakStartedAt: null,
    skippedRuns: 0,
    circuit: { open: false, openedAt: null, until: null, openCount: 0 },
    alert: { sentAt: null, streakStartedAt: null, recoveredSentAt: null },
    source: null,
    summary: null,
  };
}

/** Дополняет состояние из БД (возможно, старого формата) значениями по умолчанию. */
export function normalizeIntegrationState(name: IntegrationName, raw: unknown): IntegrationState {
  const base = createIntegrationState(name);
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<IntegrationState>;
  return {
    ...base,
    ...r,
    name,
    circuit: { ...base.circuit, ...(r.circuit ?? {}) },
    alert: { ...base.alert, ...(r.alert ?? {}) },
  };
}

/** Можно ли запускать интеграцию сейчас: цепь замкнута или cooldown истёк (half-open). */
export function circuitAllows(
  state: IntegrationState,
  now: Date,
): { allow: boolean; halfOpen: boolean } {
  if (!state.circuit.open) return { allow: true, halfOpen: false };
  const until = state.circuit.until ? Date.parse(state.circuit.until) : Number.NaN;
  if (Number.isNaN(until) || now.getTime() >= until) return { allow: true, halfOpen: true };
  return { allow: false, halfOpen: false };
}

/** Запуск пропущен из-за разомкнутой цепи. */
export function recordSkipped(state: IntegrationState, now: Date): IntegrationState {
  return {
    ...state,
    status: "circuit-open",
    lastRunAt: now.toISOString(),
    skippedRuns: state.skippedRuns + 1,
  };
}

export interface SuccessResult {
  state: IntegrationState;
  /** Серия сбоев закончилась и о ней уже уведомляли — пора сообщить о восстановлении. */
  recovered: boolean;
}

export function recordSuccess(
  state: IntegrationState,
  now: Date,
  extra: {
    durationMs?: number;
    summary?: Record<string, unknown> | null;
    source?: string | null;
  } = {},
): SuccessResult {
  const at = now.toISOString();
  const alertedThisStreak =
    state.alert.sentAt !== null &&
    state.alert.streakStartedAt !== null &&
    state.alert.streakStartedAt === state.failureStreakStartedAt &&
    state.alert.recoveredSentAt === null;
  return {
    recovered: alertedThisStreak,
    state: {
      ...state,
      status: "ok",
      lastRunAt: at,
      lastSuccessAt: at,
      lastDurationMs: extra.durationMs ?? state.lastDurationMs,
      consecutiveFailures: 0,
      failureStreakStartedAt: null,
      skippedRuns: 0,
      circuit: { open: false, openedAt: null, until: null, openCount: 0 },
      source: extra.source === undefined ? (state.source ?? null) : extra.source,
      summary: extra.summary === undefined ? (state.summary ?? null) : extra.summary,
    },
  };
}

export interface FailureResult {
  state: IntegrationState;
  /** Достигнут порог уведомления, и по этой серии ещё не уведомляли. */
  shouldAlert: boolean;
  /** Цепь разомкнута этим сбоем. */
  circuitOpened: boolean;
}

/** Cooldown растёт удвоением с каждым размыканием в рамках одной серии сбоев. */
export function cooldownMs(openCount: number, opts: ResilienceOptions): number {
  const factor = 2 ** Math.max(0, openCount - 1);
  return Math.min(opts.circuitMaxCooldownMs, opts.circuitCooldownMs * factor);
}

export function recordFailure(
  state: IntegrationState,
  error: unknown,
  now: Date,
  opts: ResilienceOptions = DEFAULT_RESILIENCE,
  extra: { source?: string | null } = {},
): FailureResult {
  const at = now.toISOString();
  const failures = state.consecutiveFailures + 1;
  const streakStart = state.failureStreakStartedAt ?? at;
  let circuit = { ...state.circuit };
  let circuitOpened = false;
  if (failures >= opts.circuitFailureThreshold) {
    const openCount = circuit.openCount + 1;
    circuit = {
      open: true,
      openedAt: at,
      until: new Date(now.getTime() + cooldownMs(openCount, opts)).toISOString(),
      openCount,
    };
    circuitOpened = true;
  }
  const shouldAlert =
    failures >= opts.alertFailureThreshold && state.alert.streakStartedAt !== streakStart;
  return {
    shouldAlert,
    circuitOpened,
    state: {
      ...state,
      status: "failed",
      lastRunAt: at,
      lastError: summarizeError(error),
      lastErrorAt: at,
      consecutiveFailures: failures,
      failureStreakStartedAt: streakStart,
      circuit,
      source: extra.source === undefined ? (state.source ?? null) : extra.source,
    },
  };
}

/** Отметить, что уведомление о сбое текущей серии отправлено. */
export function markAlerted(state: IntegrationState, now: Date): IntegrationState {
  return {
    ...state,
    alert: {
      sentAt: now.toISOString(),
      streakStartedAt: state.failureStreakStartedAt,
      recoveredSentAt: null,
    },
  };
}

/** Отметить, что уведомление о восстановлении отправлено. */
export function markRecoveredAlerted(state: IntegrationState, now: Date): IntegrationState {
  return { ...state, alert: { ...state.alert, recoveredSentAt: now.toISOString() } };
}

/** HTTP‑статусы, при которых запрос имеет смысл повторить. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);
}

/**
 * Задержка перед повтором номер attempt (1 — первый повтор): экспонента от base с
 * верхней границей max и детерминированным джиттером ±20 % (seed — для тестов).
 */
export function backoffDelayMs(
  attempt: number,
  baseMs = 1_000,
  maxMs = 30_000,
  jitter: () => number = Math.random,
): number {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  const spread = exp * 0.2;
  return Math.round(exp - spread + jitter() * 2 * spread);
}

export function summarizeError(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause;
    const causeText =
      cause instanceof Error ? `: ${cause.message}` : cause ? `: ${String(cause)}` : "";
    return `${error.name === "Error" ? "" : `${error.name}: `}${error.message}${causeText}`.slice(
      0,
      500,
    );
  }
  return String(error).slice(0, 500);
}

/** Убирает учётные данные и ключи из URL для показа в админке и письмах. */
export function maskUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.username || u.password) {
      u.username = u.username ? "***" : "";
      u.password = "";
    }
    for (const key of [...u.searchParams.keys()]) {
      if (/key|token|secret|password|pass|auth/i.test(key)) u.searchParams.set(key, "***");
    }
    return u.toString();
  } catch {
    return url.replace(/\/\/[^@/]+@/, "//***@");
  }
}
