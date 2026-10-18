/**
 * CAP‑предупреждения (SmartMet Alert): загрузка в БД, семантика Update/Cancel/expires,
 * выборки для портала, карты, API и админки.
 */
import {
  type CapAlert,
  type CapCertainty,
  type CapMsgType,
  type CapSeverity,
  type CapStatus,
  type CapUrgency,
  capWindow,
  isCapActive,
  isCapUpcoming,
} from "@meteo/core";
import type { I18nText } from "@meteo/i18n";
import { and, asc, count, desc, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import type { Database } from "../client";
import type { CapNamedValue, GeoJsonMultiPolygon } from "../schema";
import * as s from "../schema";

const DAY = 86_400_000;

export interface CapIngestResult {
  id: number;
  inserted: boolean;
  /** Сколько предыдущих сообщений помечено заменёнными/отменёнными. */
  superseded: number;
}

/** Регулярное выражение для поиска identifier внутри строки <references>. */
function identifierPattern(identifier: string): string {
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `(^|[\\s,])${escaped}([\\s,]|$)`;
}

/**
 * Идемпотентная загрузка сообщения: upsert по identifier+sent, info и area — только при
 * первой вставке. Для Update/Cancel помечает сообщения из <references> как заменённые;
 * если ссылающееся сообщение пришло раньше исходного — исходное помечается сразу.
 */
export async function ingestCapAlert(
  db: Database,
  alert: CapAlert,
  meta: { rawXml: string; sourceUrl: string | null },
): Promise<CapIngestResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(s.capAlerts)
      .values({
        identifier: alert.identifier,
        sender: alert.sender,
        sent: alert.sent,
        status: alert.status,
        msgType: alert.msgType,
        scope: alert.scope,
        source: alert.source,
        note: alert.note,
        references: alert.referencesRaw,
        sourceUrl: meta.sourceUrl,
        rawXml: meta.rawXml,
      })
      .onConflictDoNothing({ target: [s.capAlerts.identifier, s.capAlerts.sent] })
      .returning({ id: s.capAlerts.id });
    let id: number;
    let inserted = false;
    if (row) {
      id = row.id;
      inserted = true;
    } else {
      const existing = await tx
        .select({ id: s.capAlerts.id })
        .from(s.capAlerts)
        .where(and(eq(s.capAlerts.identifier, alert.identifier), eq(s.capAlerts.sent, alert.sent)))
        .limit(1);
      const found = existing[0];
      if (!found) throw new Error(`CAP ${alert.identifier}: не удалось найти строку после upsert`);
      id = found.id;
    }

    if (inserted) {
      const regionRows = await tx
        .select({ id: s.warningRegions.id, code: s.warningRegions.code })
        .from(s.warningRegions);
      const regionByCode = new Map(regionRows.map((r) => [r.code.trim().toUpperCase(), r.id]));
      const events = [...new Set(alert.infos.map((i) => i.event.trim()).filter(Boolean))];
      if (events.length) {
        await tx
          .insert(s.capEventTranslations)
          .values(events.map((event) => ({ event, name: {} })))
          .onConflictDoNothing();
      }
      for (const info of alert.infos) {
        const [infoRow] = await tx
          .insert(s.capInfos)
          .values({
            alertId: id,
            language: info.language,
            locale: info.locale,
            categories: info.categories,
            event: info.event,
            responseTypes: info.responseTypes,
            urgency: info.urgency,
            severity: info.severity,
            certainty: info.certainty,
            audience: info.audience,
            eventCodes: info.eventCodes,
            effective: info.effective,
            onset: info.onset,
            expires: info.expires,
            senderName: info.senderName,
            headline: info.headline,
            description: info.description,
            instruction: info.instruction,
            web: info.web,
            contact: info.contact,
            parameters: info.parameters,
          })
          .returning({ id: s.capInfos.id });
        if (!infoRow) continue;
        for (const area of info.areas) {
          const regionIds = [
            ...new Set(
              area.geocodes
                .map((g) => regionByCode.get(g.value.trim().toUpperCase()))
                .filter((v): v is number => v !== undefined),
            ),
          ];
          const base = {
            infoId: infoRow.id,
            areaDesc: area.areaDesc,
            geom: area.geometry as GeoJsonMultiPolygon | null,
            geocodes: area.geocodes,
            altitude: area.altitude,
            ceiling: area.ceiling,
          };
          if (regionIds.length > 0) {
            await tx
              .insert(s.capAreas)
              .values(regionIds.map((warningRegionId) => ({ ...base, warningRegionId })));
          } else {
            const [areaRow] = await tx
              .insert(s.capAreas)
              .values({ ...base, warningRegionId: null })
              .returning({ id: s.capAreas.id });
            if (areaRow && area.geometry) {
              // Геокода нет — регионы по пересечению с геометрией (≥ 5 % меньшей из площадей).
              const matched = await tx.execute<{ id: number }>(sql`
                select wr.id
                from ${s.warningRegions} wr, ${s.capAreas} ca
                where ca.id = ${areaRow.id}
                  and wr.geom is not null
                  and ST_Intersects(wr.geom, ca.geom)
                  and ST_Area(ST_Intersection(wr.geom, ca.geom))
                      > 0.05 * least(ST_Area(wr.geom), ST_Area(ca.geom))
              `);
              const ids = [...matched].map((m) => Number(m.id));
              const first = ids[0];
              if (first !== undefined) {
                await tx
                  .update(s.capAreas)
                  .set({ warningRegionId: first })
                  .where(eq(s.capAreas.id, areaRow.id));
                if (ids.length > 1) {
                  await tx
                    .insert(s.capAreas)
                    .values(ids.slice(1).map((warningRegionId) => ({ ...base, warningRegionId })));
                }
              }
            }
          }
        }
      }
    }

    let superseded = 0;
    if (alert.msgType === "Update" || alert.msgType === "Cancel") {
      for (const ref of alert.references) {
        const res = await tx
          .update(s.capAlerts)
          .set({ supersededBy: id })
          .where(
            and(
              eq(s.capAlerts.identifier, ref.identifier),
              isNull(s.capAlerts.supersededBy),
              ne(s.capAlerts.id, id),
              lte(s.capAlerts.sent, alert.sent),
            ),
          )
          .returning({ id: s.capAlerts.id });
        superseded += res.length;
      }
    }
    if (inserted) {
      // Сообщение могло прийти позже ссылающегося на него Update/Cancel.
      const later = await tx
        .select({ id: s.capAlerts.id })
        .from(s.capAlerts)
        .where(
          and(
            inArray(s.capAlerts.msgType, ["Update", "Cancel"]),
            gte(s.capAlerts.sent, alert.sent),
            ne(s.capAlerts.id, id),
            sql`${s.capAlerts.references} ~ ${identifierPattern(alert.identifier)}`,
          ),
        )
        .orderBy(asc(s.capAlerts.sent))
        .limit(1);
      const by = later[0];
      if (by) {
        await tx.update(s.capAlerts).set({ supersededBy: by.id }).where(eq(s.capAlerts.id, id));
        superseded += 1;
      }
    }
    return { id, inserted, superseded };
  });
}

