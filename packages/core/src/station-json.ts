/**
 * Разбор ответов JSON API сетей датчиков в записи для приёма измерений — третий формат
 * источника станций наряду с файлами CSV/TSV (station-feed.ts). Образец — открытый API сети
 * PM‑датчиков Агентства (wwcs.tj: `/airquality/stations` — последняя запись каждой станции,
 * `/airquality/history?hours=N` — ряд за N часов по всем станциям). Чистая логика без I/O:
 * ответ уже разобран (JSON.parse), маппинг описывает путь к массиву записей, поля времени,
 * кода станции и веществ. Один источник может обслуживать несколько станций: код станции
 * берётся из записи (`stationField`) и при необходимости переводится в код станции портала
 * (`stations`). Дальше записи проходят `normalizeIngestRecords` на сервере.
 */
import {
  type ImportCell,
  parseImportTime,
  parseImportValue,
  timezoneOffsetMinutes,
} from "./import-mapping";
import { type IngestRecordInput, resolvePollutantCode } from "./ingest";
import type { FeedError } from "./station-feed";

export interface JsonFeedPollutantField {
  /** Путь к значению в записи ("PM25", "values.pm25"). */
  field: string;
  /** Единица входных данных; без значения — единица ввода станции (station_pollutants). */
  unit?: string;
  /** Множитель к значению до конверсии единиц. */
  scale?: number;
  /** Путь к флагу качества именно этого вещества. */
  flagField?: string;
}

export interface JsonFeedTime {
  /** Путь к времени записи: ISO (с зоной или без), «YYYY-MM-DD HH:mm», epoch (с/мс). */
  field: string;
  /** Формат как в маппинге файлов (токены YYYY MM DD HH mm ss); без формата — автоопределение. */
  format?: string;
  /** Зона времени без смещения в ответе: "Asia/Dushanbe" (по умолчанию), "UTC", "+05:00". */
  timezone?: string;
  /** Округлить время до ближайших N минут (16:40:03 → 16:40 при 10). */
  roundMin?: number;
}

export interface JsonFeedHistory {
  /** URL ряда за прошедшие часы; `{hours}` заменяется глубиной догрузки. */
  url: string;
  /** Глубина при первом запуске и ручной проверке, ч (по умолчанию 24). */
  hours?: number;
  /** Предел глубины при догрузке пропусков, ч (по умолчанию 72). */
  maxHours?: number;
  /** Путь к массиву записей в ответе истории, если отличается от основного. */
  recordsPath?: string;
}

/** Описание ответа JSON API (station_sources.mapping для типа json). */
export interface JsonFeedMapping {
  format: "json";
  /** Путь к массиву записей ("data.items"); пусто — ответ сам является массивом. */
  recordsPath?: string;
  /** Путь к коду станции в записи; без него все записи относятся к станции источника. */
  stationField?: string;
  /** Коды станций в ответе → коды станций портала; без значения коды совпадают. */
  stations?: Record<string, string>;
  time: JsonFeedTime;
  /** Код вещества (или синоним) → поле значения. */
  pollutants: Record<string, JsonFeedPollutantField>;
  /** Поле статуса записи: значения из invalidStatuses (или не из validStatuses) → флаг invalid. */
  statusField?: string;
  validStatuses?: string[];
  invalidStatuses?: string[];
  /** Строки, означающие отсутствие значения (помимо null). */
  missingValues?: string[];
  /** Период осреднения записей, мин (10 для 10‑минутных датчиков); без значения — станции. */
  averagingMin?: number;
  /** Догрузка истории за прошедшие часы (пропуски, первый запуск). */
  history?: JsonFeedHistory;
}

export interface JsonFeedRecord extends IngestRecordInput {
  time: string;
  /** Код станции портала (после `stations`), null — станция источника. */
  stationCode: string | null;
  /** Порядковый номер записи в массиве (с 1) — для журнала. */
  row: number;
}

