import { hostname } from "node:os";
import { settings, sql } from "@meteo/db";
import { db } from "../db";
import type { JobDefinition } from "./types";

export const HEARTBEAT_KEY = "worker.heartbeat";

/**
 * Пишет отметку живости в settings — админ‑дашборд показывает состояние фоновых задач
 * без доступа к контейнеру.
 */
export const heartbeat: JobDefinition = {
  name: "heartbeat",
  schedule: { every: 60_000 },
  async run() {
    const value = { at: new Date().toISOString(), host: hostname(), pid: process.pid };
    await db
      .insert(settings)
      .values({ key: HEARTBEAT_KEY, value })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: sql`now()` } });
    return value;
  },
};
