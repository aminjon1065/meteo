/**
 * Минимальный рендерер Markdown для новостей CMS и e-mail рассылок.
 * Без зависимостей и без I/O. Всё, что не распознано как разметка, экранируется;
 * сырой HTML не пропускается. Один разбор в AST и два рендера: безопасный HTML
 * (`renderMarkdown`) и простой текст для text/plain части писем (`markdownToText`).
 *
 * Поддерживается: ATX‑заголовки, абзацы, жёсткие переносы, **жирный**, *курсив*,
 * `код`, ~~зачёркнутый~~, ссылки, изображения, автоссылки, списки (один уровень
 * вложенности по отступу 2+ пробела), цитаты, огороженный код, горизонтальная линия.
 */

type Inline =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | { type: "br" }
  | { type: "em" | "strong" | "del"; children: Inline[] }
  | { type: "link"; url: string | null; title: string | null; children: Inline[] }
  | { type: "image"; url: string; title: string | null; alt: string };

type Block =
  | { type: "heading"; level: number; children: Inline[] }
  | { type: "paragraph"; children: Inline[] }
  | { type: "code"; lang: string | null; text: string }
  | { type: "quote"; children: Block[] }
  | { type: "list"; ordered: boolean; start: number; items: Block[][] }
  | { type: "hr" };

/* ------------------------------------------------------------------ */
/* Утилиты                                                             */
/* ------------------------------------------------------------------ */

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

/** ASCII‑пунктуация, которую можно экранировать обратным слэшем. */
const PUNCT = /[!-/:-@[-`{-~]/;

function unescapeMd(s: string): string {
  return s.replace(/\\([!-/:-@[-`{-~])/g, "$1");
}

function isSpace(ch: string): boolean {
  return ch !== "" && /\s/.test(ch);
}

function isAlnum(ch: string): boolean {
  return ch !== "" && /[\p{L}\p{N}]/u.test(ch);
}

/** Длина серии одинаковых символов `ch`, начиная с позиции `i`. */
function runLength(src: string, i: number, ch: string): number {
  let n = 0;
  while (src.charAt(i + n) === ch) n++;
  return n;
}

/** Позиция ближайшей серии из ровно `n` символов `ch` (для закрытия code span) или -1. */
function findExactRun(src: string, from: number, ch: string, n: number): number {
  let j = from;
  while (j < src.length) {
    if (src.charAt(j) === ch) {
      const r = runLength(src, j, ch);
      if (r === n) return j;
      j += r;
    } else {
      j++;
    }
  }
  return -1;
}

/** Если в позиции `i` начинается code span — индекс сразу за ним, иначе -1. */
function codeSpanEnd(src: string, i: number): number {
  const run = runLength(src, i, "`");
  if (run === 0) return -1;
  const close = findExactRun(src, i + run, "`", run);
  return close < 0 ? -1 : close + run;
}

/**
 * Белый список URL: http(s), mailto и относительные пути (/, #, ./, ../).
 * Управляющие символы удаляются до проверки, чтобы `java\tscript:` не прошёл.
 * Протокольно‑относительные `//host` и `/\host` не считаются относительными путями.
 */
