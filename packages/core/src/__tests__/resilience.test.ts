import { describe, expect, it } from "vitest";
import {
  backoffDelayMs,
  circuitAllows,
  cooldownMs,
  createIntegrationState,
  DEFAULT_RESILIENCE,
  isRetryableStatus,
  markAlerted,
  markRecoveredAlerted,
  maskUrl,
  normalizeIntegrationState,
  recordFailure,
  recordSkipped,
  recordSuccess,
  summarizeError,
} from "../resilience";

const opts = {
  ...DEFAULT_RESILIENCE,
  circuitFailureThreshold: 3,
  alertFailureThreshold: 3,
  circuitCooldownMs: 60_000,
  circuitMaxCooldownMs: 4 * 60_000,
};
const t0 = new Date("2026-12-01T06:00:00Z");
const after = (ms: number) => new Date(t0.getTime() + ms);

describe("circuit breaker", () => {
  it("замыкается после порога неудач и пропускает запуски до истечения cooldown", () => {
    let state = createIntegrationState("smartmet");
    let r = recordFailure(state, new Error("HTTP 503"), t0, opts);
    expect(r.circuitOpened).toBe(false);
    expect(r.state.consecutiveFailures).toBe(1);
    expect(r.state.failureStreakStartedAt).toBe(t0.toISOString());
    r = recordFailure(r.state, new Error("timeout"), after(1_000), opts);
    expect(r.circuitOpened).toBe(false);
    r = recordFailure(r.state, new Error("HTTP 500"), after(2_000), opts);
    expect(r.circuitOpened).toBe(true);
    expect(r.state.circuit.open).toBe(true);
    expect(r.state.circuit.until).toBe(after(2_000 + 60_000).toISOString());
    state = r.state;

    expect(circuitAllows(state, after(10_000))).toEqual({ allow: false, halfOpen: false });
    const skipped = recordSkipped(state, after(10_000));
    expect(skipped.status).toBe("circuit-open");
    expect(skipped.skippedRuns).toBe(1);
    expect(circuitAllows(skipped, after(70_000))).toEqual({ allow: true, halfOpen: true });
  });

  it("cooldown удваивается с каждым размыканием, но ограничен максимумом", () => {
    expect(cooldownMs(1, opts)).toBe(60_000);
    expect(cooldownMs(2, opts)).toBe(120_000);
    expect(cooldownMs(3, opts)).toBe(240_000);
    expect(cooldownMs(10, opts)).toBe(240_000);
    let state = createIntegrationState("silam");
    for (let i = 0; i < 4; i++) {
      state = recordFailure(state, new Error("x"), after(i * 1000), opts).state;
    }
    expect(state.circuit.openCount).toBe(2);
    expect(Date.parse(state.circuit.until ?? "") - after(3000).getTime()).toBe(120_000);
  });

  it("успех замыкает цепь и сбрасывает серию", () => {
    let state = createIntegrationState("cap");
    for (let i = 0; i < 3; i++) state = recordFailure(state, "boom", after(i), opts).state;
    const ok = recordSuccess(state, after(5_000), { durationMs: 1234, summary: { n: 1 } });
    expect(ok.state.status).toBe("ok");
    expect(ok.state.consecutiveFailures).toBe(0);
    expect(ok.state.circuit.open).toBe(false);
    expect(ok.state.circuit.openCount).toBe(0);
    expect(ok.state.failureStreakStartedAt).toBeNull();
    expect(ok.state.lastDurationMs).toBe(1234);
    expect(ok.state.summary).toEqual({ n: 1 });
    expect(ok.recovered).toBe(false);
  });
});

describe("уведомления администраторов", () => {
  it("один раз на серию при достижении порога и один раз при восстановлении", () => {
    let state = createIntegrationState("smartmet");
    let r = recordFailure(state, "1", after(0), opts);
    expect(r.shouldAlert).toBe(false);
    r = recordFailure(r.state, "2", after(1), opts);
    expect(r.shouldAlert).toBe(false);
    r = recordFailure(r.state, "3", after(2), opts);
    expect(r.shouldAlert).toBe(true);
    state = markAlerted(r.state, after(2));
    expect(state.alert.streakStartedAt).toBe(state.failureStreakStartedAt);
    // Четвёртый сбой той же серии — повторно не уведомляем.
    r = recordFailure(state, "4", after(3), opts);
    expect(r.shouldAlert).toBe(false);
    // Восстановление после уведомления → сообщаем один раз.
    const ok = recordSuccess(r.state, after(4), {});
    expect(ok.recovered).toBe(true);
    state = markRecoveredAlerted(ok.state, after(4));
    const ok2 = recordSuccess(state, after(5), {});
    expect(ok2.recovered).toBe(false);
    // Новая серия → новое уведомление при достижении порога.
    let n = recordFailure(ok2.state, "a", after(6), opts);
    n = recordFailure(n.state, "b", after(7), opts);
    n = recordFailure(n.state, "c", after(8), opts);
    expect(n.shouldAlert).toBe(true);
  });

  it("без уведомления о сбое восстановление не рассылается", () => {
    let state = createIntegrationState("cap");
    state = recordFailure(state, "x", after(0), opts).state;
    expect(recordSuccess(state, after(1), {}).recovered).toBe(false);
  });
});

describe("вспомогательные функции", () => {
  it("normalizeIntegrationState дополняет неполные данные", () => {
    const s = normalizeIntegrationState("silam", { status: "ok", lastSuccessAt: "2026-01-01" });
    expect(s.name).toBe("silam");
    expect(s.circuit).toEqual({ open: false, openedAt: null, until: null, openCount: 0 });
    expect(s.alert.sentAt).toBeNull();
    expect(normalizeIntegrationState("cap", null).status).toBe("never");
  });

  it("isRetryableStatus: 5xx, 408, 425, 429 — да; 4xx — нет", () => {
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(408)).toBe(true);
    expect(isRetryableStatus(404)).toBe(false);
    expect(isRetryableStatus(401)).toBe(false);
    expect(isRetryableStatus(200)).toBe(false);
  });

  it("backoffDelayMs растёт экспоненциально с джиттером ±20 %", () => {
    expect(backoffDelayMs(1, 1000, 30000, () => 0.5)).toBe(1000);
    expect(backoffDelayMs(2, 1000, 30000, () => 0.5)).toBe(2000);
    expect(backoffDelayMs(3, 1000, 30000, () => 0)).toBe(3200);
    expect(backoffDelayMs(3, 1000, 30000, () => 1)).toBe(4800);
    expect(backoffDelayMs(10, 1000, 30000, () => 0.5)).toBe(30000);
  });

  it("summarizeError и maskUrl", () => {
    expect(summarizeError(new Error("HTTP 503"))).toBe("HTTP 503");
    expect(
      summarizeError(new TypeError("fetch failed", { cause: new Error("ECONNREFUSED") })),
    ).toBe("TypeError: fetch failed: ECONNREFUSED");
    expect(summarizeError("plain")).toBe("plain");
    expect(maskUrl("https://user:secret@smartmet.example/timeseries?apikey=abc&x=1")).toBe(
      "https://***@smartmet.example/timeseries?apikey=***&x=1",
    );
    expect(maskUrl("https://opendata.fmi.fi")).toBe("https://opendata.fmi.fi/");
    expect(maskUrl(null)).toBeNull();
    expect(maskUrl("file:///data/cap")).toBe("file:///data/cap");
  });
});
