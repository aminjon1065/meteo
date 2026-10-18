/**
 * Разбор файлов экспорта станционного ПО (CSV/TSV) в записи для приёма измерений.
 * Общий код агента станции (apps/station-agent) и pull‑адаптера worker'а (задача station-pull):
 * одна таблица маппинга колонок → одинаковые записи `{ time, pollutant, value, unit?, flag? }`,
 * которые затем проходят `normalizeIngestRecords` на сервере. Чистая логика без I/O и без
 * справочников БД: вещества приводятся к каноническим кодам по синонимам, остальное решает сервер.
 */
import { detectDelimiter, parseCsv, parseCsvRecords } from "./csv";
import {
  type ColumnRef,
  columnIndexer,
  type ImportCell,
  parseImportTime,
  parseImportValue,
  type TimeSingleColumn,
  type TimeSplitColumns,
  timezoneOffsetMinutes,
  type WidePollutantColumn,
} from "./import-mapping";
import { type IngestRecordInput, resolvePollutantCode } from "./ingest";

export interface FeedPollutantColumn extends WidePollutantColumn {
  /** Колонка флага/статуса именно этого вещества (например, «PM2.5 Status»). */
  flagColumn?: ColumnRef;
}

/** Описание формата файла экспорта (JSON в конфиге агента или в station_sources.mapping). */
export interface FeedMapping {
  /** Разделитель: ";", ",", "\t", "|" или слова tab / semicolon / comma / pipe; без значения — автоопределение. */
  delimiter?: string;
  /** Кодировка файла: utf-8 (по умолчанию), windows-1251, utf-16le … (используется читающей стороной). */
  encoding?: string;
  /** Номер строки заголовка (с 1); 0 — заголовка нет, колонки задаются индексами с 0. */
  headerRow?: number;
  /** Сколько строк после заголовка пропустить (строки единиц, описаний). */
  skipRows?: number;
  /** Строки, начинающиеся с этого префикса, пропускаются (комментарии экспорта). */
  commentPrefix?: string;
  /** wide — столбец на вещество; long — вещество / значение / единица в строке. */
  layout: "wide" | "long";
  time: TimeSingleColumn | TimeSplitColumns;
  /** Широкий формат: название вещества (код или синоним) → колонка. */
  pollutants?: Record<string, FeedPollutantColumn>;
  /** Длинный формат. */
  pollutantColumn?: ColumnRef;
  valueColumn?: ColumnRef;
  unitColumn?: ColumnRef;
  flagColumn?: ColumnRef;
  /** Единица по умолчанию (длинный формат); без значения — единица ввода станции на сервере. */
  defaultUnit?: string;
  /** Синонимы названий веществ в файле → код справочника (PM25, PM10, NO2, SO2, CO, O3). */
  pollutantAliases?: Record<string, string>;
  /** Строки, означающие отсутствие значения. */
  missingValues?: string[];
  /** Колонка статуса строки: значения из invalidStatuses (или не из validStatuses) → флаг invalid. */
  statusColumn?: ColumnRef;
  validStatuses?: string[];
  invalidStatuses?: string[];
  /** Период осреднения записей, мин; без значения сервер подставит значение станции. */
  averagingMin?: number;
}

export interface FeedRecord extends IngestRecordInput {
  time: string;
  /** Номер строки файла (с учётом заголовка) — для журнала и отчётов. */
  row: number;
}

export interface FeedError {
  row: number;
  message: string;
}

export interface FeedParseResult {
  records: FeedRecord[];
  errors: FeedError[];
  /** Строк данных в файле (без пустых и комментариев). */
  total: number;
  /** Строк, из которых не получилось ни одной записи (пустые значения). */
  empty: number;
  /** Повторов ключа «время + вещество» внутри файла (остаётся последняя запись). */
  duplicates: number;
  from: string | null;
  to: string | null;
}

const MAX_ERRORS = 500;
const DEFAULT_MISSING = ["", "-", "—", "–", "n/a", "na", "nan", "null", "н/д", "нд", "нет", "*"];
const DELIMITER_WORDS: Record<string, string> = {
  tab: "\t",
  "\\t": "\t",
  semicolon: ";",
  comma: ",",
  pipe: "|",
  space: " ",
};

export function normalizeDelimiter(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === "") return undefined;
  return DELIMITER_WORDS[raw.toLowerCase()] ?? raw;
}

function isColumnRef(v: unknown): v is ColumnRef {
  return (typeof v === "string" && v.trim() !== "") || (typeof v === "number" && v >= 0);
}