export interface JsonFeedParseResult {
  records: JsonFeedRecord[];
  errors: FeedError[];
  /** Записей в массиве; записей без единого значения; повторов ключа (остаётся последняя). */
  total: number;
  empty: number;
  duplicates: number;
  from: string | null;
  to: string | null;
  /** Коды станций (после `stations`), встретившиеся в ответе. */
  stations: string[];
}

export const JSON_FEED_FORMAT = "json";
const MAX_ERRORS = 500;
const MAX_HISTORY_HOURS = 168;
const DEFAULT_MISSING = ["", "-", "—", "n/a", "na", "nan", "null"];

/** Маппинг типа json (в отличие от FeedMapping файлов, у которого есть layout). */
export function isJsonFeedMapping(m: unknown): m is JsonFeedMapping {
  return !!m && typeof m === "object" && (m as { format?: unknown }).format === JSON_FEED_FORMAT;
}

function isPath(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "";
}

/** Проверка структуры маппинга; пустой список — маппинг пригоден. */
export function validateJsonFeedMapping(m: unknown): string[] {
  const errors: string[] = [];
  if (!m || typeof m !== "object" || Array.isArray(m)) return ["mapping должен быть объектом JSON"];
  const map = m as Partial<JsonFeedMapping>;
  if (map.format !== JSON_FEED_FORMAT) errors.push('format: ожидается "json"');
  if (map.recordsPath !== undefined && typeof map.recordsPath !== "string")
    errors.push("recordsPath: строка (путь к массиву записей)");
  if (map.stationField !== undefined && !isPath(map.stationField))
    errors.push("stationField: путь к коду станции в записи");
  if (map.stations !== undefined) {
    if (!map.stations || typeof map.stations !== "object" || Array.isArray(map.stations))
      errors.push("stations: объект «код в источнике → код станции портала»");
    else
      for (const [from, to] of Object.entries(map.stations))
        if (!isPath(to)) errors.push(`stations.${from}: нужен код станции портала`);
  }
  if (!map.time || typeof map.time !== "object") errors.push("time: укажите { field }");
  else {
    if (!isPath(map.time.field)) errors.push("time.field: путь к времени записи");
    if (map.time.timezone !== undefined) {
      try {
        timezoneOffsetMinutes(map.time.timezone);
      } catch (error) {
        errors.push(`time.timezone: ${(error as Error).message}`);
      }
    }
    if (
      map.time.roundMin !== undefined &&
      !(Number.isInteger(map.time.roundMin) && map.time.roundMin > 0 && map.time.roundMin <= 1440)
    )
      errors.push("time.roundMin: целое число минут 1–1440");
  }
  const entries = Object.entries(map.pollutants ?? {});
  if (entries.length === 0) errors.push("pollutants: нужно хотя бы одно поле вещества");
  for (const [name, def] of entries) {
    if (!def || typeof def !== "object" || !isPath(def.field))
      errors.push(`pollutants.${name}: нужен field`);
    else if (def.scale !== undefined && !(typeof def.scale === "number" && def.scale > 0))
      errors.push(`pollutants.${name}.scale: число > 0`);
  }
  if (
    map.averagingMin !== undefined &&
    !(Number.isInteger(map.averagingMin) && map.averagingMin > 0 && map.averagingMin <= 1440)
  )
    errors.push("averagingMin: целое число минут 1–1440");
  if (map.history !== undefined) {
    const h = map.history;
    if (!h || typeof h !== "object" || !isPath(h.url))
      errors.push("history.url: адрес ряда за прошедшие часы");
    else if (!/^(https?|file):\/\//i.test(h.url.trim()))
      errors.push("history.url: ожидается http(s)://");
    for (const key of ["hours", "maxHours"] as const) {
      const v = h && typeof h === "object" ? h[key] : undefined;
      if (v !== undefined && !(Number.isInteger(v) && v > 0 && v <= MAX_HISTORY_HOURS))
        errors.push(`history.${key}: целое число часов 1–${MAX_HISTORY_HOURS}`);
    }
  }
  return errors;
}

/** Значение по пути "a.b.0.c" (точки разделяют ключи и индексы массивов). */
export function getByPath(obj: unknown, path: string | undefined): unknown {
  if (path === undefined || path === "") return obj;
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) {
      const idx = Number(part);
      cur = Number.isInteger(idx) ? cur[idx] : undefined;
    } else if (typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return cur;
}

/** Массив записей из ответа по пути; null — по пути нет массива. */
export function extractRecords(
  payload: unknown,
  recordsPath: string | undefined,
): unknown[] | null {
  const value = getByPath(payload, recordsPath);
  return Array.isArray(value) ? value : null;
}

function cellOf(value: unknown): ImportCell {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean")
    return value;
  return String(value);
}

/** Время записи: epoch (с/мс) числом или строкой цифр, иначе строка по формату/автоопределению. */
export function parseJsonTime(value: unknown, time: JsonFeedTime): Date | null {
  let parsed: Date | null = null;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return null;
    parsed = new Date(Math.round(value > 1e11 ? value : value * 1000));
  } else if (typeof value === "string") {
    const s = value.trim();
    if (!s) return null;
    if (/^\d{9,13}$/.test(s)) return parseJsonTime(Number(s), time);
    parsed = parseImportTime(s, { format: time.format, timezone: time.timezone });
  } else {
    return null;
  }
  if (!parsed || Number.isNaN(parsed.getTime())) return null;
  if (time.roundMin) {
    const step = time.roundMin * 60_000;
    parsed = new Date(Math.round(parsed.getTime() / step) * step);
  }
  return parsed;
}

