#!/usr/bin/env node
/**
 * Сборка документации из Markdown: HTML (всегда) и PDF (если доступен Chromium Playwright).
 *
 *   pnpm docs:build                 → docs/manuals/dist/
 *   node docs/manuals/build.mjs --no-pdf
 *
 * Что делает: рендерит все docs/**.md в dist с той же структурой (marked, GFM), добавляет
 * оглавление, переключатель языков для руководств (tg/ru/en) и runbook (ru/en), копирует
 * изображения, переписывает ссылки .md → .html, собирает dist/index.html. PDF печатается
 * из HTML через Chromium (@playwright/test в apps/web); без Chromium выводится инструкция:
 * открыть HTML в браузере и «Печать → Сохранить как PDF» (стили печати уже заданы).
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
import { headingsOf, uniqueSlugs } from "./slug.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const docsDir = resolve(here, "..");
const repoRoot = resolve(docsDir, "..");
const distDir = resolve(here, "dist");
const wantPdf = !process.argv.includes("--no-pdf");

/* ---------------------------------------------------------------- документы */
const LOCALE_NAMES = { tg: "Тоҷикӣ", ru: "Русский", en: "English" };
const UI = {
  tg: {
    toc: "Мундариҷа",
    languages: "Забон",
    printed: "Чоп",
    home: "Ҳуҷҷатҳо",
    print: "Чоп / PDF",
  },
  ru: {
    toc: "Содержание",
    languages: "Язык",
    printed: "Напечатано",
    home: "Документация",
    print: "Печать / PDF",
  },
  en: {
    toc: "Contents",
    languages: "Language",
    printed: "Printed",
    home: "Documentation",
    print: "Print / PDF",
  },
};

/** Группы документов с версиями на нескольких языках (для переключателя и индекса). */
const GROUPS = [
  {
    id: "admin",
    title: { tg: "Дастури маъмур", ru: "Руководство администратора", en: "Administrator guide" },
    files: { tg: "manuals/admin/tg.md", ru: "manuals/admin/ru.md", en: "manuals/admin/en.md" },
  },
  {
    id: "user",
    title: {
      tg: "Дастури корбари портал",
      ru: "Руководство пользователя портала",
      en: "Portal user guide",
    },
    files: { tg: "manuals/user/tg.md", ru: "manuals/user/ru.md", en: "manuals/user/en.md" },
  },
  {
    id: "runbook",
    title: { ru: "Runbook для IT-службы", en: "Runbook for the IT service" },
    files: { ru: "runbook.md", en: "runbook.en.md" },
  },
  {
    id: "training",
    title: { ru: "Материалы обучающей сессии" },
    files: { ru: "training/outline.md" },
  },
];
/** Что печатать в PDF: имя файла → документ. */
const PDF_SET = {
  "admin-tg.pdf": "manuals/admin/tg.md",
  "admin-ru.pdf": "manuals/admin/ru.md",
  "admin-en.pdf": "manuals/admin/en.md",
  "user-tg.pdf": "manuals/user/tg.md",
  "user-ru.pdf": "manuals/user/ru.md",
  "user-en.pdf": "manuals/user/en.md",
  "runbook-ru.pdf": "runbook.md",
  "runbook-en.pdf": "runbook.en.md",
  "training-ru.pdf": "training/outline.md",
};

function listMarkdown(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "dist" || entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listMarkdown(full));
    else if (entry.endsWith(".md")) out.push(full);
  }
  return out.sort();
}

function localeOf(rel) {
  for (const g of GROUPS) {
    for (const [locale, file] of Object.entries(g.files))
      if (file === rel) return { group: g, locale };
  }
  return { group: null, locale: "ru" };
}

