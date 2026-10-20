/**
 * Ежедневный экологический бюллетень Агентства: чистые расчёты без I/O.
 *
 * Для местных суток (Asia/Dushanbe) по каждому веществу считаются среднесуточная и максимальная
 * разовая концентрации, кратности к ПДКс.с. и ПДКм.р., число случаев превышения (> ПДК и ≥ 5 ПДК),
 * суммация NO2+SO2, сравнение кратностей с предыдущим днём (повышение / понижение / на уровне —
 * по напечатанным, то есть округлённым, значениям) и признаки ВЗ (≥ 10 ПДКм.р.) и ЭВЗ (≥ 50 ПДКм.р.).
 *
 * Суммация по методике Агентства: сумма отношений среднесуточных концентраций NO2 и SO2 к ПДКм.р.
 * (так получаются значения 0,59 → 0,66 из образца бюллетеня за 19.10.2026); вариант с ПДКс.с.
 * (классическое правило суммации РД 52.04.186‑89) включается настройкой.
 *
 * Единицы в документах — мг/м³ (как у Агентства); объёмные единицы (ppm, ppb) печатаются как есть.
 * Числа форматируются с запятой‑разделителем.
 */
import { dushanbeLocalToUtc, utcToDushanbeLocal } from "./time";
import { roundTo } from "./units";

export type BulletinLang = "tg" | "ru";
export const BULLETIN_LANGS: readonly BulletinLang[] = ["tg", "ru"];

export interface BulletinPollutantDef {
  id: number;
  code: string;
  shortName: string;
  /** Единица хранения значений: µg/m³, mg/m³, ppm, ppb. */
  unit: string;
  /** Знаков после запятой в единице хранения. */
  decimals: number;
  sortOrder: number;
  /** Названия из справочника — фолбэк, если формулировки нет в шаблонах фраз. */
  name?: Partial<Record<"tg" | "ru" | "en", string>>;
  /** ПДК среднесуточная и максимальная разовая в единице хранения; null — норматива нет. */
  dailyLimit: number | null;
  maxSingleLimit: number | null;
}

/** Валидные значения за местные сутки: разовые/часовые (осреднение < 24 ч) и суточные записи. */
export interface DayValues {
  single: number[];
  daily: number[];
}
export type DayValuesByPollutant = Map<number, DayValues>;

/** Порог «случая ≥ 5 ПДК» во второй колонке числа превышений. */
export const BULLETIN_HIGH_CASE_RATIO = 5;
/** Высокое загрязнение (ВЗ): разовая концентрация ≥ 10 ПДКм.р. */
export const BULLETIN_HIGH_POLLUTION_RATIO = 10;
/** Экстремально высокое загрязнение (ЭВЗ): ≥ 50 ПДКм.р. */
export const BULLETIN_EXTREME_POLLUTION_RATIO = 50;

export interface PollutantDayStats {
  pollutantId: number;
  /** Среднесуточная концентрация в единице хранения (null — данных нет). */
  mean: number | null;
  /** Максимальная разовая концентрация (по разовым/часовым значениям). */
  max: number | null;
  samples: number;
  ratioDaily: number | null;
  ratioSingle: number | null;
  /** Превышение ПДКс.с. среднесуточной (0/1). */
  casesDaily: number;
  /** Число разовых значений выше ПДКм.р. */
  casesSingle: number;
  casesHighDaily: number;
  casesHighSingle: number;
  highPollution: boolean;
  extremePollution: boolean;
}

