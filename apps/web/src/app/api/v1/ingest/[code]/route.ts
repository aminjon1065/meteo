import { evaluateAlertRules, findStationByApiKey, ingestMeasurements } from "@meteo/db";
import { auditLog } from "@meteo/db/schema";
import { after, type NextRequest, NextResponse } from "next/server";
import { IngestRequestSchema } from "@/lib/api/schemas";
import { getDb } from "@/lib/db";
import { enqueueJob } from "@/lib/jobs";
import { BodyTooLargeError, readBodyWithLimit } from "@/lib/security/body";
import { clientIp } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

/** Максимальный размер тела: 1000 записей с запасом (≈ 150 байт на запись). */
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const NO_STORE = { "Cache-Control": "no-store" };

function error(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  return NextResponse.json(
    { error: code, message, ...extra },
    { status, headers: { ...NO_STORE, ...headers } },
  );
}

/**
 * POST /api/v1/ingest/{code} — приём измерений от станции (логгер, агент станции, вендорское ПО).
 * Авторизация: `Authorization: Bearer <ключ станции>` (ключ создаётся в карточке станции, в БД хранится
 * хэш). Тело — JSON‑массив записей `{ time, pollutant, value, unit?, flag?, averagingMin? }` (до 1000).
 * Повторная отправка идемпотентна: строки обновляются по ключу время/вещество/осреднение, решения
 * оператора (qc_locked) сохраняются. Ответ — числа принятых/отклонённых и причины по записям;
 * 200 — принята хотя бы одна запись, 422 — ни одной. Лимит запросов — отдельная группа `ingest`
 * (код станции + IP). После записи пересчитывается индекс и ставится задача правил уведомлений.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const authorization = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization);
  const unauthorized = () =>
    error(
      401,
      "unauthorized",
      "Station code or API key is invalid",
      {},
      {
        "WWW-Authenticate": 'Bearer realm="meteo-ingest"',
      },
    );
  if (!match?.[1]) return unauthorized();

  const db = getDb();
  const station = await findStationByApiKey(db, code, match[1]);
  if (!station) return unauthorized();
  if (station.status !== "active")
    return error(403, "station_inactive", `Station ${station.code} is ${station.status}`);

  // Тело читается потоком и обрывается при превышении предела (Content-Length может отсутствовать).
  let text: string;
  try {
    text = await readBodyWithLimit(req, MAX_BODY_BYTES);
  } catch (e) {
    if (e instanceof BodyTooLargeError)
      return error(413, "payload_too_large", `Body must be at most ${MAX_BODY_BYTES} bytes`);
    return error(400, "invalid_json", "Body could not be read");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return error(400, "invalid_json", "Body must be valid JSON");
  }
  const parsed = IngestRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return error(400, "validation", "Body must be a JSON array of 1–1000 measurements", {
      issues: parsed.error.issues.slice(0, 20).map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
  }
  const records = Array.isArray(parsed.data) ? parsed.data : parsed.data.measurements;
  const agent = req.headers.get("user-agent") ?? undefined;
  const ip = clientIp(req.headers);

  const result = await ingestMeasurements(db, {
    station,
    records,
    source: "api",
    meta: { agent },
  });

  await db.insert(auditLog).values({
    actorId: null,
    actorEmail: `station:${station.code}`,
    actorRole: "station",
    action: "measurements.ingest",
    entity: "stations",
    entityId: String(station.id),
    after: {
      source: "station",
      stationCode: station.code,
      received: result.received,
      accepted: result.accepted,
      rejected: result.rejected,
      inserted: result.inserted,
      updated: result.updated,
      skippedLocked: result.skippedLocked,
      invalidRange: result.invalidRange,
      from: result.from?.toISOString() ?? null,
      to: result.to?.toISOString() ?? null,
      pollutants: result.pollutantCodes,
      errors: result.errors.slice(0, 50),
    },
    ip: ip === "local" ? null : ip,
    userAgent: agent ?? null,
    requestId: req.headers.get("x-request-id"),
  });

  if (result.accepted > 0) {
    // Правила уведомлений: задача worker'а (одна на минуту для всех станций); без Redis — прямо здесь после ответа.
    after(async () => {
      const minute = Math.floor(Date.now() / 60_000);
      const queued = await enqueueJob(
        "threshold-eval",
        {},
        { jobId: `threshold-eval:ingest:${minute}` },
      );
      if (!queued) {
        await evaluateAlertRules(db, {
          publicUrl: process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin,
        }).catch((e) => console.error("[ingest] threshold evaluation failed", e));
      }
    });
  }

  const body = {
    station: { id: station.id, code: station.code, slug: station.slug },
    received: result.received,
    accepted: result.accepted,
    rejected: result.rejected,
    inserted: result.inserted,
    updated: result.updated,
    skippedLocked: result.skippedLocked,
    invalidRange: result.invalidRange,
    duplicates: result.duplicates,
    from: result.from?.toISOString() ?? null,
    to: result.to?.toISOString() ?? null,
    pollutants: result.pollutantCodes,
    errors: result.errors,
  };
  return NextResponse.json(body, { status: result.accepted > 0 ? 200 : 422, headers: NO_STORE });
}
