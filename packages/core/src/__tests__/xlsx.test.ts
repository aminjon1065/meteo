import { crc32, deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { columnIndex, excelSerialToIsoLocal, listXlsxSheets, readXlsxSheet } from "../xlsx";

/** Минимальный ZIP-писатель (store или deflate) для сборки тестовой книги XLSX. */
function zip(files: Array<{ name: string; data: string; deflate?: boolean }>): Uint8Array {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const raw = Buffer.from(f.data, "utf8");
    const data = f.deflate ? deflateRawSync(raw) : raw;
    const name = Buffer.from(f.name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(f.deflate ? 8 : 0, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    chunks.push(local, name, data);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(f.deflate ? 8 : 0, 10);
    cd.writeUInt32LE(crc32(raw), 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);
    offset += local.length + name.length + data.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...chunks, cdBuf, eocd]));
}

function workbook(deflate: boolean): Uint8Array {
  return zip([
    {
      name: "xl/workbook.xml",
      deflate,
      data: `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Данные" sheetId="1" r:id="rId1"/><sheet name="Справка" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      deflate,
      data: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="x" Target="worksheets/sheet2.xml"/><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>`,
    },
    {
      name: "xl/sharedStrings.xml",
      deflate,
      data: `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="4" uniqueCount="4"><si><t>Дата</t></si><si><t>Пост</t></si><si><r><t>PM</t></r><r><t xml:space="preserve">2.5</t></r></si><si><t>DU-01</t></si></sst>`,
    },
    {
      name: "xl/styles.xml",
      deflate,
      data: `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd.mm.yyyy\\ hh:mm"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="4"/></cellXfs></styleSheet>`,
    },
    {
      name: "xl/worksheets/sheet1.xml",
      deflate,
      data: `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row><row r="2"><c r="A2" s="1"><v>45292.291666666664</v></c><c r="B2" t="s"><v>3</v></c><c r="C2" s="2"><v>45.2</v></c></row><row r="4"><c r="A4" t="inlineStr"><is><t>02.01.2024 07:00</t></is></c><c r="B4" t="str"><f>B2</f><v>DU-01</v></c><c r="C4" t="e"><v>#N/A</v></c><c r="D4" t="b"><v>1</v></c></row></sheetData></worksheet>`,
    },
    {
      name: "xl/worksheets/sheet2.xml",
      deflate,
      data: `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><v>42</v></c></row></sheetData></worksheet>`,
    },
  ]);
}

describe("readXlsxSheet", () => {
  for (const deflate of [false, true]) {
    it(`читает книгу (${deflate ? "deflate" : "store"}): общие и инлайн-строки, даты по стилю, пропуски, ошибки`, () => {
      const bytes = workbook(deflate);
      expect(listXlsxSheets(bytes)).toEqual(["Данные", "Справка"]);
      const sheet = readXlsxSheet(bytes);
      expect(sheet.name).toBe("Данные");
      expect(sheet.rows[0]).toEqual(["Дата", "Пост", "PM2.5"]);
      expect(sheet.rows[1]).toEqual(["2024-01-01T07:00:00", "DU-01", 45.2]);
      expect(sheet.rows[2]).toEqual([]);
      expect(sheet.rows[3]).toEqual(["02.01.2024 07:00", "DU-01", null, true]);
      expect(readXlsxSheet(bytes, { sheet: "Справка" }).rows[0]).toEqual([42]);
      expect(readXlsxSheet(bytes, { sheet: 1 }).name).toBe("Справка");
      expect(() => readXlsxSheet(bytes, { sheet: "Нет" })).toThrow(/не найден/);
    });
  }
  it("отклоняет не-ZIP данные", () => {
    expect(() => readXlsxSheet(new Uint8Array([1, 2, 3, 4]))).toThrow(/ZIP/);
  });
});

describe("helpers", () => {
  it("columnIndex и серийные даты", () => {
    expect(columnIndex("A1")).toBe(0);
    expect(columnIndex("Z9")).toBe(25);
    expect(columnIndex("AA10")).toBe(26);
    expect(excelSerialToIsoLocal(45292.5)).toBe("2024-01-01T12:00:00");
    expect(excelSerialToIsoLocal(1)).toBe("1899-12-31T00:00:00");
  });
});
