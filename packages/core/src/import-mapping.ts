/**
 * Импорт исторических измерений по гибкому маппингу колонок (docs/import-history.md).
 * Чистая логика без I/O: таблица (заголовок + строки из CSV/XLSX) + описание маппинга + справочники
 * → строки для вставки в measurements и отчёт об ошибках. Поддерживаются «широкий» формат
 * (столбец на вещество) и «длинный» (вещество / значение / единица в строке), разные форматы даты,
 * единицы с конверсией (ppb/ppm/mg/m³), значения ниже предела обнаружения («<5»).
 */
import { applyRangeRule, QC_FLAG } from "./qc";
import { DUSHANBE_OFFSET_MINUTES } from "./time";
import { type ConcentrationUnit, convertConcentration, normalizeUnit, roundTo } from "./units";

/** Ссылка на колонку: имя заголовка (без учёта регистра и лишних пробелов) или индекс с 0. */
export type ColumnRef = string | number;

export interface TimeSingleColumn {
  column: ColumnRef;
  /** Токены: YYYY YY MM M DD D HH H mm m ss s; без формата — ISO / DD.MM.YYYY / серийная дата Excel. */
  format?: string;
  /** "Asia/Dushanbe" (по умолчанию, UTC+5), "UTC" или смещение "+05:00". */
  timezone?: string;
}

export interface TimeSplitColumns {
  dateColumn: ColumnRef;
  timeColumn?: ColumnRef;
  format?: string;
  timeFormat?: string;
  /** Время, если столбца времени нет или ячейка пуста, например "13:00". */
  defaultTime?: string;
  timezone?: string;
}

export interface WidePollutantColumn {
  column: ColumnRef;
  /** Единица входных данных; без значения — единица станции (station_pollutants) или вещества. */
  unit?: string;
  /** Множитель к значению до конверсии единиц (например, 0.001). */
  scale?: number;
}

export interface HistoryImportMapping {
  layout: "wide" | "long";
  /** XLSX: имя или индекс листа. */
  sheet?: string | number;
  /** Номер строки заголовка (с 1); строки выше пропускаются. */
  headerRow?: number;
  /** CSV: разделитель и кодировка (utf-8, windows-1251 …). */
  delimiter?: string;
  encoding?: string;
  station: { column: ColumnRef } | { value: string };
  time: TimeSingleColumn | TimeSplitColumns;
  /** Период осреднения, мин; без значения — 60 для непрерывных станций и 20 для разовых проб. */
  averagingMin?: number;
  /** Широкий формат: код вещества → колонка. */
  pollutants?: Record<string, WidePollutantColumn>;
  /** Длинный формат. */
  pollutantColumn?: ColumnRef;
  valueColumn?: ColumnRef;
  unitColumn?: ColumnRef;
  defaultUnit?: string;
  /** Синонимы названий веществ в файле → код справочника (PM25, PM10, NO2, SO2, CO, O3). */
  pollutantAliases?: Record<string, string>;
  /** Строки, означающие отсутствие значения. */
  missingValues?: string[];
  /** Флаг QC для принятых значений: 1 — valid (по умолчанию), 0 — raw (пройдут автоконтроль). */
  qcFlag?: 0 | 1;
}

export interface HistoryImportContext {
  stations: Map<
    string,
    { id: number; sampling: "continuous" | "discrete"; inputUnits: Map<number, ConcentrationUnit> }
  >;
  pollutants: Map<
    string,
    {
      id: number;
      code: string;
      unit: ConcentrationUnit;
      decimals: number;
      molarMass: number | null;
    }
  >;
  ranges: Map<number, { min: number; max: number }>;
  now?: Date;
}

export interface HistoryImportRow {
  time: Date;
  stationId: number;
  pollutantId: number;
  averagingMin: number;
  value: number;
  qcFlag: number;
  qcReason: string | null;
}