function sanitizeUrl(raw: string): string | null {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: намеренно вычищаем управляющие символы
  const url = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (url === "") return null;
  if (/^(https?|mailto):/i.test(url)) return url;
  if (/^(\/(?![/\\])|#|\.\.?\/)/.test(url)) return url;
  return null;
}

function isExternal(url: string): boolean {
  return /^https?:/i.test(url);
}

/* ------------------------------------------------------------------ */
/* Строчная разметка                                                   */
/* ------------------------------------------------------------------ */

const AUTOLINK = /^<((?:https?|mailto):[^\s<>]*)>/i;
const EMAIL_AUTOLINK = /^<([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)>/;

interface LinkSyntax {
  text: string;
  url: string;
  title: string | null;
  /** Индекс сразу за закрывающей скобкой. */
  end: number;
}

/** Разбор `[text](url "title")`, `start` указывает на `[`. */
function parseLinkSyntax(src: string, start: number): LinkSyntax | null {
  let depth = 0;
  let j = start;
  while (j < src.length) {
    const c = src.charAt(j);
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (c === "`") {
      const e = codeSpanEnd(src, j);
      j = e < 0 ? j + runLength(src, j, "`") : e;
      continue;
    }
    if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) break;
    }
    j++;
  }
  if (j >= src.length || src.charAt(j + 1) !== "(") return null;
  const text = src.slice(start + 1, j);
  let k = j + 2;
  while (isSpace(src.charAt(k))) k++;

  let url: string;
  if (src.charAt(k) === "<") {
    const close = src.indexOf(">", k + 1);
    if (close < 0) return null;
    url = src.slice(k + 1, close);
    if (/[\n<]/.test(url)) return null;
    k = close + 1;
  } else {
    const s = k;
    let parens = 0;
    while (k < src.length) {
      const c = src.charAt(k);
      if (c === "\\") {
        k += 2;
        continue;
      }
      if (isSpace(c)) break;
      if (c === "(") parens++;
      else if (c === ")") {
        if (parens === 0) break;
        parens--;
      }
      k++;
    }
    url = src.slice(s, k);
  }
  while (isSpace(src.charAt(k))) k++;

  let title: string | null = null;
  const q = src.charAt(k);
  if (q === '"' || q === "'" || q === "(") {
    const closeQ = q === "(" ? ")" : q;
    let e = k + 1;
    while (e < src.length && src.charAt(e) !== closeQ) {
      if (src.charAt(e) === "\\") e++;
      e++;
    }
    if (e >= src.length) return null;
    title = unescapeMd(src.slice(k + 1, e));
    k = e + 1;
    while (isSpace(src.charAt(k))) k++;
  }
  if (src.charAt(k) !== ")") return null;
  return { text, url: unescapeMd(url), title, end: k + 1 };
}

/** Поиск закрывающей серии разделителя выделения (`*`, `_`, `~`) длиной не меньше `n`. */
function findCloser(
  src: string,
  from: number,
  ch: string,
  n: number,
): { index: number; run: number } | null {
  let j = from;
  while (j < src.length) {
    const c = src.charAt(j);
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (c === "`") {
      const e = codeSpanEnd(src, j);
      j = e < 0 ? j + runLength(src, j, "`") : e;
      continue;
    }
    if (c !== ch) {
      j++;
      continue;
    }
    const r = runLength(src, j, ch);
    const prev = src.charAt(j - 1);
    const next = src.charAt(j + r);
    // одиночный `*` не закрывается серией `**` — это, скорее всего, вложенный strong
    const fits = r >= n && (n === 2 || r % 2 === 1);
    if (j > from && fits && !isSpace(prev) && !(ch === "_" && isAlnum(next))) {
      return { index: j, run: r };
    }
    j += r;
  }
  return null;
}

function parseEmphasis(
  src: string,
  i: number,
  ch: string,
  inLink: boolean,
): { node: Inline; end: number } | null {
  const run = runLength(src, i, ch);
  if (ch === "~" && run < 2) return null;
  const n = ch === "~" ? 2 : run >= 2 ? 2 : 1;
  const after = src.charAt(i + run);
  if (after === "" || isSpace(after)) return null;
  if (ch === "_" && isAlnum(src.charAt(i - 1))) return null;

  const wrap = (kind: "em" | "strong" | "del", a: number, b: number): Inline => ({
    type: kind,
    children: parseInline(src.slice(a, b), inLink),
  });

  // ***текст*** → <em><strong>текст</strong></em>
  if (ch !== "~" && run === 3) {
    const closer = findCloser(src, i + 3, ch, 3);
    if (closer && closer.run === 3) {
      const strong = wrap("strong", i + 3, closer.index);
      return { node: { type: "em", children: [strong] }, end: closer.index + 3 };
    }
  }
  const closer = findCloser(src, i + run, ch, n);
  if (!closer) return null;
  const kind = ch === "~" ? "del" : n === 2 ? "strong" : "em";
  return { node: wrap(kind, i + n, closer.index), end: closer.index + n };
}

/** Нормализация содержимого code span: переводы строк → пробелы, обрамляющий пробел снимается. */
function normalizeCodeSpan(s: string): string {
  const v = s.replace(/\n/g, " ");
  if (v.length >= 2 && v.startsWith(" ") && v.endsWith(" ") && v.trim() !== "") {
    return v.slice(1, -1);
  }
  return v;
}

function parseInline(src: string, inLink = false): Inline[] {
  const nodes: Inline[] = [];
  let text = "";
  // длина `text` сразу после последнего экранированного символа (чтобы `\\` в конце строки не стал переносом)
  let escapedAt = -1;
  const flush = (): void => {
    if (text !== "") nodes.push({ type: "text", value: text });
    text = "";
    escapedAt = -1;
  };

  let i = 0;
  while (i < src.length) {
    const ch = src.charAt(i);

    if (ch === "\\") {
      const next = src.charAt(i + 1);
      if (next !== "" && PUNCT.test(next)) {
        text += next;
        escapedAt = text.length;
        i += 2;
        continue;
      }
    }

    if (ch === "\n") {
      let hard = false;
      if (/ {2,}$/.test(text)) {
        hard = true;
      } else if (text.endsWith("\\") && escapedAt !== text.length) {
        hard = true;
        text = text.slice(0, -1);
      }
      text = text.replace(/[ \t]+$/, "");
      flush();
      nodes.push(hard ? { type: "br" } : { type: "text", value: "\n" });
      i++;
      while (src.charAt(i) === " " || src.charAt(i) === "\t") i++;
      continue;
    }

    if (ch === "`") {
      const run = runLength(src, i, "`");
      const close = findExactRun(src, i + run, "`", run);
      if (close >= 0) {
        flush();
        nodes.push({ type: "code", value: normalizeCodeSpan(src.slice(i + run, close)) });
        i = close + run;
      } else {
        text += "`".repeat(run);
        i += run;
      }
      continue;
    }

    if (ch === "!" && src.charAt(i + 1) === "[") {
      const link = parseLinkSyntax(src, i + 1);
      if (link) {
        flush();
        const url = sanitizeUrl(link.url);
        // небезопасный src — изображение просто пропускается
        if (url) {
          const alt = inlinesToText(parseInline(link.text, true));
          nodes.push({ type: "image", url, title: link.title, alt });
        }
        i = link.end;
        continue;
      }
    }

    if (ch === "[" && !inLink) {
      const link = parseLinkSyntax(src, i);
      if (link) {
        flush();
        nodes.push({
          type: "link",
          url: sanitizeUrl(link.url),
          title: link.title,
          children: parseInline(link.text, true),
        });
        i = link.end;
        continue;
      }
    }

    if (ch === "<" && !inLink) {
      const rest = src.slice(i);
      const m = AUTOLINK.exec(rest);
      const e = m ? null : EMAIL_AUTOLINK.exec(rest);
      const raw = m?.[1] ?? e?.[1];
      const full = m?.[0] ?? e?.[0];
      if (raw !== undefined && full !== undefined) {
        flush();
        const url = sanitizeUrl(m ? raw : `mailto:${raw}`);
        nodes.push({ type: "link", url, title: null, children: [{ type: "text", value: raw }] });
        i += full.length;
        continue;
      }
    }

    if (ch === "*" || ch === "_" || ch === "~") {
      const em = parseEmphasis(src, i, ch, inLink);
      if (em) {
        flush();
        nodes.push(em.node);
        i = em.end;
        continue;
      }
      const run = runLength(src, i, ch);
      text += ch.repeat(run);
      i += run;
      continue;
    }

    text += ch;
    i++;
  }
  flush();
  return nodes;
}

/* ------------------------------------------------------------------ */
/* Блочная разметка                                                    */
/* ------------------------------------------------------------------ */

const RE_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const RE_HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const RE_FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const RE_FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const RE_QUOTE = /^ {0,3}>/;
const RE_ITEM = /^( *)([-+*]|\d{1,9}\.)(?:([ \t]+)(.*))?$/;

interface ItemStart {
  indent: number;
  marker: string;
  ordered: boolean;
  number: number;
  /** Отступ содержимого пункта (маркер + пробелы после него). */
  contentIndent: number;
  text: string;
}

function parseItemStart(line: string): ItemStart | null {
  const m = RE_ITEM.exec(line);
  if (!m) return null;
  const indent = (m[1] ?? "").length;
  const marker = m[2] ?? "";
  const spaces = m[3] ?? " ";
  const text = m[4] ?? "";
  const ordered = /\d/.test(marker);
  return {
    indent,
    marker,
    ordered,
    number: ordered ? Number.parseInt(marker, 10) : 1,
    contentIndent: indent + marker.length + Math.min(spaces.length, 4),
    text,
  };
}

function leadingSpaces(line: string): number {
  return runLength(line, 0, " ");
}

function isBlank(line: string): boolean {
  return line.trim() === "";
}

function isFenceOpen(line: string): boolean {
  const m = RE_FENCE_OPEN.exec(line);
  return m !== null && !((m[2] ?? "").startsWith("`") && (m[3] ?? "").includes("`"));
}

/** Строка, способная прервать абзац (список — только непустой пункт, нумерованный — только с 1). */
function interruptsParagraph(line: string): boolean {
  if (RE_HEADING.test(line) || RE_HR.test(line) || RE_QUOTE.test(line) || isFenceOpen(line)) {
    return true;
  }
  const item = parseItemStart(line);
  return item !== null && !isBlank(item.text) && (!item.ordered || item.number === 1);
}

function parseList(
  lines: string[],
  from: number,
  first: ItemStart,
): { block: Block; next: number } {
  const items: Block[][] = [];
  const sameList = (s: ItemStart, cur: ItemStart): boolean =>
    s.ordered === first.ordered &&
    (first.ordered || s.marker === first.marker) &&
    s.indent < cur.indent + 2;

  let cur = first;
  let i = from;
  for (;;) {
    const nested = Math.min(cur.contentIndent, cur.indent + 2);
    const itemLines: string[] = [cur.text];
    let j = i + 1;
    let nextItem: ItemStart | null = null;
    while (j < lines.length) {
      const line = lines[j] ?? "";
      if (isBlank(line)) {
        let k = j;
        while (k < lines.length && isBlank(lines[k] ?? "")) k++;
        if (k >= lines.length) {
          j = k;
          break;
        }
        const after = lines[k] ?? "";
        if (leadingSpaces(after) >= nested) {
          for (; j < k; j++) itemLines.push("");
          continue;
        }
        const s = parseItemStart(after);
        if (s && sameList(s, cur)) nextItem = s;
        j = k;
        break;
      }
      const indent = leadingSpaces(line);
      if (indent >= nested) {
        itemLines.push(line.slice(Math.min(indent, cur.contentIndent)));
        j++;
        continue;
      }
      const s = parseItemStart(line);
      if (s && sameList(s, cur)) {
        nextItem = s;
        break;
      }
      if (interruptsParagraph(line)) break;
      // ленивое продолжение абзаца пункта
      itemLines.push(line.trim());
      j++;
    }
    items.push(parseBlocks(itemLines));
    i = j;
    if (!nextItem) break;
    cur = nextItem;
  }
  return { block: { type: "list", ordered: first.ordered, start: first.number, items }, next: i };
}

function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (isBlank(line)) {
      i++;
      continue;
    }

    const fence = RE_FENCE_OPEN.exec(line);
    if (fence && isFenceOpen(line)) {
      const indent = (fence[1] ?? "").length;
      const open = fence[2] ?? "";
      const info = (fence[3] ?? "").trim();
      const lang = info.split(/\s+/)[0] ?? "";
      const body: string[] = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const l = lines[j] ?? "";
        const close = RE_FENCE_CLOSE.exec(l);
        const closeRun = close?.[1] ?? "";
        if (closeRun.startsWith(open.charAt(0)) && closeRun.length >= open.length) break;
        body.push(l.slice(Math.min(leadingSpaces(l), indent)));
      }
      blocks.push({
        type: "code",
        lang: /^[A-Za-z0-9_+#.-]+$/.test(lang) ? lang : null,
        text: body.join("\n"),
      });
      i = j + 1;
      continue;
    }

    const heading = RE_HEADING.exec(line);
    if (heading) {
      blocks.push({
        type: "heading",
        level: (heading[1] ?? "#").length,
        children: parseInline((heading[2] ?? "").trim()),
      });
      i++;
      continue;
    }

    if (RE_HR.test(line)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    if (RE_QUOTE.test(line)) {
      const inner: string[] = [];
      let j = i;
      while (j < lines.length) {
        const l = lines[j] ?? "";
        if (RE_QUOTE.test(l)) {
          inner.push(l.replace(/^ {0,3}> ?/, ""));
        } else if (
          !isBlank(l) &&
          !interruptsParagraph(l) &&
          !isBlank(inner[inner.length - 1] ?? "")
        ) {
          inner.push(l); // ленивое продолжение абзаца цитаты
        } else {
          break;
        }
        j++;
      }
      blocks.push({ type: "quote", children: parseBlocks(inner) });
      i = j;
      continue;
    }

    const item = parseItemStart(line);
    if (item) {
      const { block, next } = parseList(lines, i, item);
      blocks.push(block);
      i = next;
      continue;
    }

    const para: string[] = [line.trimStart()];
    let j = i + 1;
    while (j < lines.length) {
      const l = lines[j] ?? "";
      if (isBlank(l) || interruptsParagraph(l)) break;
      para.push(l.trimStart());
      j++;
    }
    blocks.push({ type: "paragraph", children: parseInline(para.join("\n").trimEnd()) });
    i = j;
  }
  return blocks;
}

