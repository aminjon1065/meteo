/**
 * CAP 1.2 (OASIS Common Alerting Protocol) — разбор сообщений SmartMet Alert без I/O:
 * валидация обязательных полей, геометрия областей (polygon/circle → GeoJSON MultiPolygon),
 * ссылки Update/Cancel, окно действия и цвет по severity (как в MeteoAlarm).
 */
import { XMLParser } from "fast-xml-parser";
import { AQ_LEVEL_STYLES } from "./levels";

export const CAP_NAMESPACE = "urn:oasis:names:tc:emergency:cap:1.2";

export const CAP_STATUSES = ["Actual", "Exercise", "System", "Test", "Draft"] as const;
export type CapStatus = (typeof CAP_STATUSES)[number];
export const CAP_MSG_TYPES = ["Alert", "Update", "Cancel", "Ack", "Error"] as const;
export type CapMsgType = (typeof CAP_MSG_TYPES)[number];
export const CAP_SCOPES = ["Public", "Restricted", "Private"] as const;
export type CapScope = (typeof CAP_SCOPES)[number];
export const CAP_URGENCIES = ["Immediate", "Expected", "Future", "Past", "Unknown"] as const;
export type CapUrgency = (typeof CAP_URGENCIES)[number];
export const CAP_SEVERITIES = ["Extreme", "Severe", "Moderate", "Minor", "Unknown"] as const;
export type CapSeverity = (typeof CAP_SEVERITIES)[number];
export const CAP_CERTAINTIES = ["Observed", "Likely", "Possible", "Unlikely", "Unknown"] as const;
export type CapCertainty = (typeof CAP_CERTAINTIES)[number];

export type CapLocale = "tg" | "ru" | "en";

export interface CapNamedValue {
  valueName: string;
  value: string;
}

export interface CapCircle {
  /** [lon, lat] */
  center: [number, number];
  radiusKm: number;
}

/** GeoJSON MultiPolygon (SRID 4326), совместим с типом колонки в @meteo/db. */
export interface CapMultiPolygon {
  type: "MultiPolygon";
  coordinates: number[][][][];
}

export interface CapArea {
  areaDesc: string;
  /** Замкнутые кольца [lon, lat] из <polygon>. */
  polygons: number[][][];
  circles: CapCircle[];
  geocodes: CapNamedValue[];
  altitude: number | null;
  ceiling: number | null;
  /** Объединённая геометрия polygon + circle; null, если область задана только geocode. */
  geometry: CapMultiPolygon | null;
}

export interface CapInfo {
  language: string;
  /** Локаль портала, если язык info — tg/ru/en. */
  locale: CapLocale | null;
  categories: string[];
  event: string;
  responseTypes: string[];
  urgency: CapUrgency;
  severity: CapSeverity;
  certainty: CapCertainty;
  audience: string | null;
  eventCodes: CapNamedValue[];
  effective: Date | null;
  onset: Date | null;
  expires: Date | null;
  senderName: string | null;
  headline: string | null;
  description: string | null;
  instruction: string | null;
  web: string | null;
  contact: string | null;
  parameters: CapNamedValue[];
  areas: CapArea[];
}

export interface CapReference {
  sender: string;
  identifier: string;
  sent: Date | null;
  raw: string;
}

export interface CapAlert {
  identifier: string;
  sender: string;
  sent: Date;
  status: CapStatus;
  msgType: CapMsgType;
  scope: CapScope;
  source: string | null;
  restriction: string | null;
  addresses: string | null;
  codes: string[];
  note: string | null;
  references: CapReference[];
  /** Исходная строка <references>. */
  referencesRaw: string | null;
  incidents: string | null;
  infos: CapInfo[];
}

