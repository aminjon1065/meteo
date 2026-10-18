import { createHash } from "node:crypto";
import { and, desc, eq, gte } from "@meteo/db";
import { auditLog, measurements, pollutants, stations } from "@meteo/db/schema";
import { expect, test } from "@playwright/test";
import { closeE2eDb, e2eDb } from "../helpers/db";
import { E2E } from "../setup/fixtures";

/** Ключ станции E2E-DU-01: в базе хранится SHA‑256, сам ключ знает только тест. */
const API_KEY = "mst_e2e-ingest-key-0123456789";
const INGEST = `/api/v1/ingest/${E2E.station.code}`;
const auth = { Authorization: `Bearer ${API_KEY}` };

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const db = e2eDb();
  await db
    .update(stations)
    .set({ apiKeyHash: createHash("sha256").update(API_KEY).digest("hex") })
    .where(eq(stations.code, E2E.station.code));
});
test.afterAll(async () => {
  await closeE2eDb();
});

test("POST /api/v1/ingest: приём с конверсией единиц, причины по записям, аудит и карточка станции", async ({
  request,
}) => {
  const base = new Date(Date.now() - 6 * 3_600_000);
  base.setUTCMinutes(0, 0, 0);
  const t0 = base.toISOString();
  const t1 = new Date(base.getTime() + 3_600_000).toISOString();
  const local = new Date(base.getTime() + 2 * 3_600_000 + 5 * 3_600_000)
    .toISOString()
    .slice(0, 16)
    .replace("T", " ");
  const res = await request.post(INGEST, {
    headers: auth,
    data: [
      { time: t0, pollutant: "PM25", value: 42.5 },
      { time: t0, pollutant: "pm2.5 (ug/m3)", value: "43,5" },
      { time: t1, pollutant: "PM10", value: 61, unit: "µg/m³" },
      { time: t1, pollutant: "NO2", value: 10, unit: "ppb" },
      { time: local, pollutant: "PM25", value: "<5" },
      { time: t0, pollutant: "SO2", value: 3 },
      { time: t0, pollutant: "XX", value: 1 },
      // Значение вне диапазона QC здесь не шлём: оно попало бы в очередь QC, которую проверяет qc.spec.ts
      // (покрыто unit-тестами normalizeIngestRecords); флаг missing в очередь не попадает.
      { time: t1, pollutant: "PM25", value: null, flag: "missing" },
      { time: "not a time", pollutant: "PM25", value: 1 },
    ],
  });
  expect(res.status()).toBe(200);
  expect(res.headers()["x-ratelimit-limit"]).toBeTruthy();
  expect(res.headers()["cache-control"]).toContain("no-store");
  const body = (await res.json()) as {
    station: { code: string };
    received: number;
    accepted: number;
    rejected: number;
    inserted: number;
    updated: number;
    duplicates: number;
    invalidRange: number;
    pollutants: string[];
    errors: Array<{ index: number; message: string }>;
  };
  expect(body.station.code).toBe(E2E.station.code);
  expect(body.received).toBe(9);
  expect(body.accepted).toBe(5);
  expect(body.rejected).toBe(3);
  expect(body.duplicates).toBe(1);
  expect(body.invalidRange).toBe(0);
  expect(body.pollutants.sort()).toEqual(["NO2", "PM10", "PM25"]);
  expect(body.errors.map((e) => `${e.index}:${e.message.split(":")[0]}`).sort()).toEqual([
    "0:duplicate",
    "5:pollutantNotConfigured",
    "6:unknownPollutant",
    "8:time",
  ]);

  const db = e2eDb();
  const [station] = await db
    .select({
      id: stations.id,
      lastIngestAt: stations.lastIngestAt,
      source: stations.lastIngestSource,
      summary: stations.lastIngestSummary,
    })
    .from(stations)
    .where(eq(stations.code, E2E.station.code));
  expect(station?.lastIngestAt).toBeTruthy();
  expect(station?.source).toBe("api");
  expect(station?.summary?.accepted).toBe(5);
  const pid = new Map(
    (await db.select({ id: pollutants.id, code: pollutants.code }).from(pollutants)).map((p) => [
      p.code,
      p.id,
    ]),
  );
  const rows = await db
    .select()
    .from(measurements)
    .where(
      and(
        eq(measurements.stationId, station?.id ?? -1),
        gte(measurements.time, new Date(t0)),
        eq(measurements.source, 3),
      ),
    );
  const find = (code: string, iso: string) =>
    rows.find((r) => r.pollutantId === pid.get(code) && r.time.toISOString() === iso);
  expect(find("PM25", t0)?.value).toBe(43.5); // последняя запись с тем же ключом побеждает
  expect(find("NO2", t1)?.value).toBeCloseTo(18.8, 1); // ppb → µg/m³
  expect(find("PM25", t1)?.qcFlag).toBe(5); // флаг вендора missing → значение null, флаг missing
  expect(find("PM25", t1)?.value).toBeNull();
  expect(find("PM25", t1)?.qcReason).toBe("vendor:missing");
  const below = rows.find((r) => r.pollutantId === pid.get("PM25") && r.value === 2.5);
  expect(below?.qcReason).toBe("belowDetectionLimit:5");

  const [audit] = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.action, "measurements.ingest"))
    .orderBy(desc(auditLog.id))
    .limit(1);
  expect(audit?.actorEmail).toBe(`station:${E2E.station.code}`);
  expect(audit?.actorRole).toBe("station");
  expect((audit?.after as { source: string; accepted: number }).source).toBe("station");
  expect((audit?.after as { accepted: number }).accepted).toBe(5);

  // Повторная отправка идемпотентна: строки обновляются, не дублируются.
  const again = await request.post(INGEST, {
    headers: auth,
    data: [
      { time: t0, pollutant: "PM25", value: 43.5 },
      { time: t1, pollutant: "PM10", value: 61 },
    ],
  });
  expect(again.status()).toBe(200);
  const second = (await again.json()) as { inserted: number; updated: number; accepted: number };
  expect(second).toMatchObject({ accepted: 2, inserted: 0, updated: 2 });
  const after = await db
    .select()
    .from(measurements)
    .where(
      and(
        eq(measurements.stationId, station?.id ?? -1),
        gte(measurements.time, new Date(t0)),
        eq(measurements.source, 3),
      ),
    );
  expect(after.length).toBe(rows.length);
});

