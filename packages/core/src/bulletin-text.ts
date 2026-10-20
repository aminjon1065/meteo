/**
 * Генератор текста ежедневного экологического бюллетеня (tg / ru) по шаблонам фраз.
 * Три документа: бюллетень города (таблица + текст), сводка по городам (ЗАВ / ИҲА), форма 4а.
 * Результат — модель документа (`bulletin-doc.ts`), которую рендерят HTML и DOCX.
 */
import {
  aboveOne,
  type BulletinLang,
  type BulletinPollutantDef,
  type BulletinRow,
  type BulletinStats,
  type EcoBulletinData,
  form4aRows,
  formatCases,
  formatConcentration,
  formatDateDots,
  formatLimit,
  formatRatio,
  type RatioChange,
  shiftIsoDate,
} from "./bulletin";
import { cell, type DocBlock, type DocCell, type DocModel, paragraph } from "./bulletin-doc";
import {
  BULLETIN_PHRASES,
  type BulletinPhraseSet,
  type ComparePhrases,
  type LangPhrases,
  POLLUTANT_ALIASES,
  POLLUTANT_PHRASES,
} from "./bulletin-phrases";

export interface BulletinTextOverrides {
  /** Фраза о причинах превышений (настройка админки). */
  causes?: Partial<Record<BulletinLang, string>>;
  /** Подпись отдела под документом. */
  department?: Partial<Record<BulletinLang, string>>;
  /** Полный набор фраз (для тестов и особых шаблонов). */
  phrases?: BulletinPhraseSet;
}

export interface CityDocumentContext extends BulletinTextOverrides {
  /** Дата бюллетеня (местные сутки), YYYY-MM-DD. */
  date: string;
  /** Дата подписи; по умолчанию — следующий день. */
  issuedDate?: string;
  /** Название города в языке документа (без «г.»). */
  city: Partial<Record<BulletinLang, string>>;
  /** Станция: автоматическая (непрерывные измерения) или пост разовых проб. */
  automatic?: boolean;
  /** Гамма‑фон — ручной ввод (например «0,014»); пусто — абзац не печатается. */
  gamma?: string | null;
}

export interface CitySummaryEntry {
  key: string;
  /** Название для таблиц («Душанбе»). */
  name: Partial<Record<BulletinLang, string>>;
  /** Подпись для текста («г. Душанбе»); по умолчанию — name. */
  label?: Partial<Record<BulletinLang, string>>;
  stats: BulletinStats;
}

export interface SummaryDocumentContext extends BulletinTextOverrides {
  date: string;
  issuedDate?: string;
}

/* ------------------------------------------------------------------ подстановки */

export function fill(template: string, vars: Record<string, string | number | undefined>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = vars[key];
    return v === undefined || v === null ? "" : String(v);
  });
}

function phrasesOf(lang: BulletinLang, set?: BulletinPhraseSet): LangPhrases {
  return (set ?? BULLETIN_PHRASES)[lang];
}

/** «19 октября 2026» / «19 октябри 2026». */
export function formatDateLong(date: string, lang: BulletinLang, set?: BulletinPhraseSet): string {
  const [y = "", m = "1", d = "1"] = date.split("-");
  const month = phrasesOf(lang, set).months[Number(m) - 1] ?? m;
  return `${Number(d)} ${month} ${y}`;
}

function normalizeCode(code: string): string {
  const upper = code.trim().toUpperCase();
  const alias = POLLUTANT_ALIASES[upper] ?? POLLUTANT_ALIASES[code.trim()];
  return alias ?? upper;
}

