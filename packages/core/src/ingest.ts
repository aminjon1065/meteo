/**
 * Приём измерений от станций (POST /api/v1/ingest, агент станции, pull‑адаптер worker'а):
 * чистая нормализация записей `{ time, pollutant, value, unit?, flag?, averagingMin? }`
 * в строки таблицы measurements. Правила те же, что у ручного ввода и импорта CSV:
 * синонимы вендоров → код вещества, единица ввода станции → единица вещества,
 * правило диапазона QC → флаг invalid, ключ «время / станция / вещество / осреднение»
 * (идемпотентный upsert выполняет сервис БД `ingestMeasurements`).
 */
import { normalizePollutantCode, parseImportTime, parseImportValue } from "./import-mapping";
import { applyRangeRule, QC_FLAG, type QcFlag, type RangeRule } from "./qc";
import { type ConcentrationUnit, convertConcentration, normalizeUnit, roundTo } from "./units";

/**
 * Синонимы кодов веществ в экспортах вендорского ПО и API логгеров (ключи — после
 * normalizePollutantCode: верхний регистр, без точек, пробелов, дефисов и подчёркиваний).
 */
const BUILTIN_ALIASES: Record<string, string> = {
  PM25: "PM25",
  PM2P5: "PM25",
  PM25CONC: "PM25",
  PM25MASS: "PM25",
  PM25AVG: "PM25",
  FPM: "PM25",
  FINEPARTICLES: "PM25",
  FINEPARTICULATEMATTER: "PM25",
  ТЧ25: "PM25",
  PM10: "PM10",
  PM10CONC: "PM10",
  PM10MASS: "PM10",
  PM10AVG: "PM10",
  PARTICULATEMATTER10: "PM10",
  ТЧ10: "PM10",
  NO2: "NO2",
  NITROGENDIOXIDE: "NO2",
  ДИОКСИДАЗОТА: "NO2",
  ДВУОКИСЬАЗОТА: "NO2",
  SO2: "SO2",
  SULFURDIOXIDE: "SO2",
  SULPHURDIOXIDE: "SO2",
  ДИОКСИДСЕРЫ: "SO2",
  ДВУОКИСЬСЕРЫ: "SO2",
  СЕРНИСТЫЙГАЗ: "SO2",
  СЕРНИСТЫЙАНГИДРИД: "SO2",
  CO: "CO",
  CARBONMONOXIDE: "CO",
  ОКСИДУГЛЕРОДА: "CO",
  ОКИСЬУГЛЕРОДА: "CO",
  УГАРНЫЙГАЗ: "CO",
  O3: "O3",
  OZONE: "O3",
  ОЗОН: "O3",
  // Вещества автоматической станции Душанбе и постов (бюллетени Агентства)
  NO: "NO",
  NITRICOXIDE: "NO",
  NITROGENMONOXIDE: "NO",
  NITROGENOXIDE: "NO",
  ОКСИДАЗОТА: "NO",
  ОКИСЬАЗОТА: "NO",
  МОНООКСИДАЗОТА: "NO",
  CH2O: "CH2O",
  HCHO: "CH2O",
  FORMALDEHYDE: "CH2O",
  ФОРМАЛЬДЕГИД: "CH2O",
  ФОРМАЛДЕГИД: "CH2O",
  C6H5OH: "C6H5OH",
  C6H6O: "C6H5OH",
  PHENOL: "C6H5OH",
  ФЕНОЛ: "C6H5OH",
  HF: "HF",
  HYDROGENFLUORIDE: "HF",
  ФТОРИСТЫЙВОДОРОД: "HF",
  ФТОРИДВОДОРОДА: "HF",
  ФТОРВОДОРОД: "HF",
  TSP: "TSP",
  SPM: "TSP",
  DUST: "TSP",
  TOTALSUSPENDEDPARTICLES: "TSP",
  ПЫЛЬ: "TSP",
  ВЗВЕШЕННЫЕЧАСТИЦЫ: "TSP",
  ВЗВЕШЕННЫЕВЕЩЕСТВА: "TSP",
  CO2: "CO2",
  CARBONDIOXIDE: "CO2",
  ДИОКСИДУГЛЕРОДА: "CO2",
  ДВУОКИСЬУГЛЕРОДА: "CO2",
  УГЛЕКИСЛЫЙГАЗ: "CO2",
  TVOC: "TVOC",
  VOC: "TVOC",
  VOCS: "TVOC",
  ЛОС: "TVOC",
};