function toLines(src: string): string[] {
  return src
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/^\t+/, (t) => "    ".repeat(t.length)));
}

/* ------------------------------------------------------------------ */
/* Рендер в HTML                                                       */
/* ------------------------------------------------------------------ */

function renderInlines(nodes: Inline[]): string {
  let out = "";
  for (const n of nodes) {
    switch (n.type) {
      case "text":
        out += escapeHtml(n.value);
        break;
      case "code":
        out += `<code>${escapeHtml(n.value)}</code>`;
        break;
      case "br":
        out += "<br>";
        break;
      case "em":
      case "strong":
      case "del":
        out += `<${n.type}>${renderInlines(n.children)}</${n.type}>`;
        break;
      case "link": {
        const inner = renderInlines(n.children);
        if (n.url === null) {
          out += inner; // небезопасный URL — остаётся только текст
          break;
        }
        const title = n.title !== null ? ` title="${escapeHtml(n.title)}"` : "";
        const ext = isExternal(n.url) ? ' target="_blank" rel="noopener noreferrer"' : "";
        out += `<a href="${escapeHtml(n.url)}"${title}${ext}>${inner}</a>`;
        break;
      }
      case "image": {
        const title = n.title !== null ? ` title="${escapeHtml(n.title)}"` : "";
        out += `<img src="${escapeHtml(n.url)}" alt="${escapeHtml(n.alt)}"${title}>`;
        break;
      }
    }
  }
  return out;
}

