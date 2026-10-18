"use server";

import { createHash, randomBytes } from "node:crypto";
import { type FeedMapping, ForbiddenError, slugify } from "@meteo/core";
import { isEnvSecret, sealSecret, secretKeyFromEnv } from "@meteo/core/secret-box";
import { eq } from "@meteo/db";
import { stationPollutants, stationSources, stations } from "@meteo/db/schema";
import type { Locale } from "@meteo/i18n";
import { recordAudit } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { isUniqueViolation, violatedConstraint } from "@/lib/db-errors";
import { enqueueJob } from "@/lib/jobs";
import { requireAdminSession } from "@/lib/session";
import { fieldErrorsOf } from "@/lib/validation/common";
import { type StationValues, stationInput } from "@/lib/validation/station";
import { stationSourceInput } from "@/lib/validation/station-source";

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

// ---------------------------------------------------------------------------
// Источники pull‑типа (SFTP/FTP/HTTP) — задача worker'а station-pull
// ---------------------------------------------------------------------------

export type StationSourceResult =
  | { ok: true; id: number }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

/**
 * Секрет для хранения: пусто — оставить прежний, "-" — удалить, `env:ИМЯ` — ссылка на переменную
 * окружения worker'а, иначе шифруется ключом STATION_SOURCES_KEY/BETTER_AUTH_SECRET.
 */
function storedSecret(
  input: string,
  previous: string | null,
): { value: string | null } | { error: "noKey" } {
  if (input === "") return { value: previous };
  if (input.trim() === "-") return { value: null };
  if (isEnvSecret(input.trim())) return { value: input.trim() };
  const key = secretKeyFromEnv();
  if (!key) return { error: "noKey" };
  return { value: sealSecret(input, key) };
}

/** Создание/изменение источника станции; пароль и ключ хранятся зашифрованными. */
export async function saveStationSource(
  locale: Locale,
  stationId: number,
  raw: unknown,
): Promise<StationSourceResult> {
  const session = await requireAdminSession(locale, "stations.write");
  const parsed = stationSourceInput.safeParse(raw);
  if (!parsed.success)
    return { ok: false, message: "validation", fieldErrors: fieldErrorsOf(parsed.error) };
  const v = parsed.data;
  const db = getDb();
  const station = await db.query.stations.findFirst({ where: eq(stations.id, stationId) });
  if (!station) return { ok: false, message: "notFound" };
  const previous = v.id
    ? await db.query.stationSources.findFirst({ where: eq(stationSources.id, v.id) })
    : null;
  if (v.id && (!previous || previous.stationId !== stationId))
    return { ok: false, message: "notFound" };

  const secret = storedSecret(v.password, previous?.secret ?? null);
  if ("error" in secret) return { ok: false, message: secret.error };
  const privateKey = storedSecret(v.privateKey, previous?.privateKey ?? null);
  if ("error" in privateKey) return { ok: false, message: privateKey.error };

  const mapping = JSON.parse(v.mappingJson) as FeedMapping;
  const row = {
    stationId,
    kind: v.kind,
    enabled: v.enabled,
    label: v.label || null,
    host: v.kind === "http" ? "" : v.host,
    port: v.port,
    username: v.username || null,
    secret: secret.value,
    privateKey: v.kind === "sftp" ? privateKey.value : null,
    hostFingerprint: v.kind === "sftp" ? v.hostFingerprint || null : null,
    path: v.path,
    filePattern: v.filePattern || "*.csv",
    mapping,
    staleAfterMin: v.staleAfterMin,
    updatedBy: session.user.id,
  };
  const auditView = {
    kind: row.kind,
    enabled: row.enabled,
    label: row.label,
    host: row.host,
    port: row.port,
    username: row.username,
    path: row.path,
    filePattern: row.filePattern,
    staleAfterMin: row.staleAfterMin,
    mapping,
    secret: row.secret ? "***" : null,
    privateKey: row.privateKey ? "***" : null,
  };
  let id: number;
  if (previous) {
    await db
      .update(stationSources)
      .set({
        ...row,
        // Смена адреса/маски обнуляет реестр файлов: новые файлы будут обработаны заново.
        ...(previous.host !== row.host ||
        previous.path !== row.path ||
        previous.filePattern !== row.filePattern
          ? { files: {} }
          : {}),
      })
      .where(eq(stationSources.id, previous.id));
    id = previous.id;
  } else {
    const [created] = await db
      .insert(stationSources)
      .values({ ...row, createdBy: session.user.id })
      .returning({ id: stationSources.id });
    if (!created) return { ok: false, message: "insert" };
    id = created.id;
  }
  await recordAudit(session, {
    action: previous ? "station.source.update" : "station.source.create",
    entity: "station_sources",
    entityId: id,
    before: previous
      ? {
          kind: previous.kind,
          enabled: previous.enabled,
          host: previous.host,
          port: previous.port,
          username: previous.username,
          path: previous.path,
          filePattern: previous.filePattern,
          staleAfterMin: previous.staleAfterMin,
          mapping: previous.mapping,
        }
      : null,
    after: { stationId, stationCode: station.code, ...auditView },
  });
  return { ok: true, id };
}

export async function deleteStationSource(
  locale: Locale,
  stationId: number,
  id: number,
): Promise<StationSourceResult> {
  const session = await requireAdminSession(locale, "stations.write");
  const db = getDb();
  const previous = await db.query.stationSources.findFirst({ where: eq(stationSources.id, id) });
  if (!previous || previous.stationId !== stationId) return { ok: false, message: "notFound" };
  await db.delete(stationSources).where(eq(stationSources.id, id));
  await recordAudit(session, {
    action: "station.source.delete",
    entity: "station_sources",
    entityId: id,
    before: { stationId, kind: previous.kind, host: previous.host, path: previous.path },
  });
  return { ok: true, id };
}

/** Ставит задачу station-pull для одного источника (проверка настроек без ожидания расписания). */
export async function runStationSource(
  locale: Locale,
  stationId: number,
  id: number,
): Promise<StationSourceResult> {
  const session = await requireAdminSession(locale, "stations.write");
  const db = getDb();
  const source = await db.query.stationSources.findFirst({ where: eq(stationSources.id, id) });
  if (!source || source.stationId !== stationId) return { ok: false, message: "notFound" };
  const queued = await enqueueJob(
    "station-pull",
    { sourceId: id, force: true },
    { jobId: `station-pull:manual:${id}:${Date.now()}` },
  );
  if (!queued) return { ok: false, message: "queueUnavailable" };
  await recordAudit(session, {
    action: "station.source.run",
    entity: "station_sources",
    entityId: id,
    after: { stationId, kind: source.kind, host: source.host, path: source.path },
  });
  return { ok: true, id };
}
