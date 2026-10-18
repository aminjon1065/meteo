/**
 * Идентификаторы заголовков для оглавления и якорных ссылок (общие для build.mjs и check-links.mjs).
 * Кириллица сохраняется, пунктуация убирается, пробелы → дефис; повторы получают суффикс -2, -3…
 */
export function slugify(text) {
  return (
    text
      .toLowerCase()
      .replace(/<[^>]+>/g, "")
      .replace(/[`*_~[\]()]/g, "")
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .trim()
      .replace(/[\s_]+/g, "-")
      .replace(/-+/g, "-") || "section"
  );
}

/** Уникализирует слаги в пределах одного документа. */
export function uniqueSlugs() {
  const seen = new Map();
  return (text) => {
    const base = slugify(text);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };
}

/** Заголовки Markdown (вне огороженных блоков кода): { depth, text, slug }. */
export function headingsOf(markdown) {
  const unique = uniqueSlugs();
  const out = [];
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const text = m[2].replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
    out.push({ depth: m[1].length, text, slug: unique(text) });
  }
  return out;
}