/** Единицы в названии колонки ("PM2.5 (ug/m3)", "NO2 ppb") не относятся к коду вещества. */
const UNIT_SUFFIX_RE =
  /(\(.*?\)|\[.*?\]|(?<![\p{L}\p{N}])((µg|ug|mcg|mg|мкг|мг)\s*\/?\s*(m|м)\s*(3|³)?|ppb|ppm)(?![\p{L}\p{N}]))/giu;

/**
 * Код вещества из названия в файле/запросе: явные синонимы маппинга, затем встроенная таблица,
 * иначе нормализованное название как есть (справочник решит, известно ли оно).
 */
export function resolvePollutantCode(raw: string, aliases?: Record<string, string>): string {
  const key = normalizePollutantCode(raw.replace(UNIT_SUFFIX_RE, " "));
  if (aliases) {
    for (const [alias, code] of Object.entries(aliases)) {
      if (normalizePollutantCode(alias) === key) return normalizePollutantCode(code);
    }
  }
  return BUILTIN_ALIASES[key] ?? key;
}

/** Запись измерения во входном формате ingest (JSON или строка файла экспорта). */
export interface IngestRecordInput {
  /** ISO 8601 (с зоной), «YYYY-MM-DD HH:MM» / «DD.MM.YYYY HH:MM» (местное время Душанбе) или epoch. */
  time: string | number;
  /** Код вещества или синоним вендора. */
  pollutant: string;
  /** Число, строка с десятичной запятой или «<5» (ниже предела обнаружения); null — нет значения. */
  value: number | string | null;
  /** Единица входных данных; без значения — единица ввода станции для этого вещества. */
  unit?: string | null;
  /** Флаг качества вендора: valid / suspect / invalid / missing или код QC 0–5. */
  flag?: string | number | null;
  /** Период осреднения, мин (по умолчанию 60 для непрерывных станций, 20 для разовых проб). */
  averagingMin?: number | null;
}

export interface IngestStationContext {
  id: number;
  code: string;
  sampling: "continuous" | "discrete";
  /** Единицы ввода по веществам станции (station_pollutants.active). */
  inputUnits: Map<number, ConcentrationUnit>;
}

export interface IngestPollutantContext {
  id: number;
  code: string;
  unit: ConcentrationUnit;
  decimals: number;
  molarMass: number | null;
}

export interface IngestContext {
  station: IngestStationContext;
  /** Справочник веществ по каноническому коду. */
  pollutants: Map<string, IngestPollutantContext>;
  /** Правила диапазона по id вещества. */
  ranges: Map<number, RangeRule>;
  now?: Date;
  /** Максимальная давность данных в днях (защита от неверных часов логгера); по умолчанию 730. */
  maxAgeDays?: number;
  /** Принимать вещества, не отмеченные у станции (по умолчанию нет — отклоняются). */
  allowUnconfiguredPollutants?: boolean;
}

export interface IngestRow {
  time: Date;
  stationId: number;
  pollutantId: number;
  averagingMin: number;
  value: number | null;
  qcFlag: number;
  qcReason: string | null;
}

export interface IngestError {
  /** Индекс записи во входном массиве (с 0). */
  index: number;
  message: string;
}

export interface IngestNormalizeResult {
  rows: IngestRow[];
  errors: IngestError[];
  received: number;
  accepted: number;
  rejected: number;
  /** Принятых значений вне диапазона QC (сохранены с флагом invalid). */
  invalidRange: number;
  /** Повторов ключа внутри пакета (остаётся последняя запись). */
  duplicates: number;
  from: Date | null;
  to: Date | null;
  /** Коды веществ принятых записей. */
  pollutantCodes: string[];
}

export const INGEST_MAX_RECORDS = 1000;
const MAX_ERRORS = 1000;

