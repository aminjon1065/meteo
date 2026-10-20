import { describe, expect, it } from "vitest";
import { cell, type DocModel, paragraph } from "../bulletin-doc";
import { crc32, DOCX_MIME, docxFromModel, unzip, zip } from "../docx";

const doc: DocModel = {
  lang: "ru",
  title: "Тест & <документ>",
  fileName: "test",
  blocks: [
    paragraph("Заголовок", { align: "center", bold: true, size: 14 }),
    paragraph(
      [{ text: "Обычный " }, { text: "жирный", bold: true }, { text: " курсив", italic: true }],
      {
        align: "justify",
        indent: true,
      },
    ),
    {
      type: "table",
      widths: [50, 25, 25],
      headerRows: 2,
      rows: [
        [cell("Примесь", { rowSpan: 2 }), cell("Группа", { colSpan: 2 })],
        [cell("", { merged: true }), cell("а"), cell("б")],
        [cell("PM10 <5>", { align: "left" }), cell("0,079"), cell("1,32")],
      ],
    },
    { type: "spacer", height: 8 },
    paragraph("Подпись", { align: "right" }),
  ],
};

describe("zip", () => {
  it("crc32 и обратимость", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    const files = [
      { name: "a.txt", data: new TextEncoder().encode("hello") },
      { name: "dir/б.xml", data: new TextEncoder().encode("<x/>".repeat(100)) },
    ];
    const bytes = zip(files);
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    const back = unzip(bytes);
    expect(new TextDecoder().decode(back.get("a.txt"))).toBe("hello");
    expect(new TextDecoder().decode(back.get("dir/б.xml"))).toBe("<x/>".repeat(100));
  });
});

describe("docx", () => {
  const bytes = docxFromModel(doc, { created: new Date("2026-10-20T00:00:00Z") });
  const parts = unzip(bytes);
  const xml = new TextDecoder().decode(parts.get("word/document.xml"));

  it("пакет содержит обязательные части, первая — [Content_Types].xml", () => {
    expect([...parts.keys()][0]).toBe("[Content_Types].xml");
    for (const name of [
      "_rels/.rels",
      "word/document.xml",
      "word/styles.xml",
      "word/_rels/document.xml.rels",
      "docProps/core.xml",
    ])
      expect(parts.has(name)).toBe(true);
    expect(DOCX_MIME).toContain("wordprocessingml");
  });

  it("абзацы: выравнивание, красная строка, форматирование, экранирование", () => {
    expect(xml).toContain('<w:jc w:val="center"/>');
    expect(xml).toContain('<w:ind w:firstLine="709"/>');
    expect(xml).toContain("<w:b/><w:bCs/>");
    expect(xml).toContain("<w:i/><w:iCs/>");
    expect(xml).toContain('<w:sz w:val="28"/>');
    expect(xml).toContain("PM10 &lt;5&gt;");
    expect(xml).toContain('<w:lang w:val="ru-RU"/>');
  });

  it("таблица: сетка по процентам, gridSpan/vMerge, повторяемая шапка, границы", () => {
    const widths = [...xml.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].map((m) => Number(m[1]));
    expect(widths).toHaveLength(3);
    expect(Math.abs((widths[0] ?? 0) - (widths[1] ?? 0) * 2)).toBeLessThanOrEqual(1);
    expect(widths.reduce((a, b) => a + b, 0)).toBe(11906 - 850 - 1418);
    expect(xml).toContain('<w:gridSpan w:val="2"/>');
    expect(xml).toContain('<w:vMerge w:val="restart"/>');
    expect(xml).toContain("<w:vMerge/>");
    expect((xml.match(/<w:tblHeader\/>/g) ?? []).length).toBe(2);
    expect(xml).toContain('<w:insideH w:val="single"');
    expect(xml).toContain('<w:pgSz w:w="11906" w:h="16838"/>');
  });

  it("свойства: заголовок экранирован, шрифт Times New Roman по умолчанию, детерминированный вывод", () => {
    expect(new TextDecoder().decode(parts.get("docProps/core.xml"))).toContain(
      "Тест &amp; &lt;документ&gt;",
    );
    expect(new TextDecoder().decode(parts.get("word/styles.xml"))).toContain(
      'w:ascii="Times New Roman"',
    );
    const again = docxFromModel(doc, { created: new Date("2026-10-20T00:00:00Z") });
    expect(Buffer.from(again).equals(Buffer.from(bytes))).toBe(true);
  });
});
