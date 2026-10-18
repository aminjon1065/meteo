/**
 * Минимальный читатель XLSX (SpreadsheetML в ZIP) для импорта исторических данных: без внешних
 * зависимостей — ZIP (store/deflate через node:zlib), общие строки, инлайн‑строки, числа, булевы,
 * даты (по стилю ячейки → ISO‑строка без зоны). Формулы берутся по закэшированному значению.
 * Не поддерживает: зашифрованные книги, внешние ссылки, объединённые ячейки как значения.
 * Экспортируется только как `@meteo/core/xlsx` (использует node:zlib — не для клиентского кода).
 */
import { inflateRawSync } from "node:zlib";
import { XMLParser } from "fast-xml-parser";

export type XlsxCell = string | number | boolean | null;

export interface XlsxSheet {
  name: string;
  /** Строки по порядку листа; пустые строки в середине сохраняются как []; ячейки — по индексу колонки. */
  rows: XlsxCell[][];
}

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
}

function readZipEntries(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // End of central directory: сигнатура 0x06054b50, ищем с конца (комментарий ≤ 64 КБ).
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65_536); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("xlsx: не найден каталог ZIP (файл повреждён или не XLSX)");
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries = new Map<string, ZipEntry>();
  const decoder = new TextDecoder("utf-8");
  for (let n = 0; n < count; n += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("xlsx: повреждён каталог ZIP");
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
    entries.set(name, { name, method, compressedSize, localHeaderOffset });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readZipFile(bytes: Uint8Array, entry: ZipEntry): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const o = entry.localHeaderOffset;
  if (view.getUint32(o, true) !== 0x04034b50)
    throw new Error(`xlsx: повреждена запись ${entry.name}`);
  const nameLen = view.getUint16(o + 26, true);
  const extraLen = view.getUint16(o + 28, true);
  const start = o + 30 + nameLen + extraLen;
  const data = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return new Uint8Array(inflateRawSync(data));
  throw new Error(`xlsx: неподдерживаемый метод сжатия ${entry.method} (${entry.name})`);
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  isArray: (name) =>
    ["row", "c", "si", "r", "sheet", "Relationship", "xf", "numFmt"].includes(name),
});

type XmlNode = Record<string, unknown>;

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(node: unknown): string {
  if (node === undefined || node === null) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number" || typeof node === "boolean") return String(node);
  if (typeof node === "object") {
    const n = node as XmlNode;
    if ("#text" in n) return textOf(n["#text"]);
    // <t xml:space="preserve"> или вложенные <r><t>…</t></r>
    if ("t" in n) return asArray(n.t).map(textOf).join("");
    if ("r" in n) return asArray(n.r).map(textOf).join("");
  }
  return "";
}

/** Номер колонки по адресу ячейки: A → 0, Z → 25, AA → 26. */
export function columnIndex(ref: string): number {
  let col = 0;
  for (const ch of ref) {
    if (ch < "A" || ch > "Z") break;
    col = col * 26 + (ch.charCodeAt(0) - 64);
  }
  return col - 1;
}

/** Серийная дата Excel (система 1900) → Date в UTC; дробная часть — время суток. */
export function excelSerialToDate(serial: number): Date {
  const epoch = Date.UTC(1899, 11, 30);
  return new Date(Math.round(epoch + serial * 86_400_000));
}

/** ISO без зоны ("2026-01-05T07:00:00"), секунды округляются — так значение не зависит от часового пояса машины. */
export function excelSerialToIsoLocal(serial: number): string {
  const d = excelSerialToDate(serial);
  return d.toISOString().replace(/\.\d{3}Z$/, "");
}

const BUILTIN_DATE_FORMATS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57,
]);

function isDateFormatCode(code: string): boolean {
  const stripped = code
    .replace(/\[[^\]]*\]/g, "")
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "");
  return /[dmyhs]/i.test(stripped) && !/[#0?]/.test(stripped);
}

function dateStyles(stylesXml: string | null): Set<number> {
  const out = new Set<number>();
  if (!stylesXml) return out;
  const doc = parser.parse(stylesXml) as XmlNode;
  const styleSheet = (doc.styleSheet ?? {}) as XmlNode;
  const custom = new Map<number, string>();
  for (const f of asArray(
    ((styleSheet.numFmts ?? {}) as XmlNode).numFmt as XmlNode[] | undefined,
  )) {
    custom.set(Number(f["@_numFmtId"]), String(f["@_formatCode"] ?? ""));
  }
  const xfs = asArray(((styleSheet.cellXfs ?? {}) as XmlNode).xf as XmlNode[] | undefined);
  xfs.forEach((xf, index) => {
    const id = Number(xf["@_numFmtId"] ?? 0);
    const code = custom.get(id);
    if (BUILTIN_DATE_FORMATS.has(id) || (code !== undefined && isDateFormatCode(code)))
      out.add(index);
  });
  return out;
}

