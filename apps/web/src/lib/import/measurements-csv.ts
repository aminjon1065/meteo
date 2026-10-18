import "server-only";
import {
  applyRangeRule,
  type ConcentrationUnit,
  convertConcentration,
  normalizeUnit,
  parseMeasurementTime,
  QC_FLAG,
  roundTo,
} from "@meteo/core";
import Papa from "papaparse";
import { parseDecimal } from "@/lib/validation/measurement";

export interface ImportContext {
  stations: Map<
    string,
    { id: number; sampling: "continuous" | "discrete"; inputUnits: Map<number, ConcentrationUnit> }
  >;
  pollutants: Map<
    string,
    { id: number; unit: ConcentrationUnit; decimals: number; molarMass: number | null }
  >;
  ranges: Map<number, { min: number; max: number }>;
  /** Станция по умолчанию, если в файле нет столбца station. */
  defaultStationCode?: string;
}

export interface ImportRow {
  time: string;
  stationId: number;
  pollutantId: number;
  averagingMin: number;
  value: number;
  qcFlag: number;
  qcReason: string | null;
}

export interface ImportReport {
  total: number;
  ok: number;
  rejected: number;
  invalidRange: number;
  errors: Array<{ row: number; message: string }>;
  rows: ImportRow[];
}

const MAX_ROWS = 100_000;
const MAX_ERRORS = 200;

const HEADER_ALIASES: Record<string, string> = {
  time: "time",
  datetime: "time",
  date: "time",
  время: "time",
  дата: "time",
  дата_время: "time",
  station: "station",
  station_code: "station",
  code: "station",
  станция: "station",
  пост: "station",
  pollutant: "pollutant",
  parameter: "pollutant",
  вещество: "pollutant",
  параметр: "pollutant",
  value: "value",
  значение: "value",
  concentration: "value",
  концентрация: "value",
  unit: "unit",
  units: "unit",
  единица: "unit",
  ед: "unit",
};

function normalizeHeader(h: string): string {
  const key = h
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^\p{L}\p{N}_]/gu, "");
  return HEADER_ALIASES[key] ?? key;
}

function normalizeCode(s: string): string {
  return s.trim().toUpperCase().replace(/[.\s]/g, "").replace("₂", "2").replace("₃", "3");
}

/** Разбирает CSV измерений и валидирует построчно. Ничего не пишет в БД. */
export function parseMeasurementsCsv(text: string, ctx: ImportContext): ImportReport {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: normalizeHeader,
  });
  const report: ImportReport = {
    total: 0,
    ok: 0,
    rejected: 0,
    invalidRange: 0,
    errors: [],
    rows: [],
  };
  const pushError = (row: number, message: string) => {
    report.rejected += 1;
    if (report.errors.length < MAX_ERRORS) report.errors.push({ row, message });
  };
  if (parsed.errors.length && parsed.data.length === 0) {
    pushError(0, `csv:${parsed.errors[0]?.message ?? "parse"}`);
    return report;
  }
  const fields = parsed.meta.fields ?? [];
  for (const required of ["time", "pollutant", "value"]) {
    if (!fields.includes(required)) {
      pushError(0, `missingColumn:${required}`);
      return report;
    }
  }
  if (!fields.includes("station") && !ctx.defaultStationCode) {
    pushError(0, "missingColumn:station");
    return report;
  }
  if (parsed.data.length > MAX_ROWS) {
    pushError(0, `tooManyRows:${MAX_ROWS}`);
    return report;
  }

  const seen = new Set<string>();
  for (const [index, record] of parsed.data.entries()) {
    const rowNo = index + 2; // с учётом заголовка
    report.total += 1;
    const time = parseMeasurementTime(record.time ?? "");
    if (!time) {
      pushError(rowNo, "time");
      continue;
    }
    if (time.getTime() > Date.now() + 60 * 60 * 1000) {
      pushError(rowNo, "futureTime");
      continue;
    }

    const stationCode = normalizeCode(record.station ?? ctx.defaultStationCode ?? "");
    const station = ctx.stations.get(stationCode);
    if (!station) {
      pushError(rowNo, `unknownStation:${stationCode}`);
      continue;
    }

    const pollutantCode = normalizeCode(record.pollutant ?? "");
    const pollutant = ctx.pollutants.get(pollutantCode);
    if (!pollutant) {
      pushError(rowNo, `unknownPollutant:${pollutantCode}`);
      continue;
    }

    const raw = parseDecimal(record.value ?? "");
    if (raw === null) {
      pushError(rowNo, "emptyValue");
      continue;
    }
    if (Number.isNaN(raw)) {
      pushError(rowNo, "value");
      continue;
    }

    let unit: ConcentrationUnit | null = null;
    if (record.unit?.trim()) {
      unit = normalizeUnit(record.unit);
      if (!unit) {
        pushError(rowNo, `unit:${record.unit}`);
        continue;
      }
    } else {
      unit = station.inputUnits.get(pollutant.id) ?? pollutant.unit;
    }
    let value: number;
    try {
      value = roundTo(
        convertConcentration(raw, unit, pollutant.unit, pollutant.molarMass),
        pollutant.decimals + 2,
      );
    } catch {
      pushError(rowNo, `unitConversion:${unit}`);
      continue;
    }
    const averagingMin = station.sampling === "continuous" ? 60 : 20;
    const key = `${time.toISOString()}|${station.id}|${pollutant.id}|${averagingMin}`;
    if (seen.has(key)) {
      pushError(rowNo, "duplicate");
      continue;
    }
    seen.add(key);

    const verdict = applyRangeRule(value, ctx.ranges.get(pollutant.id));
    if (verdict.flag === QC_FLAG.invalid) report.invalidRange += 1;
    report.ok += 1;
    report.rows.push({
      time: time.toISOString(),
      stationId: station.id,
      pollutantId: pollutant.id,
      averagingMin,
      value,
      qcFlag: verdict.flag,
      qcReason: verdict.reason,
    });
  }
  return report;
}
