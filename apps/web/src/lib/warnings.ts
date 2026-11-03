import "server-only";
import {
  CAP_SEVERITY_RANK,
  type CapCertainty,
  type CapSeverity,
  type CapSeverityStyle,
  type CapUrgency,
  pickCapInfo,
  severityStyle,
} from "@meteo/core";
import {
  type CapAreaRow,
  type CapWarning,
  getCapSyncState,
  getIntegrationState,
  type LoadWarningsOptions,
  loadCapEventDictionary,
  loadWarnings,
  warningIdsForPoint,
} from "@meteo/db";
import { type I18nText, type Locale, pick } from "@meteo/i18n";
import { getDb } from "@/lib/db";

export interface WarningRegionRef {
  code: string;
  name: I18nText | null;
}

/** Предупреждение, приведённое к одному языку (info для локали с фолбэком и словарём событий). */
export interface LocalizedWarning {
  id: number;
  identifier: string;
  sent: Date;
  msgType: string;
  status: string;
  sourceUrl: string | null;
  language: string;
  infoLocale: string | null;
  eventName: string;
  /** Название события взято из словаря переводов, а не из info. */
  eventTranslated: boolean;
  headline: string;
  description: string | null;
  instruction: string | null;
  web: string | null;
  senderName: string | null;
  severity: CapSeverity;
  style: CapSeverityStyle;
  urgency: CapUrgency;
  certainty: CapCertainty;
  effective: Date | null;
  onset: Date | null;
  expires: Date | null;
  start: Date;
  end: Date | null;
  active: boolean;
  upcoming: boolean;
  regions: WarningRegionRef[];
  regionCodes: string[];
  areaDescs: string[];
  areas: CapAreaRow[];
}

export function localizeWarning(
  w: CapWarning,
  locale: Locale,
  dict: Map<string, I18nText>,
): LocalizedWarning | null {
  const info = pickCapInfo(w.infos, locale);
  if (!info) return null;
  const entry = dict.get(info.event.trim().toLowerCase()) ?? null;
  const own = entry?.[locale]?.trim();
  const translated = info.locale !== locale && Boolean(own || pick(entry, locale));
  const eventName = info.locale === locale ? info.event : own || pick(entry, locale) || info.event;
  const regionMap = new Map<string, I18nText | null>();
  for (const i of w.infos) {
    for (const a of i.areas) if (a.regionCode) regionMap.set(a.regionCode, a.regionName);
  }
  const regions = [...regionMap.entries()].map(([code, name]) => ({ code, name }));
  return {
    id: w.id,
    identifier: w.identifier,
    sent: w.sent,
    msgType: w.msgType,
    status: w.status,
    sourceUrl: w.sourceUrl,
    language: info.language,
    infoLocale: info.locale,
    eventName,
    eventTranslated: translated,
    headline: info.headline ?? eventName,
    description: info.description,
    instruction: info.instruction,
    web: info.web,
    senderName: info.senderName,
    severity: info.severity,
    style: severityStyle(info.severity),
    urgency: info.urgency,
    certainty: info.certainty,
    effective: info.effective,
    onset: info.onset,
    expires: info.expires,
    start: info.start,
    end: info.end,
    active: w.active,
    upcoming: w.upcoming,
    regions,
    regionCodes: regions.map((r) => r.code),
    areaDescs: [...new Set(info.areas.map((a) => a.areaDesc))],
    areas: info.areas,
  };
}

/** Порядок показа: действующие раньше ожидаемых, затем по опасности и началу. */
export function sortWarnings(list: LocalizedWarning[]): LocalizedWarning[] {
  return [...list].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    const rank = CAP_SEVERITY_RANK[b.severity] - CAP_SEVERITY_RANK[a.severity];
    if (rank !== 0) return rank;
    return a.start.getTime() - b.start.getTime();
  });
}

export async function loadLocalizedWarnings(
  locale: Locale,
  opts: LoadWarningsOptions = {},
): Promise<LocalizedWarning[]> {
  const db = getDb();
  const [warnings, dict] = await Promise.all([loadWarnings(db, opts), loadCapEventDictionary(db)]);
  return sortWarnings(
    warnings.map((w) => localizeWarning(w, locale, dict)).filter((w): w is LocalizedWarning => !!w),
  );
}

/** Предупреждения, затрагивающие точку (страница города/станции). */
export async function loadWarningsForPoint(
  locale: Locale,
  point: { lon: number; lat: number; regionCode?: string | null },
  opts: LoadWarningsOptions = {},
): Promise<LocalizedWarning[]> {
  const db = getDb();
  const [warnings, dict] = await Promise.all([loadWarnings(db, opts), loadCapEventDictionary(db)]);
  if (warnings.length === 0) return [];
  const ids = await warningIdsForPoint(db, point, warnings);
  return sortWarnings(
    warnings
      .filter((w) => ids.has(w.id))
      .map((w) => localizeWarning(w, locale, dict))
      .filter((w): w is LocalizedWarning => !!w),
  );
}

/** Допустимый возраст последней синхронизации CAP (задача cap-sync — каждые 5 мин), как в админке. */
const CAP_MAX_AGE_MS = 30 * 60_000;

export interface WarningsFreshness {
  /**
   * Сведения о предупреждениях могут быть неполными: последняя синхронизация с ошибкой или
   * давно. Тогда «предупреждений нет» нельзя показывать как отбой — только с оговоркой.
   */
  stale: boolean;
  /** Последняя успешная синхронизация (null — не было). */
  lastSuccessAt: Date | null;
}

/**
 * Свежесть ленты CAP для публичных страниц (только чтение состояния, которое пишет cap-sync).
 * Источник не настроен (CAP_FEED_URL пуст, синхронизаций не было) — не «устарело»: показывать
 * нечего, и это не сбой. Ошибка чтения состояния — тоже не «устарело», чтобы не пугать зря.
 */
export async function loadWarningsFreshness(now = new Date()): Promise<WarningsFreshness> {
  try {
    const db = getDb();
    const [cap, state] = await Promise.all([getCapSyncState(db), getIntegrationState(db, "cap")]);
    const disabled = cap?.status === "disabled" || (!cap && !state.lastRunAt);
    const okAt =
      cap?.at && cap.status !== "failed" && cap.status !== "disabled" ? new Date(cap.at) : null;
    const lastSuccessAt = okAt ?? (state.lastSuccessAt ? new Date(state.lastSuccessAt) : null);
    if (disabled) return { stale: false, lastSuccessAt };
    const at = cap?.at ? new Date(cap.at) : null;
    const stale = !at || cap?.status === "failed" || now.getTime() - at.getTime() > CAP_MAX_AGE_MS;
    return { stale, lastSuccessAt };
  } catch {
    return { stale: false, lastSuccessAt: null };
  }
}