export interface ReadXlsxOptions {
  /** Имя или индекс листа (с 0); по умолчанию первый лист. */
  sheet?: string | number;
}

export function listXlsxSheets(bytes: Uint8Array): string[] {
  const entries = readZipEntries(bytes);
  const workbook = entries.get("xl/workbook.xml");
  if (!workbook) throw new Error("xlsx: нет xl/workbook.xml");
  const doc = parser.parse(new TextDecoder().decode(readZipFile(bytes, workbook))) as XmlNode;
  const sheets = asArray(
    ((doc.workbook as XmlNode)?.sheets as XmlNode)?.sheet as XmlNode[] | undefined,
  );
  return sheets.map((s) => String(s["@_name"] ?? ""));
}

export function readXlsxSheet(bytes: Uint8Array, options: ReadXlsxOptions = {}): XlsxSheet {
  const entries = readZipEntries(bytes);
  const text = (name: string): string | null => {
    const e = entries.get(name);
    return e ? new TextDecoder().decode(readZipFile(bytes, e)) : null;
  };
  const workbookXml = text("xl/workbook.xml");
  if (!workbookXml) throw new Error("xlsx: нет xl/workbook.xml");
  const workbook = parser.parse(workbookXml) as XmlNode;
  const sheets = asArray(
    ((workbook.workbook as XmlNode)?.sheets as XmlNode)?.sheet as XmlNode[] | undefined,
  );
  if (sheets.length === 0) throw new Error("xlsx: в книге нет листов");
  const wanted =
    typeof options.sheet === "number"
      ? sheets[options.sheet]
      : options.sheet
        ? sheets.find((s) => String(s["@_name"]) === options.sheet)
        : sheets[0];
  if (!wanted) throw new Error(`xlsx: лист ${String(options.sheet)} не найден`);
  const relId = String(wanted["@_r:id"] ?? "");
  const rels = text("xl/_rels/workbook.xml.rels");
  let target: string | null = null;
  if (rels && relId) {
    const relDoc = parser.parse(rels) as XmlNode;
    const list = asArray(
      ((relDoc.Relationships ?? {}) as XmlNode).Relationship as XmlNode[] | undefined,
    );
    const rel = list.find((r) => String(r["@_Id"]) === relId);
    if (rel) {
      const t = String(rel["@_Target"] ?? "");
      target = t.startsWith("/") ? t.slice(1) : `xl/${t.replace(/^\.\//, "")}`;
    }
  }
  const sheetXml =
    (target ? text(target) : null) ?? text(`xl/worksheets/sheet${sheets.indexOf(wanted) + 1}.xml`);
  if (!sheetXml) throw new Error("xlsx: не найден XML листа");

  const shared: string[] = [];
  const sst = text("xl/sharedStrings.xml");
  if (sst) {
    const doc = parser.parse(sst) as XmlNode;
    for (const si of asArray(((doc.sst ?? {}) as XmlNode).si as XmlNode[] | undefined))
      shared.push(textOf(si));
  }
  const dateStyleSet = dateStyles(text("xl/styles.xml"));

  const sheetDoc = parser.parse(sheetXml) as XmlNode;
  const sheetData = ((sheetDoc.worksheet as XmlNode)?.sheetData ?? {}) as XmlNode;
  const rows: XlsxCell[][] = [];
  for (const row of asArray(sheetData.row as XmlNode[] | undefined)) {
    const rowIndex = Number(row["@_r"] ?? rows.length + 1) - 1;
    while (rows.length < rowIndex) rows.push([]);
    const cells: XlsxCell[] = [];
    let autoCol = 0;
    for (const c of asArray(row.c as XmlNode[] | undefined)) {
      const ref = String(c["@_r"] ?? "");
      const col = ref ? columnIndex(ref) : autoCol;
      autoCol = col + 1;
      while (cells.length < col) cells.push(null);
      cells[col] = cellValue(c, shared, dateStyleSet);
    }
    rows[rowIndex] = cells;
  }
  return { name: String(wanted["@_name"] ?? ""), rows };
}

function cellValue(c: XmlNode, shared: string[], dateStyleSet: Set<number>): XlsxCell {
  const type = String(c["@_t"] ?? "n");
  const raw = c.v === undefined ? "" : textOf(c.v);
  switch (type) {
    case "s":
      return shared[Number(raw)] ?? "";
    case "inlineStr":
      return textOf(c.is);
    case "str":
      return raw;
    case "b":
      return raw === "1";
    case "e":
      return null;
    default: {
      if (raw === "") return null;
      const num = Number(raw);
      if (!Number.isFinite(num)) return raw;
      const style = Number(c["@_s"] ?? -1);
      return dateStyleSet.has(style) ? excelSerialToIsoLocal(num) : num;
    }
  }
}
