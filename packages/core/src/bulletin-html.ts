/**
 * HTML‑рендер документа бюллетеня: фрагмент для предпросмотра в админке и на портале
 * (класс `eco-doc`, стили прилагаются отдельно) и самостоятельная страница для печати / PDF (A4).
 * Весь текст экранируется; скрипт добавляется только в режиме автоматической печати.
 */
import type { DocAlign, DocBlock, DocModel, DocRun } from "./bulletin-doc";

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

const ALIGN_CLASS: Record<DocAlign, string> = { left: "l", center: "c", right: "r", justify: "j" };

function runHtml(run: DocRun): string {
  let html = esc(run.text);
  if (run.italic) html = `<em>${html}</em>`;
  if (run.bold) html = `<strong>${html}</strong>`;
  if (run.size) html = `<span style="font-size:${run.size}pt">${html}</span>`;
  return html;
}

function blockHtml(block: DocBlock): string {
  if (block.type === "spacer")
    return `<div class="sp" style="height:${block.height ?? 6}pt"></div>`;
  if (block.type === "paragraph") {
    const classes = [ALIGN_CLASS[block.align ?? "left"], block.indent ? "ind" : ""]
      .filter(Boolean)
      .join(" ");
    const style = [
      block.spaceBefore ? `margin-top:${block.spaceBefore}pt` : "",
      block.spaceAfter !== undefined ? `margin-bottom:${block.spaceAfter}pt` : "",
    ]
      .filter(Boolean)
      .join(";");
    return `<p class="${classes}"${style ? ` style="${style}"` : ""}>${block.runs.map(runHtml).join("") || "&nbsp;"}</p>`;
  }
  const cols = block.widths.map((w) => `<col style="width:${w}%">`).join("");
  const rows = block.rows
    .map((row, i) => {
      const tag = i < block.headerRows ? "th" : "td";
      const cells = row
        .filter((c) => !c.merged)
        .map((c) => {
          const attrs = [
            c.colSpan && c.colSpan > 1 ? ` colspan="${c.colSpan}"` : "",
            c.rowSpan && c.rowSpan > 1 ? ` rowspan="${c.rowSpan}"` : "",
            c.align ? ` class="${ALIGN_CLASS[c.align]}"` : "",
          ].join("");
          const text = c.bold && tag === "td" ? `<strong>${esc(c.text)}</strong>` : esc(c.text);
          return `<${tag}${attrs}>${text || "&nbsp;"}</${tag}>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  const style = block.fontSize ? ` style="font-size:${block.fontSize}pt"` : "";
  return `<table${style}><colgroup>${cols}</colgroup><tbody>${rows}</tbody></table>`;
}

/** Стили фрагмента (общие для предпросмотра и печатной страницы). */
export const ECO_DOC_CSS = `
.eco-doc{font-family:"Times New Roman",Times,serif;font-size:12pt;line-height:1.3;color:#000;background:#fff}
.eco-doc p{margin:0 0 3pt}
.eco-doc .l{text-align:left}.eco-doc .c{text-align:center}.eco-doc .r{text-align:right}.eco-doc .j{text-align:justify}
.eco-doc .ind{text-indent:1.25cm}
.eco-doc table{border-collapse:collapse;width:100%;margin:6pt 0;table-layout:fixed}
.eco-doc th,.eco-doc td{border:1px solid #000;padding:2pt 4pt;vertical-align:middle;text-align:center;overflow-wrap:anywhere}
.eco-doc th{font-weight:bold}
.eco-doc td.l,.eco-doc th.l{text-align:left}
`;

export interface RenderHtmlOptions {
  /** Полная страница (иначе — фрагмент <div class="eco-doc">). */
  standalone?: boolean;
  /** Вызвать печать при загрузке (запасной путь получения PDF без Chromium на сервере). */
  autoPrint?: boolean;
}

export function renderDocHtml(doc: DocModel, opts: RenderHtmlOptions = {}): string {
  const body = `<div class="eco-doc" lang="${doc.lang === "tg" ? "tg-Cyrl-TJ" : "ru"}">${doc.blocks.map(blockHtml).join("\n")}</div>`;
  if (!opts.standalone) return body;
  const print = opts.autoPrint
    ? `<script>window.addEventListener("load",function(){setTimeout(function(){window.print()},200)})</script>`
    : "";
  return `<!doctype html>
<html lang="${doc.lang === "tg" ? "tg-Cyrl-TJ" : "ru"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(doc.title)}</title>
<style>
@page{size:A4;margin:12mm 15mm 18mm 25mm}
html,body{margin:0;background:#e9ecef}
.page{max-width:210mm;margin:0 auto;background:#fff;padding:12mm 15mm 18mm 25mm;box-sizing:border-box;min-height:297mm}
@media print{html,body{background:#fff}.page{max-width:none;margin:0;padding:0;min-height:0}}
${ECO_DOC_CSS}
</style>
</head>
<body><div class="page">${body}</div>${print}</body>
</html>
`;
}