/** Название вещества в нужной форме: tg — одна форма; ru — nom (таблица), gen, dat. */
export function pollutantLabel(
  p: BulletinPollutantDef,
  lang: BulletinLang,
  form: "nom" | "gen" | "dat" | "nomCode" = "nom",
): string {
  const phrase = POLLUTANT_PHRASES[normalizeCode(p.code)];
  const unitSuffix = p.unit === "ppm" || p.unit === "ppb" ? ` (${p.unit})` : "";
  // В таблице (nom) название с заглавной буквы, в тексте (gen/dat) — со строчной, кроме аббревиатур.
  const inText = (s: string) => (form === "nom" || form === "nomCode" ? s : decapitalize(s));
  if (phrase) {
    if (lang === "tg") return `${inText(phrase.tg)}${unitSuffix}`;
    const text = form === "gen" ? phrase.ruGen : form === "dat" ? phrase.ruDat : phrase.ru;
    // nomCode: именительный падеж с формулой из родительного («Диоксид азота (NO2)») — форма 4а;
    // если формула уже есть в названии («Взвешенные частицы РМ-10»), повторно не добавляется.
    const codeMatch = form === "nomCode" ? /\(([^)]+)\)/.exec(phrase.ruGen) : null;
    const code = codeMatch && !text.includes(codeMatch[1] ?? "") ? codeMatch[0] : "";
    return `${inText(text)}${code ? ` ${code}` : ""}${unitSuffix}`;
  }
  const base = (p.name?.[lang] ?? p.name?.ru ?? p.name?.en ?? p.shortName).trim();
  const withCode = base.includes("(") ? base : `${base} (${p.shortName})`;
  return `${inText(withCode)}${unitSuffix}`;
}