export interface HistoryImportError {
  row: number;
  message: string;
}

export interface HistoryImportResult {
  rows: HistoryImportRow[];
  errors: HistoryImportError[];
  /** Строк таблицы; принятых значений; отклонённых строк/значений; дубликатов; вне диапазона. */
  total: number;
  ok: number;
  rejected: number;
  duplicates: number;
  invalidRange: number;
  stationIds: number[];
  from: Date | null;
  to: Date | null;
}

export type ImportCell = string | number | boolean | null | undefined;

export interface ImportTable {
  header: string[];
  rows: ImportCell[][];
}

const MAX_ERRORS = 500;
const DEFAULT_MISSING = ["", "-", "—", "–", "n/a", "na", "nan", "null", "н/д", "нд", "нет", "*"];

export function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizePollutantCode(s: string): string {
  return s
    .trim()
    .toUpperCase()
    .replace(/[.,\s_-]/g, "")
    .replace(/₂/g, "2")
    .replace(/₃/g, "3")
    .replace(/^PM25$/, "PM25")
    .replace(/^PM2\.?5$/, "PM25");
}

/** Проверка структуры маппинга; возвращает список ошибок (пусто — маппинг пригоден). */
export function validateMapping(m: unknown): string[] {
  const errors: string[] = [];
  if (!m || typeof m !== "object") return ["маппинг должен быть объектом JSON"];
  const map = m as Partial<HistoryImportMapping>;
  if (map.layout !== "wide" && map.layout !== "long")
    errors.push('layout: ожидается "wide" или "long"');
  if (!map.station || typeof map.station !== "object")
    errors.push("station: укажите { column } или { value }");
  else if (!("column" in map.station) && !("value" in map.station))
    errors.push("station: нужен column или value");
  if (!map.time || typeof map.time !== "object")
    errors.push("time: укажите { column } или { dateColumn }");
  else if (!("column" in map.time) && !("dateColumn" in map.time))
    errors.push("time: нужен column или dateColumn");
  if (map.layout === "wide") {
    if (!map.pollutants || Object.keys(map.pollutants).length === 0)
      errors.push("pollutants: для широкого формата нужен хотя бы один столбец вещества");
  }
  if (map.layout === "long") {
    if (map.pollutantColumn === undefined)
      errors.push("pollutantColumn: обязателен для длинного формата");
    if (map.valueColumn === undefined) errors.push("valueColumn: обязателен для длинного формата");
  }
  if (
    map.averagingMin !== undefined &&
    !(Number.isInteger(map.averagingMin) && map.averagingMin > 0)
  )
    errors.push("averagingMin: целое число минут > 0");
  if (map.qcFlag !== undefined && map.qcFlag !== 0 && map.qcFlag !== 1)
    errors.push("qcFlag: 0 или 1");
  return errors;
}

/** Поиск индекса колонки по имени заголовка (без учёта регистра) или по индексу с 0. */
export function columnIndexer(header: string[]): (ref: ColumnRef) => number {
  const byName = new Map<string, number>();
  header.forEach((h, i) => {
    const key = normalizeHeader(h);
    if (!byName.has(key)) byName.set(key, i);
  });
  return (ref) => {
    if (typeof ref === "number") return ref;
    const idx = byName.get(normalizeHeader(ref));
    if (idx === undefined) throw new Error(`колонка «${ref}» не найдена в заголовке`);
    return idx;
  };
}

/** Смещение зоны в минутах: Asia/Dushanbe → 300, UTC → 0, "+05:00" → 300. */
export function timezoneOffsetMinutes(tz: string | undefined): number {
  if (!tz || tz === "Asia/Dushanbe" || tz === "Dushanbe") return DUSHANBE_OFFSET_MINUTES;
  if (/^(UTC|GMT|Z)$/i.test(tz)) return 0;
  const m = tz.match(/^([+-])(\d{1,2}):?(\d{2})?$/);
  if (m) {
    const sign = m[1] === "-" ? -1 : 1;
    return sign * (Number(m[2]) * 60 + Number(m[3] ?? 0));
  }
  throw new Error(
    `часовой пояс «${tz}» не поддерживается (Asia/Dushanbe, UTC или смещение +HH:MM)`,
  );
}

