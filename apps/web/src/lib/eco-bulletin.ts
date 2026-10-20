import "server-only";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BULLETIN_PHRASES,
  type BulletinLang,
  type BulletinStats,
  buildEcoDocument,
  compareSentences,
  type DocModel,
  type EcoBulletinData,
  type EcoDocKind,
  exceedanceSentence,
  formatDateLong,
  formatRatio,
  highPollutionSentence,
  pollutantLabel,
  renderDocHtml,
} from "@meteo/core";
import { DOCX_MIME, docxFromModel } from "@meteo/core/docx";
import type { EcoBulletinFile, EcoBulletinSettings } from "@meteo/db";
import { htmlToPdf } from "@/lib/pdf";
import { UPLOADS_DIR } from "@/lib/uploads";

export type EcoFileExt = "docx" | "pdf" | "html";
export const ECO_FILE_EXTS: readonly EcoFileExt[] = ["docx", "pdf", "html"];

export interface EcoFileSpec {
  kind: EcoDocKind;
  lang: BulletinLang;
  ext: EcoFileExt;
}

const FILE_RE = /^(city|summary|form4a)-(tg|ru)\.(docx|pdf|html)$/;

/** «city-ru.docx» → { kind, lang, ext }; иначе null. */
export function parseEcoFileName(name: string): EcoFileSpec | null {
  const m = FILE_RE.exec(name);
  if (!m) return null;
  return { kind: m[1] as EcoDocKind, lang: m[2] as BulletinLang, ext: m[3] as EcoFileExt };
}

export function ecoFileName(spec: EcoFileSpec): string {
  return `${spec.kind}-${spec.lang}.${spec.ext}`;
}

export const ECO_MIME: Record<EcoFileExt, string> = {
  docx: DOCX_MIME,
  pdf: "application/pdf",
  html: "text/html; charset=utf-8",
};

/** Документ из снимка расчёта с настройками (подпись, причины) и гамма‑фоном записи. */
export function ecoDocument(
  row: { data: EcoBulletinData; gamma: string | null },
  settings: EcoBulletinSettings,
  kind: EcoDocKind,
  lang: BulletinLang,
): DocModel {
  return buildEcoDocument(row.data, kind, lang, {
    gamma: row.gamma,
    causes: settings.causes,
    department: settings.department,
  });
}

/** Байты документа в нужном формате; PDF — null, если Chromium недоступен. */
export async function renderEcoFile(
  doc: DocModel,
  ext: EcoFileExt,
  opts: { autoPrint?: boolean; created?: Date } = {},
): Promise<Uint8Array | null> {
  if (ext === "docx") return docxFromModel(doc, { created: opts.created });
  const html = renderDocHtml(doc, {
    standalone: true,
    autoPrint: ext === "html" && opts.autoPrint,
  });
  if (ext === "html") return new TextEncoder().encode(html);
  return htmlToPdf(html);
}

/** Имя скачиваемого файла: eco-bulletin-2026-10-19-city-ru.docx. */
export function downloadName(doc: DocModel, ext: EcoFileExt): string {
  return `${doc.fileName}.${ext}`;
}

/* ------------------------------------------------------------------ хранение опубликованных файлов */

export function ecoFilesDir(id: number): string {
  return resolve(UPLOADS_DIR, "eco-bulletins", String(id));
}

export function storeEcoFile(id: number, name: string, bytes: Uint8Array): EcoBulletinFile {
  const spec = parseEcoFileName(name);
  if (!spec) throw new Error(`Недопустимое имя файла бюллетеня: ${name}`);
  const dir = ecoFilesDir(id);
  mkdirSync(/* turbopackIgnore: true */ dir, { recursive: true });
  writeFileSync(/* turbopackIgnore: true */ resolve(dir, name), bytes);
  return { name, mime: ECO_MIME[spec.ext], size: bytes.length };
}

export function readEcoFile(id: number, name: string): Uint8Array | null {
  if (!parseEcoFileName(name)) return null;
  const file = resolve(ecoFilesDir(id), name);
  if (!existsSync(/* turbopackIgnore: true */ file)) return null;
  return new Uint8Array(readFileSync(/* turbopackIgnore: true */ file));
}

/* ------------------------------------------------------------------ текст для новости и письма */

export interface EcoBulletinLinks {
  /** Абсолютный или относительный адрес страницы бюллетеня на портале. */
  pageUrl: string;
  /** Адрес файла по имени (city-ru.docx → URL). */
  fileUrl: (name: string) => string;
  files: EcoBulletinFile[];
}

export interface EcoMarkdownLabels {
  files: string;
  docs: Record<EcoDocKind, string>;
  langs: Record<BulletinLang, string>;
  readMore: string;
}

/** Краткий текст бюллетеня (сравнение, превышения, ВЗ/ЭВЗ) + ссылки на файлы — для новости и письма. */
export function ecoBulletinMarkdown(
  data: EcoBulletinData,
  lang: BulletinLang,
  settings: EcoBulletinSettings,
  links: EcoBulletinLinks,
  labels: EcoMarkdownLabels,
): string {
  const ph = BULLETIN_PHRASES[lang];
  const stats: BulletinStats = data.cityStats;
  const paragraphs: string[] = [];
  const compare = stats.hasYesterday
    ? compareSentences(stats, lang, ph.city.compare)
    : [ph.city.compare.none];
  if (compare.length > 0) paragraphs.push(compare.join(" "));
  paragraphs.push(
    `${exceedanceSentence(stats, lang, ph.city.exceed, settings.causes[lang])} ${highPollutionSentence(stats, lang, ph.city.high)}`,
  );
  const exceeded = [
    ...stats.exceedances.both,
    ...stats.exceedances.dailyOnly,
    ...stats.exceedances.singleOnly,
  ];
  if (exceeded.length > 0) {
    const byId = new Map(stats.rows.map((r) => [r.pollutant.id, r]));
    const items = exceeded
      .map((id) => byId.get(id))
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
      .map(
        (r) =>
          `- ${pollutantLabel(r.pollutant, lang, "nom")}: ${formatRatio(r.today.ratioDaily)} ${ph.units.daily}, ${formatRatio(r.today.ratioSingle)} ${ph.units.single}`,
      );
    paragraphs.push(items.join("\n"));
  }
  const fileLines: string[] = [];
  for (const kind of ["city", "summary", "form4a"] as EcoDocKind[]) {
    const parts: string[] = [];
    for (const l of ["tg", "ru"] as BulletinLang[]) {
      for (const ext of ECO_FILE_EXTS) {
        if (ext === "html") continue;
        const name = ecoFileName({ kind, lang: l, ext });
        if (!links.files.some((f) => f.name === name)) continue;
        parts.push(`[${labels.langs[l]} ${ext.toUpperCase()}](${links.fileUrl(name)})`);
      }
    }
    if (parts.length > 0) fileLines.push(`- ${labels.docs[kind]}: ${parts.join(" · ")}`);
  }
  if (fileLines.length > 0) paragraphs.push(`**${labels.files}**\n\n${fileLines.join("\n")}`);
  paragraphs.push(`[${labels.readMore}](${links.pageUrl})`);
  return paragraphs.join("\n\n");
}

export function ecoBulletinTitle(data: EcoBulletinData, lang: BulletinLang): string {
  const city = data.city.name[lang] ?? data.city.name.ru ?? data.city.name.tg ?? data.station.code;
  const date = formatDateLong(data.date, lang);
  return lang === "ru"
    ? `Экологический бюллетень г. ${city} за ${date}`
    : `Бюллетени экологии ш. ${city} барои ${date}`;
}