function renderBlock(b: Block): string {
  switch (b.type) {
    case "heading": {
      const tag = `h${Math.min(b.level + 1, 6)}`;
      return `<${tag}>${renderInlines(b.children)}</${tag}>`;
    }
    case "paragraph":
      return `<p>${renderInlines(b.children)}</p>`;
    case "code": {
      const cls = b.lang !== null ? ` class="language-${escapeHtml(b.lang)}"` : "";
      return `<pre><code${cls}>${escapeHtml(b.text)}</code></pre>`;
    }
    case "quote":
      return `<blockquote>${renderBlocks(b.children)}</blockquote>`;
    case "hr":
      return "<hr>";
    case "list": {
      const tag = b.ordered ? "ol" : "ul";
      const start = b.ordered && b.start !== 1 ? ` start="${b.start}"` : "";
      const items = b.items
        .map((item) => {
          const inner = item
            .map((x, idx) =>
              x.type === "paragraph" && idx === 0 ? renderInlines(x.children) : renderBlock(x),
            )
            .join("");
          return `<li>${inner}</li>`;
        })
        .join("");
      return `<${tag}${start}>${items}</${tag}>`;
    }
  }
}

function renderBlocks(blocks: Block[]): string {
  return blocks.map(renderBlock).join("");
}

/* ------------------------------------------------------------------ */
/* Рендер в простой текст                                              */
/* ------------------------------------------------------------------ */