export interface CapAreaRow {
  id: number;
  areaDesc: string;
  warningRegionId: number | null;
  regionCode: string | null;
  regionName: I18nText | null;
  hasGeometry: boolean;
  /** GeoJSON области (polygon/circle) либо геометрия региона — только при withGeometry. */
  geometry: GeoJsonMultiPolygon | null;
  geocodes: CapNamedValue[];
}

export interface CapInfoRow {
  id: number;
  language: string;
  locale: string | null;
  categories: string[];
  event: string;
  responseTypes: string[];
  urgency: CapUrgency;
  severity: CapSeverity;
  certainty: CapCertainty;
  effective: Date | null;
  onset: Date | null;
  expires: Date | null;
  senderName: string | null;
  headline: string | null;
  description: string | null;
  instruction: string | null;
  web: string | null;
  contact: string | null;
  parameters: CapNamedValue[];
  areas: CapAreaRow[];
  /** Окно действия: начало onset → effective → sent, конец expires. */
  start: Date;
  end: Date | null;
}

export interface CapWarning {
  id: number;
  identifier: string;
  sender: string;
  sent: Date;
  status: CapStatus;
  msgType: CapMsgType;
  scope: CapScopeValue;
  note: string | null;
  sourceUrl: string | null;
  supersededBy: number | null;
  receivedAt: Date;
  infos: CapInfoRow[];
  /** Активно сейчас (любой info) / ещё не началось. */
  active: boolean;
  upcoming: boolean;
  /** Коды регионов предупреждений по всем info. */
  regionCodes: string[];
}

