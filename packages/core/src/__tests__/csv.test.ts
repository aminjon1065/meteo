import { describe, expect, it } from "vitest";
import { detectDelimiter, parseCsv, parseCsvRecords } from "../csv";

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