const htmlPath = (rel) => rel.replace(/\.md$/, ".html");
const esc = (s) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/* ---------------------------------------------------------------- Markdown → HTML */
function render(markdown, { rel }) {
  const unique = uniqueSlugs();
  const headings = headingsOf(markdown);
  const renderer = {
    heading({ tokens, depth }) {
      const text = this.parser.parseInline(tokens);
      const id = unique(text.replace(/<[^>]+>/g, ""));
      return `<h${depth} id="${id}"><a class="anchor" href="#${id}">${text}</a></h${depth}>\n`;
    },
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      let target = href;
      if (!/^(https?:|mailto:|tel:|#)/i.test(href)) {
        target = href.replace(/\.md(#|$)/, ".html$1");
      }
      const ext = /^https?:/i.test(href) ? ' target="_blank" rel="noopener"' : "";
      return `<a href="${esc(target)}"${title ? ` title="${esc(title)}"` : ""}${ext}>${text}</a>`;
    },
    image({ href, title, text }) {
      return `<figure><img src="${esc(href)}" alt="${esc(text)}" loading="lazy">${
        title
          ? `<figcaption>${esc(title)}</figcaption>`
          : text
            ? `<figcaption>${esc(text)}</figcaption>`
            : ""
      }</figure>`;
    },
  };
  marked.use({ gfm: true, renderer });
  const body = marked.parse(markdown);
  const title = headings.find((h) => h.depth === 1)?.text ?? basename(rel, ".md");
  const toc = headings.filter((h) => h.depth === 2 || h.depth === 3);
  return { body, title, toc };
}

function tocHtml(toc, label) {
  if (toc.length === 0) return "";
  let html = `<nav class="toc" aria-label="${label}"><h2>${label}</h2><ol>`;
  let open3 = false;
  for (const h of toc) {
    if (h.depth === 2) {
      if (open3) {
        html += "</ol></li>";
        open3 = false;
      }
      html += `<li><a href="#${h.slug}">${esc(h.text)}</a>`;
    } else {
      if (!open3) {
        html += "<ol>";
        open3 = true;
      }
      html += `<li><a href="#${h.slug}">${esc(h.text)}</a></li>`;
    }
  }
  if (open3) html += "</ol>";
  html += "</li></ol></nav>";
  return html.replace("<li><a", "<li><a").replace("</nav>", "</nav>");
}

const CSS = `
:root { --fg: #1a1f2b; --muted: #5b6372; --line: #d9dee7; --bg: #fff; --accent: #0f5fa8; --code: #f3f5f8; }
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; font: 16px/1.55 -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif; color: var(--fg); background: var(--bg); }
.topbar { display: flex; flex-wrap: wrap; gap: 12px 20px; align-items: center; padding: 10px 24px; border-bottom: 1px solid var(--line); font-size: 14px; background: #f7f9fc; }
.topbar a { color: var(--accent); text-decoration: none; }
.topbar .lang a.current { font-weight: 600; text-decoration: underline; }
.topbar .spacer { flex: 1; }
.topbar button { font: inherit; padding: 4px 10px; border: 1px solid var(--line); background: #fff; border-radius: 6px; cursor: pointer; }
main { max-width: 920px; margin: 0 auto; padding: 24px 24px 64px; }
h1 { font-size: 2rem; line-height: 1.2; margin: 0 0 16px; }
h2 { font-size: 1.45rem; margin: 40px 0 12px; padding-top: 12px; border-top: 1px solid var(--line); }
h3 { font-size: 1.15rem; margin: 28px 0 8px; }
h4 { font-size: 1rem; margin: 20px 0 6px; }
h1 a.anchor, h2 a.anchor, h3 a.anchor, h4 a.anchor { color: inherit; text-decoration: none; }
p, ul, ol, table, pre, blockquote, figure { margin: 0 0 14px; }
li { margin: 3px 0; }
a { color: var(--accent); }
code { font: 0.9em ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: var(--code); padding: 1px 5px; border-radius: 4px; }
pre { background: var(--code); padding: 12px 14px; border-radius: 8px; overflow: auto; font-size: 0.85em; line-height: 1.45; }
pre code { background: none; padding: 0; }
table { border-collapse: collapse; width: 100%; font-size: 0.92em; }
th, td { border: 1px solid var(--line); padding: 6px 10px; vertical-align: top; text-align: left; }
th { background: #f3f5f8; }
blockquote { border-left: 4px solid var(--accent); margin-left: 0; padding: 4px 16px; color: var(--muted); background: #f7f9fc; }
figure { margin: 18px 0 22px; }
figure img { max-width: 100%; height: auto; border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
figcaption { font-size: 0.88em; color: var(--muted); margin-top: 6px; }
.toc { background: #f7f9fc; border: 1px solid var(--line); border-radius: 10px; padding: 14px 20px 14px 36px; margin: 20px 0 28px; font-size: 0.95em; }
.toc h2 { border: 0; margin: 0 0 8px; padding: 0; font-size: 1rem; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
.toc ol { margin: 0; padding-left: 20px; }
.toc a { text-decoration: none; }
.note { color: var(--muted); font-size: 0.9em; }
footer { max-width: 920px; margin: 0 auto; padding: 0 24px 40px; color: var(--muted); font-size: 0.85em; border-top: 1px solid var(--line); padding-top: 12px; }
@media print {
  @page { size: A4; margin: 16mm 14mm 18mm; }
  body { font-size: 11pt; }
  .topbar, .no-print { display: none !important; }
  main { max-width: none; padding: 0; }
  h1 { font-size: 22pt; }
  h2 { font-size: 15pt; break-after: avoid; page-break-after: avoid; }
  h3, h4 { break-after: avoid; page-break-after: avoid; }
  figure, table, pre { break-inside: avoid; page-break-inside: avoid; }
  figure img { box-shadow: none; max-height: 240mm; }
  a { color: inherit; text-decoration: none; }
  a[href^="http"]::after { content: " (" attr(href) ")"; font-size: 0.85em; color: var(--muted); }
  .toc a[href^="#"]::after { content: none; }
  .toc { break-after: page; page-break-after: always; }
}
`;

function page({ rel, title, body, toc, group, locale }) {
  const ui = UI[locale] ?? UI.ru;
  const depth = rel.split("/").length - 1;
  const up = depth ? "../".repeat(depth) : "./";
  let lang = "";
  if (group) {
    const links = Object.entries(group.files)
      .map(([l, f]) => {
        const href = up + htmlPath(f);
        const cls = l === locale ? ' class="current"' : "";
        return `<a href="${href}"${cls} lang="${l}">${LOCALE_NAMES[l]}</a>`;
      })
      .join(" · ");
    lang = `<span class="lang">${ui.languages}: ${links}</span>`;
  }
  const printed = new Date().toISOString().slice(0, 10);
  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
<div class="topbar no-print">
  <a href="${up}index.html">← ${ui.home}</a>
  ${lang}
  <span class="spacer"></span>
  <button type="button" onclick="window.print()">${ui.print}</button>
</div>
<main>
${tocHtml(toc, ui.toc)}
${body}
</main>
<footer>${esc(title)} · ${ui.printed} ${printed}</footer>
</body>
</html>
`;
}

/* ---------------------------------------------------------------- сборка */
rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

const built = [];
for (const file of listMarkdown(docsDir)) {
  const rel = relative(docsDir, file).split("\\").join("/");
  const md = readFileSync(file, "utf8");
  const { group, locale } = localeOf(rel);
  const { body, title, toc } = render(md, { rel });
  const out = resolve(distDir, htmlPath(rel));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, page({ rel, title, body, toc, group, locale }));
  built.push({ rel, title, out });
}

// Изображения руководств и прочие бинарные ресурсы рядом с документами.
const imgSrc = resolve(docsDir, "manuals/img");
if (existsSync(imgSrc)) cpSync(imgSrc, resolve(distDir, "manuals/img"), { recursive: true });

// Индекс: группы документов на трёх языках + остальные документы.
const grouped = new Set(GROUPS.flatMap((g) => Object.values(g.files)));
const rows = GROUPS.map((g) => {
  const title = g.title.ru ?? g.title.en;
  const links = Object.entries(g.files)
    .map(([l, f]) => `<a href="${htmlPath(f)}" lang="${l}">${LOCALE_NAMES[l]}</a>`)
    .join(" · ");
  const pdfs = Object.entries(PDF_SET)
    .filter(([, f]) => Object.values(g.files).includes(f))
    .map(([name]) => `<a href="pdf/${name}">${name}</a>`)
    .join(" · ");
  return `<tr><td>${esc(title)}</td><td>${links}</td><td class="pdf">${pdfs}</td></tr>`;
}).join("\n");
const others = built
  .filter((b) => !grouped.has(b.rel))
  .map(
    (b) =>
      `<li><a href="${htmlPath(b.rel)}">${esc(b.title)}</a> <span class="note">${b.rel}</span></li>`,
  )
  .join("\n");
writeFileSync(
  resolve(distDir, "index.html"),
  `<!doctype html>
<html lang="ru">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Метеопортал — документация</title><style>${CSS}</style></head>
<body><main>
<h1>Метеопортал FINTAJ — документация / Ҳуҷҷатҳо / Documentation</h1>
<p class="note">Собрано ${new Date().toISOString().slice(0, 10)} из <code>docs/</code> (pnpm docs:build).</p>
<h2>Руководства · Дастурҳо · Manuals</h2>
<table><thead><tr><th>Документ</th><th>HTML</th><th>PDF</th></tr></thead><tbody>
${rows}
</tbody></table>
<h2>Проектная документация</h2>
<ul>
${others}
</ul>
</main></body></html>
`,
);
console.info(`HTML: ${built.length} документов → ${relative(repoRoot, distDir)}`);

/* ---------------------------------------------------------------- PDF */
async function buildPdf() {
  let chromium;
  try {
    const require = createRequire(resolve(repoRoot, "apps/web/package.json"));
    ({ chromium } = require("@playwright/test"));
  } catch {
    return "Playwright не установлен (pnpm install в apps/web)";
  }
  let browser;
  try {
    browser = await chromium.launch();
  } catch (error) {
    return `Chromium недоступен: ${error instanceof Error ? error.message.split("\n")[0] : error}`;
  }
  const pdfDir = resolve(distDir, "pdf");
  mkdirSync(pdfDir, { recursive: true });
  try {
    const page = await browser.newPage();
    for (const [name, rel] of Object.entries(PDF_SET)) {
      const html = resolve(distDir, htmlPath(rel));
      if (!existsSync(html)) {
        console.warn(`  – ${name}: нет ${rel}`);
        continue;
      }
      await page.goto(`file://${html}`, { waitUntil: "load" });
      await page.emulateMedia({ media: "print" });
      await page.pdf({
        path: resolve(pdfDir, name),
        format: "A4",
        printBackground: true,
        margin: { top: "16mm", right: "14mm", bottom: "18mm", left: "14mm" },
        displayHeaderFooter: true,
        headerTemplate: "<span></span>",
        footerTemplate:
          '<div style="width:100%;font-size:9px;color:#5b6372;padding:0 14mm;display:flex;justify-content:space-between"><span class="title"></span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
      });
      console.info(`  ✓ pdf/${name}`);
    }
  } finally {
    await browser.close();
  }
  return null;
}

if (wantPdf) {
  const skipped = await buildPdf();
  if (skipped) {
    console.warn(
      `PDF пропущен: ${skipped}.\n` +
        "Чтобы получить PDF вручную: откройте dist/<документ>.html в Chrome/Edge/Firefox, " +
        "«Печать» → принтер «Сохранить как PDF», формат A4, фон включён (стили печати уже в странице). " +
        "Установка Chromium: pnpm --filter @meteo/web exec playwright install chromium.",
    );
  }
}