/** Разбирает ответ JSON API по маппингу; ничего не отправляет и не пишет. */
export function parseStationJsonFeed(
  payload: unknown,
  mapping: JsonFeedMapping,
  opts: { now?: Date; recordsPath?: string } = {},
): JsonFeedParseResult {
  const result: JsonFeedParseResult = {
    records: [],
    errors: [],
    total: 0,
    empty: 0,
    duplicates: 0,
    from: null,
    to: null,
    stations: [],
  };
  const problems = validateJsonFeedMapping(mapping);
  if (problems.length) {
    result.errors.push(...problems.map((message) => ({ row: 0, message: `mapping:${message}` })));
    return result;
  }
  const records = extractRecords(payload, opts.recordsPath ?? mapping.recordsPath);
  if (!records) {
    result.errors.push({
      row: 0,
      message: `records:по пути «${opts.recordsPath ?? mapping.recordsPath ?? ""}» нет массива записей`,
    });
    return result;
  }
  const now = opts.now ?? new Date();
  const missing = new Set(
    (mapping.missingValues ?? DEFAULT_MISSING).map((m) => m.trim().toLowerCase()),
  );
  const valid = mapping.validStatuses?.map((s) => s.trim().toLowerCase());
  const invalid = new Set((mapping.invalidStatuses ?? []).map((s) => s.trim().toLowerCase()));
  const fields = Object.entries(mapping.pollutants).map(([name, def]) => ({
    code: resolvePollutantCode(name),
    def,
  }));
  const pushError = (row: number, message: string) => {
    if (result.errors.length < MAX_ERRORS) result.errors.push({ row, message });
  };
  const byKey = new Map<string, number>();
  const stations = new Set<string>();

  records.forEach((rec, i) => {
    const rowNo = i + 1;
    result.total += 1;
    if (!rec || typeof rec !== "object") {
      pushError(rowNo, "record");
      return;
    }
    let stationCode: string | null = null;
    if (mapping.stationField) {
      const raw = getByPath(rec, mapping.stationField);
      const code = raw === null || raw === undefined ? "" : String(raw).trim();
      if (!code) {
        pushError(rowNo, "station:(пусто)");
        return;
      }
      stationCode = (mapping.stations?.[code] ?? code).trim();
    }
    const rawTime = getByPath(rec, mapping.time.field);
    const when = parseJsonTime(rawTime, mapping.time);
    if (!when) {
      pushError(rowNo, `time:${rawTime === undefined ? "(нет)" : String(rawTime)}`);
      return;
    }
    if (when.getTime() > now.getTime() + 3_600_000) {
      pushError(rowNo, "futureTime");
      return;
    }
    let rowFlag: string | undefined;
    if (mapping.statusField) {
      const status = String(getByPath(rec, mapping.statusField) ?? "").trim();
      const key = status.toLowerCase();
      if (invalid.has(key) || (valid && !valid.includes(key))) rowFlag = `invalid:${status}`;
    }
    const iso = when.toISOString();
    let produced = 0;
    for (const { code, def } of fields) {
      const rawValue = cellOf(getByPath(rec, def.field));
      const parsed = parseImportValue(rawValue, missing);
      if (parsed === null) continue;
      if (typeof parsed === "number") {
        pushError(rowNo, `value:${code}:${String(rawValue)}`);
        continue;
      }
      const scale = def.scale ?? 1;
      const flagRaw = def.flagField ? String(getByPath(rec, def.flagField) ?? "").trim() : "";
      const record: JsonFeedRecord = {
        time: iso,
        pollutant: code,
        value:
          parsed.belowLimit !== undefined ? `<${parsed.belowLimit * scale}` : parsed.value * scale,
        stationCode,
        row: rowNo,
      };
      if (def.unit) record.unit = def.unit;
      if (rowFlag) record.flag = rowFlag;
      else if (flagRaw) record.flag = flagRaw;
      if (mapping.averagingMin) record.averagingMin = mapping.averagingMin;
      const key = `${stationCode ?? ""}|${iso}|${code}|${record.averagingMin ?? 0}`;
      const previous = byKey.get(key);
      if (previous !== undefined) {
        result.duplicates += 1;
        result.records[previous] = record;
      } else {
        byKey.set(key, result.records.length);
        result.records.push(record);
      }
      produced += 1;
      if (!result.from || iso < result.from) result.from = iso;
      if (!result.to || iso > result.to) result.to = iso;
    }
    if (produced === 0) result.empty += 1;
    else if (stationCode) stations.add(stationCode);
  });
  result.stations = [...stations];
  return result;
}