function meanOf(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function maxOf(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((m, v) => (v > m ? v : m), Number.NEGATIVE_INFINITY);
}

/** Кратность «выше нормы» — по округлённому до двух знаков значению, как оно печатается. */
export function aboveOne(ratio: number | null): boolean {
  return ratio !== null && roundTo(ratio, 2) > 1;
}

function atLeast(ratio: number | null, threshold: number): boolean {
  return ratio !== null && roundTo(ratio, 2) >= threshold;
}

/** Статистика за сутки по одному веществу. */
export function dayStats(p: BulletinPollutantDef, values?: DayValues): PollutantDayStats {
  const single = (values?.single ?? []).filter((v) => Number.isFinite(v));
  const daily = (values?.daily ?? []).filter((v) => Number.isFinite(v));
  const mean = single.length > 0 ? meanOf(single) : meanOf(daily);
  const max = maxOf(single);
  // Кратности ПДК считаются только для массовых концентраций: CO2 (ppm) и ЛОС (ppb) в бюллетене
  // Агентства печатаются без кратностей и не участвуют в сравнении и превышениях.
  const mass = MASS_UNITS.has(p.unit);
  const dailyLimit = mass && p.dailyLimit !== null && p.dailyLimit > 0 ? p.dailyLimit : null;
  const singleLimit =
    mass && p.maxSingleLimit !== null && p.maxSingleLimit > 0 ? p.maxSingleLimit : null;
  const ratioDaily = mean !== null && dailyLimit !== null ? mean / dailyLimit : null;
  const ratioSingle = max !== null && singleLimit !== null ? max / singleLimit : null;
  const singleRatios = singleLimit !== null ? single.map((v) => v / singleLimit) : [];
  return {
    pollutantId: p.id,
    mean,
    max,
    samples: single.length + daily.length,
    ratioDaily,
    ratioSingle,
    casesDaily: aboveOne(ratioDaily) ? 1 : 0,
    casesSingle: singleRatios.filter((r) => aboveOne(r)).length,
    casesHighDaily: atLeast(ratioDaily, BULLETIN_HIGH_CASE_RATIO) ? 1 : 0,
    casesHighSingle: singleRatios.filter((r) => atLeast(r, BULLETIN_HIGH_CASE_RATIO)).length,
    highPollution: singleRatios.some((r) => atLeast(r, BULLETIN_HIGH_POLLUTION_RATIO)),
    extremePollution: singleRatios.some((r) => atLeast(r, BULLETIN_EXTREME_POLLUTION_RATIO)),
  };
}

export type ChangeKind = "up" | "down" | "same";

export interface RatioChange {
  kind: ChangeKind;
  from: number;
  to: number;
}

/** Сравнение кратностей с предыдущим днём по напечатанным значениям: 1,30 и 1,3 — «на уровне». */
export function ratioChange(today: number | null, yesterday: number | null): RatioChange | null {
  if (today === null || yesterday === null) return null;
  if (!Number.isFinite(today) || !Number.isFinite(yesterday)) return null;
  if (formatRatio(today) === formatRatio(yesterday))
    return { kind: "same", from: yesterday, to: today };
  return { kind: today > yesterday ? "up" : "down", from: yesterday, to: today };
}

export type SummationLimitKind = "max_single" | "daily";

export interface SummationOptions {
  limitKind: SummationLimitKind;
  /** Коды веществ группы суммации (по умолчанию NO2 и SO2). */
  codes?: readonly string[];
}

export const DEFAULT_SUMMATION: SummationOptions = {
  limitKind: "max_single",
  codes: ["NO2", "SO2"],
};

/** Суммация: Σ q̄_i / ПДК_i по веществам группы; null, если нет значения или норматива хотя бы у одного. */
export function summationRatio(
  statsById: ReadonlyMap<number, PollutantDayStats>,
  pollutants: readonly BulletinPollutantDef[],
  opts: SummationOptions = DEFAULT_SUMMATION,
): number | null {
  let sum = 0;
  for (const code of opts.codes ?? DEFAULT_SUMMATION.codes ?? []) {
    const p = pollutants.find((x) => x.code.toUpperCase() === code.toUpperCase());
    if (!p) return null;
    const st = statsById.get(p.id);
    const limit = opts.limitKind === "daily" ? p.dailyLimit : p.maxSingleLimit;
    if (!st || st.mean === null || limit === null || limit <= 0) return null;
    sum += st.mean / limit;
  }
  return sum;
}

export interface BulletinRow {
  pollutant: BulletinPollutantDef;
  today: PollutantDayStats;
  yesterday: PollutantDayStats | null;
  change: RatioChange | null;
}

export interface SummationResult {
  today: number | null;
  yesterday: number | null;
  change: RatioChange | null;
}

/** Идентификаторы веществ с превышениями: по обеим ПДК, только ПДКс.с., только ПДКм.р. */
export interface ExceedanceGroups {
  both: number[];
  dailyOnly: number[];
  singleOnly: number[];
}

export interface BulletinStats {
  rows: BulletinRow[];
  summation: SummationResult;
  exceedances: ExceedanceGroups;
  highPollution: number[];
  extremePollution: number[];
  hasData: boolean;
  hasYesterday: boolean;
}

export interface BuildStatsOptions {
  summation?: SummationOptions;
  /** Оставлять только вещества, по которым есть данные хотя бы за один из двух дней. */
  onlyWithData?: boolean;
}

/** Таблица суток + сравнение с предыдущими сутками + суммация + превышения. */
export function buildBulletinStats(
  pollutants: readonly BulletinPollutantDef[],
  today: DayValuesByPollutant,
  yesterday: DayValuesByPollutant | null,
  opts: BuildStatsOptions = {},
): BulletinStats {
  const sorted = [...pollutants].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const todayById = new Map<number, PollutantDayStats>();
  const yesterdayById = new Map<number, PollutantDayStats>();
  const rows: BulletinRow[] = [];
  for (const p of sorted) {
    const t = dayStats(p, today.get(p.id));
    const yv = yesterday?.get(p.id);
    const y = yv && (yv.single.length > 0 || yv.daily.length > 0) ? dayStats(p, yv) : null;
    if (opts.onlyWithData && t.samples === 0 && !y) continue;
    todayById.set(p.id, t);
    if (y) yesterdayById.set(p.id, y);
    rows.push({
      pollutant: p,
      today: t,
      yesterday: y,
      change: ratioChange(t.ratioDaily, y?.ratioDaily ?? null),
    });
  }
  const summationOpts = opts.summation ?? DEFAULT_SUMMATION;
  const sumToday = summationRatio(todayById, sorted, summationOpts);
  const sumYesterday = yesterday ? summationRatio(yesterdayById, sorted, summationOpts) : null;
  const exceedances: ExceedanceGroups = { both: [], dailyOnly: [], singleOnly: [] };
  const highPollution: number[] = [];
  const extremePollution: number[] = [];
  for (const row of rows) {
    const d = row.today.casesDaily > 0;
    const s = row.today.casesSingle > 0;
    if (d && s) exceedances.both.push(row.pollutant.id);
    else if (d) exceedances.dailyOnly.push(row.pollutant.id);
    else if (s) exceedances.singleOnly.push(row.pollutant.id);
    if (row.today.extremePollution) extremePollution.push(row.pollutant.id);
    else if (row.today.highPollution) highPollution.push(row.pollutant.id);
  }
  return {
    rows,
    summation: {
      today: sumToday,
      yesterday: sumYesterday,
      change: ratioChange(sumToday, sumYesterday),
    },
    exceedances,
    highPollution,
    extremePollution,
    hasData: rows.some((r) => r.today.samples > 0),
    hasYesterday: rows.some((r) => r.yesterday !== null),
  };
}

/** Объединяет значения нескольких станций одного города (среднее по всем пробам, максимум по всем). */
export function mergeDayValues(parts: readonly DayValuesByPollutant[]): DayValuesByPollutant {
  const out: DayValuesByPollutant = new Map();
  for (const part of parts) {
    for (const [pollutantId, v] of part) {
      const acc = out.get(pollutantId) ?? { single: [], daily: [] };
      acc.single.push(...v.single);
      acc.daily.push(...v.daily);
      out.set(pollutantId, acc);
    }
  }
  return out;
}

export interface Form4aRow {
  pollutant: BulletinPollutantDef;
  mean: number | null;
  ratioDaily: number | null;
  max: number | null;
  ratioSingle: number | null;
  /** Превышена ПДКм.р. — иначе в форме 4а максимальные значения печатаются прочерком. */
  singleExceeds: boolean;
}

/** Строки формы 4а: вещества с превышением ПДКс.с. или ПДКм.р. */
export function form4aRows(stats: BulletinStats): Form4aRow[] {
  const out: Form4aRow[] = [];
  for (const row of stats.rows) {
    const singleExceeds = aboveOne(row.today.ratioSingle);
    if (row.today.casesDaily === 0 && !singleExceeds) continue;
    out.push({
      pollutant: row.pollutant,
      mean: row.today.mean,
      ratioDaily: row.today.ratioDaily,
      max: row.today.max,
      ratioSingle: row.today.ratioSingle,
      singleExceeds,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Снимок рассчитанного бюллетеня (хранится в eco_bulletins.data, из него рендерятся документы)
// ---------------------------------------------------------------------------

export type LocalizedName = Partial<Record<"tg" | "ru" | "en", string>>;

export interface EcoBulletinCity {
  key: string;
  /** Название для таблиц и заголовков («Душанбе», «Хуҷанд»). */
  name: LocalizedName;
  /** Подпись для текста сводки («г. Душанбе», «ш. Хуҷанд», «Согдийская область»). */
  label?: LocalizedName;
  stationIds: number[];
  stats: BulletinStats;
}

export interface EcoBulletinData {
  version: 1;
  /** Местные сутки YYYY-MM-DD. */
  date: string;
  station: { id: number; code: string; name: LocalizedName; automatic: boolean };
  city: { key: string; name: LocalizedName; label?: LocalizedName };
  summation: SummationLimitKind;
  /** Таблица и текст бюллетеня города (по выбранной станции). */
  cityStats: BulletinStats;
  /** Сводка по городам республики (по всем станциям, объединённым по городам). */
  cities: EcoBulletinCity[];
  computedAt: string;
}

// ---------------------------------------------------------------------------
// Форматирование чисел (запятая‑разделитель, мг/м³)
// ---------------------------------------------------------------------------

function trimZeros(fixed: string, minDecimals: number): string {
  const dot = fixed.indexOf(".");
  if (dot < 0) return fixed;
  const int = fixed.slice(0, dot);
  let frac = fixed.slice(dot + 1);
  while (frac.length > minDecimals && frac.endsWith("0")) frac = frac.slice(0, -1);
  return frac.length > 0 ? `${int}.${frac}` : int;
}

/** Число с запятой‑разделителем: не более maxDecimals знаков, лишние нули справа убираются до minDecimals. */
export function formatNumber(value: number, maxDecimals: number, minDecimals = 0): string {
  if (!Number.isFinite(value)) return "-";
  const fixed = roundTo(value, maxDecimals).toFixed(maxDecimals);
  return trimZeros(fixed, Math.min(minDecimals, maxDecimals)).replace(".", ",");
}

/** Кратность ПДК: два знака (1,32; 0,3; 1,2); меньше 0,01 — две значащие цифры (0,006). */
export function formatRatio(ratio: number | null): string {
  if (ratio === null || !Number.isFinite(ratio)) return "-";
  if (ratio === 0) return "0";
  if (Math.abs(ratio) < 0.01) {
    const precise = Number(ratio.toPrecision(2));
    return precise.toFixed(6).replace(/0+$/, "").replace(".", ",");
  }
  return formatNumber(ratio, 2);
}

export const MASS_UNITS = new Set(["µg/m³", "ug/m3", "µg/m3", "mg/m³", "mg/m3"]);

/** Перевод в единицу документа: µg/m³ → mg/m³; остальные единицы без изменений. */
export function toDocumentUnit(value: number, unit: string): { value: number; unit: string } {
  if (unit === "µg/m³" || unit === "ug/m3" || unit === "µg/m3")
    return { value: value / 1000, unit: "mg/m³" };
  if (unit === "mg/m3") return { value, unit: "mg/m³" };
  return { value, unit };
}

/**
 * Точность концентраций в документе: как в бюллетене Агентства — три знака для веществ
 * с точностью хранения 0,1 µg/m³ (0,079; 0,055), четыре для 0,01 µg/m³ (0,0016); если значение
 * при этом обращается в ноль, печатается полная точность хранения (0,00003). Для mg/m³ и объёмных
 * единиц — точность справочника.
 */
function documentDecimals(p: BulletinPollutantDef): { max: number; full: number; min: number } {
  if (p.unit === "µg/m³" || p.unit === "ug/m3" || p.unit === "µg/m3") {
    const full = p.decimals + 3;
    return { max: Math.min(Math.max(3, p.decimals + 2), full), full, min: 3 };
  }
  return { max: p.decimals, full: p.decimals, min: 0 };
}

/** Концентрация в мг/м³ для таблицы: 79 µg/m³ → «0,079», 0,65 mg/m³ → «0,65». */
export function formatConcentration(value: number | null, p: BulletinPollutantDef): string {
  if (value === null || !Number.isFinite(value)) return "-";
  const { max, full, min } = documentDecimals(p);
  const converted = toDocumentUnit(value, p.unit).value;
  const decimals = converted !== 0 && roundTo(converted, max) === 0 ? full : max;
  return formatNumber(converted, decimals, Math.min(min, decimals));
}

/** ПДК в мг/м³: 60 µg/m³ → «0,06», 3 mg/m³ → «3». */
export function formatLimit(limit: number | null, p: BulletinPollutantDef): string {
  if (limit === null || !Number.isFinite(limit) || limit <= 0) return "-";
  const decimals = Math.max(documentDecimals(p).full, 6);
  return formatNumber(toDocumentUnit(limit, p.unit).value, decimals, 0);
}

/** Число случаев превышения: «1» (среднесуточная), «1-2» (и две разовые), «0-1», «-». */
export function formatCases(daily: number, single: number): string {
  if (daily <= 0 && single <= 0) return "-";
  if (single <= 0) return String(daily);
  return `${daily}-${single}`;
}

// ---------------------------------------------------------------------------
// Даты местных суток
// ---------------------------------------------------------------------------

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function shiftIsoDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Границы местных суток [start, end) в UTC. */
export function localDayRangeUtc(date: string): { start: Date; end: Date } {
  return {
    start: dushanbeLocalToUtc(date, "00:00"),
    end: dushanbeLocalToUtc(shiftIsoDate(date, 1), "00:00"),
  };
}

/** Местная дата момента времени (YYYY-MM-DD). */
export function localDateOf(at: Date): string {
  return utcToDushanbeLocal(at).date;
}

/** «19.10.2026» или «19.10.26». */
export function formatDateDots(date: string, opts: { shortYear?: boolean } = {}): string {
  const [y = "", m = "", d = ""] = date.split("-");
  return `${d}.${m}.${opts.shortYear ? y.slice(2) : y}`;
}
