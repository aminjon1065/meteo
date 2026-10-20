#!/usr/bin/env node
// Метеопортал — агент станции. Собрано из apps/station-agent/src/agent.ts и @meteo/core;
// не редактируйте вручную: pnpm --filter @meteo/station-agent build.

// src/agent.ts
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

// ../../packages/core/src/csv.ts
var CANDIDATES = [";", ",", "	", "|"];
function detectDelimiter(firstLine) {
  let best = ",";
  let bestCount = -1;
  for (const d of CANDIDATES) {
    const count = splitLine(firstLine, d).length;
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}
function splitLine(line, delimiter) {
  return parseCsvRecords(line, delimiter)[0] ?? [];
}
function parseCsvRecords(text, delimiter) {
  const records = [];
  let row = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const src = text.charCodeAt(0) === 65279 ? text.slice(1) : text;
  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      row.push(field);
      field = "";
      records.push(row);
      row = [];
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    records.push(row);
  }
  return records;
}
function parseCsv(text, options = {}) {
  const normalized = text.charCodeAt(0) === 65279 ? text.slice(1) : text;
  const lines = normalized.split(/\r?\n/);
  const skip = Math.max(0, options.skipRows ?? 0);
  const body = lines.slice(skip).join("\n");
  const firstLine = lines.slice(skip).find((l) => l.trim().length > 0) ?? "";
  const delimiter = options.delimiter ?? detectDelimiter(firstLine);
  const records = parseCsvRecords(body, delimiter).filter(
    (r) => r.some((cell) => cell.trim().length > 0)
  );
  const header = (records[0] ?? []).map((h) => h.trim());
  const rows = records.slice(1).map((r) => {
    const out = r.slice(0, header.length);
    while (out.length < header.length) out.push("");
    return out;
  });
  return { delimiter, header, rows };
}

// ../../packages/core/src/qc.ts
var QC_FLAG = {
  raw: 0,
  valid: 1,
  suspect: 2,
  invalid: 3,
  corrected: 4,
  missing: 5
};

// ../../packages/core/src/time.ts
var DUSHANBE_OFFSET_MINUTES = 5 * 60;

