/**
 * Минимальный генератор DOCX (WordprocessingML в ZIP) без внешних зависимостей: абзацы с
 * выравниванием, красной строкой и форматированием фрагментов, таблицы с фиксированными
 * колонками, объединением ячеек по горизонтали и вертикали, повторяемой шапкой. Страница A4,
 * шрифт Times New Roman — как в документах Агентства. ZIP пишется с deflate через node:zlib,
 * поэтому модуль экспортируется только как `@meteo/core/docx` (не для клиентского кода).
 */
import { deflateRawSync, inflateRawSync } from "node:zlib";
import type { DocAlign, DocBlock, DocCell, DocModel, DocRun } from "./bulletin-doc";

/* ------------------------------------------------------------------ ZIP */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = (CRC_TABLE[(crc ^ (bytes[i] as number)) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipInput {
  name: string;
  data: Uint8Array;
}

/** Фиксированная дата записей (2026-01-01 00:00): одинаковые входные данные → одинаковый файл. */
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

function u16(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff];
}
function u32(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}

/** ZIP с deflate для всех записей (имена в UTF‑8). */
export function zip(files: ZipInput[]): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: number[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.data);
    const compressed = new Uint8Array(deflateRawSync(file.data));
    const local = new Uint8Array([
      ...u32(0x04034b50),
      ...u16(20),
      ...u16(0x0800),
      ...u16(8),
      ...u16(DOS_TIME),
      ...u16(DOS_DATE),
      ...u32(crc),
      ...u32(compressed.length),
      ...u32(file.data.length),
      ...u16(name.length),
      ...u16(0),
      ...name,
    ]);
    parts.push(local, compressed);
    central.push(
      ...u32(0x02014b50),
      ...u16(20),
      ...u16(20),
      ...u16(0x0800),
      ...u16(8),
      ...u16(DOS_TIME),
      ...u16(DOS_DATE),
      ...u32(crc),
      ...u32(compressed.length),
      ...u32(file.data.length),
      ...u16(name.length),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(offset),
      ...name,
    );
    offset += local.length + compressed.length;
  }
  const centralBytes = new Uint8Array(central);
  const eocd = new Uint8Array([
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(files.length),
    ...u16(files.length),
    ...u32(centralBytes.length),
    ...u32(offset),
    ...u16(0),
  ]);
  const total = parts.reduce((s, p) => s + p.length, 0) + centralBytes.length + eocd.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of [...parts, centralBytes, eocd]) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

/** Чтение записей ZIP, созданного `zip()` (для тестов и проверки): имя → содержимое. */
export function unzip(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const out = new Map<string, Uint8Array>();
  let pos = 0;
  while (pos + 30 <= bytes.length && view.getUint32(pos, true) === 0x04034b50) {
    const method = view.getUint16(pos + 8, true);
    const csize = view.getUint32(pos + 18, true);
    const nameLen = view.getUint16(pos + 26, true);
    const extraLen = view.getUint16(pos + 28, true);
    const name = decoder.decode(bytes.subarray(pos + 30, pos + 30 + nameLen));
    const dataStart = pos + 30 + nameLen + extraLen;
    const raw = bytes.subarray(dataStart, dataStart + csize);
    out.set(name, method === 8 ? new Uint8Array(inflateRawSync(raw)) : new Uint8Array(raw));
    pos = dataStart + csize;
  }
  return out;
}

/* ------------------------------------------------------------------ WordprocessingML */

function xmlEsc(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
  );
}

export interface DocxOptions {
  font?: string;
  /** Базовый размер шрифта в пунктах. */
  fontSize?: number;
  /** Поля страницы A4 в твипах (1/20 пт): верх, право, низ, лево. */
  margins?: { top: number; right: number; bottom: number; left: number };
}

const PAGE_W = 11906;
const PAGE_H = 16838;
const DEFAULT_MARGINS = { top: 709, right: 850, bottom: 1134, left: 1418 };
const JC: Record<DocAlign, string> = {
  left: "left",
  center: "center",
  right: "right",
  justify: "both",
};

function runXml(run: DocRun, lang: string, baseSize: number): string {
  const size = (run.size ?? baseSize) * 2;
  const props = [
    run.bold ? "<w:b/><w:bCs/>" : "",
    run.italic ? "<w:i/><w:iCs/>" : "",
    `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`,
    `<w:lang w:val="${lang}"/>`,
  ].join("");
  return `<w:r><w:rPr>${props}</w:rPr><w:t xml:space="preserve">${xmlEsc(run.text)}</w:t></w:r>`;
}

function paragraphXml(
  runs: DocRun[],
  opts: {
    align?: DocAlign;
    indent?: boolean;
    spaceBefore?: number;
    spaceAfter?: number;
    inTable?: boolean;
  },
  lang: string,
  baseSize: number,
): string {
  const props = [
    `<w:spacing w:before="${Math.round((opts.spaceBefore ?? 0) * 20)}" w:after="${Math.round((opts.spaceAfter ?? (opts.inTable ? 0 : 3)) * 20)}" w:line="276" w:lineRule="auto"/>`,
    opts.indent ? '<w:ind w:firstLine="709"/>' : "",
    `<w:jc w:val="${JC[opts.align ?? "left"]}"/>`,
  ].join("");
  const body = runs.length > 0 ? runs.map((r) => runXml(r, lang, baseSize)).join("") : "";
  return `<w:p><w:pPr>${props}</w:pPr>${body}</w:p>`;
}