/** Первая буква строчная, если слово не аббревиатура («Зарачаҳои» → «зарачаҳои», «ПОЗ» — без изменений). */
function decapitalize(s: string): string {
  if (s.length < 2) return s;
  const second = s.charAt(1);
  if (second !== second.toLowerCase()) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/** Убирает удвоенную точку после сокращения в конце предложения («ПДКс.с..» → «ПДКс.с.») и двойные пробелы. */
function tidy(sentence: string): string {
  return sentence
    .replace(/\.\.$/, ".")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function joinItems(items: string[]): string {
  return items.join("; ");
}

function joinNames(items: string[]): string {
  return items.join(", ");
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

/* ------------------------------------------------------------------ сравнение с предыдущим днём */

interface CompareLists {
  up: BulletinRow[];
  down: BulletinRow[];
  same: BulletinRow[];
}

function splitByChange(rows: BulletinRow[]): CompareLists {
  const out: CompareLists = { up: [], down: [], same: [] };
  for (const row of rows) {
    if (!row.change) continue;
    out[row.change.kind].push(row);
  }
  return out;
}

function changeItem(ph: ComparePhrases, row: BulletinRow, lang: BulletinLang): string {
  const change = row.change as RatioChange;
  return fill(ph.item, {
    name: pollutantLabel(row.pollutant, lang, "gen"),
    from: formatRatio(change.from),
    to: formatRatio(change.to),
  });
}

function sumSuffix(template: string, change: RatioChange | null, kind: "up" | "down"): string {
  if (!change || change.kind !== kind) return "";
  return fill(template, { from: formatRatio(change.from), to: formatRatio(change.to) });
}

/**
 * Предложения «повышение … / понижение … / осталось на уровне …». Каждая строка результата —
 * законченное предложение; `lead` (сводка: «В воздушном бассейне г. X наблюдалось ») добавляется
 * к первому предложению, остальные начинаются с заглавной буквы.
 */
export function compareSentences(
  stats: BulletinStats,
  lang: BulletinLang,
  ph: ComparePhrases,
  lead = "",
): string[] {
  const lists = splitByChange(stats.rows);
  const sum = stats.summation.change;
  const sentences: string[] = [];
  const upItems = lists.up.map((r) => changeItem(ph, r, lang));
  if (upItems.length > 0) {
    sentences.push(fill(ph.up, { items: joinItems(upItems), sum: sumSuffix(ph.upSum, sum, "up") }));
  } else if (sum?.kind === "up") {
    sentences.push(fill(ph.upSumOnly, { from: formatRatio(sum.from), to: formatRatio(sum.to) }));
  }
  const downItems = lists.down.map((r) => changeItem(ph, r, lang));
  if (downItems.length > 0) {
    sentences.push(
      fill(ph.down, { items: joinItems(downItems), sum: sumSuffix(ph.downSum, sum, "down") }),
    );
  } else if (sum?.kind === "down") {
    sentences.push(fill(ph.downSumOnly, { from: formatRatio(sum.from), to: formatRatio(sum.to) }));
  }
  const sameItems = lists.same.map((r) =>
    fill(ph.sameItem, {
      name: pollutantLabel(r.pollutant, lang, "gen"),
      value: formatRatio(r.change?.to ?? null),
    }),
  );
  if (sameItems.length > 0) {
    sentences.push(
      fill(sameItems.length > 1 ? ph.samePlural : ph.same, { items: joinItems(sameItems) }),
    );
  }
  if (sentences.length === 0) return [];
  return sentences.map((s, i) =>
    tidy(i === 0 ? `${lead}${lead ? s : capitalize(s)}` : capitalize(s)),
  );
}

/* ------------------------------------------------------------------ превышения и ВЗ/ЭВЗ */

function rowsById(stats: BulletinStats): Map<number, BulletinRow> {
  return new Map(stats.rows.map((r) => [r.pollutant.id, r]));
}

function namesOf(
  stats: BulletinStats,
  ids: number[],
  lang: BulletinLang,
  form: "gen" | "dat",
): string[] {
  const byId = rowsById(stats);
  return ids
    .map((id) => byId.get(id))
    .filter((r): r is BulletinRow => Boolean(r))
    .map((r) => pollutantLabel(r.pollutant, lang, form));
}

export function exceedanceSentence(
  stats: BulletinStats,
  lang: BulletinLang,
  ph: LangPhrases["city"]["exceed"],
  causes?: string,
): string {
  const form = lang === "ru" ? "dat" : "gen";
  const parts: string[] = [];
  const both = namesOf(stats, stats.exceedances.both, lang, form);
  const dailyOnly = namesOf(stats, stats.exceedances.dailyOnly, lang, form);
  const singleOnly = namesOf(stats, stats.exceedances.singleOnly, lang, form);
  if (both.length > 0) parts.push(fill(ph.both, { items: joinNames(both) }));
  if (dailyOnly.length > 0) parts.push(fill(ph.dailyOnly, { items: joinNames(dailyOnly) }));
  if (singleOnly.length > 0) parts.push(fill(ph.singleOnly, { items: joinNames(singleOnly) }));
  if (parts.length === 0) return ph.none;
  return fill(ph.lead, { parts: parts.join(", "), causes: (causes ?? "").trim() || ph.causes });
}

export function highPollutionSentence(
  stats: BulletinStats,
  lang: BulletinLang,
  ph: LangPhrases["city"]["high"],
): string {
  const form = lang === "ru" ? "dat" : "gen";
  const sentences: string[] = [];
  const extreme = namesOf(stats, stats.extremePollution, lang, form);
  const high = namesOf(stats, stats.highPollution, lang, form);
  if (extreme.length > 0) sentences.push(fill(ph.extreme, { items: joinNames(extreme) }));
  if (high.length > 0) sentences.push(fill(ph.high, { items: joinNames(high) }));
  return sentences.length > 0 ? sentences.join(" ") : ph.none;
}

/* ------------------------------------------------------------------ таблица города */

function cityTableRu(stats: BulletinStats, ph: LangPhrases): DocBlock {
  const t = ph.city.table;
  const header: DocCell[][] = [
    [
      cell(t.pollutant, { bold: true, rowSpan: 2 }),
      cell(t.meanGroup, { bold: true, colSpan: 3 }),
      cell(t.maxGroup, { bold: true, colSpan: 3 }),
      cell(t.casesGroup, { bold: true, colSpan: 2 }),
    ],
    [
      cell("", { merged: true }),
      cell(t.mg, { bold: true }),
      cell(t.limitDaily, { bold: true }),
      cell(t.ratioDaily, { bold: true }),
      cell(t.maxMg, { bold: true }),
      cell(t.limitSingle, { bold: true }),
      cell(t.ratioSingle, { bold: true }),
      cell(t.casesAbove, { bold: true }),
      cell(t.casesHigh, { bold: true }),
    ],
  ];
  const rows: DocCell[][] = stats.rows.map((r) => [
    cell(pollutantLabel(r.pollutant, "ru", "nom"), { align: "left" }),
    cell(formatConcentration(r.today.mean, r.pollutant)),
    cell(formatLimit(r.pollutant.dailyLimit, r.pollutant)),
    cell(formatRatio(r.today.ratioDaily)),
    cell(formatConcentration(r.today.max, r.pollutant)),
    cell(formatLimit(r.pollutant.maxSingleLimit, r.pollutant)),
    cell(formatRatio(r.today.ratioSingle)),
    cell(formatCases(r.today.casesDaily, r.today.casesSingle)),
    cell(formatCases(r.today.casesHighDaily, r.today.casesHighSingle)),
  ]);
  rows.push([
    cell(t.sumRow, { align: "left", bold: true }),
    cell(formatRatio(stats.summation.today), { bold: true }),
    cell(""),
    cell(""),
    cell(""),
    cell(""),
    cell(""),
    cell(""),
    cell(""),
  ]);
  return {
    type: "table",
    widths: [24, 9, 8, 10, 9, 8, 10, 11, 11],
    rows: [...header, ...rows],
    headerRows: 2,
    fontSize: 10,
  };
}

function cityTableTg(stats: BulletinStats, ph: LangPhrases): DocBlock {
  const t = ph.city.table;
  const header: DocCell[][] = [
    [
      cell(t.no, { bold: true }),
      cell(t.pollutant, { bold: true }),
      cell(t.mg, { bold: true }),
      cell(t.limitDaily, { bold: true }),
      cell(t.ratioDaily, { bold: true }),
      cell(t.maxMg, { bold: true }),
      cell(t.limitSingle, { bold: true }),
      cell(t.ratioSingle, { bold: true }),
    ],
  ];
  const rows: DocCell[][] = stats.rows.map((r, i) => [
    cell(String(i + 1)),
    cell(pollutantLabel(r.pollutant, "tg", "nom"), { align: "left" }),
    cell(formatConcentration(r.today.mean, r.pollutant)),
    cell(formatLimit(r.pollutant.dailyLimit, r.pollutant)),
    cell(formatRatio(r.today.ratioDaily)),
    cell(formatConcentration(r.today.max, r.pollutant)),
    cell(formatLimit(r.pollutant.maxSingleLimit, r.pollutant)),
    cell(formatRatio(r.today.ratioSingle)),
  ]);
  rows.push([
    cell(""),
    cell(t.sumRow, { align: "left", bold: true }),
    cell(formatRatio(stats.summation.today), { bold: true }),
    cell(""),
    cell(""),
    cell(""),
    cell(""),
    cell(""),
  ]);
  return {
    type: "table",
    widths: [5, 31, 11, 11, 10, 11, 11, 10],
    rows: [...header, ...rows],
    headerRows: 1,
    fontSize: 10,
  };
}

function overviewParagraph(stats: BulletinStats, ph: LangPhrases, city: string): string | null {
  const o = ph.city.overview;
  if (!o.lead) return null;
  const items = stats.rows
    .filter((r) => r.today.ratioDaily !== null)
    .map((r) =>
      fill(r.today.ratioSingle !== null ? o.item : o.itemDailyOnly, {
        name: pollutantLabel(r.pollutant, "ru", "dat"),
        daily: formatRatio(r.today.ratioDaily),
        single: formatRatio(r.today.ratioSingle),
      }),
    );
  if (items.length === 0) return null;
  const sum =
    stats.summation.today === null
      ? ""
      : fill(o.sum, {
          value: formatRatio(stats.summation.today),
          sign:
            aboveOne(stats.summation.today) || formatRatio(stats.summation.today) === "1"
              ? "≥"
              : "<",
        });
  return fill(o.lead, { agency: ph.agencyGenitive, city, items: joinItems(items), sum });
}

function signatureBlocks(department: string, issued: string, ph: LangPhrases): DocBlock[] {
  return [
    { type: "spacer", height: 8 },
    paragraph(department, { align: "right", bold: true }),
    paragraph(`${formatDateDots(issued)}${ph.dateSuffix}`, { align: "right" }),
  ];
}

function notesBlocks(title: string, notes: string[]): DocBlock[] {
  return [
    { type: "spacer", height: 6 },
    paragraph(title, { bold: true, italic: true, size: 10 }),
    ...notes.map((n) => paragraph(n, { italic: true, size: 10 })),
  ];
}

/** Документ 1: экологический бюллетень города (таблица + текст). */
export function buildCityDocument(
  stats: BulletinStats,
  ctx: CityDocumentContext,
  lang: BulletinLang,
): DocModel {
  const ph = phrasesOf(lang, ctx.phrases);
  const city = ctx.city[lang] ?? ctx.city.ru ?? ctx.city.tg ?? "";
  const date = formatDateLong(ctx.date, lang, ctx.phrases);
  const issued = ctx.issuedDate ?? shiftIsoDate(ctx.date, 1);
  const vars = { city, date, dateSuffix: ph.dateSuffix };
  const blocks: DocBlock[] = [];
  for (const line of ph.city.agencyLines)
    blocks.push(paragraph(line, { align: "center", bold: true }));
  if (ph.city.heading) {
    blocks.push({ type: "spacer", height: 6 });
    blocks.push(paragraph(ph.city.heading, { align: "center", bold: true, size: 16 }));
  }
  blocks.push({ type: "spacer", height: 6 });
  blocks.push(paragraph(fill(ph.city.title, vars), { align: "center", bold: true, size: 13 }));
  blocks.push(
    paragraph(fill(ph.city.subtitle, vars), { align: "center", bold: true, italic: true }),
  );
  if (ph.city.intro) {
    blocks.push(
      paragraph(
        fill(ph.city.intro, {
          ...vars,
          station: ctx.automatic === false ? ph.city.stationManual : ph.city.stationAutomatic,
        }),
        { align: "justify", indent: true, spaceBefore: 6 },
      ),
    );
  }
  blocks.push(lang === "ru" ? cityTableRu(stats, ph) : cityTableTg(stats, ph));
  const overview = overviewParagraph(stats, ph, city);
  if (overview)
    blocks.push(paragraph(overview, { align: "justify", indent: true, spaceBefore: 6 }));
  const compare = stats.hasYesterday
    ? compareSentences(stats, lang, ph.city.compare)
    : [ph.city.compare.none];
  if (compare.length > 0)
    blocks.push(paragraph(compare.join(" "), { align: "justify", indent: true }));
  const exceed = exceedanceSentence(stats, lang, ph.city.exceed, ctx.causes?.[lang]);
  const high = highPollutionSentence(stats, lang, ph.city.high);
  blocks.push(paragraph(`${exceed} ${high}`, { align: "justify", indent: true }));
  const gamma = (ctx.gamma ?? "").trim();
  if (gamma)
    blocks.push(paragraph(fill(ph.city.gamma, { gamma }), { align: "justify", indent: true }));
  blocks.push(...notesBlocks(ph.city.notesTitle, ph.city.notes));
  blocks.push(...signatureBlocks(ctx.department?.[lang] || ph.city.department, issued, ph));
  const title =
    lang === "ru"
      ? `Экологический бюллетень г. ${city} за ${date}`
      : `Шарҳи ҳолати ифлосшавии ҳаво дар шаҳри ${city} барои ${date}`;
  return { lang, title, fileName: `eco-bulletin-${ctx.date}-city-${lang}`, blocks };
}

/* ------------------------------------------------------------------ сводка по городам */

function cityParagraph(entry: CitySummaryEntry, lang: BulletinLang, ph: LangPhrases): string {
  const named = entry.label ?? entry.name;
  const city = named[lang] ?? named.ru ?? named.tg ?? entry.key;
  const sp = ph.summary.city;
  if (!entry.stats.hasData) return fill(sp.noData, { city });
  if (!entry.stats.hasYesterday) {
    const items = entry.stats.rows
      .filter((r) => r.today.ratioDaily !== null)
      .map((r) =>
        fill(sp.noYesterdayItem, {
          name: pollutantLabel(r.pollutant, lang, "gen"),
          value: formatRatio(r.today.ratioDaily),
        }),
      );
    return fill(sp.noYesterday, { city, items: joinItems(items) });
  }
  const sentences = compareSentences(entry.stats, lang, sp, fill(sp.lead, { city }));
  return sentences.length > 0 ? sentences.join(" ") : fill(sp.noChange, { city });
}

/** Документ 2: сводка по городам республики (ЗАВ / ИҲА). */
export function buildSummaryDocument(
  entries: CitySummaryEntry[],
  ctx: SummaryDocumentContext,
  lang: BulletinLang,
): DocModel {
  const ph = phrasesOf(lang, ctx.phrases);
  const date = formatDateLong(ctx.date, lang, ctx.phrases);
  const issued = ctx.issuedDate ?? shiftIsoDate(ctx.date, 1);
  const mainCity = entries[0]?.name[lang] ?? entries[0]?.name.ru ?? "";
  const blocks: DocBlock[] = [];
  for (const line of ph.summary.agencyLines)
    blocks.push(paragraph(line, { align: "center", bold: true }));
  blocks.push(
    paragraph(fill(ph.summary.title, { city: mainCity }), {
      align: "center",
      bold: true,
      size: 14,
    }),
  );
  const cityName = (e: CitySummaryEntry) => {
    const named = e.label ?? e.name;
    return named[lang] ?? named.ru ?? named.tg ?? e.key;
  };
  const extremeCities = entries.filter((e) => e.stats.extremePollution.length > 0).map(cityName);
  const highCities = entries.filter((e) => e.stats.highPollution.length > 0).map(cityName);
  const highSentences: string[] = [];
  if (extremeCities.length > 0)
    highSentences.push(fill(ph.summary.high.extreme, { items: joinNames(extremeCities) }));
  if (highCities.length > 0)
    highSentences.push(fill(ph.summary.high.high, { items: joinNames(highCities) }));
  if (highSentences.length === 0) highSentences.push(ph.summary.high.none);
  blocks.push(
    paragraph(
      `${fill(ph.summary.intro, { date, dateSuffix: ph.dateSuffix, agency: ph.agencyGenitive })} ${highSentences.join(" ")}`,
      { align: "justify", indent: true, spaceBefore: 6 },
    ),
  );
  for (const entry of entries) {
    blocks.push(paragraph(cityParagraph(entry, lang, ph), { align: "justify", indent: true }));
  }
  blocks.push({ type: "spacer", height: 8 });
  blocks.push(paragraph(formatDateDots(issued, { shortYear: true }), { align: "right" }));
  const title =
    lang === "ru" ? `Загрязнение атмосферного воздуха за ${date}` : `ИҲА барои санаи ${date}`;
  return { lang, title, fileName: `eco-bulletin-${ctx.date}-summary-${lang}`, blocks };
}

/* ------------------------------------------------------------------ форма 4а */

/** Документ 3: форма 4а — превышения ПДК по городам. */
export function buildForm4aDocument(
  entries: CitySummaryEntry[],
  ctx: SummaryDocumentContext,
  lang: BulletinLang,
): DocModel {
  const ph = phrasesOf(lang, ctx.phrases);
  const f = ph.form4a;
  const date = formatDateLong(ctx.date, lang, ctx.phrases);
  const issued = ctx.issuedDate ?? shiftIsoDate(ctx.date, 1);
  const blocks: DocBlock[] = [paragraph(f.label, { align: "right" })];
  blocks.push(paragraph(f.title, { align: "center", bold: true, size: 14 }));
  blocks.push(
    paragraph(fill(f.subtitle, { date, dateSuffix: ph.dateSuffix }), {
      align: "center",
      bold: true,
    }),
  );
  blocks.push({ type: "spacer", height: 6 });
  const rows: DocCell[][] = [f.headers.map((h) => cell(h, { bold: true }))];
  let n = 0;
  for (const entry of entries) {
    const list = form4aRows(entry.stats);
    if (list.length === 0) continue;
    n += 1;
    const city = entry.name[lang] ?? entry.name.ru ?? entry.name.tg ?? entry.key;
    list.forEach((row, i) => {
      const first = i === 0;
      const span = list.length;
      rows.push([
        first ? cell(String(n), { rowSpan: span }) : cell("", { merged: true }),
        first ? cell(city, { rowSpan: span, align: "left" }) : cell("", { merged: true }),
        cell(pollutantLabel(row.pollutant, lang, lang === "ru" ? "nomCode" : "gen"), {
          align: "left",
        }),
        cell(formatConcentration(row.mean, row.pollutant)),
        cell(formatRatio(row.ratioDaily)),
        cell(row.singleExceeds ? formatConcentration(row.max, row.pollutant) : "-"),
        cell(row.singleExceeds ? formatRatio(row.ratioSingle) : "-"),
      ]);
    });
  }
  if (rows.length > 1) {
    blocks.push({
      type: "table",
      widths: [5, 14, 33, 11, 13, 11, 13],
      rows,
      headerRows: 1,
      fontSize: 11,
    });
  } else {
    blocks.push(paragraph(f.empty, { align: "justify", indent: true }));
  }
  blocks.push(...notesBlocks(f.notesTitle, f.notes));
  blocks.push(...signatureBlocks(ctx.department?.[lang] || f.department, issued, ph));
  const title = lang === "ru" ? `Форма 4а за ${date}` : `Намунаи 4а барои санаи ${date}`;
  return { lang, title, fileName: `eco-bulletin-${ctx.date}-form4a-${lang}`, blocks };
}

/* ------------------------------------------------------------------ все документы из снимка */

export type EcoDocKind = "city" | "summary" | "form4a";
export const ECO_DOC_KINDS: readonly EcoDocKind[] = ["city", "summary", "form4a"];

export function isEcoDocKind(value: unknown): value is EcoDocKind {
  return typeof value === "string" && (ECO_DOC_KINDS as readonly string[]).includes(value);
}

export interface EcoDocumentOptions extends BulletinTextOverrides {
  gamma?: string | null;
  issuedDate?: string;
}

/** Документ выбранного вида и языка из сохранённого снимка расчёта. */
export function buildEcoDocument(
  data: EcoBulletinData,
  kind: EcoDocKind,
  lang: BulletinLang,
  opts: EcoDocumentOptions = {},
): DocModel {
  const overrides: BulletinTextOverrides = {
    causes: opts.causes,
    department: opts.department,
    phrases: opts.phrases,
  };
  if (kind === "city") {
    return buildCityDocument(
      data.cityStats,
      {
        ...overrides,
        date: data.date,
        issuedDate: opts.issuedDate,
        city: data.city.name,
        automatic: data.station.automatic,
        gamma: opts.gamma,
      },
      lang,
    );
  }
  const entries: CitySummaryEntry[] = data.cities.map((c) => ({
    key: c.key,
    name: c.name,
    label: c.label,
    stats: c.stats,
  }));
  const ctx: SummaryDocumentContext = {
    ...overrides,
    date: data.date,
    issuedDate: opts.issuedDate,
  };
  return kind === "summary"
    ? buildSummaryDocument(entries, ctx, lang)
    : buildForm4aDocument(entries, ctx, lang);
}