function inlinesToText(nodes: Inline[]): string {
  let out = "";
  for (const n of nodes) {
    switch (n.type) {
      case "text":
      case "code":
        out += n.value;
        break;
      case "br":
        out += "\n";
        break;
      case "em":
      case "strong":
      case "del":
        out += inlinesToText(n.children);
        break;
      case "link": {
        const t = inlinesToText(n.children);
        const u = n.url;
        out += u === null || u === t || u === `mailto:${t}` ? t : `${t} (${u})`;
        break;
      }
      case "image":
        out += n.alt;
        break;
    }
  }
  return out;
}

function blockToText(b: Block): string {
  switch (b.type) {
    case "heading":
    case "paragraph":
      return inlinesToText(b.children);
    case "code":
      return b.text;
    case "quote":
      return blocksToText(b.children, "\n\n");
    case "hr":
      return "";
    case "list":
      return b.items
        .map((item, idx) => {
          const marker = b.ordered ? `${b.start + idx}. ` : "- ";
          return blocksToText(item, "\n")
            .split("\n")
            .map((l, li) => (li === 0 ? marker + l : l === "" ? "" : `  ${l}`))
            .join("\n");
        })
        .join("\n");
  }
}

function blocksToText(blocks: Block[], sep: string): string {
  return blocks
    .map(blockToText)
    .filter((s) => s !== "")
    .join(sep);
}