function cellXml(c: DocCell, width: number, isHeader: boolean, lang: string, size: number): string {
  const props = [
    `<w:tcW w:w="${width}" w:type="dxa"/>`,
    c.colSpan && c.colSpan > 1 ? `<w:gridSpan w:val="${c.colSpan}"/>` : "",
    c.rowSpan && c.rowSpan > 1 ? '<w:vMerge w:val="restart"/>' : c.merged ? "<w:vMerge/>" : "",
    '<w:vAlign w:val="center"/>',
  ].join("");
  const run: DocRun = { text: c.text, bold: Boolean(c.bold || isHeader), size };
  const p = paragraphXml(
    c.text ? [run] : [],
    { align: c.align ?? "center", inTable: true },
    lang,
    size,
  );
  return `<w:tc><w:tcPr>${props}</w:tcPr>${p}</w:tc>`;
}

function tableXml(
  block: Extract<DocBlock, { type: "table" }>,
  contentWidth: number,
  lang: string,
  baseSize: number,
): string {
  const size = block.fontSize ?? baseSize;
  const total = block.widths.reduce((s, w) => s + w, 0) || 100;
  const twips = block.widths.map((w) => Math.round((contentWidth * w) / total));
  // Остаток округления — последней колонке, чтобы сумма сетки совпадала с шириной таблицы.
  const rounding = contentWidth - twips.reduce((s, w) => s + w, 0);
  if (twips.length > 0) twips[twips.length - 1] = (twips[twips.length - 1] as number) + rounding;
  const grid = twips.map((w) => `<w:gridCol w:w="${w}"/>`).join("");
  const border =
    '<w:top w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:left w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:right w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="000000"/>';
  const rows = block.rows
    .map((row, i) => {
      let col = 0;
      const cells = row
        .map((c) => {
          const span = c.colSpan && c.colSpan > 1 ? c.colSpan : 1;
          const width = twips.slice(col, col + span).reduce((s, w) => s + w, 0);
          col += span;
          return cellXml(c, width, i < block.headerRows, lang, size);
        })
        .join("");
      const trPr = i < block.headerRows ? "<w:trPr><w:tblHeader/></w:trPr>" : "";
      return `<w:tr>${trPr}${cells}</w:tr>`;
    })
    .join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="${contentWidth}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>${border}</w:tblBorders><w:tblCellMar><w:left w:w="57" w:type="dxa"/><w:right w:w="57" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rows}</w:tbl>`;
}

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

export function documentXml(doc: DocModel, opts: DocxOptions = {}): string {
  const margins = opts.margins ?? DEFAULT_MARGINS;
  const baseSize = opts.fontSize ?? 12;
  const lang = doc.lang === "tg" ? "tg-Cyrl-TJ" : "ru-RU";
  const contentWidth = PAGE_W - margins.left - margins.right;
  const body = doc.blocks
    .map((block) => {
      if (block.type === "spacer")
        return paragraphXml([], { spaceAfter: 0, spaceBefore: block.height ?? 6 }, lang, baseSize);
      if (block.type === "paragraph") return paragraphXml(block.runs, block, lang, baseSize);
      return tableXml(block, contentWidth, lang, baseSize);
    })
    .join("");
  const sect = `<w:sectPr><w:pgSz w:w="${PAGE_W}" w:h="${PAGE_H}"/><w:pgMar w:top="${margins.top}" w:right="${margins.right}" w:bottom="${margins.bottom}" w:left="${margins.left}" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W_NS}><w:body>${body}${sect}</w:body></w:document>`;
}

function stylesXml(font: string, fontSize: number, lang: string): string {
  const size = fontSize * 2;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W_NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${xmlEsc(font)}" w:hAnsi="${xmlEsc(font)}" w:cs="${xmlEsc(font)}" w:eastAsia="${xmlEsc(font)}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/><w:lang w:val="${lang}" w:eastAsia="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

function corePropsXml(title: string, created: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEsc(title)}</dc:title><dc:creator>Метеопортал</dc:creator><cp:lastModifiedBy>Метеопортал</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified></cp:coreProperties>`;
}

const APP_PROPS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Meteoportal</Application></Properties>`;

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Собирает DOCX из модели документа. `created` — ISO‑время для свойств файла (по умолчанию сейчас). */
export function docxFromModel(
  doc: DocModel,
  opts: DocxOptions & { created?: Date } = {},
): Uint8Array {
  const encoder = new TextEncoder();
  const font = opts.font ?? "Times New Roman";
  const fontSize = opts.fontSize ?? 12;
  const lang = doc.lang === "tg" ? "tg-Cyrl-TJ" : "ru-RU";
  const created = (opts.created ?? new Date()).toISOString().replace(/\.\d{3}Z$/, "Z");
  return zip([
    { name: "[Content_Types].xml", data: encoder.encode(CONTENT_TYPES) },
    { name: "_rels/.rels", data: encoder.encode(ROOT_RELS) },
    { name: "word/document.xml", data: encoder.encode(documentXml(doc, { ...opts, fontSize })) },
    { name: "word/styles.xml", data: encoder.encode(stylesXml(font, fontSize, lang)) },
    { name: "word/_rels/document.xml.rels", data: encoder.encode(DOC_RELS) },
    { name: "docProps/core.xml", data: encoder.encode(corePropsXml(doc.title, created)) },
    { name: "docProps/app.xml", data: encoder.encode(APP_PROPS) },
  ]);
}