test("POST /api/v1/ingest: ошибки авторизации и тела", async ({ request }) => {
  const noAuth = await request.post(INGEST, {
    data: [{ time: "2026-01-01T00:00:00Z", pollutant: "PM25", value: 1 }],
  });
  expect(noAuth.status()).toBe(401);
  expect(noAuth.headers()["www-authenticate"]).toContain("Bearer");

  const wrongKey = await request.post(INGEST, {
    headers: { Authorization: "Bearer mst_wrong" },
    data: [{ time: "2026-01-01T00:00:00Z", pollutant: "PM25", value: 1 }],
  });
  expect(wrongKey.status()).toBe(401);

  const wrongStation = await request.post(`/api/v1/ingest/${E2E.station2.code}`, {
    headers: auth,
    data: [{ time: "2026-01-01T00:00:00Z", pollutant: "PM25", value: 1 }],
  });
  expect(wrongStation.status()).toBe(401);

  const empty = await request.post(INGEST, { headers: auth, data: [] });
  expect(empty.status()).toBe(400);
  expect(((await empty.json()) as { error: string }).error).toBe("validation");

  const notJson = await request.post(INGEST, {
    headers: { ...auth, "Content-Type": "application/json" },
    data: "{not json",
  });
  expect(notJson.status()).toBe(400);

  const allRejected = await request.post(INGEST, {
    headers: auth,
    data: { measurements: [{ time: "2026-01-01T00:00:00Z", pollutant: "Hg", value: 1 }] },
  });
  expect(allRejected.status()).toBe(422);
  const rejectedBody = (await allRejected.json()) as {
    accepted: number;
    errors: Array<{ message: string }>;
  };
  expect(rejectedBody.accepted).toBe(0);
  expect(rejectedBody.errors[0]?.message).toBe("unknownPollutant:HG");
});

test("OpenAPI описывает POST /api/v1/ingest/{code} со схемой запроса и bearer-авторизацией", async ({
  request,
}) => {
  const doc = (await (await request.get("/api/v1/openapi.json?lang=ru")).json()) as {
    paths: Record<string, Record<string, { security?: unknown[]; requestBody?: unknown }>>;
    components: { securitySchemes: Record<string, { scheme: string }> };
  };
  const op = doc.paths["/api/v1/ingest/{code}"]?.post;
  expect(op).toBeTruthy();
  expect(op?.requestBody).toBeTruthy();
  expect(op?.security).toEqual([{ stationApiKey: [] }]);
  expect(doc.components.securitySchemes.stationApiKey?.scheme).toBe("bearer");
});
