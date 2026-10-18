/**
 * Разбор CSV (RFC 4180) без зависимостей: кавычки, экранированные кавычки, переводы строк внутри
 * полей, автоопределение разделителя (; , \t |) по строке заголовка. Используется скриптом импорта
 * исторических данных (packages/db/src/scripts/import-history.ts); web использует papaparse.
 */
export interface CsvParseOptions {
  /** Разделитель; без значения — автоопределение по первой строке. */
  delimiter?: string;
  /** Пропустить N строк перед заголовком (титульные строки экспорта). */
  skipRows?: number;
}

export interface CsvTable {
  delimiter: string;
  header: string[];
  /** Строки данных в порядке файла; длина выравнивается по заголовку. */
  rows: string[][];
}

const CANDIDATES = [";", ",", "\t", "|"];

/** Выбирает разделитель, дающий больше всего колонок в первой строке (с учётом кавычек). */
export function detectDelimiter(firstLine: string): string {
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

function splitLine(line: string, delimiter: string): string[] {
  return parseCsvRecords(line, delimiter)[0] ?? [];
}

/** Разбирает текст на записи; поля в кавычках могут содержать разделители и переводы строк. */
export function parseCsvRecords(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  while (i < src.length) {
    const ch = src[i] as string;
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

export function parseCsv(text: string, options: CsvParseOptions = {}): CsvTable {
  const normalized = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = normalized.split(/\r?\n/);
  const skip = Math.max(0, options.skipRows ?? 0);
  const body = lines.slice(skip).join("\n");
  const firstLine = lines.slice(skip).find((l) => l.trim().length > 0) ?? "";
  const delimiter = options.delimiter ?? detectDelimiter(firstLine);
  const records = parseCsvRecords(body, delimiter).filter((r) =>
    r.some((cell) => cell.trim().length > 0),
  );
  const header = (records[0] ?? []).map((h) => h.trim());
  const rows = records.slice(1).map((r) => {
    const out = r.slice(0, header.length);
    while (out.length < header.length) out.push("");
    return out;
  });
  return { delimiter, header, rows };
}