/** Проверка структуры маппинга; пустой список — маппинг пригоден. */
export function validateFeedMapping(m: unknown): string[] {
  const errors: string[] = [];
  if (!m || typeof m !== "object" || Array.isArray(m)) return ["mapping должен быть объектом JSON"];
  const map = m as Partial<FeedMapping>;
  if (map.layout !== "wide" && map.layout !== "long")
    errors.push('layout: ожидается "wide" или "long"');
  if (!map.time || typeof map.time !== "object")
    errors.push("time: укажите { column } или { dateColumn }");
  else {
    const t = map.time as Partial<TimeSingleColumn & TimeSplitColumns>;
    if (!isColumnRef(t.column) && !isColumnRef(t.dateColumn))
      errors.push("time: нужен column или dateColumn");
    if (t.timezone !== undefined) {
      try {
        timezoneOffsetMinutes(t.timezone);
      } catch (error) {
        errors.push(`time.timezone: ${(error as Error).message}`);
      }
    }
  }
  if (map.layout === "wide") {
    const entries = Object.entries(map.pollutants ?? {});
    if (entries.length === 0)
      errors.push("pollutants: для широкого формата нужен хотя бы один столбец вещества");
    for (const [name, def] of entries) {
      if (!def || typeof def !== "object" || !isColumnRef(def.column))
        errors.push(`pollutants.${name}: нужен column`);
    }
  }
  if (map.layout === "long") {
    if (!isColumnRef(map.pollutantColumn))
      errors.push("pollutantColumn: обязателен для длинного формата");
    if (!isColumnRef(map.valueColumn)) errors.push("valueColumn: обязателен для длинного формата");
  }
  if (map.headerRow !== undefined && !(Number.isInteger(map.headerRow) && map.headerRow >= 0))
    errors.push("headerRow: целое число ≥ 0");
  if (map.skipRows !== undefined && !(Number.isInteger(map.skipRows) && map.skipRows >= 0))
    errors.push("skipRows: целое число ≥ 0");
  if (
    map.averagingMin !== undefined &&
    !(Number.isInteger(map.averagingMin) && map.averagingMin > 0 && map.averagingMin <= 1440)
  )
    errors.push("averagingMin: целое число минут 1–1440");
  if (map.headerRow === 0) {
    const refs: unknown[] = [];
    if (map.time && typeof map.time === "object") {
      const t = map.time as Partial<TimeSingleColumn & TimeSplitColumns>;
      refs.push(t.column, t.dateColumn, t.timeColumn);
    }
    refs.push(map.pollutantColumn, map.valueColumn, map.unitColumn, map.statusColumn);
    for (const def of Object.values(map.pollutants ?? {})) refs.push(def?.column);
    if (refs.some((r) => typeof r === "string"))
      errors.push("headerRow: 0 — без заголовка все колонки задаются индексами");
  }
  return errors;
}

function cellString(cell: ImportCell): string {
  if (cell === null || cell === undefined) return "";
  return typeof cell === "string" ? cell : String(cell);
}

function splitRows(text: string, mapping: FeedMapping): { header: string[]; rows: string[][] } {
  const normalized = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).replace(/\r\n?/g, "\n");
  const prefix = mapping.commentPrefix;
  const body = prefix
    ? normalized
        .split("\n")
        .filter((line) => !line.startsWith(prefix))
        .join("\n")
    : normalized;
  const delimiter = normalizeDelimiter(mapping.delimiter);
  const headerRow = mapping.headerRow ?? 1;
  if (headerRow === 0) {
    const firstLine = body.split("\n").find((l) => l.trim().length > 0) ?? "";
    const records = parseCsvRecords(body, delimiter ?? detectDelimiter(firstLine)).filter((r) =>
      r.some((c) => c.trim().length > 0),
    );
    return { header: [], rows: records };
  }
  const table = parseCsv(body, { delimiter, skipRows: headerRow - 1 });
  return { header: table.header, rows: table.rows };
}

