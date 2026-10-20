/**
 * Ежедневный экологический бюллетень Агентства: настройки, расчёт по валидным измерениям за местные
 * сутки, черновики и публикации (таблица eco_bulletins). Расчёты — чистые функции @meteo/core
 * (`bulletin.ts`); здесь только выборки и группировка станций по городам.
 */
import {
  type BulletinPollutantDef,
  type BulletinStats,
  buildBulletinStats,
  type DayValuesByPollutant,
  type EcoBulletinCity,
  type EcoBulletinData,
  isIsoDate,
  localDateOf,
  localDayRangeUtc,
  mergeDayValues,
  type SummationLimitKind,
  shiftIsoDate,
} from "@meteo/core";
import type { I18nText } from "@meteo/i18n";
import { and, asc, count, desc, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import type { Database } from "../client";
import * as s from "../schema";
import { getSetting, setSetting } from "./integrations";

// ---------------------------------------------------------------------------
// Настройки (settings.ecoBulletin)
// ---------------------------------------------------------------------------

export const ECO_BULLETIN_SETTINGS_KEY = "ecoBulletin";

export interface EcoBulletinSettings {
  /** Готовить черновик ежедневно в 08:00 (Душанбе) за прошедшие сутки. */
  scheduleEnabled: boolean;
  /** Уведомлять операторов и администраторов письмом о готовом черновике. */
  notifyOperators: boolean;
  /** Станции для автоматического черновика; пусто — все публичные с непрерывными измерениями. */
  stationIds: number[];
  /** Подпись отдела (пусто — из шаблона фраз). */
  department: { tg: string; ru: string };
  /** Фраза о причинах превышений (пусто — из шаблона фраз). */
  causes: { tg: string; ru: string };
  /** Суммация NO2+SO2: к ПДКм.р. (методика Агентства) или к ПДКс.с. */
  summation: SummationLimitKind;
}

export const DEFAULT_ECO_BULLETIN_SETTINGS: EcoBulletinSettings = {
  scheduleEnabled: true,
  notifyOperators: true,
  stationIds: [],
  department: { tg: "", ru: "" },
  causes: { tg: "", ru: "" },
  summation: "max_single",
};

function text2(raw: unknown): { tg: string; ru: string } {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    tg: typeof r.tg === "string" ? r.tg : "",
    ru: typeof r.ru === "string" ? r.ru : "",
  };
}

export function normalizeEcoBulletinSettings(raw: unknown): EcoBulletinSettings {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    scheduleEnabled:
      typeof r.scheduleEnabled === "boolean"
        ? r.scheduleEnabled
        : DEFAULT_ECO_BULLETIN_SETTINGS.scheduleEnabled,
    notifyOperators:
      typeof r.notifyOperators === "boolean"
        ? r.notifyOperators
        : DEFAULT_ECO_BULLETIN_SETTINGS.notifyOperators,
    stationIds: Array.isArray(r.stationIds)
      ? r.stationIds.filter((v): v is number => Number.isInteger(v) && (v as number) > 0)
      : [],
    department: text2(r.department),
    causes: text2(r.causes),
    summation: r.summation === "daily" ? "daily" : "max_single",
  };
}

export async function getEcoBulletinSettings(db: Database): Promise<EcoBulletinSettings> {
  return normalizeEcoBulletinSettings(await getSetting(db, ECO_BULLETIN_SETTINGS_KEY));
}

export async function saveEcoBulletinSettings(
  db: Database,
  value: EcoBulletinSettings,
  updatedBy: string | null = null,
): Promise<void> {
  await setSetting(db, ECO_BULLETIN_SETTINGS_KEY, normalizeEcoBulletinSettings(value), updatedBy);
}

// ---------------------------------------------------------------------------
// Справочники: вещества с ПДК, станции и города
// ---------------------------------------------------------------------------