interface WallClock {
  y: number;
  M: number;
  d: number;
  h: number;
  m: number;
  s: number;
}

const TOKEN_RE: Record<string, string> = {
  YYYY: "(\\d{4})",
  YY: "(\\d{2})",
  MM: "(\\d{1,2})",
  M: "(\\d{1,2})",
  DD: "(\\d{1,2})",
  D: "(\\d{1,2})",
  HH: "(\\d{1,2})",
  H: "(\\d{1,2})",
  mm: "(\\d{1,2})",
  m: "(\\d{1,2})",
  ss: "(\\d{1,2})",
  s: "(\\d{1,2})",
};

const formatCache = new Map<string, { re: RegExp; tokens: string[] }>();

function compileFormat(format: string): { re: RegExp; tokens: string[] } {
  const cached = formatCache.get(format);
  if (cached) return cached;
  const tokens: string[] = [];
  let pattern = "";
  let i = 0;
  while (i < format.length) {
    const token = ["YYYY", "YY", "MM", "DD", "HH", "mm", "ss", "M", "D", "H", "m", "s"].find((t) =>
      format.startsWith(t, i),
    );
    if (token) {
      tokens.push(token);
      pattern += TOKEN_RE[token];
      i += token.length;
    } else {
      const ch = format[i] as string;
      pattern += /\s/.test(ch) ? "\\s+" : ch.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
      i += 1;
    }
  }
  const compiled = { re: new RegExp(`^\\s*${pattern}\\s*$`), tokens };
  formatCache.set(format, compiled);
  return compiled;
}

function applyTokens(parts: WallClock, tokens: string[], match: RegExpMatchArray): void {
  tokens.forEach((token, i) => {
    const value = Number(match[i + 1]);
    switch (token) {
      case "YYYY":
        parts.y = value;
        break;
      case "YY":
        parts.y = value + (value < 70 ? 2000 : 1900);
        break;
      case "MM":
      case "M":
        parts.M = value;
        break;
      case "DD":
      case "D":
        parts.d = value;
        break;
      case "HH":
      case "H":
        parts.h = value;
        break;
      case "mm":
      case "m":
        parts.m = value;
        break;
      default:
        parts.s = value;
    }
  });
}

function parseWithFormat(raw: string, format: string, into: WallClock): boolean {
  const { re, tokens } = compileFormat(format);
  const match = raw.match(re);
  if (!match) return false;
  applyTokens(into, tokens, match);
  return true;
}