export type CapScopeValue = "Public" | "Restricted" | "Private";

export interface LoadWarningsOptions {
  now?: Date;
  /** Горизонт для предстоящих предупреждений, дней (по умолчанию 7). */
  horizonDays?: number;
  /** Только опубликованные: Actual, Alert/Update, не заменённые (по умолчанию true). */
  publishedOnly?: boolean;
  /** Геометрия областей в GeoJSON (карта, API). */
  withGeometry?: boolean;
  /** Ограничить регионом предупреждений (код). */
  regionCode?: string;
  /** Конкретные сообщения (админка). */
  alertIds?: number[];
}

/** Действующие и предстоящие предупреждения с info и областями (сборка на стороне JS). */
export async function loadWarnings(
  db: Database,
  opts: LoadWarningsOptions = {},
): Promise<CapWarning[]> {
  const now = opts.now ?? new Date();
  const horizon = new Date(now.getTime() + (opts.horizonDays ?? 7) * DAY);
  const publishedOnly = opts.publishedOnly ?? true;
  const conditions = [
    sql`exists (
      select 1 from ${s.capInfos} i
      where i.alert_id = ${s.capAlerts.id}
        and (i.expires is null or i.expires > ${now.toISOString()}::timestamptz)
        and coalesce(i.onset, i.effective, ${s.capAlerts.sent}) < ${horizon.toISOString()}::timestamptz
    )`,
  ];
  if (publishedOnly) {
    conditions.push(
      eq(s.capAlerts.status, "Actual"),
      inArray(s.capAlerts.msgType, ["Alert", "Update"]),
      isNull(s.capAlerts.supersededBy),
    );
  }
  if (opts.alertIds) {
    if (opts.alertIds.length === 0) return [];
    conditions.push(inArray(s.capAlerts.id, opts.alertIds));
  }
  const alerts = await db
    .select()
    .from(s.capAlerts)
    .where(and(...conditions))
    .orderBy(desc(s.capAlerts.sent));
  if (alerts.length === 0) return [];
  const alertIds = alerts.map((a) => a.id);
  const infos = await db
    .select()
    .from(s.capInfos)
    .where(inArray(s.capInfos.alertId, alertIds))
    .orderBy(asc(s.capInfos.id));
  const infoIds = infos.map((i) => i.id);
  const areas = infoIds.length
    ? await db
        .select({
          id: s.capAreas.id,
          infoId: s.capAreas.infoId,
          areaDesc: s.capAreas.areaDesc,
          warningRegionId: s.capAreas.warningRegionId,
          geocodes: s.capAreas.geocodes,
          regionCode: s.warningRegions.code,
          regionName: s.warningRegions.name,
          hasGeometry: sql<boolean>`${s.capAreas.geom} is not null`,
          geometry: opts.withGeometry
            ? sql<GeoJsonMultiPolygon | null>`ST_AsGeoJSON(coalesce(${s.capAreas.geom}, ${s.warningRegions.geom}), 5)::json`
            : sql<null>`null`,
        })
        .from(s.capAreas)
        .leftJoin(s.warningRegions, eq(s.warningRegions.id, s.capAreas.warningRegionId))
        .where(inArray(s.capAreas.infoId, infoIds))
        .orderBy(asc(s.capAreas.id))
    : [];
  const areasByInfo = new Map<number, CapAreaRow[]>();
  for (const a of areas) {
    const list = areasByInfo.get(a.infoId) ?? [];
    list.push({
      id: a.id,
      areaDesc: a.areaDesc,
      warningRegionId: a.warningRegionId,
      regionCode: a.regionCode ?? null,
      regionName: a.regionName ?? null,
      hasGeometry: Boolean(a.hasGeometry),
      geometry: a.geometry ?? null,
      geocodes: a.geocodes,
    });
    areasByInfo.set(a.infoId, list);
  }
  const sentById = new Map(alerts.map((a) => [a.id, a.sent]));
  const infosByAlert = new Map<number, CapInfoRow[]>();
  for (const i of infos) {
    const sent = sentById.get(i.alertId) ?? i.effective ?? now;
    const w = capWindow(i, sent);
    const list = infosByAlert.get(i.alertId) ?? [];
    list.push({
      id: i.id,
      language: i.language,
      locale: i.locale,
      categories: i.categories,
      event: i.event,
      responseTypes: i.responseTypes,
      urgency: i.urgency,
      severity: i.severity,
      certainty: i.certainty,
      effective: i.effective,
      onset: i.onset,
      expires: i.expires,
      senderName: i.senderName,
      headline: i.headline,
      description: i.description,
      instruction: i.instruction,
      web: i.web,
      contact: i.contact,
      parameters: i.parameters,
      areas: areasByInfo.get(i.id) ?? [],
      start: w.start,
      end: w.end,
    });
    infosByAlert.set(i.alertId, list);
  }
  const result: CapWarning[] = [];
  for (const a of alerts) {
    const list = (infosByAlert.get(a.id) ?? []).filter((i) => i.end === null || i.end > now);
    const regionCodes = [
      ...new Set(
        list.flatMap((i) => i.areas.map((ar) => ar.regionCode)).filter((c): c is string => !!c),
      ),
    ];
    if (opts.regionCode && !regionCodes.includes(opts.regionCode)) continue;
    result.push({
      id: a.id,
      identifier: a.identifier,
      sender: a.sender,
      sent: a.sent,
      status: a.status,
      msgType: a.msgType,
      scope: a.scope,
      note: a.note,
      sourceUrl: a.sourceUrl,
      supersededBy: a.supersededBy,
      receivedAt: a.receivedAt,
      infos: list,
      active: list.some((i) => isCapActive({ start: i.start, end: i.end }, now)),
      upcoming:
        !list.some((i) => isCapActive({ start: i.start, end: i.end }, now)) &&
        list.some((i) => isCapUpcoming({ start: i.start, end: i.end }, now)),
      regionCodes,
    });
  }
  return result;
}

