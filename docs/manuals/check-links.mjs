#!/usr/bin/env node
/**
 * Проверка ссылок в документации (docs/**.md): относительные ссылки и изображения должны указывать на
 * существующие файлы, якоря (#раздел) — на заголовки целевого документа. Внешние адреса (http, mailto)
 * не запрашиваются. Код выхода 1, если найдены битые ссылки.
 *
 *   pnpm docs:check          (node docs/manuals/check-links.mjs)
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { headingsOf } from "./slug.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const docsDir = resolve(here, "..");
const repoRoot = resolve(docsDir, "..");

function listMarkdown(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "dist" || entry === "node_modules") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listMarkdown(full));
    else if (entry.endsWith(".md")) out.push(full);
  }
  return out.sort();
}

/** Ссылки и изображения Markdown вне блоков кода: [text](target), ![alt](target), <img src>. */
function linksOf(markdown) {
  const links = [];
  let fenced = false;
  let lineNo = 0;
  for (const rawLine of markdown.split("\n")) {
    lineNo += 1;
    if (/^\s*(```|~~~)/.test(rawLine)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const line = rawLine.replace(/`[^`]*`/g, "");
    const re = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)|<img[^>]+src="([^"]+)"/g;
    for (const m of line.matchAll(re)) {
      links.push({ target: m[1] ?? m[2], line: lineNo });
    }
  }
  return links;
}

const anchors = new Map();
function anchorsOf(file) {
  let set = anchors.get(file);
  if (!set) {
    set = new Set(headingsOf(readFileSync(file, "utf8")).map((h) => h.slug));
    anchors.set(file, set);
  }
  return set;
}

const files = listMarkdown(docsDir);
const problems = [];
let total = 0;
for (const file of files) {
  const md = readFileSync(file, "utf8");
  for (const { target, line } of linksOf(md)) {
    total += 1;
    if (/^(https?:|mailto:|tel:|data:)/i.test(target)) continue;
    const [pathPart, anchor] = target.split("#");
    const decoded = decodeURI(pathPart);
    const resolved = decoded ? resolve(dirname(file), decoded) : file;
    if (decoded && !existsSync(resolved)) {
      problems.push(`${relative(repoRoot, file)}:${line}: нет файла ${target}`);
      continue;
    }
    if (anchor && resolved.endsWith(".md")) {
      const slug = decodeURIComponent(anchor).toLowerCase();
      if (!anchorsOf(resolved).has(slug)) {
        problems.push(
          `${relative(repoRoot, file)}:${line}: нет якоря #${anchor} в ${relative(repoRoot, resolved)}`,
        );
      }
    }
  }
}

console.info(`Документов: ${files.length}, ссылок: ${total}, битых: ${problems.length}`);
for (const p of problems) console.error(`  ✗ ${p}`);
process.exit(problems.length ? 1 : 0);
