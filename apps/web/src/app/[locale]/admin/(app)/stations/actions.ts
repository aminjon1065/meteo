"use server";

import { createHash, randomBytes } from "node:crypto";
import { ForbiddenError, slugify } from "@meteo/core";
import { eq } from "@meteo/db";
import { stationPollutants, stations } from "@meteo/db/schema";
import type { Locale } from "@meteo/i18n";
import { recordAudit } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { isUniqueViolation, violatedConstraint } from "@/lib/db-errors";
import { requireAdminSession } from "@/lib/session";
import { fieldErrorsOf } from "@/lib/validation/common";
import { type StationValues, stationInput } from "@/lib/validation/station";

export type StationActionResult =
  | { ok: true; id: number; slug: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

function uniqueError(error: unknown): StationActionResult {
  const field = violatedConstraint(error)?.includes("slug") ? "slug" : "code";
  return { ok: false, message: "unique", fieldErrors: { [field]: ["unique"] } };
}

function toRow(values: StationValues, slug: string) {
  return {
    code: values.code,
    slug,
    name: values.name,
    kind: values.kind,
    status: values.status,
    geom: { x: values.lon, y: values.lat },
    elevationM: values.elevationM,
    regionId: values.regionId,
    districtId: values.districtId,
    commissionedAt: values.commissionedAt,
    decommissionedAt: values.decommissionedAt,
    dataSource: values.dataSource,
    sampling: values.sampling,
    isPublic: values.isPublic,
    description: values.description ?? null,
    address: values.address ?? null,
  };
}

function deriveSlug(values: StationValues): string {
  if (values.slug) return values.slug;
  const base =
    values.name.en?.trim() || values.name.ru?.trim() || values.name.tg?.trim() || values.code;
  return slugify(base) || slugify(values.code);
}

async function syncPollutants(stationId: number, list: StationValues["pollutants"]) {
  const db = getDb();
  await db.delete(stationPollutants).where(eq(stationPollutants.stationId, stationId));
  if (list.length > 0) {
    await db.insert(stationPollutants).values(
      list.map((p) => ({
        stationId,
        pollutantId: p.pollutantId,
        inputUnit: p.inputUnit,
        active: p.active,
      })),
    );
  }
}

export async function createStation(locale: Locale, raw: unknown): Promise<StationActionResult> {
  const session = await requireAdminSession(locale, "stations.write");
  const parsed = stationInput.safeParse(raw);
  if (!parsed.success)
    return { ok: false, message: "validation", fieldErrors: fieldErrorsOf(parsed.error) };
  const values = parsed.data;
  const slug = deriveSlug(values);
  try {
    const [row] = await getDb()
      .insert(stations)
      .values(toRow(values, slug))
      .returning({ id: stations.id });
    if (!row) return { ok: false, message: "insert" };
    await syncPollutants(row.id, values.pollutants);
    await recordAudit(session, {
      action: "station.create",
      entity: "stations",
      entityId: row.id,
      after: { ...values, slug },
    });
    return { ok: true, id: row.id, slug };
  } catch (error) {
    if (isUniqueViolation(error)) return uniqueError(error);
    throw error;
  }
}

export async function updateStation(
  locale: Locale,
  id: number,
  raw: unknown,
): Promise<StationActionResult> {
  const session = await requireAdminSession(locale, "stations.write");
  const parsed = stationInput.safeParse(raw);
  if (!parsed.success)
    return { ok: false, message: "validation", fieldErrors: fieldErrorsOf(parsed.error) };
  const values = parsed.data;
  const slug = deriveSlug(values);
  const db = getDb();
  const before = await db.query.stations.findFirst({ where: eq(stations.id, id) });
  if (!before) return { ok: false, message: "notFound" };
  try {
    await db.update(stations).set(toRow(values, slug)).where(eq(stations.id, id));
    await syncPollutants(id, values.pollutants);
    await recordAudit(session, {
      action: "station.update",
      entity: "stations",
      entityId: id,
      before: {
        code: before.code,
        slug: before.slug,
        name: before.name,
        status: before.status,
        geom: before.geom,
      },
      after: { ...values, slug },
    });
    return { ok: true, id, slug };
  } catch (error) {
    if (isUniqueViolation(error)) return uniqueError(error);
    throw error;
  }
}

/** Вывод из эксплуатации: статус + дата; данные станции сохраняются. */
export async function decommissionStation(
  locale: Locale,
  id: number,
  date: string,
): Promise<StationActionResult> {
  const session = await requireAdminSession(locale, "stations.write");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    return { ok: false, message: "validation", fieldErrors: { decommissionedAt: ["date"] } };
  const db = getDb();
  const before = await db.query.stations.findFirst({ where: eq(stations.id, id) });
  if (!before) return { ok: false, message: "notFound" };
  await db
    .update(stations)
    .set({ status: "decommissioned", decommissionedAt: date })
    .where(eq(stations.id, id));
  await recordAudit(session, {
    action: "station.decommission",
    entity: "stations",
    entityId: id,
    before: { status: before.status, decommissionedAt: before.decommissionedAt },
    after: { status: "decommissioned", decommissionedAt: date },
  });
  return { ok: true, id, slug: before.slug };
}

/** Генерирует новый API‑ключ станции; в БД хранится только SHA‑256, ключ показывается один раз. */
export async function rotateStationApiKey(
  locale: Locale,
  id: number,
): Promise<{ ok: true; apiKey: string } | { ok: false; message: string }> {
  const session = await requireAdminSession(locale, "stations.write");
  const db = getDb();
  const station = await db.query.stations.findFirst({ where: eq(stations.id, id) });
  if (!station) return { ok: false, message: "notFound" };
  const apiKey = `mst_${randomBytes(24).toString("base64url")}`;
  const apiKeyHash = createHash("sha256").update(apiKey).digest("hex");
  await db.update(stations).set({ apiKeyHash }).where(eq(stations.id, id));
  await recordAudit(session, { action: "station.apiKey.rotate", entity: "stations", entityId: id });
  return { ok: true, apiKey };
}

export async function assertStationsWrite(locale: Locale): Promise<void> {
  try {
    await requireAdminSession(locale, "stations.write");
  } catch (error) {
    if (error instanceof ForbiddenError) throw error;
    throw error;
  }
}