/** Идентификаторы предупреждений, затрагивающих точку (геометрия области/региона) или регион по коду. */
export async function warningIdsForPoint(
  db: Database,
  point: { lon: number; lat: number; regionCode?: string | null },
  warnings: CapWarning[],
): Promise<Set<number>> {
  const infoIds = warnings.flatMap((w) => w.infos.map((i) => i.id));
  if (infoIds.length === 0) return new Set();
  const rows = await db.execute<{ info_id: number }>(sql`
    select distinct ca.info_id
    from ${s.capAreas} ca
    left join ${s.warningRegions} wr on wr.id = ca.warning_region_id
    where ca.info_id in ${infoIds}
      and (
        ST_Intersects(coalesce(ca.geom, wr.geom), ST_SetSRID(ST_Point(${point.lon}, ${point.lat}), 4326))
        or (${point.regionCode ?? null}::text is not null and wr.code = ${point.regionCode ?? null})
      )
  `);
  const matched = new Set([...rows].map((r) => Number(r.info_id)));
  return new Set(warnings.filter((w) => w.infos.some((i) => matched.has(i.id))).map((w) => w.id));
}

export interface WarningRegionRow {
  id: number;
  code: string;
  name: I18nText;
  hasGeometry: boolean;
}

/** Регионы предупреждений в порядке областей (по коду из regions.sort_order). */
export async function listWarningRegions(db: Database): Promise<WarningRegionRow[]> {
  return db
    .select({
      id: s.warningRegions.id,
      code: s.warningRegions.code,
      name: s.warningRegions.name,
      hasGeometry: sql<boolean>`${s.warningRegions.geom} is not null`,
    })
    .from(s.warningRegions)
    .leftJoin(s.regions, eq(s.regions.code, s.warningRegions.code))
    .orderBy(sql`coalesce(${s.regions.sortOrder}, 99)`, asc(s.warningRegions.code));
}

/** Словарь переводов типов событий: event (как в CAP) → название на tg/ru/en. */
export async function loadCapEventDictionary(db: Database): Promise<Map<string, I18nText>> {
  const rows = await db
    .select({ event: s.capEventTranslations.event, name: s.capEventTranslations.name })
    .from(s.capEventTranslations);
  return new Map(rows.map((r) => [r.event.trim().toLowerCase(), r.name]));
}

export interface CapAdminListOptions {
  page?: number;
  pageSize?: number;
  status?: CapStatus;
  msgType?: CapMsgType;
}

