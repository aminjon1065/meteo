import { sql } from "@meteo/db";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Проверка живости для Docker/Caddy/мониторинга: процесс + соединение с БД. */
export async function GET() {
  const startedAt = Date.now();
  try {
    await getDb().execute(sql`select 1`);
    return NextResponse.json({
      status: "ok",
      db: "ok",
      latencyMs: Date.now() - startedAt,
      time: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "degraded",
        db: "error",
        error: error instanceof Error ? error.message : String(error),
        time: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
