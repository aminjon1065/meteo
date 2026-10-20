/**
 * Модель документа бюллетеня, общая для HTML (предпросмотр, печать) и DOCX.
 * Намеренно маленькая: абзацы с форматированными фрагментами и таблицы с объединением ячеек.
 */
import type { BulletinLang } from "./bulletin";

export type DocAlign = "left" | "center" | "right" | "justify";

export interface DocRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  /** Размер шрифта в пунктах (по умолчанию — базовый размер документа). */
  size?: number;
}

export interface DocParagraph {
  type: "paragraph";
  runs: DocRun[];
  align?: DocAlign;
  /** Красная строка. */
  indent?: boolean;
  /** Отступы до/после в пунктах. */
  spaceBefore?: number;
  spaceAfter?: number;
}

export interface DocCell {
  text: string;
  bold?: boolean;
  align?: DocAlign;
  colSpan?: number;
  /** Начало вертикального объединения на rowSpan строк. */
  rowSpan?: number;
  /** Продолжение вертикального объединения (в HTML не выводится, в DOCX — <w:vMerge/>). */
  merged?: boolean;
}

export interface DocTable {
  type: "table";
  /** Ширины колонок в процентах (сумма 100). */
  widths: number[];
  rows: DocCell[][];
  headerRows: number;
  /** Размер шрифта таблицы в пунктах. */
  fontSize?: number;
}

export interface DocSpacer {
  type: "spacer";
  /** Высота в пунктах. */
  height?: number;
}

export type DocBlock = DocParagraph | DocTable | DocSpacer;

export interface DocModel {
  lang: BulletinLang;
  /** Заголовок окна/файла. */
  title: string;
  /** Имя файла без расширения (латиница, цифры, дефис). */
  fileName: string;
  blocks: DocBlock[];
}

export function paragraph(
  text: string | DocRun[],
  opts: Omit<DocParagraph, "type" | "runs"> & {
    bold?: boolean;
    italic?: boolean;
    size?: number;
  } = {},
): DocParagraph {
  const { bold, italic, size, ...rest } = opts;
  const runs =
    typeof text === "string"
      ? [
          {
            text,
            ...(bold ? { bold } : {}),
            ...(italic ? { italic } : {}),
            ...(size ? { size } : {}),
          },
        ]
      : text;
  return { type: "paragraph", runs, ...rest };
}

export function cell(text: string, opts: Omit<DocCell, "text"> = {}): DocCell {
  return { text, ...opts };
}

/** Простой текст документа (для писем, выдержек и тестов). */
export function docToText(doc: DocModel): string {
  const lines: string[] = [];
  for (const block of doc.blocks) {
    if (block.type === "paragraph") {
      const text = block.runs.map((r) => r.text).join("");
      if (text.trim()) lines.push(text.trim());
    } else if (block.type === "table") {
      for (const row of block.rows) {
        lines.push(
          row
            .filter((c) => !c.merged)
            .map((c) => c.text)
            .join(" | "),
        );
      }
    }
  }
  return lines.join("\n");
}