const FLAG_WORDS: Record<string, QcFlag> = {
  valid: QC_FLAG.valid,
  validated: QC_FLAG.valid,
  ok: QC_FLAG.valid,
  good: QC_FLAG.valid,
  v: QC_FLAG.valid,
  suspect: QC_FLAG.suspect,
  suspicious: QC_FLAG.suspect,
  questionable: QC_FLAG.suspect,
  doubtful: QC_FLAG.suspect,
  warning: QC_FLAG.suspect,
  warn: QC_FLAG.suspect,
  s: QC_FLAG.suspect,
  q: QC_FLAG.suspect,
  invalid: QC_FLAG.invalid,
  bad: QC_FLAG.invalid,
  error: QC_FLAG.invalid,
  err: QC_FLAG.invalid,
  fault: QC_FLAG.invalid,
  failed: QC_FLAG.invalid,
  fail: QC_FLAG.invalid,
  calibration: QC_FLAG.invalid,
  cal: QC_FLAG.invalid,
  maintenance: QC_FLAG.invalid,
  service: QC_FLAG.invalid,
  zero: QC_FLAG.invalid,
  span: QC_FLAG.invalid,
  i: QC_FLAG.invalid,
  f: QC_FLAG.invalid,
  missing: QC_FLAG.missing,
  nodata: QC_FLAG.missing,
  na: QC_FLAG.missing,
  "n/a": QC_FLAG.missing,
  none: QC_FLAG.missing,
  m: QC_FLAG.missing,
  raw: QC_FLAG.raw,
  unchecked: QC_FLAG.raw,
};

/**
 * Флаг вендора → флаг QC портала. Числа трактуются как коды QC (0 raw … 5 missing),
 * неизвестные строки — как valid (значение пройдёт правило диапазона и пакетный контроль).
 */
export function parseVendorFlag(raw: string | number | null | undefined): QcFlag | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    return Number.isInteger(raw) && raw >= 0 && raw <= 5 ? (raw as QcFlag) : null;
  }
  const s = raw.trim().toLowerCase();
  if (s === "") return null;
  if (/^[0-5]$/.test(s)) return Number(s) as QcFlag;
  return FLAG_WORDS[s] ?? null;
}

/** Время записи: epoch (с или мс), ISO со зоной как есть, без зоны — местное время Душанбе. */
export function parseIngestTime(value: string | number): Date | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return null;
    const ms = value > 1e11 ? value : value * 1000;
    const d = new Date(Math.round(ms));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const s = value.trim();
  if (!s) return null;
  if (/^\d{9,13}$/.test(s)) return parseIngestTime(Number(s));
  return parseImportTime(s, { timezone: "Asia/Dushanbe" });
}

