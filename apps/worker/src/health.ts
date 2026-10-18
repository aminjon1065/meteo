import { createServer } from "node:http";
import { env } from "./env";
import { logger } from "./logger";

export const healthState = {
  startedAt: new Date(),
  lastHeartbeatAt: null as Date | null,
  queueReady: false,
  shuttingDown: false,
};

/** GET /healthz — для Docker healthcheck и мониторинга. */
export function startHealthServer() {
  const server = createServer((req, res) => {
    if (req.url === "/healthz") {
      const stale =
        healthState.lastHeartbeatAt === null ||
        Date.now() - healthState.lastHeartbeatAt.getTime() > 3 * 60_000;
      const ok = healthState.queueReady && !stale && !healthState.shuttingDown;
      res.writeHead(ok ? 200 : 503, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          status: ok ? "ok" : "degraded",
          queue: healthState.queueReady ? "ok" : "down",
          lastHeartbeatAt: healthState.lastHeartbeatAt?.toISOString() ?? null,
          uptimeSec: Math.round((Date.now() - healthState.startedAt.getTime()) / 1000),
        }),
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(env.WORKER_PORT, () =>
    logger.info({ port: env.WORKER_PORT }, "health server started"),
  );
  return server;
}