/** Без формата: ISO (с зоной или без), "DD.MM.YYYY[ HH:mm[:ss]]", "DD/MM/YYYY", "YYYY-MM-DD HH:mm". */
function parseLoose(raw: string, into: WallClock): "wall" | Date | null {
  const s = raw.trim();
  const iso = s.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/,
  );
  if (iso) {
    if (iso[7]) {
      const d = new Date(s.replace(" ", "T"));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    into.y = Number(iso[1]);
    into.M = Number(iso[2]);
    into.d = Number(iso[3]);
    into.h = Number(iso[4] ?? 0);
    into.m = Number(iso[5] ?? 0);
    into.s = Number(iso[6] ?? 0);
    return "wall";
  }
  const dotted = s.match(
    /^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (dotted) {
    into.d = Number(dotted[1]);
    into.M = Number(dotted[2]);
    into.y = Number(dotted[3]);
    into.h = Number(dotted[4] ?? 0);
    into.m = Number(dotted[5] ?? 0);
    into.s = Number(dotted[6] ?? 0);
    return "wall";
  }
  return null;
}

function wallToUtc(w: WallClock, offsetMin: number): Date | null {
  if (!w.y || w.M < 1 || w.M > 12 || w.d < 1 || w.d > 31 || w.h > 24 || w.m > 59 || w.s > 59) {
    return null;
  }
  // Date.UTC «перекатывает» несуществующие даты (31.02 → 02.03) — проверяем, что день и месяц сохранились.
  const probe = new Date(Date.UTC(w.y, w.M - 1, w.d));
  if (probe.getUTCMonth() !== w.M - 1 || probe.getUTCDate() !== w.d) return null;
  const d = new Date(Date.UTC(w.y, w.M - 1, w.d, w.h, w.m, w.s) - offsetMin * 60_000);
  return Number.isNaN(d.getTime()) ? null : d;
}

function excelSerialToWall(serial: number, into: WallClock): void {
  const ms = Math.round(Date.UTC(1899, 11, 30) + serial * 86_400_000);
  const d = new Date(ms);
  into.y = d.getUTCFullYear();
  into.M = d.getUTCMonth() + 1;
  into.d = d.getUTCDate();
  into.h = d.getUTCHours();
  into.m = d.getUTCMinutes();
  into.s = d.getUTCSeconds();
}

/**
 * Разбирает дату/время измерения. Числовое значение — серийная дата Excel; строка без зоны
 * трактуется в часовом поясе маппинга; ISO со зоной — как есть.
 */
export function parseImportTime(
  value: ImportCell,
  opts: {
    format?: string;
    timeValue?: ImportCell;
    timeFormat?: string;
    defaultTime?: string;
    timezone?: string;
  },
): Date | null {
  const offset = timezoneOffsetMinutes(opts.timezone);
  const wall: WallClock = { y: 0, M: 0, d: 0, h: 0, m: 0, s: 0 };
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    excelSerialToWall(value, wall);
  } else {
    const raw = String(value).trim();
    if (opts.format) {
      if (!parseWithFormat(raw, opts.format, wall)) return null;
    } else {
      const loose = parseLoose(raw, wall);
      if (loose === null) return null;
      if (loose instanceof Date) return loose;
    }
  }
  const timeValue = opts.timeValue;
  const hasTime = timeValue !== null && timeValue !== undefined && String(timeValue).trim() !== "";
  if (hasTime || opts.defaultTime) {
    const t = hasTime ? timeValue : opts.defaultTime;
    if (typeof t === "number") {
      // Доля суток Excel (0.5 = 12:00).
      const minutes = Math.round((t % 1) * 24 * 60);
      wall.h = Math.floor(minutes / 60);
      wall.m = minutes % 60;
      wall.s = 0;
    } else {
      const parsed: WallClock = { ...wall };
      const ok = parseWithFormat(
        String(t),
        opts.timeFormat ?? (String(t).split(":").length > 2 ? "HH:mm:ss" : "HH:mm"),
        parsed,
      );
      if (!ok) return null;
      wall.h = parsed.h;
      wall.m = parsed.m;
      wall.s = parsed.s;
    }
  }
  return wallToUtc(wall, offset);
}

export interface ParsedValue {
  value: number;
  /** Значение «<x» — ниже предела обнаружения: берётся x/2, помечается в qc_reason. */
  belowLimit?: number;
}

/** "12,5" → 12.5; "<5" → 2.5 (ниже предела обнаружения); пустые/маркеры → null; мусор → NaN. */
export function parseImportValue(
  raw: ImportCell,
  missing: Set<string>,
): ParsedValue | null | typeof Number.NaN {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "boolean") return Number.NaN;
  if (typeof raw === "number") return Number.isFinite(raw) ? { value: raw } : null;
  let s = raw.trim().toLowerCase();
  if (missing.has(s)) return null;
  let below = false;
  if (s.startsWith("<")) {
    below = true;
    s = s.slice(1).trim();
  }
  s = s.replace(/\s+/g, "").replace(",", ".");
  if (s === "") return null;
  if (!/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(s)) return Number.NaN;
  const num = Number(s);
  return below ? { value: num / 2, belowLimit: num } : { value: num };
}