/** Подставляет глубину истории в URL (`{hours}`) или добавляет параметр hours. */
export function historyUrl(template: string, hours: number): string {
  const h = String(Math.max(1, Math.round(hours)));
  if (template.includes("{hours}")) return template.replaceAll("{hours}", h);
  try {
    const url = new URL(template);
    url.searchParams.set("hours", h);
    return url.toString();
  } catch {
    return `${template}${template.includes("?") ? "&" : "?"}hours=${h}`;
  }
}

export interface HistoryPlanInput {
  /** Последняя известная отметка времени по станции (курсор) — null, если данных ещё не было. */
  cursors: Array<{ station: string; last: Date | null; newest: Date | null }>;
  /** Ожидаемый интервал между записями, мин. */
  intervalMin: number;
  /** Ручной запуск или первый проход — полная глубина. */
  full: boolean;
  hours: number;
  maxHours: number;
  now: Date;
}

/**
 * Нужна ли догрузка истории и на сколько часов: при первом запуске/ручной проверке — на `hours`;
 * иначе — если у какой‑то станции между курсором и свежей записью пропущено больше двух
 * интервалов (сбой сети, простой worker'а), на глубину пропуска (не больше maxHours).
 */
export function planHistoryFetch(input: HistoryPlanInput): number | null {
  if (input.full) return Math.min(input.hours, input.maxHours);
  const gapThreshold = Math.max(3 * input.intervalMin, 30) * 60_000;
  let maxGap = 0;
  for (const c of input.cursors) {
    if (!c.newest) continue;
    const since = c.last ?? new Date(input.now.getTime() - input.hours * 3_600_000);
    const gap = c.newest.getTime() - since.getTime();
    if (gap > gapThreshold) maxGap = Math.max(maxGap, gap);
  }
  if (maxGap === 0) return null;
  return Math.min(input.maxHours, Math.ceil(maxGap / 3_600_000) + 1);
}
