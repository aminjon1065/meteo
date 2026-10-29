import { displayTimeZone } from "@meteo/i18n";

/**
 * Даты и время для компонентов, которые рисуются в браузере (карта, графики, попапы).
 *
 * В Chrome нет данных Intl для таджикского: `Intl.DateTimeFormat("tg")` молча откатывается на
 * английский («Thu, Oct 29, 05:00 PM»), а Node форматирует по-таджикски («Пшб, 29 Окт, 17:00»),
 * и подпись менялась после гидратации. Поэтому для tg подписи собираются здесь — по тем же
 * шаблонам CLDR, что у Node (сверка в тестах), одинаково на сервере и в браузере. Для ru и en —
 * Intl, данные этих языков есть во всех браузерах.
 */

const TG_MONTHS_SHORT = [
  "Янв",
  "Фев",
  "Мар",
  "Апр",
  "Май",
  "Июн",
  "Июл",
  "Авг",
  "Сен",
  "Окт",
  "Ноя",
  "Дек",
] as const;
const TG_MONTHS_LONG = [
  "Январ",
  "Феврал",
  "Март",
  "Апрел",
  "Май",
  "Июн",
  "Июл",
  "Август",
  "Сентябр",
  "Октябр",
  "Ноябр",
  "Декабр",
] as const;
/** С воскресенья, как Date#getDay. */
const TG_WEEKDAYS_SHORT = ["Яшб", "Дшб", "Сшб", "Чшб", "Пшб", "Ҷмъ", "Шнб"] as const;
const TG_WEEKDAYS_LONG = [
  "Якшанбе",
  "Душанбе",
  "Сешанбе",
  "Чоршанбе",
  "Панҷшанбе",
  "Ҷумъа",
  "Шанбе",
] as const;

/**
 * Поля даты, как у Intl.DateTimeFormat. Поддерживаются сочетания, которые встречаются на портале:
 * день с месяцем (и годом), день недели отдельно, с днём или с днём и месяцем, время отдельно или
 * вместе с ними. Часы и минуты задаются вместе.
 */
interface FieldOptions {
  /** По умолчанию — Asia/Dushanbe. */
  timeZone?: string;
  weekday?: "short" | "long";
  day?: "numeric";
  month?: "short" | "long";
  year?: "numeric";
  hour?: "2-digit";
  minute?: "2-digit";
  dateStyle?: undefined;
  timeStyle?: undefined;
}

/** Готовые стили, как у Intl.DateTimeFormat (с полями не сочетаются). */
interface StyleOptions {
  timeZone?: string;
  dateStyle?: "short" | "medium" | "long";
  timeStyle?: "short";
  weekday?: undefined;
  day?: undefined;
  month?: undefined;
  year?: undefined;
  hour?: undefined;
  minute?: undefined;
}

export type DateFormatOptions = FieldOptions | StyleOptions;

export interface DateFormatter {
  format(date: Date | number): string;
}

export function isTajik(locale: string): boolean {
  return locale === "tg" || locale.toLowerCase().startsWith("tg-");
}

interface ZonedParts {
  year: number;
  /** 1…12. */
  month: number;
  day: number;
  /** 0 — воскресенье. */
  weekday: number;
  hour: number;
  minute: number;
}