/* ------------------------------------------------------------------ */
/* Публичный API                                                       */
/* ------------------------------------------------------------------ */

/** Markdown → безопасный компактный HTML (без ведущих/замыкающих пробелов, без сырого HTML). */
export function renderMarkdown(src: string): string {
  return renderBlocks(parseBlocks(toLines(src))).trim();
}

/**
 * Markdown → простой текст для text/plain части писем и выдержек: разметка снимается,
 * URL ссылок остаётся в скобках после текста, пункты списков — на отдельных строках,
 * пустые строки схлопываются до одной.
 */
export function markdownToText(src: string): string {
  return blocksToText(parseBlocks(toLines(src)), "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Выдержка: первые абзацы текста (заголовки пропускаются), пока они целиком помещаются
 * в `max` символов; если не помещается даже первый — обрезка по границе слова с «…».
 */
export function markdownExcerpt(src: string, max = 200): string {
  const chunks = parseBlocks(toLines(src))
    .filter((b) => b.type !== "heading")
    .map((b) => blockToText(b).replace(/\s+/g, " ").trim())
    .filter((s) => s !== "");
  let out = "";
  for (const chunk of chunks) {
    const candidate = out === "" ? chunk : `${out} ${chunk}`;
    if (candidate.length <= max) {
      out = candidate;
      continue;
    }
    if (out === "") return cutAtWord(chunk, max);
    break;
  }
  return out;
}

function cutAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, Math.max(max - 1, 0));
  const sp = head.lastIndexOf(" ");
  const base = (sp > 0 ? head.slice(0, sp) : head).replace(/[\s,;:—–-]+$/, "");
  return `${base}…`;
}