/** Вещества с ПДКс.с. и ПДКм.р. в единицах хранения, в порядке справочника. */
export async function loadBulletinPollutants(db: Database): Promise<BulletinPollutantDef[]> {
  const [rows, limits] = await Promise.all([
    db
      .select({
        id: s.pollutants.id,
        code: s.pollutants.code,
        shortName: s.pollutants.shortName,
        unit: s.pollutants.unit,
        decimals: s.pollutants.decimals,
        sortOrder: s.pollutants.sortOrder,
        name: s.pollutants.name,
      })
      .from(s.pollutants)
      .orderBy(asc(s.pollutants.sortOrder), asc(s.pollutants.id)),
    db
      .select({
        pollutantId: s.limitValues.pollutantId,
        kind: s.limitValues.kind,
        value: s.limitValues.value,
      })
      .from(s.limitValues),
  ]);
  const limitOf = (pollutantId: number, kind: "daily" | "max_single"): number | null => {
    const row = limits.find((l) => l.pollutantId === pollutantId && l.kind === kind);
    return row && row.value > 0 ? row.value : null;
  };
  return rows.map((p) => ({
    id: p.id,
    code: p.code,
    shortName: p.shortName,
    unit: p.unit,
    decimals: p.decimals,
    sortOrder: p.sortOrder,
    name: p.name,
    dailyLimit: limitOf(p.id, "daily"),
    maxSingleLimit: limitOf(p.id, "max_single"),
  }));
}

export interface BulletinCity {
  key: string;
  /** Название для таблиц и заголовков («Душанбе», «Хуҷанд»). */
  name: I18nText;
  /** Подпись для текста сводки: «г. Душанбе» / «ш. Душанбе»; область и район — как есть. */
  label: I18nText;
  /** Порядок в сводке: по области, затем по названию. */
  order: number;
}

export interface BulletinStation {
  id: number;
  code: string;
  slug: string;
  name: I18nText;
  status: "active" | "suspended" | "decommissioned";
  isPublic: boolean;
  /** Непрерывные измерения (автоматическая станция). */
  automatic: boolean;
  city: BulletinCity;
}

/** «Шаҳри Хуҷанд» → «Хуҷанд», «Город Худжанд» → «Худжанд», «Khujand city» → «Khujand». */
export function bareCityName(name: I18nText | null | undefined): I18nText {
  const out: I18nText = {};
  const tg = name?.tg?.replace(/^Шаҳри\s+/u, "").trim();
  const ru = name?.ru?.replace(/^(Город|г\.)\s+/u, "").trim();
  const en = name?.en?.replace(/\s+city$/iu, "").trim();
  if (tg) out.tg = tg;
  if (ru) out.ru = ru;
  if (en) out.en = en;
  return out;
}

interface StationCityRow {
  stationId: number;
  stationName: I18nText;
  regionId: number | null;
  regionCode: string | null;
  regionName: I18nText | null;
  regionOrder: number | null;
  districtId: number | null;
  districtName: I18nText | null;
}

/** Подпись города для текста: «г. Худжанд» / «ш. Хуҷанд» / «Khujand». */
function cityLabel(bare: I18nText): I18nText {
  const out: I18nText = {};
  if (bare.tg) out.tg = `ш. ${bare.tg}`;
  if (bare.ru) out.ru = `г. ${bare.ru}`;
  if (bare.en) out.en = bare.en;
  return out;
}

/**
 * Город станции: Душанбе (область DU) — сама область; иначе район (для городов республиканского
 * подчинения он и есть город: «Шаҳри Хуҷанд» → «Хуҷанд»); без района — область; без области — станция.
 */