// ../../packages/core/src/import-mapping.ts
function normalizeHeader(h) {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}
function normalizePollutantCode(s) {
  return s.trim().toUpperCase().replace(/[.,\s_-]/g, "").replace(/₂/g, "2").replace(/₃/g, "3").replace(/^PM25$/, "PM25").replace(/^PM2\.?5$/, "PM25");
}
function columnIndexer(header) {
  const byName = /* @__PURE__ */ new Map();
  header.forEach((h, i) => {
    const key = normalizeHeader(h);
    if (!byName.has(key)) byName.set(key, i);
  });
  return (ref) => {
    if (typeof ref === "number") return ref;
    const idx = byName.get(normalizeHeader(ref));
    if (idx === void 0) throw new Error(`\u043A\u043E\u043B\u043E\u043D\u043A\u0430 \xAB${ref}\xBB \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430 \u0432 \u0437\u0430\u0433\u043E\u043B\u043E\u0432\u043A\u0435`);
    return idx;
  };
}
function timezoneOffsetMinutes(tz) {
  if (!tz || tz === "Asia/Dushanbe" || tz === "Dushanbe") return DUSHANBE_OFFSET_MINUTES;
  if (/^(UTC|GMT|Z)$/i.test(tz)) return 0;
  const m = tz.match(/^([+-])(\d{1,2}):?(\d{2})?$/);
  if (m) {
    const sign = m[1] === "-" ? -1 : 1;
    return sign * (Number(m[2]) * 60 + Number(m[3] ?? 0));
  }
  throw new Error(
    `\u0447\u0430\u0441\u043E\u0432\u043E\u0439 \u043F\u043E\u044F\u0441 \xAB${tz}\xBB \u043D\u0435 \u043F\u043E\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u0442\u0441\u044F (Asia/Dushanbe, UTC \u0438\u043B\u0438 \u0441\u043C\u0435\u0449\u0435\u043D\u0438\u0435 +HH:MM)`
  );
}
var TOKEN_RE = {
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
  s: "(\\d{1,2})"
};
var formatCache = /* @__PURE__ */ new Map();
function compileFormat(format) {
  const cached = formatCache.get(format);
  if (cached) return cached;
  const tokens = [];
  let pattern = "";
  let i = 0;
  while (i < format.length) {
    const token = ["YYYY", "YY", "MM", "DD", "HH", "mm", "ss", "M", "D", "H", "m", "s"].find(
      (t) => format.startsWith(t, i)
    );
    if (token) {
      tokens.push(token);
      pattern += TOKEN_RE[token];
      i += token.length;
    } else {
      const ch = format[i];
      pattern += /\s/.test(ch) ? "\\s+" : ch.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
      i += 1;
    }
  }
  const compiled = { re: new RegExp(`^\\s*${pattern}\\s*$`), tokens };
  formatCache.set(format, compiled);
  return compiled;
}
function applyTokens(parts, tokens, match) {
  tokens.forEach((token, i) => {
    const value = Number(match[i + 1]);
    switch (token) {
      case "YYYY":
        parts.y = value;
        break;
      case "YY":
        parts.y = value + (value < 70 ? 2e3 : 1900);
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
function parseWithFormat(raw, format, into) {
  const { re, tokens } = compileFormat(format);
  const match = raw.match(re);
  if (!match) return false;
  applyTokens(into, tokens, match);
  return true;
}
function parseLoose(raw, into) {
  const s = raw.trim();
  const iso = s.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/
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
    /^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
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
function wallToUtc(w, offsetMin) {
  if (!w.y || w.M < 1 || w.M > 12 || w.d < 1 || w.d > 31 || w.h > 24 || w.m > 59 || w.s > 59) {
    return null;
  }
  const probe = new Date(Date.UTC(w.y, w.M - 1, w.d));
  if (probe.getUTCMonth() !== w.M - 1 || probe.getUTCDate() !== w.d) return null;
  const d = new Date(Date.UTC(w.y, w.M - 1, w.d, w.h, w.m, w.s) - offsetMin * 6e4);
  return Number.isNaN(d.getTime()) ? null : d;
}
function excelSerialToWall(serial, into) {
  const ms = Math.round(Date.UTC(1899, 11, 30) + serial * 864e5);
  const d = new Date(ms);
  into.y = d.getUTCFullYear();
  into.M = d.getUTCMonth() + 1;
  into.d = d.getUTCDate();
  into.h = d.getUTCHours();
  into.m = d.getUTCMinutes();
  into.s = d.getUTCSeconds();
}
function parseImportTime(value, opts) {
  const offset = timezoneOffsetMinutes(opts.timezone);
  const wall = { y: 0, M: 0, d: 0, h: 0, m: 0, s: 0 };
  if (value === null || value === void 0 || value === "") return null;
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
  const hasTime = timeValue !== null && timeValue !== void 0 && String(timeValue).trim() !== "";
  if (hasTime || opts.defaultTime) {
    const t = hasTime ? timeValue : opts.defaultTime;
    if (typeof t === "number") {
      const minutes = Math.round(t % 1 * 24 * 60);
      wall.h = Math.floor(minutes / 60);
      wall.m = minutes % 60;
      wall.s = 0;
    } else {
      const parsed = { ...wall };
      const ok = parseWithFormat(
        String(t),
        opts.timeFormat ?? (String(t).split(":").length > 2 ? "HH:mm:ss" : "HH:mm"),
        parsed
      );
      if (!ok) return null;
      wall.h = parsed.h;
      wall.m = parsed.m;
      wall.s = parsed.s;
    }
  }
  return wallToUtc(wall, offset);
}
function parseImportValue(raw, missing) {
  if (raw === null || raw === void 0) return null;
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

// ../../packages/core/src/ingest.ts
var BUILTIN_ALIASES = {
  PM25: "PM25",
  PM2P5: "PM25",
  PM25CONC: "PM25",
  PM25MASS: "PM25",
  PM25AVG: "PM25",
  FPM: "PM25",
  FINEPARTICLES: "PM25",
  FINEPARTICULATEMATTER: "PM25",
  \u0422\u042725: "PM25",
  PM10: "PM10",
  PM10CONC: "PM10",
  PM10MASS: "PM10",
  PM10AVG: "PM10",
  PARTICULATEMATTER10: "PM10",
  \u0422\u042710: "PM10",
  NO2: "NO2",
  NITROGENDIOXIDE: "NO2",
  \u0414\u0418\u041E\u041A\u0421\u0418\u0414\u0410\u0417\u041E\u0422\u0410: "NO2",
  \u0414\u0412\u0423\u041E\u041A\u0418\u0421\u042C\u0410\u0417\u041E\u0422\u0410: "NO2",
  SO2: "SO2",
  SULFURDIOXIDE: "SO2",
  SULPHURDIOXIDE: "SO2",
  \u0414\u0418\u041E\u041A\u0421\u0418\u0414\u0421\u0415\u0420\u042B: "SO2",
  \u0414\u0412\u0423\u041E\u041A\u0418\u0421\u042C\u0421\u0415\u0420\u042B: "SO2",
  \u0421\u0415\u0420\u041D\u0418\u0421\u0422\u042B\u0419\u0413\u0410\u0417: "SO2",
  \u0421\u0415\u0420\u041D\u0418\u0421\u0422\u042B\u0419\u0410\u041D\u0413\u0418\u0414\u0420\u0418\u0414: "SO2",
  CO: "CO",
  CARBONMONOXIDE: "CO",
  \u041E\u041A\u0421\u0418\u0414\u0423\u0413\u041B\u0415\u0420\u041E\u0414\u0410: "CO",
  \u041E\u041A\u0418\u0421\u042C\u0423\u0413\u041B\u0415\u0420\u041E\u0414\u0410: "CO",
  \u0423\u0413\u0410\u0420\u041D\u042B\u0419\u0413\u0410\u0417: "CO",
  O3: "O3",
  OZONE: "O3",
  \u041E\u0417\u041E\u041D: "O3",
  // Вещества автоматической станции Душанбе и постов (бюллетени Агентства)
  NO: "NO",
  NITRICOXIDE: "NO",
  NITROGENMONOXIDE: "NO",
  NITROGENOXIDE: "NO",
  \u041E\u041A\u0421\u0418\u0414\u0410\u0417\u041E\u0422\u0410: "NO",
  \u041E\u041A\u0418\u0421\u042C\u0410\u0417\u041E\u0422\u0410: "NO",
  \u041C\u041E\u041D\u041E\u041E\u041A\u0421\u0418\u0414\u0410\u0417\u041E\u0422\u0410: "NO",
  CH2O: "CH2O",
  HCHO: "CH2O",
  FORMALDEHYDE: "CH2O",
  \u0424\u041E\u0420\u041C\u0410\u041B\u042C\u0414\u0415\u0413\u0418\u0414: "CH2O",
  \u0424\u041E\u0420\u041C\u0410\u041B\u0414\u0415\u0413\u0418\u0414: "CH2O",
  C6H5OH: "C6H5OH",
  C6H6O: "C6H5OH",
  PHENOL: "C6H5OH",
  \u0424\u0415\u041D\u041E\u041B: "C6H5OH",
  HF: "HF",
  HYDROGENFLUORIDE: "HF",
  \u0424\u0422\u041E\u0420\u0418\u0421\u0422\u042B\u0419\u0412\u041E\u0414\u041E\u0420\u041E\u0414: "HF",
  \u0424\u0422\u041E\u0420\u0418\u0414\u0412\u041E\u0414\u041E\u0420\u041E\u0414\u0410: "HF",
  \u0424\u0422\u041E\u0420\u0412\u041E\u0414\u041E\u0420\u041E\u0414: "HF",
  TSP: "TSP",
  SPM: "TSP",
  DUST: "TSP",
  TOTALSUSPENDEDPARTICLES: "TSP",
  \u041F\u042B\u041B\u042C: "TSP",
  \u0412\u0417\u0412\u0415\u0428\u0415\u041D\u041D\u042B\u0415\u0427\u0410\u0421\u0422\u0418\u0426\u042B: "TSP",
  \u0412\u0417\u0412\u0415\u0428\u0415\u041D\u041D\u042B\u0415\u0412\u0415\u0429\u0415\u0421\u0422\u0412\u0410: "TSP",
  CO2: "CO2",
  CARBONDIOXIDE: "CO2",
  \u0414\u0418\u041E\u041A\u0421\u0418\u0414\u0423\u0413\u041B\u0415\u0420\u041E\u0414\u0410: "CO2",
  \u0414\u0412\u0423\u041E\u041A\u0418\u0421\u042C\u0423\u0413\u041B\u0415\u0420\u041E\u0414\u0410: "CO2",
  \u0423\u0413\u041B\u0415\u041A\u0418\u0421\u041B\u042B\u0419\u0413\u0410\u0417: "CO2",
  TVOC: "TVOC",
  VOC: "TVOC",
  VOCS: "TVOC",
  \u041B\u041E\u0421: "TVOC"
};
var UNIT_SUFFIX_RE = /(\(.*?\)|\[.*?\]|(?<![\p{L}\p{N}])((µg|ug|mcg|mg|мкг|мг)\s*\/?\s*(m|м)\s*(3|³)?|ppb|ppm)(?![\p{L}\p{N}]))/giu;
function resolvePollutantCode(raw, aliases) {
  const key = normalizePollutantCode(raw.replace(UNIT_SUFFIX_RE, " "));
  if (aliases) {
    for (const [alias, code] of Object.entries(aliases)) {
      if (normalizePollutantCode(alias) === key) return normalizePollutantCode(code);
    }
  }
  return BUILTIN_ALIASES[key] ?? key;
}
var FLAG_WORDS = {
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
  unchecked: QC_FLAG.raw
};

// ../../packages/core/src/station-feed.ts
var MAX_ERRORS = 500;
var DEFAULT_MISSING = ["", "-", "\u2014", "\u2013", "n/a", "na", "nan", "null", "\u043D/\u0434", "\u043D\u0434", "\u043D\u0435\u0442", "*"];
var DELIMITER_WORDS = {
  tab: "	",
  "\\t": "	",
  semicolon: ";",
  comma: ",",
  pipe: "|",
  space: " "
};
function normalizeDelimiter(raw) {
  if (raw === void 0 || raw === "") return void 0;
  return DELIMITER_WORDS[raw.toLowerCase()] ?? raw;
}
function isColumnRef(v) {
  return typeof v === "string" && v.trim() !== "" || typeof v === "number" && v >= 0;
}
function validateFeedMapping(m) {
  const errors = [];
  if (!m || typeof m !== "object" || Array.isArray(m)) return ["mapping \u0434\u043E\u043B\u0436\u0435\u043D \u0431\u044B\u0442\u044C \u043E\u0431\u044A\u0435\u043A\u0442\u043E\u043C JSON"];
  const map = m;
  if (map.layout !== "wide" && map.layout !== "long")
    errors.push('layout: \u043E\u0436\u0438\u0434\u0430\u0435\u0442\u0441\u044F "wide" \u0438\u043B\u0438 "long"');
  if (!map.time || typeof map.time !== "object")
    errors.push("time: \u0443\u043A\u0430\u0436\u0438\u0442\u0435 { column } \u0438\u043B\u0438 { dateColumn }");
  else {
    const t = map.time;
    if (!isColumnRef(t.column) && !isColumnRef(t.dateColumn))
      errors.push("time: \u043D\u0443\u0436\u0435\u043D column \u0438\u043B\u0438 dateColumn");
    if (t.timezone !== void 0) {
      try {
        timezoneOffsetMinutes(t.timezone);
      } catch (error) {
        errors.push(`time.timezone: ${error.message}`);
      }
    }
  }
  if (map.layout === "wide") {
    const entries = Object.entries(map.pollutants ?? {});
    if (entries.length === 0)
      errors.push("pollutants: \u0434\u043B\u044F \u0448\u0438\u0440\u043E\u043A\u043E\u0433\u043E \u0444\u043E\u0440\u043C\u0430\u0442\u0430 \u043D\u0443\u0436\u0435\u043D \u0445\u043E\u0442\u044F \u0431\u044B \u043E\u0434\u0438\u043D \u0441\u0442\u043E\u043B\u0431\u0435\u0446 \u0432\u0435\u0449\u0435\u0441\u0442\u0432\u0430");
    for (const [name, def] of entries) {
      if (!def || typeof def !== "object" || !isColumnRef(def.column))
        errors.push(`pollutants.${name}: \u043D\u0443\u0436\u0435\u043D column`);
    }
  }
  if (map.layout === "long") {
    if (!isColumnRef(map.pollutantColumn))
      errors.push("pollutantColumn: \u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u0435\u043D \u0434\u043B\u044F \u0434\u043B\u0438\u043D\u043D\u043E\u0433\u043E \u0444\u043E\u0440\u043C\u0430\u0442\u0430");
    if (!isColumnRef(map.valueColumn)) errors.push("valueColumn: \u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u0435\u043D \u0434\u043B\u044F \u0434\u043B\u0438\u043D\u043D\u043E\u0433\u043E \u0444\u043E\u0440\u043C\u0430\u0442\u0430");
  }
  if (map.headerRow !== void 0 && !(Number.isInteger(map.headerRow) && map.headerRow >= 0))
    errors.push("headerRow: \u0446\u0435\u043B\u043E\u0435 \u0447\u0438\u0441\u043B\u043E \u2265 0");
  if (map.skipRows !== void 0 && !(Number.isInteger(map.skipRows) && map.skipRows >= 0))
    errors.push("skipRows: \u0446\u0435\u043B\u043E\u0435 \u0447\u0438\u0441\u043B\u043E \u2265 0");
  if (map.averagingMin !== void 0 && !(Number.isInteger(map.averagingMin) && map.averagingMin > 0 && map.averagingMin <= 1440))
    errors.push("averagingMin: \u0446\u0435\u043B\u043E\u0435 \u0447\u0438\u0441\u043B\u043E \u043C\u0438\u043D\u0443\u0442 1\u20131440");
  if (map.headerRow === 0) {
    const refs = [];
    if (map.time && typeof map.time === "object") {
      const t = map.time;
      refs.push(t.column, t.dateColumn, t.timeColumn);
    }
    refs.push(map.pollutantColumn, map.valueColumn, map.unitColumn, map.statusColumn);
    for (const def of Object.values(map.pollutants ?? {})) refs.push(def?.column);
    if (refs.some((r) => typeof r === "string"))
      errors.push("headerRow: 0 \u2014 \u0431\u0435\u0437 \u0437\u0430\u0433\u043E\u043B\u043E\u0432\u043A\u0430 \u0432\u0441\u0435 \u043A\u043E\u043B\u043E\u043D\u043A\u0438 \u0437\u0430\u0434\u0430\u044E\u0442\u0441\u044F \u0438\u043D\u0434\u0435\u043A\u0441\u0430\u043C\u0438");
  }
  return errors;
}
function cellString(cell) {
  if (cell === null || cell === void 0) return "";
  return typeof cell === "string" ? cell : String(cell);
}
function splitRows(text, mapping) {
  const normalized = (text.charCodeAt(0) === 65279 ? text.slice(1) : text).replace(/\r\n?/g, "\n");
  const prefix = mapping.commentPrefix;
  const body = prefix ? normalized.split("\n").filter((line) => !line.startsWith(prefix)).join("\n") : normalized;
  const delimiter = normalizeDelimiter(mapping.delimiter);
  const headerRow = mapping.headerRow ?? 1;
  if (headerRow === 0) {
    const firstLine = body.split("\n").find((l) => l.trim().length > 0) ?? "";
    const records = parseCsvRecords(body, delimiter ?? detectDelimiter(firstLine)).filter(
      (r) => r.some((c) => c.trim().length > 0)
    );
    return { header: [], rows: records };
  }
  const table = parseCsv(body, { delimiter, skipRows: headerRow - 1 });
  return { header: table.header, rows: table.rows };
}
function parseStationFeed(text, mapping, opts = {}) {
  const result = {
    records: [],
    errors: [],
    total: 0,
    empty: 0,
    duplicates: 0,
    from: null,
    to: null
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
  const now = opts.now ?? /* @__PURE__ */ new Date();
  const missing = new Set(
    (mapping.missingValues ?? DEFAULT_MISSING).map((m) => m.trim().toLowerCase())
  );
  const col = columnIndexer(header);
  const ref = (r) => col(r);
  let timeIdx;
  let timeOfDayIdx = null;
  let statusIdx = null;
  let wide = [];
  let long = null;
  try {
    const time = mapping.time;
    timeIdx = "column" in time ? ref(time.column) : ref(time.dateColumn);
    timeOfDayIdx = "dateColumn" in time && time.timeColumn !== void 0 ? ref(time.timeColumn) : null;
    statusIdx = mapping.statusColumn !== void 0 ? ref(mapping.statusColumn) : null;
    if (mapping.layout === "wide") {
      wide = Object.entries(mapping.pollutants ?? {}).map(([name, def]) => ({
        name,
        code: resolvePollutantCode(name, mapping.pollutantAliases),
        idx: ref(def.column),
        flagIdx: def.flagColumn !== void 0 ? ref(def.flagColumn) : null,
        unit: def.unit,
        scale: def.scale ?? 1
      }));
    } else {
      long = {
        pollutant: ref(mapping.pollutantColumn),
        value: ref(mapping.valueColumn),
        unit: mapping.unitColumn !== void 0 ? ref(mapping.unitColumn) : null,
        flag: mapping.flagColumn !== void 0 ? ref(mapping.flagColumn) : null
      };
    }
  } catch (error) {
    result.errors.push({ row: 0, message: `column:${error.message}` });
    return result;
  }
  const valid = mapping.validStatuses?.map((s) => s.trim().toLowerCase());
  const invalid = new Set((mapping.invalidStatuses ?? []).map((s) => s.trim().toLowerCase()));
  const pushError = (row, message) => {
    if (result.errors.length < MAX_ERRORS) result.errors.push({ row, message });
  };
  const byKey = /* @__PURE__ */ new Map();
  data.forEach((cells, i) => {
    const rowNo = headerRow + skip + 1 + i;
    if (cells.every((c) => c.trim() === "")) return;
    result.total += 1;
    const when = parseImportTime(cells[timeIdx], {
      format: mapping.time.format,
      timeValue: timeOfDayIdx !== null ? cells[timeOfDayIdx] : void 0,
      timeFormat: "dateColumn" in mapping.time ? mapping.time.timeFormat : void 0,
      defaultTime: "dateColumn" in mapping.time ? mapping.time.defaultTime : void 0,
      timezone: mapping.time.timezone
    });
    if (!when) {
      pushError(rowNo, `time:${cellString(cells[timeIdx])}`);
      return;
    }
    if (when.getTime() > now.getTime() + 36e5) {
      pushError(rowNo, "futureTime");
      return;
    }
    let rowFlag;
    if (statusIdx !== null) {
      const status = cellString(cells[statusIdx]).trim();
      const key = status.toLowerCase();
      if (invalid.has(key) || valid && !valid.includes(key)) rowFlag = `invalid:${status}`;
    }
    const iso = when.toISOString();
    let produced = 0;
    const accept = (code, rawValue, unit, scale, flagCell) => {
      const parsed = parseImportValue(rawValue, missing);
      if (parsed === null) return;
      if (typeof parsed === "number") {
        pushError(rowNo, `value:${code}:${cellString(rawValue)}`);
        return;
      }
      const flagRaw = cellString(flagCell).trim();
      const record = {
        time: iso,
        pollutant: code,
        // «<5» передаётся строкой: сервер сам подставит половину предела и причину QC.
        value: parsed.belowLimit !== void 0 ? `<${parsed.belowLimit * scale}` : parsed.value * scale,
        row: rowNo
      };
      if (unit) record.unit = unit;
      if (rowFlag) record.flag = rowFlag;
      else if (flagRaw) record.flag = flagRaw;
      if (mapping.averagingMin) record.averagingMin = mapping.averagingMin;
      const key = `${iso}|${code}|${record.averagingMin ?? 0}`;
      const previous = byKey.get(key);
      if (previous !== void 0) {
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
          c.flagIdx !== null ? cells[c.flagIdx] : void 0
        );
    } else if (long) {
      const name = cellString(cells[long.pollutant]).trim();
      if (!name) {
        pushError(rowNo, "pollutant:(\u043F\u0443\u0441\u0442\u043E)");
        return;
      }
      const code = resolvePollutantCode(name, mapping.pollutantAliases);
      const unitCell = long.unit !== null ? cellString(cells[long.unit]).trim() : "";
      accept(
        code,
        cells[long.value],
        unitCell || mapping.defaultUnit,
        1,
        long.flag !== null ? cells[long.flag] : void 0
      );
    }
    if (produced === 0) result.empty += 1;
  });
  return result;
}
function filePatternToRegExp(pattern) {
  const escaped = pattern.trim().split(/[*?]/).map((part) => part.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"));
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

// src/agent.ts
var AGENT_VERSION = "0.1.0";
var AgentError = class extends Error {
  constructor(message, exitCode) {
    super(message);
    this.exitCode = exitCode;
    this.name = "AgentError";
  }
  exitCode;
};
var LEVEL_ORDER = { debug: 10, info: 20, warn: 30, error: 40 };
var Logger = class {
  constructor(file, maxBytes, minLevel) {
    this.file = file;
    this.maxBytes = maxBytes;
    this.minLevel = minLevel;
  }
  file;
  maxBytes;
  minLevel;
  log(level, message, data) {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;
    const line = `${(/* @__PURE__ */ new Date()).toISOString()} ${level.toUpperCase().padEnd(5)} ${message}${data && Object.keys(data).length ? ` ${JSON.stringify(data)}` : ""}`;
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.info(line);
    if (this.file) {
      try {
        if (existsSync(this.file) && statSync(this.file).size > this.maxBytes) {
          renameSync(this.file, `${this.file}.1`);
        }
        appendFileSync(this.file, `${line}
`);
      } catch {
      }
    }
  }
};
function loadConfig(path) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
  } catch (error) {
    throw new AgentError(`\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u0440\u043E\u0447\u0438\u0442\u0430\u0442\u044C \u043A\u043E\u043D\u0444\u0438\u0433 ${path}: ${error.message}`, 1);
  }
  const problems = validateConfig(raw);
  if (problems.length) throw new AgentError(`\u041A\u043E\u043D\u0444\u0438\u0433 ${path}:
  - ${problems.join("\n  - ")}`, 1);
  return { config: raw, dir: dirname(resolve(path)) };
}
function validateConfig(raw) {
  const errors = [];
  if (!raw || typeof raw !== "object") return ["\u043E\u0436\u0438\u0434\u0430\u0435\u0442\u0441\u044F \u043E\u0431\u044A\u0435\u043A\u0442 JSON"];
  const c = raw;
  if (typeof c.portalUrl !== "string" || !/^https?:\/\/\S+$/.test(c.portalUrl))
    errors.push("portalUrl: \u043D\u0443\u0436\u0435\u043D \u0430\u0434\u0440\u0435\u0441 http(s)://\u2026");
  if (typeof c.stationCode !== "string" || !/^[A-Za-z0-9_-]{2,32}$/.test(c.stationCode))
    errors.push("stationCode: \u043A\u043E\u0434 \u0441\u0442\u0430\u043D\u0446\u0438\u0438 (\u043B\u0430\u0442\u0438\u043D\u0438\u0446\u0430, \u0446\u0438\u0444\u0440\u044B, \u0434\u0435\u0444\u0438\u0441, 2\u201332 \u0441\u0438\u043C\u0432\u043E\u043B\u0430)");
  if (!c.apiKey && !c.apiKeyEnv) errors.push("apiKey \u0438\u043B\u0438 apiKeyEnv: \u043A\u043B\u044E\u0447 \u0441\u0442\u0430\u043D\u0446\u0438\u0438 \u043D\u0435 \u0437\u0430\u0434\u0430\u043D");
  if (typeof c.watchDir !== "string" || !c.watchDir) errors.push("watchDir: \u043F\u0430\u043F\u043A\u0430 \u044D\u043A\u0441\u043F\u043E\u0440\u0442\u0430");
  if (c.filePattern !== void 0 && typeof c.filePattern !== "string")
    errors.push("filePattern: \u0441\u0442\u0440\u043E\u043A\u0430\u2011\u043C\u0430\u0441\u043A\u0430, \u043D\u0430\u043F\u0440\u0438\u043C\u0435\u0440 *.csv");
  for (const m of validateFeedMapping(c.mapping)) errors.push(`mapping.${m}`);
  const num = (name, min, max) => {
    const v = c[name];
    if (v !== void 0 && (typeof v !== "number" || v < min || v > max))
      errors.push(`${name}: \u0447\u0438\u0441\u043B\u043E \u043E\u0442 ${min} \u0434\u043E ${max}`);
  };
  num("pollIntervalSec", 0, 86400);
  num("batchSize", 1, 1e3);
  num("timeoutMs", 1e3, 6e5);
  num("retries", 0, 20);
  num("maxFileMb", 0.1, 500);
  num("lookbackDays", 0, 3650);
  num("settleSec", 0, 3600);
  num("logMaxMb", 0.1, 1e3);
  return errors;
}
function resolveApiKey(config) {
  if (config.apiKey) return config.apiKey;
  const name = config.apiKeyEnv;
  const value = process.env[name];
  if (!value) throw new AgentError(`\u041F\u0435\u0440\u0435\u043C\u0435\u043D\u043D\u0430\u044F \u043E\u043A\u0440\u0443\u0436\u0435\u043D\u0438\u044F ${name} \u0441 \u043A\u043B\u044E\u0447\u043E\u043C \u0441\u0442\u0430\u043D\u0446\u0438\u0438 \u043D\u0435 \u0437\u0430\u0434\u0430\u043D\u0430`, 1);
  return value;
}
function emptyState(stationCode) {
  return {
    version: 1,
    stationCode,
    files: {},
    lastRunAt: null,
    lastOkAt: null,
    totals: { sent: 0, accepted: 0, rejected: 0 }
  };
}
function loadState(path, stationCode) {
  if (!existsSync(path)) return emptyState(stationCode);
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (parsed.version !== 1 || parsed.stationCode !== stationCode) return emptyState(stationCode);
    return { ...emptyState(stationCode), ...parsed, files: parsed.files ?? {} };
  } catch {
    return emptyState(stationCode);
  }
}
function saveState(path, state) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, path);
}
function listFiles(dir, pattern, recursive, maxBytes) {
  const out = [];
  const entries = readdirSync(dir, { withFileTypes: true, recursive });
  for (const entry of entries) {
    if (!entry.isFile() || !pattern.test(entry.name)) continue;
    const parent = entry.parentPath ?? entry.path ?? dir;
    const full = join(parent, entry.name);
    const st = statSync(full);
    if (st.size > maxBytes) continue;
    out.push({
      key: relative(dir, full).split(sep).join("/"),
      path: full,
      mtime: st.mtimeMs,
      size: st.size
    });
  }
  return out.sort((a, b) => a.mtime - b.mtime || a.key.localeCompare(b.key));
}
function headSignature(text) {
  const first = text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
  return first.length > 512 ? `${first.slice(0, 512)}#${first.length}` : first;
}
function decode(buffer, encoding) {
  return new TextDecoder((encoding ?? "utf-8").trim().toLowerCase()).decode(buffer);
}
function selectNewRecords(records, prev, size, head) {
  if (!prev || prev.head !== head || size < prev.size) return { records, mode: "all" };
  const fresh = records.filter((r) => r.row > prev.lastRow);
  return { records: fresh, mode: fresh.length ? "append" : "none" };
}
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function sendBatch(records, opts) {
  const doFetch = opts.fetchImpl ?? fetch;
  const wait = opts.sleepImpl ?? sleep;
  const body = JSON.stringify(records.map(({ row: _row, ...rec }) => rec));
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await doFetch(opts.url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${opts.apiKey}`,
          "content-type": "application/json",
          "user-agent": opts.agent
        },
        body,
        signal: AbortSignal.timeout(opts.timeoutMs)
      });
    } catch (error) {
      if (attempt >= opts.retries)
        throw new AgentError(`\u041F\u043E\u0440\u0442\u0430\u043B \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D: ${error.message}`, 3);
      const delay = Math.min(6e4, 2e3 * 2 ** attempt);
      opts.logger.log("warn", "\u0441\u0435\u0442\u044C: \u043F\u043E\u0432\u0442\u043E\u0440 \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u0438", {
        attempt: attempt + 1,
        delayMs: delay,
        error: error.message
      });
      await wait(delay);
      continue;
    }
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    if (res.status === 401 || res.status === 403) {
      throw new AgentError(
        `\u041F\u043E\u0440\u0442\u0430\u043B \u043E\u0442\u043A\u043B\u043E\u043D\u0438\u043B \u043A\u043B\u044E\u0447 \u0441\u0442\u0430\u043D\u0446\u0438\u0438 (${res.status} ${json?.error ?? ""}): \u043F\u0440\u043E\u0432\u0435\u0440\u044C\u0442\u0435 stationCode \u0438 apiKey`,
        2
      );
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= opts.retries)
        throw new AgentError(`\u041F\u043E\u0440\u0442\u0430\u043B \u043E\u0442\u0432\u0435\u0447\u0430\u0435\u0442 ${res.status} \u043F\u043E\u0441\u043B\u0435 ${attempt + 1} \u043F\u043E\u043F\u044B\u0442\u043E\u043A`, 3);
      const retryAfter = Number(res.headers.get("retry-after"));
      const delay = res.status === 429 && Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(12e4, retryAfter * 1e3) : Math.min(6e4, 2e3 * 2 ** attempt);
      opts.logger.log("warn", `\u043F\u043E\u0440\u0442\u0430\u043B: ${res.status}, \u043F\u043E\u0432\u0442\u043E\u0440`, {
        attempt: attempt + 1,
        delayMs: delay
      });
      await wait(delay);
      continue;
    }
    if (res.status === 413 && records.length > 1) {
      const half = Math.ceil(records.length / 2);
      opts.logger.log("warn", "\u043F\u0430\u043A\u0435\u0442 \u0441\u043B\u0438\u0448\u043A\u043E\u043C \u0431\u043E\u043B\u044C\u0448\u043E\u0439: \u0434\u0435\u043B\u0438\u043C \u043F\u043E\u043F\u043E\u043B\u0430\u043C", { size: records.length });
      const a = await sendBatch(records.slice(0, half), opts);
      const b = await sendBatch(records.slice(half), opts);
      return {
        accepted: a.accepted + b.accepted,
        rejected: a.rejected + b.rejected,
        errors: [...a.errors, ...b.errors]
      };
    }
    if (res.status === 200 || res.status === 422) {
      const errors = (json?.errors ?? []).map((e) => ({
        row: records[e.index]?.row,
        message: e.message
      }));
      return { accepted: json?.accepted ?? 0, rejected: json?.rejected ?? records.length, errors };
    }
    opts.logger.log("error", `\u043F\u043E\u0440\u0442\u0430\u043B \u043E\u0442\u043A\u043B\u043E\u043D\u0438\u043B \u043F\u0430\u043A\u0435\u0442: ${res.status}`, {
      error: json?.error ?? text.slice(0, 300),
      message: json?.message
    });
    return {
      accepted: 0,
      rejected: records.length,
      errors: [{ row: void 0, message: `http:${res.status}` }]
    };
  }
}
function resolvePath(base, value) {
  return resolve(base, value);
}
function groupErrors(errors) {
  const groups = /* @__PURE__ */ new Map();
  for (const e of errors) {
    const kind = e.message.split(":")[0] ?? e.message;
    const key = e.message.length > 60 ? kind : e.message;
    const rows = groups.get(key) ?? [];
    if (e.row !== void 0 && rows.length < 10) rows.push(e.row);
    groups.set(key, rows);
  }
  return Object.fromEntries(
    [...groups.entries()].map(([k, rows]) => [k, rows.length ? `\u0441\u0442\u0440\u043E\u043A\u0438 ${rows.join(",")}` : ""])
  );
}
async function runOnce(opts) {
  const { config, logger, state } = opts;
  const now = (opts.now ?? (() => /* @__PURE__ */ new Date()))();
  const watchDir = resolvePath(opts.configDir, config.watchDir);
  if (!existsSync(watchDir)) throw new AgentError(`\u041F\u0430\u043F\u043A\u0430 \u044D\u043A\u0441\u043F\u043E\u0440\u0442\u0430 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430: ${watchDir}`, 1);
  const maxBytes = Math.round((config.maxFileMb ?? 20) * 1024 * 1024);
  const settleMs = (config.settleSec ?? 5) * 1e3;
  const lookbackMs = (config.lookbackDays ?? 7) * 864e5;
  const firstRun = Object.keys(state.files).length === 0;
  const files = listFiles(
    watchDir,
    filePatternToRegExp(config.filePattern ?? "*.csv"),
    config.recursive ?? false,
    maxBytes
  ).filter((f) => {
    if (settleMs > 0 && now.getTime() - f.mtime < settleMs) return false;
    if (firstRun && lookbackMs > 0 && now.getTime() - f.mtime > lookbackMs) return false;
    const prev = state.files[f.key];
    return !prev || prev.mtime !== f.mtime || prev.size !== f.size;
  });
  const summary = { files: 0, sent: 0, accepted: 0, rejected: 0 };
  const apiKey = opts.dryRun ? "dry-run" : resolveApiKey(config);
  const url = `${config.portalUrl.replace(/\/+$/, "")}/api/v1/ingest/${encodeURIComponent(config.stationCode)}`;
  const agent = `meteo-station-agent/${AGENT_VERSION} (${config.stationCode}; node ${process.version})`;
  const batchSize = Math.min(1e3, Math.max(1, config.batchSize ?? 500));
  for (const file of files) {
    const text = decode(readFileSync(file.path), config.mapping.encoding);
    const head = headSignature(text);
    const parsed = parseStationFeed(text, config.mapping, { now });
    const prev = state.files[file.key];
    const selection = selectNewRecords(parsed.records, prev, file.size, head);
    if (parsed.errors.length) {
      logger.log("warn", `\u0440\u0430\u0437\u0431\u043E\u0440 ${file.key}: \u043E\u0448\u0438\u0431\u043A\u0438 \u0432 \u0441\u0442\u0440\u043E\u043A\u0430\u0445`, {
        errors: parsed.errors.length,
        sample: parsed.errors.slice(0, 5)
      });
    }
    logger.log(selection.records.length ? "info" : "debug", `\u0444\u0430\u0439\u043B ${file.key}`, {
      rows: parsed.total,
      records: parsed.records.length,
      toSend: selection.records.length,
      mode: selection.mode
    });
    summary.files += 1;
    let accepted = 0;
    let rejected = 0;
    const errors = [];
    if (opts.dryRun) {
      if (selection.records.length) {
        logger.log("info", "dry-run: \u043F\u0435\u0440\u0432\u044B\u0435 \u0437\u0430\u043F\u0438\u0441\u0438", {
          records: selection.records.slice(0, 5)
        });
      }
      continue;
    }
    const ordered = [...selection.records].sort((a, b) => a.row - b.row);
    for (let i = 0; i < ordered.length; i += batchSize) {
      const batch = ordered.slice(i, i + batchSize);
      const result = await sendBatch(batch, {
        url,
        apiKey,
        timeoutMs: config.timeoutMs ?? 3e4,
        retries: config.retries ?? 5,
        agent,
        logger,
        fetchImpl: opts.fetchImpl,
        sleepImpl: opts.sleepImpl
      });
      accepted += result.accepted;
      rejected += result.rejected;
      errors.push(...result.errors);
      summary.sent += batch.length;
      const lastRow = batch[batch.length - 1]?.row ?? prev?.lastRow ?? 0;
      state.files[file.key] = {
        mtime: file.mtime,
        size: file.size,
        head,
        lastRow: Math.max(lastRow, selection.mode === "append" ? prev?.lastRow ?? 0 : 0),
        lastSentAt: now.toISOString(),
        accepted: (selection.mode === "append" ? prev?.accepted ?? 0 : 0) + accepted,
        rejected: (selection.mode === "append" ? prev?.rejected ?? 0 : 0) + rejected
      };
      state.totals.sent += batch.length;
      state.totals.accepted += result.accepted;
      state.totals.rejected += result.rejected;
      saveState(resolvePath(opts.configDir, config.stateFile ?? "station-agent.state.json"), state);
    }
    if (ordered.length === 0) {
      state.files[file.key] = {
        mtime: file.mtime,
        size: file.size,
        head,
        lastRow: prev?.lastRow ?? 0,
        lastSentAt: prev?.lastSentAt ?? now.toISOString(),
        accepted: prev?.accepted ?? 0,
        rejected: prev?.rejected ?? 0
      };
    }
    summary.accepted += accepted;
    summary.rejected += rejected;
    if (ordered.length) {
      logger.log(rejected ? "warn" : "info", `\u043E\u0442\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u043E ${file.key}`, {
        sent: ordered.length,
        accepted,
        rejected,
        ...errors.length ? { reasons: groupErrors(errors) } : {}
      });
    }
  }
  state.lastRunAt = now.toISOString();
  state.lastOkAt = now.toISOString();
  if (!opts.dryRun)
    saveState(resolvePath(opts.configDir, config.stateFile ?? "station-agent.state.json"), state);
  return summary;
}
var HELP = `\u0410\u0433\u0435\u043D\u0442 \u0441\u0442\u0430\u043D\u0446\u0438\u0438 \u041C\u0435\u0442\u0435\u043E\u043F\u043E\u0440\u0442\u0430\u043B\u0430 ${AGENT_VERSION}
  node station-agent.mjs --config config.json [\u043F\u0430\u0440\u0430\u043C\u0435\u0442\u0440\u044B]
    --config, -c  \u043F\u0443\u0442\u044C \u043A \u043A\u043E\u043D\u0444\u0438\u0433\u0443 (\u043F\u043E \u0443\u043C\u043E\u043B\u0447\u0430\u043D\u0438\u044E ./config.json)
    --once        \u043E\u0434\u0438\u043D \u043F\u0440\u043E\u0445\u043E\u0434 \u0438 \u0432\u044B\u0445\u043E\u0434 (\u0434\u043B\u044F \u041F\u043B\u0430\u043D\u0438\u0440\u043E\u0432\u0449\u0438\u043A\u0430 Windows / cron)
    --dry-run     \u0440\u0430\u0437\u043E\u0431\u0440\u0430\u0442\u044C \u0444\u0430\u0439\u043B\u044B \u0438 \u043F\u043E\u043A\u0430\u0437\u0430\u0442\u044C, \u0447\u0442\u043E \u0431\u044B\u043B\u043E \u0431\u044B \u043E\u0442\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u043E, \u043D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u0441\u043B\u0430\u0442\u044C
    --check       \u043F\u0440\u043E\u0432\u0435\u0440\u0438\u0442\u044C \u043A\u043E\u043D\u0444\u0438\u0433, \u043F\u0430\u043F\u043A\u0443 \u0438 \u0444\u043E\u0440\u043C\u0430\u0442 \u0441\u0430\u043C\u043E\u0433\u043E \u0441\u0432\u0435\u0436\u0435\u0433\u043E \u0444\u0430\u0439\u043B\u0430
    --verbose     \u043F\u043E\u0434\u0440\u043E\u0431\u043D\u044B\u0439 \u043B\u043E\u0433
    --help, -h    \u044D\u0442\u0430 \u0441\u043F\u0440\u0430\u0432\u043A\u0430
  \u041A\u043E\u0434\u044B \u0432\u044B\u0445\u043E\u0434\u0430: 0 \u2014 \u0443\u0441\u043F\u0435\u0445, 1 \u2014 \u043E\u0448\u0438\u0431\u043A\u0430 \u043A\u043E\u043D\u0444\u0438\u0433\u0430/\u043F\u0430\u043F\u043A\u0438, 2 \u2014 \u043A\u043B\u044E\u0447 \u0441\u0442\u0430\u043D\u0446\u0438\u0438 \u043E\u0442\u043A\u043B\u043E\u043D\u0451\u043D, 3 \u2014 \u043F\u043E\u0440\u0442\u0430\u043B \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D.`;
async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      config: { type: "string", short: "c", default: "config.json" },
      once: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      check: { type: "boolean", default: false },
      verbose: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false }
    },
    strict: true
  });
  if (values.help) {
    console.info(HELP);
    return 0;
  }
  const { config, dir } = loadConfig(resolve(values.config));
  const logger = new Logger(
    config.logFile ? resolve(dir, config.logFile) : null,
    Math.round((config.logMaxMb ?? 5) * 1024 * 1024),
    values.verbose || config.verbose ? "debug" : "info"
  );
  const statePath = resolve(dir, config.stateFile ?? "station-agent.state.json");
  const state = loadState(statePath, config.stationCode);
  if (values.check) {
    const watchDir = resolve(dir, config.watchDir);
    if (!existsSync(watchDir)) throw new AgentError(`\u041F\u0430\u043F\u043A\u0430 \u044D\u043A\u0441\u043F\u043E\u0440\u0442\u0430 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430: ${watchDir}`, 1);
    const files = listFiles(
      watchDir,
      filePatternToRegExp(config.filePattern ?? "*.csv"),
      config.recursive ?? false,
      Math.round((config.maxFileMb ?? 20) * 1024 * 1024)
    );
    logger.log("info", "\u043A\u043E\u043D\u0444\u0438\u0433 \u0432 \u043F\u043E\u0440\u044F\u0434\u043A\u0435", {
      portal: config.portalUrl,
      station: config.stationCode,
      watchDir,
      files: files.length,
      journal: Object.keys(state.files).length
    });
    const newest = files[files.length - 1];
    if (newest) {
      const parsed = parseStationFeed(
        decode(readFileSync(newest.path), config.mapping.encoding),
        config.mapping
      );
      logger.log(parsed.errors.length ? "warn" : "info", `\u0441\u0432\u0435\u0436\u0438\u0439 \u0444\u0430\u0439\u043B ${newest.key}`, {
        rows: parsed.total,
        records: parsed.records.length,
        errors: parsed.errors.slice(0, 10),
        sample: parsed.records.slice(0, 3),
        period: [parsed.from, parsed.to]
      });
      return parsed.records.length > 0 ? 0 : 1;
    }
    logger.log("warn", "\u0432 \u043F\u0430\u043F\u043A\u0435 \u043D\u0435\u0442 \u0444\u0430\u0439\u043B\u043E\u0432 \u043F\u043E \u043C\u0430\u0441\u043A\u0435");
    return 0;
  }
  const once = values.once || (config.pollIntervalSec ?? 60) <= 0 || values["dry-run"];
  const run = () => runOnce({ config, configDir: dir, state, logger, dryRun: values["dry-run"] });
  if (once) {
    const summary = await run();
    logger.log("info", values["dry-run"] ? "dry-run \u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043D" : "\u043F\u0440\u043E\u0445\u043E\u0434 \u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043D", { ...summary });
    return 0;
  }
  let stopping = false;
  const stop = (signal) => {
    logger.log("info", `\u043F\u043E\u043B\u0443\u0447\u0435\u043D ${signal}, \u0437\u0430\u0432\u0435\u0440\u0448\u0430\u044E \u043F\u043E\u0441\u043B\u0435 \u0442\u0435\u043A\u0443\u0449\u0435\u0433\u043E \u043F\u0440\u043E\u0445\u043E\u0434\u0430`);
    stopping = true;
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
  logger.log("info", `\u0430\u0433\u0435\u043D\u0442 \u0437\u0430\u043F\u0443\u0449\u0435\u043D (\u043E\u043F\u0440\u043E\u0441 \u043A\u0430\u0436\u0434\u044B\u0435 ${config.pollIntervalSec ?? 60} \u0441)`, {
    station: config.stationCode,
    portal: config.portalUrl
  });
  while (!stopping) {
    try {
      const summary = await run();
      if (summary.sent) logger.log("info", "\u043F\u0440\u043E\u0445\u043E\u0434 \u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043D", { ...summary });
    } catch (error) {
      const exit = error instanceof AgentError ? error.exitCode : 3;
      logger.log("error", error.message, { exitCode: exit });
      if (exit === 1) return exit;
    }
    const interval = (config.pollIntervalSec ?? 60) * 1e3;
    for (let waited = 0; waited < interval && !stopping; waited += 1e3) await sleep(1e3);
  }
  logger.log("info", "\u0430\u0433\u0435\u043D\u0442 \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D");
  return 0;
}
var isEntry = (() => {
  try {
    return process.argv[1] !== void 0 && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (isEntry || process.env.METEO_AGENT_MAIN === "1") {
  main().then((code) => process.exit(code)).catch((error) => {
    const exit = error instanceof AgentError ? error.exitCode : 3;
    console.error(`${(/* @__PURE__ */ new Date()).toISOString()} ERROR ${error.message}`);
    process.exit(exit);
  });
}
export {
  AGENT_VERSION,
  AgentError,
  Logger,
  decode,
  listFiles,
  loadConfig,
  loadState,
  resolveApiKey,
  runOnce,
  saveState,
  selectNewRecords,
  sendBatch,
  validateConfig
};