function cellString(cell: ImportCell): string {
  if (cell === null || cell === undefined) return "";
  return typeof cell === "string" ? cell : String(cell);
}

/** Преобразует таблицу в строки измерений по маппингу. Ничего не пишет в БД. */
export function mapHistoryRows(
  table: ImportTable,
  mapping: HistoryImportMapping,
  ctx: HistoryImportContext,
): HistoryImportResult {
  const problems = validateMapping(mapping);
  if (problems.length) throw new Error(`Некорректный маппинг: ${problems.join("; ")}`);
  const col = columnIndexer(table.header);
  const now = ctx.now ?? new Date();
  const missing = new Set(
    (mapping.missingValues ?? DEFAULT_MISSING).map((m) => m.trim().toLowerCase()),
  );
  const aliases = new Map<string, string>();
  for (const [alias, code] of Object.entries(mapping.pollutantAliases ?? {})) {
    aliases.set(normalizePollutantCode(alias), normalizePollutantCode(code));
  }
  const findPollutant = (name: string) => {
    const key = normalizePollutantCode(name);
    const code = aliases.get(key) ?? key;
    return ctx.pollutants.get(code) ?? ctx.pollutants.get(key) ?? null;
  };

  const result: HistoryImportResult = {
    rows: [],
    errors: [],
    total: table.rows.length,
    ok: 0,
    rejected: 0,
    duplicates: 0,
    invalidRange: 0,
    stationIds: [],
    from: null,
    to: null,
  };
  const pushError = (row: number, message: string) => {
    result.rejected += 1;
    if (result.errors.length < MAX_ERRORS) result.errors.push({ row, message });
  };

  const stationIdx = "column" in mapping.station ? col(mapping.station.column) : null;
  const fixedStation = "value" in mapping.station ? mapping.station.value : null;
  const time = mapping.time;
  const timeIdx = "column" in time ? col(time.column) : col(time.dateColumn);
  const timeOfDayIdx =
    "dateColumn" in time && time.timeColumn !== undefined ? col(time.timeColumn) : null;
  const wideColumns =
    mapping.layout === "wide"
      ? Object.entries(mapping.pollutants ?? {}).map(([name, def]) => {
          const pollutant = findPollutant(name);
          if (!pollutant)
            throw new Error(`pollutants: вещество «${name}» не найдено в справочнике`);
          const unit = def.unit ? normalizeUnit(def.unit) : null;
          if (def.unit && !unit)
            throw new Error(`pollutants.${name}.unit: неизвестная единица «${def.unit}»`);
          return { idx: col(def.column), pollutant, unit, scale: def.scale ?? 1 };
        })
      : [];
  const longIdx =
    mapping.layout === "long"
      ? {
          pollutant: col(mapping.pollutantColumn as ColumnRef),
          value: col(mapping.valueColumn as ColumnRef),
          unit: mapping.unitColumn !== undefined ? col(mapping.unitColumn) : null,
        }
      : null;
  const defaultUnit = mapping.defaultUnit ? normalizeUnit(mapping.defaultUnit) : null;
  if (mapping.defaultUnit && !defaultUnit)
    throw new Error(`defaultUnit: неизвестная единица «${mapping.defaultUnit}»`);
  const acceptedFlag = mapping.qcFlag ?? QC_FLAG.valid;
  const seen = new Set<string>();
  const stationSet = new Set<number>();
  const headerRow = Math.max(1, mapping.headerRow ?? 1);

  table.rows.forEach((cells, i) => {
    const rowNo = headerRow + 1 + i;
    if (cells.every((c) => c === null || c === undefined || String(c).trim() === "")) {
      result.total -= 1;
      return;
    }
    const stationCode = (fixedStation ?? cellString(cells[stationIdx as number]))
      .trim()
      .toUpperCase();
    const station = ctx.stations.get(stationCode);
    if (!station) {
      pushError(rowNo, `unknownStation:${stationCode || "(пусто)"}`);
      return;
    }
    const when = parseImportTime(cells[timeIdx], {
      format: "column" in time ? time.format : time.format,
      timeValue: timeOfDayIdx !== null ? cells[timeOfDayIdx] : undefined,
      timeFormat: "dateColumn" in time ? time.timeFormat : undefined,
      defaultTime: "dateColumn" in time ? time.defaultTime : undefined,
      timezone: time.timezone,
    });
    if (!when) {
      pushError(rowNo, `time:${cellString(cells[timeIdx])}`);
      return;
    }
    if (when.getTime() > now.getTime() + 3_600_000) {
      pushError(rowNo, "futureTime");
      return;
    }
    const averagingMin = mapping.averagingMin ?? (station.sampling === "continuous" ? 60 : 20);

    const accept = (
      pollutant: NonNullable<ReturnType<typeof findPollutant>>,
      rawValue: ImportCell,
      unit: ConcentrationUnit | null,
      scale: number,
    ) => {
      const parsed = parseImportValue(rawValue, missing);
      if (parsed === null) return;
      if (typeof parsed === "number") {
        pushError(rowNo, `value:${pollutant.code}:${cellString(rawValue)}`);
        return;
      }
      const inputUnit = unit ?? station.inputUnits.get(pollutant.id) ?? pollutant.unit;
      let value: number;
      try {
        value = roundTo(
          convertConcentration(
            parsed.value * scale,
            inputUnit,
            pollutant.unit,
            pollutant.molarMass,
          ),
          pollutant.decimals + 2,
        );
      } catch {
        pushError(rowNo, `unitConversion:${pollutant.code}:${inputUnit}`);
        return;
      }
      const key = `${when.toISOString()}|${station.id}|${pollutant.id}|${averagingMin}`;
      if (seen.has(key)) {
        result.duplicates += 1;
        return;
      }
      seen.add(key);
      const verdict = applyRangeRule(value, ctx.ranges.get(pollutant.id));
      let qcFlag: number = acceptedFlag;
      let qcReason: string | null = null;
      if (verdict.flag === QC_FLAG.invalid) {
        qcFlag = QC_FLAG.invalid;
        qcReason = verdict.reason ?? "range";
        result.invalidRange += 1;
      } else if (parsed.belowLimit !== undefined) {
        qcReason = `belowDetectionLimit:${parsed.belowLimit}`;
      }
      result.rows.push({
        time: when,
        stationId: station.id,
        pollutantId: pollutant.id,
        averagingMin,
        value,
        qcFlag,
        qcReason,
      });
      result.ok += 1;
      stationSet.add(station.id);
      if (!result.from || when < result.from) result.from = when;
      if (!result.to || when > result.to) result.to = when;
    };

    if (mapping.layout === "wide") {
      for (const c of wideColumns) accept(c.pollutant, cells[c.idx], c.unit, c.scale);
    } else if (longIdx) {
      const name = cellString(cells[longIdx.pollutant]);
      const pollutant = findPollutant(name);
      if (!pollutant) {
        pushError(rowNo, `unknownPollutant:${name}`);
        return;
      }
      let unit: ConcentrationUnit | null = defaultUnit;
      if (longIdx.unit !== null) {
        const rawUnit = cellString(cells[longIdx.unit]).trim();
        if (rawUnit) {
          unit = normalizeUnit(rawUnit);
          if (!unit) {
            pushError(rowNo, `unit:${rawUnit}`);
            return;
          }
        }
      }
      accept(pollutant, cells[longIdx.value], unit, 1);
    }
  });
  result.stationIds = [...stationSet];
  return result;
}
