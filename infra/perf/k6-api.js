/**
 * Нагрузочная проверка публичного API (docs/perf.md). Запуск: sh infra/perf/run.sh
 * (k6 в Docker, целевой сервер — production-сборка web на хосте).
 *
 * Переменные: BASE_URL (http://host.docker.internal:3100), VUS (20), DURATION (30s),
 * STATION_SLUG (e2e-dushanbe-center), SCENARIO (all | stations | index | forecast | silam | station-series).
 * Пороги: p(95) < 300 мс и доля ошибок < 1 % на каждый маршрут.
 */

import { check, sleep } from "k6";
import http from "k6/http";
import { Trend } from "k6/metrics";

const BASE = (__ENV.BASE_URL || "http://host.docker.internal:3100").replace(/\/$/, "");
const VUS = Number(__ENV.VUS || 20);
const DURATION = __ENV.DURATION || "30s";
const STATION = __ENV.STATION_SLUG || "e2e-dushanbe-center";
const ONLY = __ENV.SCENARIO || "all";

const routes = {
  stations: "/api/v1/stations",
  index: "/api/v1/index/current",
  forecast: "/api/v1/forecast/dushanbe",
  silam: "/api/v1/silam/layers",
  "station-series": `/api/v1/stations/${STATION}/measurements?range=24h`,
};

const trends = Object.fromEntries(
  Object.keys(routes).map((name) => [name, new Trend(`latency_${name.replace("-", "_")}`, true)]),
);

const selected = ONLY === "all" ? Object.keys(routes) : ONLY.split(",");
export const options = {
  scenarios: Object.fromEntries(
    selected.map((name, i) => [
      name,
      {
        executor: "constant-vus",
        vus: VUS,
        duration: DURATION,
        exec: "hit",
        env: { ROUTE: name },
        startTime: `${i * 0}s`,
      },
    ]),
  ),
  thresholds: Object.fromEntries(
    selected.flatMap((name) => [
      [`http_req_duration{route:${name}}`, ["p(95)<300"]],
      [`http_req_failed{route:${name}}`, ["rate<0.01"]],
    ]),
  ),
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max"],
};

export function hit() {
  const name = __ENV.ROUTE;
  const res = http.get(`${BASE}${routes[name]}`, {
    tags: { route: name },
    headers: { Accept: "application/json" },
  });
  trends[name].add(res.timings.duration);
  check(res, {
    "status 200": (r) => r.status === 200,
    "json body": (r) => (r.headers["Content-Type"] || "").includes("json"),
  });
  sleep(0.05);
}

export function handleSummary(data) {
  const lines = [];
  for (const name of selected) {
    const m = data.metrics[`http_req_duration{route:${name}}`];
    const reqs = data.metrics.http_reqs;
    if (!m) continue;
    lines.push(
      `${name}: p50=${Math.round(m.values.med)}ms p95=${Math.round(m.values["p(95)"])}ms p99=${Math.round(m.values["p(99)"])}ms max=${Math.round(m.values.max)}ms`,
    );
    void reqs;
  }
  const total = data.metrics.http_reqs ? data.metrics.http_reqs.values.rate : 0;
  const failed = data.metrics.http_req_failed ? data.metrics.http_req_failed.values.rate : 0;
  const summary = [
    `# k6 summary — ${new Date().toISOString()} — VUS=${VUS} DURATION=${DURATION} BASE=${BASE}`,
    `total RPS=${total.toFixed(1)} failed=${(failed * 100).toFixed(2)}%`,
    ...lines,
    "",
  ].join("\n");
  return {
    stdout: `${summary}\n`,
    "/results/summary.txt": summary,
    "/results/summary.json": JSON.stringify(data, null, 2),
  };
}