/** Числовые части даты в поясе берутся у Intl с en-US — он есть в любом браузере. */
const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function zonedParts(date: Date | number, timeZone: string): ZonedParts {
  let fmt = partsFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    partsFormatters.set(timeZone, fmt);
  }
  const parts: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of fmt.formatToParts(date)) parts[part.type] = part.value;
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  return {
    year,
    month,
    day,
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
    // Старые движки пишут полночь как «24» даже при h23.
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function join(separator: string, ...items: string[]): string {
  return items.filter(Boolean).join(separator);
}

function tgDate(p: ZonedParts, o: DateFormatOptions): string {
  // У стилей CLDR для tg день двузначный: «01 Янв 2026».
  switch (o.dateStyle) {
    case "short":
      return `${pad2(p.day)}/${pad2(p.month)}/${pad2(p.year % 100)}`;
    case "medium":
      return `${pad2(p.day)} ${TG_MONTHS_SHORT[p.month - 1]} ${p.year}`;
    case "long":
      return `${pad2(p.day)} ${TG_MONTHS_LONG[p.month - 1]} ${p.year}`;
  }
  const weekday = o.weekday
    ? ((o.weekday === "long" ? TG_WEEKDAYS_LONG : TG_WEEKDAYS_SHORT)[p.weekday] ?? "")
    : "";
  const month = o.month
    ? ((o.month === "long" ? TG_MONTHS_LONG : TG_MONTHS_SHORT)[p.month - 1] ?? "")
    : "";
  const day = o.day ? String(p.day) : "";
  const year = o.year ? String(p.year) : "";
  // «29 Окт», «29 Окт 2026», «Окт 2026».
  const dayMonth = join(" ", day, month);
  if (!weekday) return join(" ", dayMonth, year);
  // «29, Пшб» — так у CLDR для дня недели с числом.
  if (!month) return join(", ", day, weekday, year);
  // «Пшб, 29 Окт», «Пшб, 29 Окт, 2026», полными словами — «Панҷшанбе, 29 Октябр 2026».
  const yearSeparator = o.weekday === "long" && o.month === "long" ? " " : ", ";
  return join(", ", weekday, join(yearSeparator, dayMonth, year));
}

function tgTime(p: ZonedParts, o: DateFormatOptions): string {
  if (o.timeStyle === "short") return `${pad2(p.hour)}:${pad2(p.minute)}`;
  if (!o.hour) return "";
  return o.minute ? `${pad2(p.hour)}:${pad2(p.minute)}` : pad2(p.hour);
}

function formatTg(p: ZonedParts, o: DateFormatOptions): string {
  const date = tgDate(p, o);
  const time = tgTime(p, o);
  if (!date || !time) return date || time;
  // С полным названием месяца — «29 Октябр соати 17:00», с одним днём недели — «Пшб 17:00».
  if (o.month === "long" || o.dateStyle === "long") return `${date} соати ${time}`;
  if (o.weekday && !o.day && !o.month && !o.year) return `${date} ${time}`;
  return `${date}, ${time}`;
}

/** Форматтер даты: для tg — без данных Intl этого языка, для остальных — Intl.DateTimeFormat. */
export function dateFormatter(locale: string, options: DateFormatOptions): DateFormatter {
  const timeZone = options.timeZone ?? displayTimeZone;
  if (!isTajik(locale)) return new Intl.DateTimeFormat(locale, { ...options, timeZone });
  return { format: (date) => formatTg(zonedParts(date, timeZone), options) };
}

/**
 * Названия месяцев и дней недели (дни — с воскресенья) для подписей осей графиков ECharts:
 * у него свои словари, по умолчанию английские.
 */
export function calendarNames(locale: string): {
  month: string[];
  monthAbbr: string[];
  dayOfWeek: string[];
  dayOfWeekAbbr: string[];
} {
  if (isTajik(locale)) {
    return {
      month: [...TG_MONTHS_LONG],
      monthAbbr: [...TG_MONTHS_SHORT],
      dayOfWeek: [...TG_WEEKDAYS_LONG],
      dayOfWeekAbbr: [...TG_WEEKDAYS_SHORT],
    };
  }
  const names = (count: number, at: (i: number) => number, options: Intl.DateTimeFormatOptions) => {
    const fmt = new Intl.DateTimeFormat(locale, { timeZone: "UTC", ...options });
    return Array.from({ length: count }, (_, i) => fmt.format(at(i)));
  };
  const monthAt = (i: number) => Date.UTC(2026, i, 15);
  // 4 января 2026 г. — воскресенье.
  const dayAt = (i: number) => Date.UTC(2026, 0, 4 + i);
  return {
    month: names(12, monthAt, { month: "long" }),
    monthAbbr: names(12, monthAt, { month: "short" }),
    dayOfWeek: names(7, dayAt, { weekday: "long" }),
    dayOfWeekAbbr: names(7, dayAt, { weekday: "short" }),
  };
}

const RELATIVE_UNITS = [
  ["second", 1],
  ["minute", 60],
  ["hour", 3600],
  ["day", 86_400],
  ["week", 604_800],
  ["month", 2_628_000],
  ["year", 31_536_000],
] as const;

type RelativeUnit = (typeof RELATIVE_UNITS)[number][0];

const TG_RELATIVE_UNITS: Record<RelativeUnit, string> = {
  second: "сония",
  minute: "дақиқа",
  hour: "соат",
  day: "рӯз",
  week: "ҳафта",
  month: "моҳ",
  year: "сол",
};

/**
 * Относительное время («5 дақиқа пеш», «пас аз 2 соат»), как `format.relativeTime` у next-intl:
 * единица — по величине разницы, число округляется, «сейчас» — только для секунд.
 */
export function formatRelativeTime(
  locale: string,
  date: Date | number,
  now: Date | number = Date.now(),
): string {
  const seconds = (new Date(date).getTime() - new Date(now).getTime()) / 1000;
  const abs = Math.abs(seconds);
  let unit: RelativeUnit = "second";
  let size = 1;
  for (const [u, s] of RELATIVE_UNITS) {
    if (abs < s) break;
    unit = u;
    size = s;
  }
  const value = Math.round(seconds / size);
  if (!isTajik(locale)) {
    const numeric = unit === "second" ? "auto" : "always";
    return new Intl.RelativeTimeFormat(locale, { numeric }).format(value, unit);
  }
  if (value === 0) return "ҳозир";
  const amount = `${Math.abs(value)} ${TG_RELATIVE_UNITS[unit]}`;
  return value < 0 ? `${amount} пеш` : `пас аз ${amount}`;
}