/** Нормализует пакет записей станции в строки measurements; ничего не пишет. */
export function normalizeIngestRecords(
  records: IngestRecordInput[],
  ctx: IngestContext,
): IngestNormalizeResult {
  const now = ctx.now ?? new Date();
  const maxAgeMs = (ctx.maxAgeDays ?? 730) * 86_400_000;
  const station = ctx.station;
  const defaultAveraging = station.sampling === "continuous" ? 60 : 20;
  const result: IngestNormalizeResult = {
    rows: [],
    errors: [],
    received: records.length,
    accepted: 0,
    rejected: 0,
    invalidRange: 0,
    duplicates: 0,
    from: null,
    to: null,
    pollutantCodes: [],
  };
  const pushError = (index: number, message: string) => {
    result.rejected += 1;
    if (result.errors.length < MAX_ERRORS) result.errors.push({ index, message });
  };
  const missing = new Set(["", "-", "—", "n/a", "na", "nan", "null"]);
  const byKey = new Map<string, { rowIndex: number; inputIndex: number }>();
  const codes = new Set<string>();

  records.forEach((rec, index) => {
    if (!rec || typeof rec !== "object") {
      pushError(index, "record");
      return;
    }
    const time =
      typeof rec.time === "string" || typeof rec.time === "number"
        ? parseIngestTime(rec.time)
        : null;
    if (!time) {
      pushError(index, `time:${String(rec.time ?? "")}`);
      return;
    }
    if (time.getTime() > now.getTime() + 3_600_000) {
      pushError(index, "futureTime");
      return;
    }
    if (now.getTime() - time.getTime() > maxAgeMs) {
      pushError(index, "tooOld");
      return;
    }

    const code = resolvePollutantCode(String(rec.pollutant ?? ""));
    const pollutant = ctx.pollutants.get(code);
    if (!pollutant) {
      pushError(index, `unknownPollutant:${code || "(пусто)"}`);
      return;
    }
    const stationUnit = station.inputUnits.get(pollutant.id);
    if (stationUnit === undefined && !ctx.allowUnconfiguredPollutants) {
      pushError(index, `pollutantNotConfigured:${pollutant.code}`);
      return;
    }

    let averagingMin = defaultAveraging;
    if (rec.averagingMin !== undefined && rec.averagingMin !== null) {
      if (!Number.isInteger(rec.averagingMin) || rec.averagingMin < 1 || rec.averagingMin > 1440) {
        pushError(index, `averagingMin:${String(rec.averagingMin)}`);
        return;
      }
      averagingMin = rec.averagingMin;
    }

    const flag = parseVendorFlag(rec.flag);
    const parsed = parseImportValue(
      typeof rec.value === "number" ? rec.value : rec.value === null ? null : String(rec.value),
      missing,
    );
    if (typeof parsed === "number") {
      pushError(index, `value:${String(rec.value)}`);
      return;
    }

    let value: number | null = null;
    let qcFlag: number;
    let qcReason: string | null = null;
    if (parsed === null) {
      if (flag !== QC_FLAG.missing && flag !== QC_FLAG.invalid) {
        pushError(index, "emptyValue");
        return;
      }
      qcFlag = flag;
      qcReason = `vendor:${String(rec.flag)}`;
    } else {
      let unit: ConcentrationUnit | null = null;
      if (typeof rec.unit === "string" && rec.unit.trim()) {
        unit = normalizeUnit(rec.unit);
        if (!unit) {
          pushError(index, `unit:${rec.unit}`);
          return;
        }
      } else {
        unit = stationUnit ?? pollutant.unit;
      }
      try {
        value = roundTo(
          convertConcentration(parsed.value, unit, pollutant.unit, pollutant.molarMass),
          pollutant.decimals + 2,
        );
      } catch {
        pushError(index, `unitConversion:${unit}`);
        return;
      }
      if (flag === QC_FLAG.invalid || flag === QC_FLAG.suspect || flag === QC_FLAG.missing) {
        qcFlag = flag;
        qcReason = `vendor:${String(rec.flag)}`;
      } else {
        const verdict = applyRangeRule(value, ctx.ranges.get(pollutant.id));
        qcFlag = verdict.flag;
        qcReason = verdict.reason;
        if (verdict.flag === QC_FLAG.invalid) result.invalidRange += 1;
        else if (parsed.belowLimit !== undefined)
          qcReason = `belowDetectionLimit:${parsed.belowLimit}`;
        if (flag === QC_FLAG.raw && qcFlag === QC_FLAG.valid) qcFlag = QC_FLAG.raw;
      }
    }

    const key = `${time.toISOString()}|${pollutant.id}|${averagingMin}`;
    const row: IngestRow = {
      time,
      stationId: station.id,
      pollutantId: pollutant.id,
      averagingMin,
      value,
      qcFlag,
      qcReason,
    };
    const previous = byKey.get(key);
    if (previous !== undefined) {
      // Повтор ключа в пакете: остаётся последняя запись, ранняя помечается как дубликат.
      result.duplicates += 1;
      result.rows[previous.rowIndex] = row;
      if (result.errors.length < MAX_ERRORS)
        result.errors.push({ index: previous.inputIndex, message: "duplicate" });
      previous.inputIndex = index;
      return;
    }
    byKey.set(key, { rowIndex: result.rows.length, inputIndex: index });
    result.rows.push(row);
    result.accepted += 1;
    codes.add(pollutant.code);
    if (!result.from || time < result.from) result.from = time;
    if (!result.to || time > result.to) result.to = time;
  });
  result.pollutantCodes = [...codes];
  return result;
}