/** Разбирает текст файла экспорта по маппингу; ничего не отправляет и не пишет. */
export function parseStationFeed(
  text: string,
  mapping: FeedMapping,
  opts: { now?: Date } = {},
): FeedParseResult {
  const result: FeedParseResult = {
    records: [],
    errors: [],
    total: 0,
    empty: 0,
    duplicates: 0,
    from: null,
    to: null,
  };
  const problems = validateFeedMapping(mapping);
  if (problems.length) {
    result.errors.push(...problems.map((message) => ({ row: 0, message: `mapping:${message}` })));
    return result;
  }
  const { header, rows } = splitRows(text, mapping);
  const headerRow = mapping.headerRow ?? 1;
  const skip = mapping.skipRows ?? 0;
  const data = rows.slice(skip);
  const now = opts.now ?? new Date();
  const missing = new Set(
    (mapping.missingValues ?? DEFAULT_MISSING).map((m) => m.trim().toLowerCase()),
  );
  const col = columnIndexer(header);
  const ref = (r: ColumnRef): number => col(r);

  let timeIdx: number;
  let timeOfDayIdx: number | null = null;
  let statusIdx: number | null = null;
  let wide: Array<{
    name: string;
    code: string;
    idx: number;
    flagIdx: number | null;
    unit?: string;
    scale: number;
  }> = [];
  let long: { pollutant: number; value: number; unit: number | null; flag: number | null } | null =
    null;
  try {
    const time = mapping.time;
    timeIdx = "column" in time ? ref(time.column) : ref(time.dateColumn);
    timeOfDayIdx =
      "dateColumn" in time && time.timeColumn !== undefined ? ref(time.timeColumn) : null;
    statusIdx = mapping.statusColumn !== undefined ? ref(mapping.statusColumn) : null;
    if (mapping.layout === "wide") {
      wide = Object.entries(mapping.pollutants ?? {}).map(([name, def]) => ({
        name,
        code: resolvePollutantCode(name, mapping.pollutantAliases),
        idx: ref(def.column),
        flagIdx: def.flagColumn !== undefined ? ref(def.flagColumn) : null,
        unit: def.unit,
        scale: def.scale ?? 1,
      }));
    } else {
      long = {
        pollutant: ref(mapping.pollutantColumn as ColumnRef),
        value: ref(mapping.valueColumn as ColumnRef),
        unit: mapping.unitColumn !== undefined ? ref(mapping.unitColumn) : null,
        flag: mapping.flagColumn !== undefined ? ref(mapping.flagColumn) : null,
      };
    }
  } catch (error) {
    result.errors.push({ row: 0, message: `column:${(error as Error).message}` });
    return result;
  }

  const valid = mapping.validStatuses?.map((s) => s.trim().toLowerCase());
  const invalid = new Set((mapping.invalidStatuses ?? []).map((s) => s.trim().toLowerCase()));
  const pushError = (row: number, message: string) => {
    if (result.errors.length < MAX_ERRORS) result.errors.push({ row, message });
  };
  const byKey = new Map<string, number>();

  data.forEach((cells, i) => {
    const rowNo = headerRow + skip + 1 + i;
    if (cells.every((c) => c.trim() === "")) return;
    result.total += 1;
    const when = parseImportTime(cells[timeIdx], {
      format: mapping.time.format,
      timeValue: timeOfDayIdx !== null ? cells[timeOfDayIdx] : undefined,
      timeFormat: "dateColumn" in mapping.time ? mapping.time.timeFormat : undefined,
      defaultTime: "dateColumn" in mapping.time ? mapping.time.defaultTime : undefined,
      timezone: mapping.time.timezone,
    });
    if (!when) {
      pushError(rowNo, `time:${cellString(cells[timeIdx])}`);
      return;
    }
    if (when.getTime() > now.getTime() + 3_600_000) {
      pushError(rowNo, "futureTime");
      return;
    }
    let rowFlag: string | undefined;
    if (statusIdx !== null) {
      const status = cellString(cells[statusIdx]).trim();
      const key = status.toLowerCase();
      if (invalid.has(key) || (valid && !valid.includes(key))) rowFlag = `invalid:${status}`;
    }
    const iso = when.toISOString();
    let produced = 0;
    const accept = (
      code: string,
      rawValue: ImportCell,
      unit: string | undefined,
      scale: number,
      flagCell: ImportCell,
    ) => {
      const parsed = parseImportValue(rawValue, missing);
      if (parsed === null) return;
      if (typeof parsed === "number") {
        pushError(rowNo, `value:${code}:${cellString(rawValue)}`);
        return;
      }
      const flagRaw = cellString(flagCell).trim();
      const record: FeedRecord = {
        time: iso,
        pollutant: code,
        // «<5» передаётся строкой: сервер сам подставит половину предела и причину QC.
        value:
          parsed.belowLimit !== undefined ? `<${parsed.belowLimit * scale}` : parsed.value * scale,
        row: rowNo,
      };
      if (unit) record.unit = unit;
      if (rowFlag) record.flag = rowFlag;
      else if (flagRaw) record.flag = flagRaw;
      if (mapping.averagingMin) record.averagingMin = mapping.averagingMin;
      const key = `${iso}|${code}|${record.averagingMin ?? 0}`;
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
    };

    if (mapping.layout === "wide") {
      for (const c of wide)
        accept(
          c.code,
          cells[c.idx],
          c.unit,
          c.scale,
          c.flagIdx !== null ? cells[c.flagIdx] : undefined,
        );
    } else if (long) {
      const name = cellString(cells[long.pollutant]).trim();
      if (!name) {
        pushError(rowNo, "pollutant:(пусто)");
        return;
      }
      const code = resolvePollutantCode(name, mapping.pollutantAliases);
      const unitCell = long.unit !== null ? cellString(cells[long.unit]).trim() : "";
      accept(
        code,
        cells[long.value],
        unitCell || mapping.defaultUnit,
        1,
        long.flag !== null ? cells[long.flag] : undefined,
      );
    }
    if (produced === 0) result.empty += 1;
  });
  return result;
}

/** Маска файлов экспорта (`*.csv`, `DU-01_*.txt`, `data_????.csv`) → регулярное выражение (без учёта регистра). */
export function filePatternToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .trim()
    .split(/[*?]/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"));
  const wildcards = pattern.trim().match(/[*?]/g) ?? [];
  let source = "";
  escaped.forEach((part, i) => {
    source += part;
    const w = wildcards[i];
    if (w === "*") source += ".*";
    else if (w === "?") source += ".";
  });
  return new RegExp(`^${source || ".*"}$`, "i");
}