export interface CapAdminRow {
  id: number;
  identifier: string;
  sender: string;
  sent: Date;
  status: CapStatus;
  msgType: CapMsgType;
  supersededBy: number | null;
  sourceUrl: string | null;
  receivedAt: Date;
  /** Сводка по первому info (по возможности на языке портала). */
  event: string | null;
  headline: string | null;
  severity: CapSeverity | null;
  expires: Date | null;
  languages: string[];
  regionCodes: string[];
}

/** Список всех сообщений для админки (включая Test/Exercise и заменённые). */
export async function listCapAlertsAdmin(
  db: Database,
  opts: CapAdminListOptions = {},
): Promise<{ rows: CapAdminRow[]; total: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 50));
  const conditions = [];
  if (opts.status) conditions.push(eq(s.capAlerts.status, opts.status));
  if (opts.msgType) conditions.push(eq(s.capAlerts.msgType, opts.msgType));
  const where = conditions.length ? and(...conditions) : undefined;
  const [alerts, totalRow] = await Promise.all([
    db
      .select({
        id: s.capAlerts.id,
        identifier: s.capAlerts.identifier,
        sender: s.capAlerts.sender,
        sent: s.capAlerts.sent,
        status: s.capAlerts.status,
        msgType: s.capAlerts.msgType,
        supersededBy: s.capAlerts.supersededBy,
        sourceUrl: s.capAlerts.sourceUrl,
        receivedAt: s.capAlerts.receivedAt,
      })
      .from(s.capAlerts)
      .where(where)
      .orderBy(desc(s.capAlerts.sent), desc(s.capAlerts.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ n: count() }).from(s.capAlerts).where(where),
  ]);
  const ids = alerts.map((a) => a.id);
  const infos = ids.length
    ? await db
        .select({
          id: s.capInfos.id,
          alertId: s.capInfos.alertId,
          locale: s.capInfos.locale,
          language: s.capInfos.language,
          event: s.capInfos.event,
          headline: s.capInfos.headline,
          severity: s.capInfos.severity,
          expires: s.capInfos.expires,
        })
        .from(s.capInfos)
        .where(inArray(s.capInfos.alertId, ids))
        .orderBy(asc(s.capInfos.id))
    : [];
  const infoIds = infos.map((i) => i.id);
  const areaRegions = infoIds.length
    ? await db
        .select({ infoId: s.capAreas.infoId, code: s.warningRegions.code })
        .from(s.capAreas)
        .innerJoin(s.warningRegions, eq(s.warningRegions.id, s.capAreas.warningRegionId))
        .where(inArray(s.capAreas.infoId, infoIds))
    : [];
  const codesByInfo = new Map<number, string[]>();
  for (const r of areaRegions) {
    const list = codesByInfo.get(r.infoId) ?? [];
    if (!list.includes(r.code)) list.push(r.code);
    codesByInfo.set(r.infoId, list);
  }
  const rows: CapAdminRow[] = alerts.map((a) => {
    const own = infos.filter((i) => i.alertId === a.id);
    const primary = own.find((i) => i.locale === "ru") ?? own.find((i) => i.locale) ?? own[0];
    return {
      ...a,
      event: primary?.event ?? null,
      headline: primary?.headline ?? null,
      severity: primary?.severity ?? null,
      expires: primary?.expires ?? null,
      languages: own.map((i) => i.language),
      regionCodes: [...new Set(own.flatMap((i) => codesByInfo.get(i.id) ?? []))],
    };
  });
  return { rows, total: totalRow[0]?.n ?? 0 };
}

export interface CapSyncState {
  at?: string;
  status?: "ok" | "partial" | "failed" | "disabled" | "not-modified";
  url?: string;
  etag?: string | null;
  lastModified?: string | null;
  fetched?: number;
  inserted?: number;
  superseded?: number;
  errors?: Array<{ source: string; error: string }>;
  message?: string;
}

export const CAP_SYNC_KEY = "cap.sync";

export async function getCapSyncState(db: Database): Promise<CapSyncState | null> {
  const rows = await db
    .select({ value: s.settings.value })
    .from(s.settings)
    .where(eq(s.settings.key, CAP_SYNC_KEY))
    .limit(1);
  return (rows[0]?.value as CapSyncState | undefined) ?? null;
}

export async function setCapSyncState(db: Database, value: CapSyncState): Promise<void> {
  await db
    .insert(s.settings)
    .values({ key: CAP_SYNC_KEY, value })
    .onConflictDoUpdate({ target: s.settings.key, set: { value, updatedAt: sql`now()` } });
}