export class CapParseError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Некорректное сообщение CAP: ${issues.join("; ")}`);
    this.name = "CapParseError";
    this.issues = issues;
  }
}

/** Теги, которые могут повторяться (CAP и Atom/RSS) — всегда массив. */
const ARRAY_TAGS = new Set([
  "info",
  "category",
  "responseType",
  "eventCode",
  "parameter",
  "area",
  "polygon",
  "circle",
  "geocode",
  "code",
  "entry",
  "link",
  "item",
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  ignoreDeclaration: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => ARRAY_TAGS.has(name),
});

type Node = Record<string, unknown>;

function isNode(v: unknown): v is Node {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function text(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") {
    const s = v.trim();
    return s.length ? s : null;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (isNode(v)) return text(v["#text"]);
  return null;
}

function list(v: unknown): unknown[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function texts(v: unknown): string[] {
  return list(v)
    .map((x) => text(x))
    .filter((x): x is string => x !== null);
}

function namedValues(v: unknown): CapNamedValue[] {
  return list(v)
    .filter(isNode)
    .map((n) => ({ valueName: text(n.valueName) ?? "", value: text(n.value) ?? "" }))
    .filter((x) => x.valueName.length > 0);
}

function attr(node: Node, name: string): string | null {
  return text(node[`@_${name}`]);
}

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | null {
  if (value === null) return null;
  const found = allowed.find((a) => a.toLowerCase() === value.toLowerCase());
  return found ?? null;
}

/** Дата CAP: ISO 8601 с явным смещением (2026-10-16T12:00:00+05:00); "Z" тоже принимаем. */
export function parseCapDateTime(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(s)) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** <references>: "sender,identifier,sent sender,identifier,sent" (разделитель — пробел). */
export function parseCapReferences(raw: string | null | undefined): CapReference[] {
  if (!raw) return [];
  const out: CapReference[] = [];
  for (const token of raw.trim().split(/\s+/)) {
    if (!token) continue;
    const parts = token.split(",");
    if (parts.length >= 3) {
      out.push({
        sender: parts[0] ?? "",
        identifier: parts[1] ?? "",
        sent: parseCapDateTime(parts.slice(2).join(",")),
        raw: token,
      });
    } else if (parts.length === 2) {
      out.push({
        sender: "",
        identifier: parts[0] ?? "",
        sent: parseCapDateTime(parts[1]),
        raw: token,
      });
    } else {
      out.push({ sender: "", identifier: token, sent: null, raw: token });
    }
  }
  return out.filter((r) => r.identifier.length > 0);
}

/** <polygon>: "lat,lon lat,lon …" → замкнутое кольцо [lon, lat]; null, если точек меньше 3. */
export function parseCapPolygon(raw: string): number[][] | null {
  const ring: number[][] = [];
  for (const token of raw.trim().split(/\s+/)) {
    if (!token) continue;
    const [latRaw, lonRaw, ...rest] = token.split(",");
    if (rest.length > 0 || latRaw === undefined || lonRaw === undefined) return null;
    const lat = Number(latRaw);
    const lon = Number(lonRaw);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    ring.push([lon, lat]);
  }
  if (ring.length < 3) return null;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
    ring.push([first[0] as number, first[1] as number]);
  }
  return ring.length >= 4 ? ring : null;
}

/** <circle>: "lat,lon radius" (радиус в км). */
export function parseCapCircle(raw: string): CapCircle | null {
  const m = raw.trim().match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  const radiusKm = Number(m[3]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || !(radiusKm > 0)) return null;
  return { center: [lon, lat], radiusKm };
}

const KM_PER_DEG_LAT = 111.32;

/** Круг → кольцо из `steps` вершин (равнопромежуточная проекция; радиусы до ~200 км). */
export function circleToRing(circle: CapCircle, steps = 48): number[][] {
  const [lon, lat] = circle.center;
  const dLat = circle.radiusKm / KM_PER_DEG_LAT;
  const dLon = circle.radiusKm / (KM_PER_DEG_LAT * Math.max(Math.cos((lat * Math.PI) / 180), 1e-6));
  const ring: number[][] = [];
  for (let i = 0; i < steps; i += 1) {
    const a = (2 * Math.PI * i) / steps;
    ring.push([round6(lon + dLon * Math.sin(a)), round6(lat + dLat * Math.cos(a))]);
  }
  const first = ring[0];
  if (first) ring.push([first[0] as number, first[1] as number]);
  return ring;
}

function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

/** Геометрия области: все полигоны и круги как отдельные части MultiPolygon. */
export function areaGeometry(polygons: number[][][], circles: CapCircle[]): CapMultiPolygon | null {
  const parts = [...polygons.map((ring) => [ring]), ...circles.map((c) => [circleToRing(c)])];
  return parts.length ? { type: "MultiPolygon", coordinates: parts } : null;
}

/** Язык RFC 3066 → локаль портала. */
export function normalizeCapLocale(language: string | null | undefined): CapLocale | null {
  const code = (language ?? "").trim().toLowerCase().split(/[-_]/)[0];
  if (code === "tg" || code === "tgk" || code === "tj") return "tg";
  if (code === "ru" || code === "rus") return "ru";
  if (code === "en" || code === "eng") return "en";
  return null;
}

function parseArea(node: Node, issues: string[], where: string): CapArea | null {
  const areaDesc = text(node.areaDesc);
  if (!areaDesc) {
    issues.push(`${where}: area без areaDesc`);
    return null;
  }
  const polygons: number[][][] = [];
  for (const raw of texts(node.polygon)) {
    const ring = parseCapPolygon(raw);
    if (ring) polygons.push(ring);
    else issues.push(`${where}: некорректный polygon «${raw.slice(0, 40)}»`);
  }
  const circles: CapCircle[] = [];
  for (const raw of texts(node.circle)) {
    const c = parseCapCircle(raw);
    if (c) circles.push(c);
    else issues.push(`${where}: некорректный circle «${raw.slice(0, 40)}»`);
  }
  const altitude = text(node.altitude);
  const ceiling = text(node.ceiling);
  return {
    areaDesc,
    polygons,
    circles,
    geocodes: namedValues(node.geocode),
    altitude: altitude !== null && Number.isFinite(Number(altitude)) ? Number(altitude) : null,
    ceiling: ceiling !== null && Number.isFinite(Number(ceiling)) ? Number(ceiling) : null,
    geometry: areaGeometry(polygons, circles),
  };
}

function parseInfo(node: Node, index: number, issues: string[]): CapInfo | null {
  const where = `info[${index}]`;
  const event = text(node.event);
  const categories = texts(node.category);
  const urgency = oneOf(text(node.urgency), CAP_URGENCIES);
  const severity = oneOf(text(node.severity), CAP_SEVERITIES);
  const certainty = oneOf(text(node.certainty), CAP_CERTAINTIES);
  if (!event) issues.push(`${where}: нет event`);
  if (categories.length === 0) issues.push(`${where}: нет category`);
  if (!urgency) issues.push(`${where}: нет или неизвестный urgency`);
  if (!severity) issues.push(`${where}: нет или неизвестный severity`);
  if (!certainty) issues.push(`${where}: нет или неизвестный certainty`);
  const dates = {
    effective: text(node.effective),
    onset: text(node.onset),
    expires: text(node.expires),
  };
  const parsedDates: Record<keyof typeof dates, Date | null> = {
    effective: null,
    onset: null,
    expires: null,
  };
  for (const key of Object.keys(dates) as Array<keyof typeof dates>) {
    const raw = dates[key];
    if (raw === null) continue;
    const d = parseCapDateTime(raw);
    if (!d) issues.push(`${where}: некорректная дата ${key} «${raw}»`);
    parsedDates[key] = d;
  }
  const areas = list(node.area)
    .filter(isNode)
    .map((a) => parseArea(a, issues, where))
    .filter((a): a is CapArea => a !== null);
  if (!event || !urgency || !severity || !certainty || categories.length === 0) return null;
  const language = text(node.language) ?? "en-US";
  return {
    language,
    locale: normalizeCapLocale(language),
    categories,
    event,
    responseTypes: texts(node.responseType),
    urgency,
    severity,
    certainty,
    audience: text(node.audience),
    eventCodes: namedValues(node.eventCode),
    effective: parsedDates.effective,
    onset: parsedDates.onset,
    expires: parsedDates.expires,
    senderName: text(node.senderName),
    headline: text(node.headline),
    description: text(node.description),
    instruction: text(node.instruction),
    web: text(node.web),
    contact: text(node.contact),
    parameters: namedValues(node.parameter),
    areas,
  };
}

/** Корневой элемент документа (без префикса пространства имён). */
export function xmlRootName(xml: string): string | null {
  const m = xml.match(/<(?:[\w.-]+:)?([A-Za-z][\w.-]*)[\s>/]/);
  return m?.[1] ?? null;
}

/**
 * Разбирает одно сообщение CAP 1.2. Бросает CapParseError, если нет обязательных
 * полей (identifier, sender, sent, status, msgType, scope; у info — event, category,
 * urgency, severity, certainty) или даты/геометрии не читаются.
 */
export function parseCapAlert(xml: string): CapAlert {
  let doc: unknown;
  try {
    doc = parser.parse(xml);
  } catch (error) {
    throw new CapParseError([`XML не разбирается: ${(error as Error).message}`]);
  }
  const root = isNode(doc) ? doc.alert : undefined;
  if (!isNode(root)) throw new CapParseError(["нет корневого элемента <alert>"]);
  const issues: string[] = [];
  const identifier = text(root.identifier);
  const sender = text(root.sender);
  const sentRaw = text(root.sent);
  const sent = parseCapDateTime(sentRaw);
  const status = oneOf(text(root.status), CAP_STATUSES);
  const msgType = oneOf(text(root.msgType), CAP_MSG_TYPES);
  const scope = oneOf(text(root.scope), CAP_SCOPES);
  if (!identifier) issues.push("нет identifier");
  if (!sender) issues.push("нет sender");
  if (!sent) issues.push(sentRaw ? `некорректная дата sent «${sentRaw}»` : "нет sent");
  if (!status) issues.push("нет или неизвестный status");
  if (!msgType) issues.push("нет или неизвестный msgType");
  if (!scope) issues.push("нет или неизвестный scope");
  const infos = list(root.info)
    .filter(isNode)
    .map((n, i) => parseInfo(n, i, issues))
    .filter((i): i is CapInfo => i !== null);
  if ((msgType === "Alert" || msgType === "Update") && infos.length === 0 && issues.length === 0) {
    issues.push("у Alert/Update нет ни одного info");
  }
  if (issues.length > 0 || !identifier || !sender || !sent || !status || !msgType || !scope) {
    throw new CapParseError(issues.length ? issues : ["неполное сообщение"]);
  }
  const referencesRaw = text(root.references);
  return {
    identifier,
    sender,
    sent,
    status,
    msgType,
    scope,
    source: text(root.source),
    restriction: text(root.restriction),
    addresses: text(root.addresses),
    codes: texts(root.code),
    note: text(root.note),
    references: parseCapReferences(referencesRaw),
    referencesRaw,
    incidents: text(root.incidents),
    infos,
  };
}

export interface CapFeedSources {
  kind: "alert" | "atom" | "rss" | "html" | "unknown";
  /** Абсолютные ссылки на CAP XML (разрешены относительно baseUrl). */
  links: string[];
  /** CAP XML, встроенные в фид (<content> Atom) или сам документ, если это <alert>. */
  inline: string[];
}

function resolveUrl(href: string, baseUrl?: string): string | null {
  try {
    return baseUrl ? new URL(href, baseUrl).toString() : new URL(href).toString();
  } catch {
    return null;
  }
}

function uniq(values: string[]): string[] {
  return [...new Set(values)];
}

/** Встроенные <alert>…</alert> (например, в <content type="application/cap+xml">). */
function inlineAlerts(xml: string): string[] {
  const out: string[] = [];
  const re = /<(?:[\w.-]+:)?alert(?=[\s>])[\s\S]*?<\/(?:[\w.-]+:)?alert>/g;
  for (const m of xml.matchAll(re)) out.push(m[0]);
  return out;
}

/**
 * Определяет источник: одиночный CAP, Atom‑фид (ссылки entry/link или встроенный content),
 * RSS (item/link или enclosure) либо HTML‑листинг каталога (ссылки на *.xml).
 */
export function parseCapFeed(body: string, baseUrl?: string): CapFeedSources {
  const root = xmlRootName(body);
  if (root === "alert") return { kind: "alert", links: [], inline: [body] };
  if (root === "feed" || root === "rss") {
    let doc: unknown;
    try {
      doc = parser.parse(body);
    } catch {
      return { kind: "unknown", links: [], inline: [] };
    }
    const links: string[] = [];
    if (root === "feed") {
      const feed = isNode(doc) && isNode(doc.feed) ? doc.feed : {};
      for (const entry of list(feed.entry).filter(isNode)) {
        const candidates = list(entry.link).filter(isNode);
        const preferred =
          candidates.find((l) => (attr(l, "type") ?? "").includes("cap")) ??
          candidates.find((l) => (attr(l, "rel") ?? "alternate") === "alternate") ??
          candidates[0];
        const href = preferred ? attr(preferred, "href") : null;
        const content = entry.content;
        const hasInline = isNode(content) && isNode(content.alert);
        if (href && !hasInline) {
          const url = resolveUrl(href, baseUrl);
          if (url) links.push(url);
        }
      }
      return { kind: "atom", links: uniq(links), inline: inlineAlerts(body) };
    }
    const rss = isNode(doc) && isNode(doc.rss) ? doc.rss : {};
    const channel = isNode(rss.channel) ? rss.channel : {};
    for (const item of list(channel.item).filter(isNode)) {
      const enclosure = isNode(item.enclosure) ? attr(item.enclosure, "url") : null;
      const href = enclosure ?? texts(item.link)[0] ?? null;
      const url = href ? resolveUrl(href, baseUrl) : null;
      if (url) links.push(url);
    }
    return { kind: "rss", links: uniq(links), inline: inlineAlerts(body) };
  }
  // HTML‑листинг каталога (nginx/apache autoindex): все ссылки на .xml
  const hrefs: string[] = [];
  for (const m of body.matchAll(/href\s*=\s*["']([^"']+\.xml)["']/gi)) {
    const url = m[1] ? resolveUrl(m[1], baseUrl) : null;
    if (url) hrefs.push(url);
  }
  if (hrefs.length > 0) return { kind: "html", links: uniq(hrefs), inline: [] };
  return { kind: "unknown", links: [], inline: [] };
}

// ---------------------------------------------------------------------------
// Семантика отображения
// ---------------------------------------------------------------------------

/** Публикуются только действительные сообщения типа Alert/Update (Test/Exercise — лишь в админке). */
export function isCapPublishable(alert: { status: string; msgType: string }): boolean {
  return alert.status === "Actual" && (alert.msgType === "Alert" || alert.msgType === "Update");
}

export const CAP_SEVERITY_RANK: Record<CapSeverity, number> = {
  Extreme: 4,
  Severe: 3,
  Moderate: 2,
  Minor: 1,
  Unknown: 0,
};

export type CapSeverityColorKey = "red" | "orange" | "yellow" | "none";

export interface CapSeverityStyle {
  severity: CapSeverity;
  key: CapSeverityColorKey;
  /** Уровень цветовой шкалы портала (токены --aq-N): 2 жёлтый, 3 оранжевый, 4 красный, 0 серый. */
  level: 0 | 2 | 3 | 4;
  color: string;
  foreground: string;
}

/** Цвета как в MeteoAlarm: Minor — жёлтый, Moderate — оранжевый, Severe и Extreme — красный. */
export const CAP_SEVERITY_STYLES: Record<CapSeverity, CapSeverityStyle> = {
  Extreme: {
    severity: "Extreme",
    key: "red",
    level: 4,
    color: AQ_LEVEL_STYLES[4].color,
    foreground: AQ_LEVEL_STYLES[4].foreground,
  },
  Severe: {
    severity: "Severe",
    key: "red",
    level: 4,
    color: AQ_LEVEL_STYLES[4].color,
    foreground: AQ_LEVEL_STYLES[4].foreground,
  },
  Moderate: {
    severity: "Moderate",
    key: "orange",
    level: 3,
    color: AQ_LEVEL_STYLES[3].color,
    foreground: AQ_LEVEL_STYLES[3].foreground,
  },
  Minor: {
    severity: "Minor",
    key: "yellow",
    level: 2,
    color: AQ_LEVEL_STYLES[2].color,
    foreground: AQ_LEVEL_STYLES[2].foreground,
  },
  Unknown: {
    severity: "Unknown",
    key: "none",
    level: 0,
    color: AQ_LEVEL_STYLES[0].color,
    foreground: AQ_LEVEL_STYLES[0].foreground,
  },
};

export function severityStyle(severity: string | null | undefined): CapSeverityStyle {
  const s = oneOf(severity ?? null, CAP_SEVERITIES) ?? "Unknown";
  return CAP_SEVERITY_STYLES[s];
}

export function maxSeverity(values: Iterable<string | null | undefined>): CapSeverity {
  let best: CapSeverity = "Unknown";
  for (const v of values) {
    const s = oneOf(v ?? null, CAP_SEVERITIES) ?? "Unknown";
    if (CAP_SEVERITY_RANK[s] > CAP_SEVERITY_RANK[best]) best = s;
  }
  return best;
}

export interface CapWindow {
  start: Date;
  end: Date | null;
}

/** Окно действия info: начало — onset, иначе effective, иначе sent; конец — expires. */
export function capWindow(
  info: { onset: Date | null; effective: Date | null; expires: Date | null },
  sent: Date,
): CapWindow {
  return { start: info.onset ?? info.effective ?? sent, end: info.expires };
}

export function isCapActive(window: CapWindow, now: Date): boolean {
  return window.start.getTime() <= now.getTime() && (window.end === null || window.end > now);
}

export function isCapUpcoming(window: CapWindow, now: Date): boolean {
  return window.start.getTime() > now.getTime() && (window.end === null || window.end > now);
}

/** Пересекается ли окно с интервалом [from, to). */
export function capOverlaps(window: CapWindow, from: Date, to: Date): boolean {
  return window.start < to && (window.end === null || window.end > from);
}

const LOCALE_FALLBACK: CapLocale[] = ["tg", "ru", "en"];

/** Выбор info для локали с фолбэком tg → ru → en → первый блок. */
export function pickCapInfo<T extends { locale: string | null }>(
  infos: readonly T[],
  locale: CapLocale,
): T | null {
  const own = infos.find((i) => i.locale === locale);
  if (own) return own;
  for (const fallback of LOCALE_FALLBACK) {
    const found = infos.find((i) => i.locale === fallback);
    if (found) return found;
  }
  return infos[0] ?? null;
}
