import { sql } from "@meteo/db";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getRedis } from "@/lib/redis";

export const dynamic = "force-dynamic";

const REDIS_TIMEOUT_MS = 1_500;

/** Состояние Redis: ok / error / not-configured. Без Redis web работает (память процесса), поэтому это не 503. */
async function redisStatus(): Promise<"ok" | "error" | "not-configured"> {
  const redis = getRedis();
  if (!redis) return "not-configured";
  try {
    const pong = await Promise.race([
      redis.ping(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), REDIS_TIMEOUT_MS).unref(),
      ),
    ]);
    return pong === "PONG" ? "ok" : "error";
  } catch {
    return "error";
  }
}

/**
 * Проверка живости для Docker/Caddy/мониторинга: процесс, соединение с БД (обязательно → 503)
 * и Redis (деградация: лимиты/кэш/очередь в памяти процесса, ответ 200 со статусом degraded).
 * Без секретов и внутренних адресов.
 */
export async function GET() {
  const startedAt = Date.now();
  const time = new Date().toISOString();
  const redis = await redisStatus();
  try {
    await getDb().execute(sql`select 1`);
    const degraded = redis === "error";
    return NextResponse.json(
      {
        status: degraded ? "degraded" : "ok",
        db: "ok",
        redis,
        latencyMs: Date.now() - startedAt,
        time,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { status: "degraded", db: "error", redis, time },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
