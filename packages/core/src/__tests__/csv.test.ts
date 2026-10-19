import { describe, expect, it } from "vitest";
import { csvCell, detectDelimiter, parseCsv, parseCsvRecords } from "../csv";

describe("parseCsvRecords", () => {
  it("кавычки, экранированные кавычки, разделители и переводы строк внутри полей", () => {
    const text = 'a;"b;c";"he said ""hi""";"multi\nline"\r\n1;2;3;4\n';
    expect(parseCsvRecords(text, ";")).toEqual([
      ["a", "b;c", 'he said "hi"', "multi\nline"],
      ["1", "2", "3", "4"],
    ]);
  });
  it("последняя строка без перевода строки и BOM", () => {
    expect(parseCsvRecords("﻿x,y\n1,2", ",")).toEqual([
      ["x", "y"],
      ["1", "2"],
    ]);
  });
});

describe("detectDelimiter / parseCsv", () => {
  it("определяет ; , и табуляцию", () => {
    expect(detectDelimiter("Дата;Пост;PM2.5")).toBe(";");
    expect(detectDelimiter("date,station,value")).toBe(",");
    expect(detectDelimiter("date\tstation\tvalue")).toBe("\t");
  });
  it("возвращает заголовок, выравнивает строки и пропускает титульные строки", () => {
    const table = parseCsv(
      "Отчёт за 2024 год\n\nДата;Пост;PM10\n01.01.2024 07:00;DU-01;45,2\n02.01.2024 07:00;DU-01\n",
      {
        skipRows: 2,
      },
    );
    expect(table.delimiter).toBe(";");
    expect(table.header).toEqual(["Дата", "Пост", "PM10"]);
    expect(table.rows).toEqual([
      ["01.01.2024 07:00", "DU-01", "45,2"],
      ["02.01.2024 07:00", "DU-01", ""],
    ]);
  });
});

describe("csvCell", () => {
  it("экранирует кавычки, разделители и переводы строк", () => {
    expect(csvCell('a "b"')).toBe('"a ""b"""');
    expect(csvCell("x,y")).toBe('"x,y"');
    expect(csvCell("x;y")).toBe('"x;y"');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    expect(csvCell("plain")).toBe("plain");
  });
  it("нейтрализует формулы Excel/Calc, не трогая числа", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("+cmd|' /C calc'!A0")).toBe("'+cmd|' /C calc'!A0");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("-DU-01")).toBe("'-DU-01");
    expect(csvCell("\tcalc")).toBe("'\tcalc");
    expect(csvCell("-5.5")).toBe("-5.5");
    expect(csvCell("+12")).toBe("+12");
    expect(csvCell(-3)).toBe("-3");
    expect(csvCell(Number.NaN)).toBe("");
    expect(csvCell(null)).toBe("");
  });
});