export function cityOfStation(row: StationCityRow): BulletinCity {
  const regionOrder = (row.regionOrder ?? 99) * 1000;
  if (row.regionCode === "DU" && row.regionName) {
    const name = bareCityName(row.regionName);
    return { key: "region:DU", name, label: cityLabel(name), order: regionOrder };
  }
  if (row.districtId && row.districtName) {
    const isCity = /^(Шаҳри|Город)\s/u.test(row.districtName.tg ?? row.districtName.ru ?? "");
    const name = bareCityName(row.districtName);
    return {
      key: `district:${row.districtId}`,
      name,
      label: isCity ? cityLabel(name) : row.districtName,
      order: regionOrder + 1,
    };
  }
  if (row.regionId && row.regionName) {
    return {
      key: `region:${row.regionId}`,
      name: bareCityName(row.regionName),
      label: row.regionName,
      order: regionOrder + 2,
    };
  }
  return {
    key: `station:${row.stationId}`,
    name: row.stationName,
    label: row.stationName,
    order: 999_000,
  };
}

/** Станции качества воздуха (не выведенные из эксплуатации) с их городами. */
export async function listBulletinStations(db: Database): Promise<BulletinStation[]> {
  const rows = await db
    .select({
      id: s.stations.id,
      code: s.stations.code,
      slug: s.stations.slug,
      name: s.stations.name,
      status: s.stations.status,
      isPublic: s.stations.isPublic,
      sampling: s.stations.sampling,
      regionId: s.regions.id,
      regionCode: s.regions.code,
      regionName: s.regions.name,
      regionOrder: s.regions.sortOrder,
      districtId: s.districts.id,
      districtName: s.districts.name,
    })
    .from(s.stations)
    .leftJoin(s.regions, eq(s.regions.id, s.stations.regionId))
    .leftJoin(s.districts, eq(s.districts.id, s.stations.districtId))
    .where(and(ne(s.stations.status, "decommissioned"), ne(s.stations.kind, "meteo")))
    .orderBy(asc(s.regions.sortOrder), asc(s.stations.code));
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    slug: r.slug,
    name: r.name,
    status: r.status,
    isPublic: r.isPublic,
    automatic: r.sampling === "continuous",
    city: cityOfStation({ ...r, stationId: r.id, stationName: r.name }),
  }));
}

/** Станции для автоматического черновика: из настроек или все публичные автоматические. */
export async function listScheduledBulletinStations(
  db: Database,
  settings: EcoBulletinSettings,
): Promise<BulletinStation[]> {
  const stations = await listBulletinStations(db);
  if (settings.stationIds.length > 0)
    return stations.filter((st) => settings.stationIds.includes(st.id));
  return stations.filter((st) => st.isPublic && st.automatic && st.status === "active");
}

// ---------------------------------------------------------------------------
// Значения за местные сутки
// ---------------------------------------------------------------------------

export type DayValuesByStation = Map<number, DayValuesByPollutant>;

/**
 * Валидные (qc 1, 4) значения станций за несколько местных суток: ключ — дата, затем станция, затем
 * вещество. Записи с осреднением < 24 ч считаются разовыми/часовыми, 1440 — суточными.
 */
export async function loadDayValues(
  db: Database,
  stationIds: number[],
  dates: string[],
): Promise<Map<string, DayValuesByStation>> {
  const out = new Map<string, DayValuesByStation>();
  for (const d of dates) out.set(d, new Map());
  if (stationIds.length === 0 || dates.length === 0) return out;
  const sorted = [...dates].sort();
  const start = localDayRangeUtc(sorted[0] as string).start;
  const end = localDayRangeUtc(sorted[sorted.length - 1] as string).end;
  const rows = await db
    .select({
      time: s.measurements.time,
      stationId: s.measurements.stationId,
      pollutantId: s.measurements.pollutantId,
      averagingMin: s.measurements.averagingMin,
      value: s.measurements.value,
    })
    .from(s.measurements)
    .where(
      and(
        inArray(s.measurements.stationId, stationIds),
        gte(s.measurements.time, start),
        lt(s.measurements.time, end),
        sql`${s.measurements.qcFlag} in (1, 4)`,
        sql`${s.measurements.value} is not null`,
      ),
    );
  for (const r of rows) {
    if (r.value === null) continue;
    const day = out.get(localDateOf(r.time));
    if (!day) continue;
    const byPollutant =
      day.get(r.stationId) ?? new Map<number, { single: number[]; daily: number[] }>();
    const v = byPollutant.get(r.pollutantId) ?? { single: [], daily: [] };
    if (r.averagingMin >= 1440) v.daily.push(r.value);
    else v.single.push(r.value);
    byPollutant.set(r.pollutantId, v);
    day.set(r.stationId, byPollutant);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Расчёт
// ---------------------------------------------------------------------------

export interface ComputeEcoBulletinOptions {
  date: string;
  stationId: number;
  settings?: EcoBulletinSettings;
}

export class EcoBulletinError extends Error {
  readonly code: "date" | "station";
  constructor(code: "date" | "station", message: string) {
    super(message);
    this.name = "EcoBulletinError";
    this.code = code;
  }
}

/** Снимок расчёта бюллетеня за местные сутки по станции города и всем станциям республики. */
export async function computeEcoBulletin(
  db: Database,
  opts: ComputeEcoBulletinOptions,
): Promise<EcoBulletinData> {
  if (!isIsoDate(opts.date)) throw new EcoBulletinError("date", `Некорректная дата ${opts.date}`);
  const settings = opts.settings ?? (await getEcoBulletinSettings(db));
  const [pollutants, stations] = await Promise.all([
    loadBulletinPollutants(db),
    listBulletinStations(db),
  ]);
  const station = stations.find((st) => st.id === opts.stationId);
  if (!station) throw new EcoBulletinError("station", `Станция ${opts.stationId} не найдена`);
  const measured = await db
    .select({ pollutantId: s.stationPollutants.pollutantId })
    .from(s.stationPollutants)
    .where(
      and(eq(s.stationPollutants.stationId, station.id), eq(s.stationPollutants.active, true)),
    );
  const measuredIds = new Set(measured.map((m) => m.pollutantId));
  const yesterday = shiftIsoDate(opts.date, -1);
  const values = await loadDayValues(
    db,
    stations.map((st) => st.id),
    [yesterday, opts.date],
  );
  const today = values.get(opts.date) ?? new Map();
  const prev = values.get(yesterday) ?? new Map();
  const summation = { limitKind: settings.summation };

  const stationToday = today.get(station.id) ?? new Map();
  const stationPrev = prev.get(station.id) ?? new Map();
  // Таблица станции: измеряемые ею вещества; если список не задан — вещества с данными за два дня.
  const stationDefs =
    measuredIds.size > 0
      ? pollutants.filter((p) => measuredIds.has(p.id))
      : pollutants.filter((p) => stationToday.has(p.id) || stationPrev.has(p.id));
  const cityStats: BulletinStats = buildBulletinStats(stationDefs, stationToday, stationPrev, {
    summation,
  });

  // Сводка по городам: публичные станции, объединённые по городам.
  const groups = new Map<string, { city: BulletinCity; stationIds: number[] }>();
  for (const st of stations) {
    if (!st.isPublic && st.id !== station.id) continue;
    const g = groups.get(st.city.key) ?? { city: st.city, stationIds: [] };
    g.stationIds.push(st.id);
    groups.set(st.city.key, g);
  }
  const cities: EcoBulletinCity[] = [];
  for (const g of groups.values()) {
    // Город выбранной станции — по её данным (как в сводке Агентства абзац о Душанбе повторяет
    // бюллетень автоматической станции); остальные города — объединение их станций.
    const own = g.city.key === station.city.key;
    const mergedToday = own
      ? stationToday
      : mergeDayValues(g.stationIds.map((id) => today.get(id) ?? new Map()));
    const mergedPrev = own
      ? stationPrev
      : mergeDayValues(g.stationIds.map((id) => prev.get(id) ?? new Map()));
    if (mergedToday.size === 0 && mergedPrev.size === 0) continue;
    cities.push({
      key: g.city.key,
      name: g.city.name,
      label: g.city.label,
      stationIds: own ? [station.id] : g.stationIds,
      stats: buildBulletinStats(own ? stationDefs : pollutants, mergedToday, mergedPrev, {
        summation,
        onlyWithData: true,
      }),
    });
  }
  const orderOf = (key: string) => groups.get(key)?.city.order ?? 999_999;
  cities.sort((a, b) => {
    if (a.key === station.city.key) return -1;
    if (b.key === station.city.key) return 1;
    return orderOf(a.key) - orderOf(b.key) || (a.name.ru ?? "").localeCompare(b.name.ru ?? "");
  });

  return {
    version: 1,
    date: opts.date,
    station: {
      id: station.id,
      code: station.code,
      name: station.name,
      automatic: station.automatic,
    },
    city: { key: station.city.key, name: station.city.name, label: station.city.label },
    summation: settings.summation,
    cityStats,
    cities,
    computedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Черновики и публикации
// ---------------------------------------------------------------------------

export interface UpsertEcoBulletinInput {
  date: string;
  stationId: number;
  data: EcoBulletinData;
  userId?: string | null;
  generatedBy: "manual" | "scheduler";
}

export interface UpsertEcoBulletinResult {
  id: number;
  created: boolean;
  status: "draft" | "published";
}

/** Создаёт черновик или обновляет данные существующего; опубликованный не трогает. */
export async function upsertEcoBulletinDraft(
  db: Database,
  input: UpsertEcoBulletinInput,
): Promise<UpsertEcoBulletinResult> {
  const existing = await db
    .select({ id: s.ecoBulletins.id, status: s.ecoBulletins.status })
    .from(s.ecoBulletins)
    .where(and(eq(s.ecoBulletins.date, input.date), eq(s.ecoBulletins.stationId, input.stationId)))
    .limit(1)
    .then((r) => r[0] ?? null);
  if (existing) {
    if (existing.status === "published")
      return { id: existing.id, created: false, status: "published" };
    await db
      .update(s.ecoBulletins)
      .set({ data: input.data, updatedBy: input.userId ?? null })
      .where(eq(s.ecoBulletins.id, existing.id));
    return { id: existing.id, created: false, status: "draft" };
  }
  const [row] = await db
    .insert(s.ecoBulletins)
    .values({
      date: input.date,
      stationId: input.stationId,
      data: input.data,
      generatedBy: input.generatedBy,
      createdBy: input.userId ?? null,
      updatedBy: input.userId ?? null,
    })
    .returning({ id: s.ecoBulletins.id });
  if (!row) throw new Error("eco_bulletins: вставка не вернула id");
  return { id: row.id, created: true, status: "draft" };
}

export type EcoBulletinRow = typeof s.ecoBulletins.$inferSelect & {
  stationCode: string;
  stationSlug: string;
  stationName: I18nText;
  authorName: string | null;
};

const rowSelection = {
  stationCode: s.stations.code,
  stationSlug: s.stations.slug,
  stationName: s.stations.name,
  authorName: s.users.name,
};

export async function getEcoBulletin(db: Database, id: number): Promise<EcoBulletinRow | null> {
  const rows = await db
    .select({ row: s.ecoBulletins, ...rowSelection })
    .from(s.ecoBulletins)
    .innerJoin(s.stations, eq(s.stations.id, s.ecoBulletins.stationId))
    .leftJoin(s.users, eq(s.users.id, s.ecoBulletins.createdBy))
    .where(eq(s.ecoBulletins.id, id))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    ...r.row,
    stationCode: r.stationCode,
    stationSlug: r.stationSlug,
    stationName: r.stationName,
    authorName: r.authorName,
  };
}

export interface ListEcoBulletinsOptions {
  limit?: number;
  stationId?: number;
  status?: "draft" | "published";
}

/** Журнал бюллетеней (админка): новые первыми. */
export async function listEcoBulletins(
  db: Database,
  opts: ListEcoBulletinsOptions = {},
): Promise<EcoBulletinRow[]> {
  const conditions = [];
  if (opts.stationId) conditions.push(eq(s.ecoBulletins.stationId, opts.stationId));
  if (opts.status) conditions.push(eq(s.ecoBulletins.status, opts.status));
  const rows = await db
    .select({ row: s.ecoBulletins, ...rowSelection })
    .from(s.ecoBulletins)
    .innerJoin(s.stations, eq(s.stations.id, s.ecoBulletins.stationId))
    .leftJoin(s.users, eq(s.users.id, s.ecoBulletins.createdBy))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(s.ecoBulletins.date), desc(s.ecoBulletins.id))
    .limit(Math.min(500, Math.max(1, opts.limit ?? 200)));
  return rows.map((r) => ({
    ...r.row,
    stationCode: r.stationCode,
    stationSlug: r.stationSlug,
    stationName: r.stationName,
    authorName: r.authorName,
  }));
}

export interface PublishedEcoBulletinsOptions {
  page?: number;
  pageSize?: number;
  stationId?: number;
}

/** Опубликованные бюллетени для архива портала: по дате, новые первыми. */
export async function listPublishedEcoBulletins(
  db: Database,
  opts: PublishedEcoBulletinsOptions = {},
): Promise<{ rows: EcoBulletinRow[]; total: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 30));
  const conditions = [eq(s.ecoBulletins.status, "published"), eq(s.stations.isPublic, true)];
  if (opts.stationId) conditions.push(eq(s.ecoBulletins.stationId, opts.stationId));
  const where = and(...conditions);
  const [rows, totalRow] = await Promise.all([
    db
      .select({ row: s.ecoBulletins, ...rowSelection })
      .from(s.ecoBulletins)
      .innerJoin(s.stations, eq(s.stations.id, s.ecoBulletins.stationId))
      .leftJoin(s.users, eq(s.users.id, s.ecoBulletins.createdBy))
      .where(where)
      .orderBy(desc(s.ecoBulletins.date), desc(s.ecoBulletins.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ n: count() })
      .from(s.ecoBulletins)
      .innerJoin(s.stations, eq(s.stations.id, s.ecoBulletins.stationId))
      .where(where),
  ]);
  return {
    rows: rows.map((r) => ({
      ...r.row,
      stationCode: r.stationCode,
      stationSlug: r.stationSlug,
      stationName: r.stationName,
      authorName: r.authorName,
    })),
    total: totalRow[0]?.n ?? 0,
  };
}

/** Опубликованный бюллетень по id (публичная страница и загрузка файлов). */
export async function getPublishedEcoBulletin(
  db: Database,
  id: number,
): Promise<EcoBulletinRow | null> {
  const row = await getEcoBulletin(db, id);
  return row && row.status === "published" ? row : null;
}

/** Последний опубликованный бюллетень (главная страница, страница станции). */
export async function latestPublishedEcoBulletin(
  db: Database,
  stationId?: number,
): Promise<EcoBulletinRow | null> {
  const { rows } = await listPublishedEcoBulletins(db, { pageSize: 1, stationId });
  return rows[0] ?? null;
}

/** Получатели письма о готовом черновике: администраторы и операторы (не заблокированные). */
export async function listEcoBulletinNoticeRecipients(
  db: Database,
): Promise<Array<{ email: string; name: string; locale: string }>> {
  return db
    .select({ email: s.users.email, name: s.users.name, locale: s.users.locale })
    .from(s.users)
    .where(
      and(
        inArray(s.users.role, ["admin", "operator"]),
        sql`coalesce(${s.users.banned}, false) = false`,
      ),
    );
}
