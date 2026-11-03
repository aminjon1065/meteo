"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { AQ_LEVEL_STYLES } from "@meteo/core";
import { type Locale, pick } from "@meteo/i18n";
import { AQ_FACES } from "@meteo/ui/components/aq-badge";
import { cn } from "@meteo/ui/lib/utils";
import type { Feature, FeatureCollection, MultiPolygon, Point } from "geojson";
import * as maplibregl from "maplibre-gl";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import { dateFormatter } from "@/lib/date-format";
import {
  type Basemap,
  buildBasemapStyle,
  ensurePmtilesProtocol,
  TAJIKISTAN_BOUNDS,
} from "./basemap";
import { invertOutline } from "./outline-mask";

export interface SilamOverlay {
  /** URL PNG‑слоя (/silam/…) */
  url: string;
  /** Внешние границы растра (градусы) */
  bounds: { west: number; south: number; east: number; north: number };
}

/** Слой погоды SmartMet: шаблоны адресов тайлов /wms/…/{z}/{x}/{y}.png (weather-layers.ts). */
export interface WeatherOverlay {
  /** Заливка (изобанды). */
  tiles: string;
  /** Стрелки ветра поверх заливки. */
  arrows?: string | null;
  /** Область данных модели: тайлы вне неё не запрашиваются. */
  bounds: { west: number; south: number; east: number; north: number };
  minzoom: number;
  maxzoom: number;
}

export interface BoundariesLayer {
  /** GeoJSON областей (/api/v1/regions). */
  regionsUrl: string;
  /** GeoJSON районов (/api/v1/districts); null — районы не показывать. */
  districtsUrl?: string | null;
  /** Контуры областей (и районов при зуме ≥ 8) видимы. */
  visible: boolean;
  /** Заливка областей цветом худшего текущего уровня индекса. */
  fill: boolean;
  /** Ссылка в попапе области (список станций, с локалью). */
  href: string;
  labels: {
    /** Подпись числа станций в попапе («Станции»). */
    stations: string;
    /** Текст ссылки в попапе. */
    open: string;
  };
}

/** Маркер погоды в городе: значок SmartSymbol и температура, по клику — попап со ссылкой на прогноз. */
export interface CityMarker {
  slug: string;
  name: string;
  lon: number;
  lat: number;
  /** Температура сейчас («13°»); null — только значок. */
  temp: string | null;
  /** Значок для светлой и тёмной темы и его описание; null — только температура. */
  symbol: { light: string; dark: string; label: string } | null;
  /** Строки попапа под названием: описание погоды, максимум и минимум за сутки. */
  details: string[];
  /** Страница прогноза города (с локалью). */
  href: string;
  /** Крупный город — виден на любом масштабе; остальные — с CITY_MINOR_MIN_ZOOM. */
  featured: boolean;
}

/** Свойства станции на главной карте: подписи уже локализованы на сервере (map-screen.tsx). */
export interface StationFeatureProps {
  slug: string;
  name: string;
  /** Уровень с учётом устаревания: 0 — нет свежих данных. */
  level: number;
  /** Подпись уровня («Умеренное»). */
  label: string;
  /** Определяющее вещество и значение («PM2.5 35 мкг/м³»); null — нет свежих данных. */
  value: string | null;
  /** «Обновлено 09:00» или «Последние данные: …»; null — станция не передавала данные. */
  time: string | null;
}

export interface StationMapProps {
  locale: Locale;
  /**
   * Станции с готовыми подписями (главная). Без него карта сама берёт /api/v1/stations.
   * Станции без свежих данных идут отдельным слоем — бледной точкой с зума EMPTY_STATIONS_MIN_ZOOM.
   */
  stationsData?: FeatureCollection<Point, StationFeatureProps> | null;
  /** Слои станций видимы (на главной скрыты в теме «Погода» и в прогнозе). */
  stationsVisible?: boolean;
  /** Контур страны (/api/v1/regions/outline): всё вне его приглушается. */
  outlineUrl?: string | null;
  /** home — главная: без полноэкранного режима и масштабной линейки, на телефоне без кнопок зума. */
  controls?: "full" | "home";
  /** Высота карточки поверх карты снизу на телефоне (px): страна вписывается над ней. */
  insetBottom?: number;
  /** Тип подложки (basemap.ts); по умолчанию — схема. */
  basemap?: Basemap;
  /** Растровый слой SILAM поверх подложки (null — выключен). */
  overlay?: SilamOverlay | null;
  /** Слой погоды SmartMet (null — выключен). */
  weather?: WeatherOverlay | null;
  /** GeoJSON действующих CAP‑предупреждений (/api/v1/alerts?format=geojson); null — слой выключен. */
  warningsUrl?: string | null;
  /** Ссылка и подпись кнопки в попапе предупреждения. */
  warningsHref?: string;
  warningsOpenLabel?: string;
  /** Подписи попапа предупреждения: уровни опасности (по CAP severity) и «Ожидается». */
  warningLabels?: { severity: Record<string, string>; upcoming: string };
  /** Показать области предупреждений целиком (ссылка /?layer=warnings): один раз после загрузки. */
  fitWarnings?: boolean;
  /** Подписи встроенных элементов MapLibre на языке страницы (map-ui-strings.ts). */
  uiStrings?: Record<string, string>;
  /** Границы областей и районов (FR6.3); null — слой не добавляется. */
  boundaries?: BoundariesLayer | null;
  /** Погода в городах (HTML‑маркеры поверх всех слоёв); null — слой выключен. */
  cities?: CityMarker[] | null;
  /** Slug выбранного города: маркер выделен, при смене карта перелетает к нему. */
  selectedCity?: string | null;
  /** Текст ссылки в попапе города. */
  cityOpenLabel?: string;
  /** Ширина панели поверх карты слева на широком экране (px): страна вписывается правее неё. */
  insetLeft?: number;
  /** Текст ссылки в попапе. */
  openLabel: string;
  /** Подписи статусов для попапа. */
  statusLabels: Record<string, string>;
  /**
   * Попап станции из /api/v1/stations (раздел «Воздух», страница станции): подписи уровней и
   * шаблоны времени «Обновлено {time}» / «Последние данные: {time}». Без них — только статус.
   */
  levelLabels?: Record<number, string>;
  timeLabels?: { updated: string; lastData: string };
  /** Префикс ссылки на страницу станции (с локалью). */
  stationHrefPrefix: string;
  className?: string;
  /** Компактный режим (главная): без части контролов. */
  compact?: boolean;
  /** Центр и зум вместо границ страны (страница станции). */
  center?: [number, number];
  zoom?: number;
  /** Доступное имя области карты (должно отличаться от «Map» канваса MapLibre). */
  ariaLabel?: string;
  /** Текст вместо карты, если браузер не поддерживает WebGL2 (старые телефоны, headless). */
  unsupportedLabel?: string;
}

/** Контейнер карты с экземпляром MapLibre для диагностики в E2E (apps/web/e2e/public/map.spec.ts). */
export interface MapDiagnosticsElement extends HTMLElement {
  __maplibreMap?: maplibregl.Map;
}

/**
 * Порядок оверлеев снизу вверх. Все они вставляются под подписи подложки (первый symbol‑слой
 * стиля), станции добавляются поверх всего: подложка → заливка областей → SILAM → погода SmartMet
 * (заливка, стрелки) → контуры районов и областей → предупреждения → станции.
 */
const OVERLAY_ORDER = [
  "regions-fill",
  "silam-raster",
  "weather-raster",
  "weather-arrows",
  "districts-line",
  "regions-line",
  "warnings-fill",
  "warnings-line-upcoming",
  "warnings-line",
] as const;

/** Слои предупреждений: заливка, контур действующих (сплошной) и ожидаемых (пунктир). */
const WARNING_LAYERS = ["warnings-fill", "warnings-line-upcoming", "warnings-line"] as const;

/** Районы рисуются с зума 8; их GeoJSON запрашивается чуть раньше, чтобы контуры не «догоняли» карту. */
const DISTRICTS_MIN_ZOOM = 8;
const DISTRICTS_PREFETCH_ZOOM = 7;

/** Станции без свежих данных на главной видны с этого масштаба: на масштабе страны они только шум. */
const EMPTY_STATIONS_MIN_ZOOM = 8;
/** Слои станций — для переключения видимости одним вызовом. */
const STATION_LAYERS = [
  "stations-clusters-halo",
  "stations-clusters",
  "stations-cluster-faces",
  "stations-cluster-count",
  "stations-points",
  "stations-faces",
  "stations-empty",
] as const;

const EMPTY_COLLECTION: FeatureCollection = { type: "FeatureCollection", features: [] };

const HOVERED: maplibregl.ExpressionSpecification = ["boolean", ["feature-state", "hover"], false];

/** Картинка «лица» уровня поверх круга станции: имя для icon-image. */
const FACE_IMAGE_PREFIX = "aq-face-";
/** Сторона картинки «лица» в CSS‑пикселях при icon-size 1 (сетка AQ_FACES — 20×20). */
const FACE_IMAGE_SIZE = 20;

/**
 * Регистрирует картинки «лиц» уровней (AQ_FACES из дизайн‑системы) для слоёв станций: на карте
 * уровень различим не только цветом круга (FR1.3). Стиль после setStyle теряет картинки —
 * вызывается при каждой загрузке стиля. Черты — цветом текста уровня (контраст ≥ 4.5:1).
 */
function ensureFaceImages(map: maplibregl.Map) {
  const ratio = 2;
  for (const key of Object.keys(AQ_FACES)) {
    const level = Number(key) as keyof typeof AQ_FACES;
    const id = `${FACE_IMAGE_PREFIX}${level}`;
    if (map.hasImage(id)) continue;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = FACE_IMAGE_SIZE * ratio;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const face = AQ_FACES[level];
    const color = (AQ_LEVEL_STYLES[level] ?? AQ_LEVEL_STYLES[0]).foreground;
    ctx.scale(ratio, ratio);
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.8;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (face.eyes) ctx.fill(new Path2D(face.eyes));
    ctx.stroke(new Path2D(face.stroke));
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    map.addImage(
      id,
      { width: canvas.width, height: canvas.height, data: new Uint8Array(data.data.buffer) },
      { pixelRatio: ratio },
    );
  }
}

/** Значок уровня для HTML попапа: круг цвета уровня с «лицом» (как AqIcon в интерфейсе). */
function faceSvgHtml(level: number, px = 16): string {
  const l = (level in AQ_FACES ? level : 0) as keyof typeof AQ_FACES;
  const face = AQ_FACES[l];
  const style = AQ_LEVEL_STYLES[l] ?? AQ_LEVEL_STYLES[0];
  return (
    `<svg viewBox="0 0 20 20" width="${px}" height="${px}" aria-hidden="true" focusable="false" class="shrink-0" data-aq-icon="${l}">` +
    `<circle cx="10" cy="10" r="10" fill="${style.color}"/>` +
    (face.eyes ? `<path d="${face.eyes}" fill="${style.foreground}"/>` : "") +
    `<path d="${face.stroke}" fill="none" stroke="${style.foreground}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  );
}

const SEVERITY_NUMBER: Record<string, string> = {
  Minor: "1",
  Moderate: "2",
  Severe: "3",
  Extreme: "4",
};

/**
 * Знак уровня опасности для попапа: круг цвета с цифрой 1–4 (как SeverityMark). `level` — уровень
 * цвета из CAP_SEVERITY_STYLES (2 жёлтый, 3 оранжевый, 4 красный): цифра цветом текста уровня.
 */
function severityMarkHtml(level: number, severity: string): string {
  const style = AQ_LEVEL_STYLES[level as keyof typeof AQ_LEVEL_STYLES] ?? AQ_LEVEL_STYLES[0];
  return `<span class="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] leading-none font-bold" style="background:${style.color};color:${style.foreground}" aria-hidden="true">${SEVERITY_NUMBER[severity] ?? "?"}</span>`;
}

/** icon-image «лица» по уровню из свойства (level у станции, worst у кластера). */
function faceImageExpression(property: string): maplibregl.ExpressionSpecification {
  return ["concat", FACE_IMAGE_PREFIX, ["to-string", ["coalesce", ["get", property], 0]]];
}

/** Охват координат GeoJSON (Polygon/MultiPolygon и т. п.): [[west, south], [east, north]]. */
function geojsonBounds(fc: unknown): [[number, number], [number, number]] | null {
  let w = Number.POSITIVE_INFINITY;
  let s = Number.POSITIVE_INFINITY;
  let e = Number.NEGATIVE_INFINITY;
  let n = Number.NEGATIVE_INFINITY;
  const walk = (c: unknown) => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === "number" && typeof c[1] === "number") {
      w = Math.min(w, c[0]);
      e = Math.max(e, c[0]);
      s = Math.min(s, c[1]);
      n = Math.max(n, c[1]);
      return;
    }
    for (const x of c) walk(x);
  };
  const features = (fc as FeatureCollection | null)?.features ?? [];
  for (const f of features) {
    const g = f.geometry as { coordinates?: unknown } | null;
    walk(g?.coordinates);
  }
  return Number.isFinite(w)
    ? [
        [w, s],
        [e, n],
      ]
    : null;
}

function levelColorExpression(property: string): maplibregl.ExpressionSpecification {
  return [
    "match",
    ["get", property],
    0,
    AQ_LEVEL_STYLES[0].color,
    1,
    AQ_LEVEL_STYLES[1].color,
    2,
    AQ_LEVEL_STYLES[2].color,
    3,
    AQ_LEVEL_STYLES[3].color,
    4,
    AQ_LEVEL_STYLES[4].color,
    5,
    AQ_LEVEL_STYLES[5].color,
    6,
    AQ_LEVEL_STYLES[6].color,
    AQ_LEVEL_STYLES[0].color,
  ];
}

/** Заливка областей: с режимом «уровни» — цвет уровня (без данных бледнее), иначе только подсветка при наведении. */
function regionFillOpacity(fill: boolean): maplibregl.ExpressionSpecification {
  return fill
    ? ["case", HOVERED, 0.5, ["==", ["get", "level"], 0], 0.12, 0.32]
    : ["case", HOVERED, 0.12, 0];
}

/** Подложка светлая в обеих темах (basemap.ts), поэтому контуры всегда тёмно‑синие. */
function regionFillColor(fill: boolean): maplibregl.ExpressionSpecification | string {
  return fill ? levelColorExpression("level") : "#334155";
}

/** Контуры: тёмно‑синие на светлых подложках, светлые на снимке. */
function boundaryLineColor(basemap: Basemap): string {
  return basemap === "satellite" ? "#f8fafc" : "#3b4a63";
}

function countryLineColor(basemap: Basemap): string {
  return basemap === "satellite" ? "#ffffff" : "#2b3a52";
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

/**
 * Масштаб, с которого видны маркеры некрупных городов: на масштабе страны Гиссар, Вахдат и
 * Турсунзаде в 20–50 км от Душанбе легли бы на его маркер.
 */
const CITY_MINOR_MIN_ZOOM = 8;

/** Высота маркера города с «хвостиком» (px): на неё попап поднимается над точкой. */
const CITY_MARKER_HEIGHT = 40;
const CITY_POPUP_OFFSET: maplibregl.Offset = {
  center: [0, -CITY_MARKER_HEIGHT / 2],
  top: [0, 4],
  "top-left": [0, 4],
  "top-right": [0, 4],
  bottom: [0, -CITY_MARKER_HEIGHT],
  "bottom-left": [0, -CITY_MARKER_HEIGHT],
  "bottom-right": [0, -CITY_MARKER_HEIGHT],
  left: [8, -CITY_MARKER_HEIGHT / 2],
  right: [-8, -CITY_MARKER_HEIGHT / 2],
};

/**
 * Маркер города — «облачко» над точкой (хвостик указывает на город), чтобы не закрывать станцию
 * в той же точке. Цвета — из темы (карточка), подложка под ним светлая в обеих темах.
 */
function cityMarkerElement(c: CityMarker, selected: boolean): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.dataset.city = c.slug;
  const description = [c.temp, c.symbol?.label].filter(Boolean).join(", ");
  const label = description ? `${c.name}: ${description}` : c.name;
  el.setAttribute("aria-label", label);
  el.title = label;
  if (selected) el.setAttribute("aria-current", "true");
  // Без scale/translate‑утилит: MapLibre ставит маркер через transform, а свойство scale
  // масштабировало бы и это смещение — маркер «уезжал» бы из‑под курсора при наведении.
  el.className = cn(
    "flex h-8 cursor-pointer items-center gap-0.5 rounded-full border bg-card/95 pr-2.5 pl-1 text-sm font-semibold text-foreground shadow-md transition-shadow hover:bg-card hover:shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
    !c.symbol && "pl-2.5",
    selected && "border-primary ring-2 ring-primary",
  );
  if (c.symbol) {
    for (const [src, cls] of [
      [c.symbol.light, "size-7 dark:hidden"],
      [c.symbol.dark, "hidden size-7 dark:block"],
    ] as const) {
      const img = document.createElement("img");
      img.src = src;
      img.alt = "";
      img.setAttribute("aria-hidden", "true");
      img.className = cls;
      el.append(img);
    }
  }
  const temp = document.createElement("span");
  temp.className = "num";
  temp.textContent = c.temp ?? "";
  el.append(temp);
  const tail = document.createElement("span");
  tail.setAttribute("aria-hidden", "true");
  tail.className = cn(
    "absolute -bottom-[5px] left-1/2 size-2.5 -translate-x-1/2 rotate-45 border-r border-b bg-card",
    selected && "border-primary",
  );
  el.append(tail);
  return el;
}

function cityPopupHtml(c: CityMarker, openLabel: string): string {
  return (
    `<div class="font-sans text-sm" data-popup="city"><div class="font-semibold">${escapeHtml(c.name)}</div>` +
    c.details
      .map((d) => `<div class="text-xs text-muted-foreground">${escapeHtml(d)}</div>`)
      .join("") +
    `<a class="mt-1 inline-block text-xs font-medium underline" href="${escapeHtml(c.href)}">${escapeHtml(openLabel)}</a></div>`
  );
}

/** Карта станций: кластеры, маркеры по уровню, попапы, границы регионов. Данные — /api/v1/*. */
export function StationMap({
  locale,
  openLabel,
  statusLabels,
  levelLabels,
  timeLabels,
  stationHrefPrefix,
  className,
  compact,
  center,
  zoom,
  ariaLabel,
  overlay,
  weather,
  warningsUrl,
  warningsHref,
  warningsOpenLabel,
  warningLabels,
  fitWarnings,
  uiStrings,
  boundaries,
  cities,
  selectedCity,
  cityOpenLabel,
  insetLeft,
  unsupportedLabel,
  stationsData,
  stationsVisible = true,
  outlineUrl,
  controls = "full",
  insetBottom,
  basemap = "scheme",
}: StationMapProps) {
  const containerRef = useRef<MapDiagnosticsElement>(null);
  const [unsupported, setUnsupported] = useState(false);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<SilamOverlay | null>(overlay ?? null);
  overlayRef.current = overlay ?? null;
  const weatherRef = useRef<WeatherOverlay | null>(weather ?? null);
  weatherRef.current = weather ?? null;
  const warningsRef = useRef<string | null>(warningsUrl ?? null);
  warningsRef.current = warningsUrl ?? null;
  const boundariesRef = useRef<BoundariesLayer | null>(boundaries ?? null);
  boundariesRef.current = boundaries ?? null;
  const stationsDataRef = useRef(stationsData ?? null);
  stationsDataRef.current = stationsData ?? null;
  const stationsVisibleRef = useRef(stationsVisible);
  stationsVisibleRef.current = stationsVisible;
  const basemapRef = useRef<Basemap>(basemap);
  basemapRef.current = basemap;
  const outlineUrlRef = useRef(outlineUrl ?? null);
  outlineUrlRef.current = outlineUrl ?? null;
  /** Контур и маска после первой загрузки: при смене темы стиль пересоздаётся, данные — нет. */
  const outlineCacheRef = useRef<{
    url: string;
    outline: FeatureCollection;
    mask: FeatureCollection;
  } | null>(null);
  const applyStationsVisibilityRef = useRef<(() => void) | null>(null);
  const applyStationsDataRef = useRef<(() => void) | null>(null);
  const applyRef = useRef<(() => void) | null>(null);
  const applyWeatherRef = useRef<(() => void) | null>(null);
  const applyWarningsRef = useRef<(() => void) | null>(null);
  const applyBoundariesRef = useRef<(() => void) | null>(null);
  const syncDiagnosticsRef = useRef<(() => void) | null>(null);
  /** Маркеры городов на карте (они в DOM, а не в стиле: переживают смену темы и языка). */
  const citiesShownRef = useRef(false);
  /**
   * Стиль готов принимать addSource/addLayer: true после style.load, false сразу после setStyle.
   * map.isStyleLoaded() для этого не годится — он ложен и пока догружаются тайлы, из‑за чего
   * переключение слоя во время прокрутки карты терялось бы.
   */
  const styleReadyRef = useRef(false);
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "dark" ? "dark" : "light";

  // biome-ignore lint/correctness/useExhaustiveDependencies: карта создаётся один раз; тема и язык — через setStyle ниже
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    ensurePmtilesProtocol();
    // Колонка и карточки главной (MapView) раскладываются по-разному с md — 768 px.
    const wide = window.matchMedia("(min-width: 768px)").matches;
    const pad = compact ? 20 : wide ? 40 : 16;
    const inset = insetLeft && wide ? insetLeft : 0;
    const insetB = insetBottom && !wide ? insetBottom : 0;
    // На телефоне сверху переключатели темы и срока.
    const insetT = controls === "home" && !wide ? 52 : 0;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: buildBasemapStyle(theme, locale, basemap),
        ...(center
          ? { center, zoom: zoom ?? 10 }
          : {
              bounds: TAJIKISTAN_BOUNDS,
              fitBoundsOptions: {
                padding: {
                  top: pad + insetT,
                  bottom: pad + insetB,
                  right: pad,
                  left: pad + inset,
                },
              },
            }),
        attributionControl: { compact: true },
        // Без анимации появления подписей и тайлов: каждый её кадр перерисовывает весь холст. Это
        // лишняя работа на слабых телефонах, а без GPU (раннер CI, Lighthouse) Chrome ещё и
        // синхронно читает пиксели каждого кадра — сотни миллисекунд занятого потока.
        fadeDuration: 0,
        cooperativeGestures: compact,
        ...(uiStrings ? { locale: uiStrings } : {}),
      });
    } catch (error) {
      // Нет WebGL2 (старые устройства, headless без GPU): страница должна жить без карты,
      // а не падать в error boundary Next.js целиком.
      console.warn("[map] MapLibre недоступен:", error instanceof Error ? error.message : error);
      setUnsupported(true);
      return;
    }
    mapRef.current = map;
    const container = containerRef.current;
    container.__maplibreMap = map;
    if (controls === "home") {
      // Телефон: зум жестами, кнопки только мешали бы; линейка и полный экран на главной не нужны.
      if (wide)
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      map.addControl(
        new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true } }),
        "top-right",
      );
    } else {
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    }
    if (!compact && controls !== "home") {
      map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
      map.addControl(new maplibregl.FullscreenControl(), "top-right");
      map.addControl(
        new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true } }),
        "top-right",
      );
    }

    /** Перед каким слоем вставлять оверлей, чтобы сохранить порядок OVERLAY_ORDER под подписями подложки. */
    const beforeIdFor = (id: (typeof OVERLAY_ORDER)[number]): string | undefined => {
      const index = OVERLAY_ORDER.indexOf(id);
      for (const above of OVERLAY_ORDER.slice(index + 1)) {
        if (map.getLayer(above)) return above;
      }
      return map.getStyle().layers.find((l) => l.type === "symbol")?.id;
    };
    const isVisible = (id: string) =>
      Boolean(map.getLayer(id)) && map.getLayoutProperty(id, "visibility") !== "none";
    /** data-map-layers: видимые логические слои — для диагностики без доступа к WebGL (E2E). */
    const syncDiagnostics = () => {
      const layers: string[] = [];
      if (citiesShownRef.current) layers.push("cities");
      if (isVisible("stations-points")) layers.push("stations");
      if (isVisible("silam-raster")) layers.push("silam");
      if (isVisible("weather-raster")) layers.push("weather");
      if (isVisible("warnings-fill")) layers.push("warnings");
      if (isVisible("regions-line")) layers.push("regions");
      if (isVisible("regions-fill") && boundariesRef.current?.fill) layers.push("regions-fill");
      if (isVisible("districts-line")) layers.push("districts");
      if (isVisible("country-mask")) layers.push("outline");
      container.dataset.mapLayers = layers.join(" ");
    };

    /**
     * Маска сильнее, когда включён растровый прогноз или снимок: их прямоугольник выходит за границу
     * страны, и за ней цветные поля только отвлекали бы.
     */
    const syncMaskOpacity = () => {
      if (!map.getLayer("country-mask")) return;
      const raster = Boolean(
        overlayRef.current || weatherRef.current || basemapRef.current === "satellite",
      );
      map.setPaintProperty("country-mask", "fill-opacity", raster ? 0.88 : 0.72);
    };

    const applyOverlay = () => {
      const o = overlayRef.current;
      const existing = map.getSource("silam") as maplibregl.ImageSource | undefined;
      if (!o) {
        if (map.getLayer("silam-raster"))
          map.setLayoutProperty("silam-raster", "visibility", "none");
        syncMaskOpacity();
        syncDiagnostics();
        return;
      }
      const coordinates: [[number, number], [number, number], [number, number], [number, number]] =
        [
          [o.bounds.west, o.bounds.north],
          [o.bounds.east, o.bounds.north],
          [o.bounds.east, o.bounds.south],
          [o.bounds.west, o.bounds.south],
        ];
      if (!existing) {
        map.addSource("silam", { type: "image", url: o.url, coordinates });
        map.addLayer(
          {
            id: "silam-raster",
            type: "raster",
            source: "silam",
            paint: {
              "raster-opacity": 1,
              "raster-fade-duration": 0,
              "raster-resampling": "linear",
            },
          },
          beforeIdFor("silam-raster"),
        );
      } else {
        existing.updateImage({ url: o.url, coordinates });
        map.setLayoutProperty("silam-raster", "visibility", "visible");
      }
      syncMaskOpacity();
      syncDiagnostics();
    };

    /**
     * Растровые тайлы погоды SmartMet: источник на каждый слой (заливка, стрелки). Смена срока —
     * setTiles того же источника: MapLibre держит прежние тайлы, пока не загрузятся новые.
     */
    const setWeatherLayer = (
      id: "weather-raster" | "weather-arrows",
      tiles: string | null | undefined,
      w: WeatherOverlay | null,
    ) => {
      const sourceId = id === "weather-raster" ? "weather" : "weather-arrows";
      const existing = map.getSource(sourceId) as maplibregl.RasterTileSource | undefined;
      if (!w || !tiles) {
        if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
        return;
      }
      if (!existing) {
        map.addSource(sourceId, {
          type: "raster",
          tiles: [tiles],
          tileSize: 256,
          bounds: [w.bounds.west, w.bounds.south, w.bounds.east, w.bounds.north],
          minzoom: w.minzoom,
          maxzoom: w.maxzoom,
          attribution: "GFS (NOAA) · SmartMet Server (FMI)",
        });
        map.addLayer(
          {
            id,
            type: "raster",
            source: sourceId,
            paint: {
              "raster-opacity": id === "weather-raster" ? 0.78 : 0.9,
              "raster-fade-duration": 0,
              "raster-resampling": "linear",
            },
          },
          beforeIdFor(id),
        );
        return;
      }
      if (existing.tiles?.[0] !== tiles) existing.setTiles([tiles]);
      map.setLayoutProperty(id, "visibility", "visible");
    };
    const applyWeather = () => {
      const w = weatherRef.current;
      setWeatherLayer("weather-raster", w?.tiles, w);
      setWeatherLayer("weather-arrows", w?.arrows, w);
      syncMaskOpacity();
      syncDiagnostics();
    };

    // Не Intl: в браузере нет его данных для tg, срок в попапе был бы английским.
    const periodFmt = dateFormatter(locale, {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
    const applyWarnings = () => {
      const url = warningsRef.current;
      const existing = map.getSource("warnings") as maplibregl.GeoJSONSource | undefined;
      if (!url) {
        for (const id of WARNING_LAYERS) {
          if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
        }
        syncDiagnostics();
        return;
      }
      if (existing) {
        existing.setData(url);
        for (const id of WARNING_LAYERS) {
          if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "visible");
        }
        syncDiagnostics();
        return;
      }
      map.addSource("warnings", { type: "geojson", data: url });
      // Действующие — заметная заливка и сплошной контур; ожидаемые (начнутся в ближайшие сутки) —
      // бледная заливка и пунктир.
      const isActive: maplibregl.ExpressionSpecification = ["==", ["get", "active"], true];
      map.addLayer(
        {
          id: "warnings-fill",
          type: "fill",
          source: "warnings",
          paint: { "fill-color": ["get", "color"], "fill-opacity": ["case", isActive, 0.28, 0.1] },
        },
        beforeIdFor("warnings-fill"),
      );
      map.addLayer(
        {
          id: "warnings-line-upcoming",
          type: "line",
          source: "warnings",
          filter: ["!", isActive],
          paint: {
            "line-color": ["get", "color"],
            "line-width": 2,
            "line-opacity": 0.9,
            "line-dasharray": [2, 1.5],
          },
        },
        beforeIdFor("warnings-line-upcoming"),
      );
      map.addLayer(
        {
          id: "warnings-line",
          type: "line",
          source: "warnings",
          filter: isActive,
          paint: { "line-color": ["get", "color"], "line-width": 2, "line-opacity": 0.9 },
        },
        beforeIdFor("warnings-line"),
      );
      syncDiagnostics();
    };
    // Обработчики слоёв MapLibre делегируются по id и переживают setStyle — регистрируем один раз,
    // иначе после смены темы клик открывал бы по два попапа.
    map.on("click", "warnings-fill", (e: maplibregl.MapLayerMouseEvent) => {
      // Клик по станции обрабатывает слой станций.
      const onStation = map.queryRenderedFeatures(e.point, {
        layers: ["stations-points", "stations-clusters", "stations-empty"].filter((l) =>
          isVisible(l),
        ),
      });
      if (onStation.length > 0) return;
      const feature = e.features?.[0];
      if (!feature) return;
      const p = feature.properties ?? {};
      const start = p.start ? periodFmt.format(new Date(String(p.start))) : "";
      const end = p.end ? periodFmt.format(new Date(String(p.end))) : "";
      const href = String(p.href ?? warningsHref ?? "/warnings");
      // Уровень опасности словом и цифрой (не только цветом), ожидаемое — с пометкой.
      const severity = String(p.severity ?? "Unknown");
      const severityLabel = warningLabels?.severity[severity] ?? "";
      const upcoming = p.active === false || p.active === "false";
      new maplibregl.Popup({ offset: 8, closeButton: false, maxWidth: "280px" })
        .setLngLat(e.lngLat)
        .setHTML(
          `<div class="font-sans text-sm" data-popup="warning"><div class="flex items-center gap-1.5">${severityMarkHtml(Number(p.level ?? 0), severity)}<span class="text-xs font-medium">${escapeHtml(severityLabel)}</span>${upcoming && warningLabels ? `<span class="text-xs text-muted-foreground">· ${escapeHtml(warningLabels.upcoming)}</span>` : ""}</div>` +
            `<div class="text-xs text-muted-foreground">${escapeHtml(String(p.event ?? ""))}</div>` +
            `<div class="font-semibold">${escapeHtml(String(p.headline ?? ""))}</div>` +
            `<div class="text-xs text-muted-foreground">${escapeHtml(start)}${end ? ` - ${escapeHtml(end)}` : ""}</div>` +
            `<a class="mt-1 inline-block text-xs font-medium underline" href="${escapeHtml(href)}">${escapeHtml(warningsOpenLabel ?? openLabel)}</a></div>`,
        )
        .addTo(map);
    });
    map.on("mouseenter", "warnings-fill", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "warnings-fill", () => {
      map.getCanvas().style.cursor = "";
    });

    /** Границы: контуры областей всегда, районы с зума 8, заливка по уровню — опционально. */
    const applyBoundaries = () => {
      const b = boundariesRef.current;
      const ids = ["regions-fill", "regions-line", "districts-line"];
      if (!b) {
        for (const id of ids) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
        syncDiagnostics();
        return;
      }
      if (!map.getSource("regions")) {
        map.addSource("regions", { type: "geojson", data: b.regionsUrl });
        map.addLayer(
          {
            id: "regions-fill",
            type: "fill",
            source: "regions",
            paint: {
              "fill-color": regionFillColor(b.fill),
              "fill-opacity": regionFillOpacity(b.fill),
            },
          },
          beforeIdFor("regions-fill"),
        );
        map.addLayer(
          {
            id: "regions-line",
            type: "line",
            source: "regions",
            layout: { "line-join": "round", "line-cap": "round" },
            paint: {
              "line-color": boundaryLineColor(basemapRef.current),
              "line-width": ["case", HOVERED, 2.6, 1.3],
              "line-opacity": 0.9,
            },
          },
          beforeIdFor("regions-line"),
        );
      } else {
        map.setPaintProperty("regions-fill", "fill-color", regionFillColor(b.fill));
        map.setPaintProperty("regions-fill", "fill-opacity", regionFillOpacity(b.fill));
      }
      if (
        b.districtsUrl &&
        !map.getSource("districts") &&
        map.getZoom() >= DISTRICTS_PREFETCH_ZOOM
      ) {
        map.addSource("districts", { type: "geojson", data: b.districtsUrl });
        map.addLayer(
          {
            id: "districts-line",
            type: "line",
            source: "districts",
            minzoom: DISTRICTS_MIN_ZOOM,
            layout: { "line-join": "round" },
            paint: {
              "line-color": boundaryLineColor(basemapRef.current),
              "line-width": 0.8,
              "line-opacity": 0.7,
              "line-dasharray": [3, 2],
            },
          },
          beforeIdFor("districts-line"),
        );
      }
      for (const id of ids) {
        if (map.getLayer(id))
          map.setLayoutProperty(id, "visibility", b.visible ? "visible" : "none");
      }
      syncDiagnostics();
    };
    // Районы подгружаются при первом приближении.
    map.on("zoomend", () => {
      const b = boundariesRef.current;
      if (
        b?.districtsUrl &&
        styleReadyRef.current &&
        !map.getSource("districts") &&
        map.getZoom() >= DISTRICTS_PREFETCH_ZOOM
      ) {
        applyBoundaries();
      }
      syncDiagnostics();
    });

    // Наведение: подсветка области (feature-state) и подпись на языке интерфейса.
    let hoveredId: string | number | null = null;
    const hoverLabel = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: "map-hover-label",
      offset: 14,
      maxWidth: "260px",
    });
    const setHovered = (id: string | number | null) => {
      if (!map.getSource("regions")) {
        hoveredId = null;
        return;
      }
      if (hoveredId !== null && hoveredId !== id) {
        map.setFeatureState({ source: "regions", id: hoveredId }, { hover: false });
      }
      hoveredId = id;
      if (id !== null) map.setFeatureState({ source: "regions", id }, { hover: true });
    };
    const stationLayersAt = (point: maplibregl.PointLike) =>
      map.queryRenderedFeatures(point, {
        layers: ["stations-points", "stations-clusters", "stations-empty", "warnings-fill"].filter(
          (l) => isVisible(l),
        ),
      });
    map.on("mousemove", "regions-fill", (e: maplibregl.MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature || feature.id === undefined) return;
      if (feature.id !== hoveredId) setHovered(feature.id);
      // Над станцией или предупреждением подпись области не нужна — у них свои попапы.
      if (stationLayersAt(e.point).length > 0) {
        hoverLabel.remove();
        return;
      }
      const name = pick(parseJson(feature.properties?.name) as Record<string, string>, locale);
      hoverLabel.setLngLat(e.lngLat).setText(name);
      if (!hoverLabel.isOpen()) hoverLabel.addTo(map);
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "regions-fill", () => {
      setHovered(null);
      hoverLabel.remove();
      map.getCanvas().style.cursor = "";
    });
    map.on("click", "regions-fill", (e: maplibregl.MapLayerMouseEvent) => {
      // Клики по станциям и предупреждениям обрабатывают их слои.
      if (stationLayersAt(e.point).length > 0) return;
      const feature = e.features?.[0];
      const b = boundariesRef.current;
      if (!feature || !b) return;
      const p = feature.properties ?? {};
      const name = pick(parseJson(p.name) as Record<string, string>, locale);
      const count = Number(p.stationsCount ?? 0);
      const level = Number(p.level ?? 0);
      const color = (AQ_LEVEL_STYLES[level as keyof typeof AQ_LEVEL_STYLES] ?? AQ_LEVEL_STYLES[0])
        .color;
      hoverLabel.remove();
      new maplibregl.Popup({ offset: 8, closeButton: false, maxWidth: "260px" })
        .setLngLat(e.lngLat)
        .setHTML(
          `<div class="font-sans text-sm" data-popup="region"><div class="flex items-center gap-1.5"><span class="inline-block size-2.5 rounded-full" style="background:${escapeHtml(color)}"></span><span class="font-semibold">${escapeHtml(name)}</span></div>` +
            `<div class="text-xs text-muted-foreground">${escapeHtml(b.labels.stations)}: ${count}</div>` +
            `<a class="mt-1 inline-block text-xs font-medium underline" href="${escapeHtml(b.href)}">${escapeHtml(b.labels.open)}</a></div>`,
        )
        .addTo(map);
    });

    /** Контур страны и маска вне его: над подписями подложки (соседние страны бледнеют), под станциями. */
    const applyOutline = () => {
      const url = outlineUrlRef.current;
      if (!url) {
        for (const id of ["country-mask", "country-line"]) {
          if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
        }
        syncDiagnostics();
        return;
      }
      if (map.getSource("country-mask")) {
        for (const id of ["country-mask", "country-line"]) {
          if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "visible");
        }
        syncDiagnostics();
        return;
      }
      const cached = outlineCacheRef.current?.url === url ? outlineCacheRef.current : null;
      map.addSource("country-mask", { type: "geojson", data: cached?.mask ?? EMPTY_COLLECTION });
      map.addSource("country-outline", {
        type: "geojson",
        data: cached?.outline ?? EMPTY_COLLECTION,
      });
      map.addLayer({
        id: "country-mask",
        type: "fill",
        source: "country-mask",
        paint: { "fill-color": "#eef2f6", "fill-opacity": 0.72 },
      });
      map.addLayer({
        id: "country-line",
        type: "line",
        source: "country-outline",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": countryLineColor(basemapRef.current),
          "line-width": 1.8,
          "line-opacity": 0.9,
        },
      });
      syncMaskOpacity();
      syncDiagnostics();
      if (cached) return;
      fetch(url)
        .then((r) => (r.ok ? (r.json() as Promise<Feature<MultiPolygon | null>>) : null))
        .then((outline) => {
          if (!outline?.geometry) return;
          const entry = {
            url,
            outline: { type: "FeatureCollection", features: [outline] } as FeatureCollection,
            mask: {
              type: "FeatureCollection",
              features: [invertOutline(outline.geometry)],
            } as FeatureCollection,
          };
          outlineCacheRef.current = entry;
          (map.getSource("country-mask") as maplibregl.GeoJSONSource | undefined)?.setData(
            entry.mask,
          );
          (map.getSource("country-outline") as maplibregl.GeoJSONSource | undefined)?.setData(
            entry.outline,
          );
        })
        .catch(() => {
          // Без контура карта просто не приглушает соседей.
        });
    };

    /** Станции с данными (кластеризуются) и без свежих данных (отдельно, бледнее) — главная. */
    const splitStations = (data: FeatureCollection<Point, StationFeatureProps>) => ({
      fresh: { ...data, features: data.features.filter((f) => f.properties.level > 0) },
      empty: { ...data, features: data.features.filter((f) => f.properties.level === 0) },
    });

    const applyStationsVisibility = () => {
      const visibility = stationsVisibleRef.current ? "visible" : "none";
      for (const id of STATION_LAYERS) {
        if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visibility);
      }
      if (!stationsVisibleRef.current) stationPopup?.remove();
      syncDiagnostics();
    };

    const applyStationsData = () => {
      const data = stationsDataRef.current;
      if (!data) return;
      const { fresh, empty } = splitStations(data);
      (map.getSource("stations") as maplibregl.GeoJSONSource | undefined)?.setData(fresh);
      (map.getSource("stations-empty") as maplibregl.GeoJSONSource | undefined)?.setData(empty);
    };

    const addStations = () => {
      styleReadyRef.current = true;
      ensureFaceImages(map);
      applyOverlay();
      applyWeather();
      applyWarnings();
      applyBoundaries();
      applyOutline();
      if (map.getSource("stations")) {
        applyStationsVisibility();
        return;
      }
      const data = stationsDataRef.current;
      if (data) {
        // Главная: кластер — круг цвета худшего уровня с ореолом, без числа (число читалось бы как
        // значение индекса); станции без данных — бледные кольца с приближением.
        const { fresh, empty } = splitStations(data);
        map.addSource("stations", {
          type: "geojson",
          data: fresh,
          cluster: true,
          clusterRadius: 40,
          clusterMaxZoom: 11,
          clusterProperties: { worst: ["max", ["get", "level"]] },
        });
        map.addSource("stations-empty", { type: "geojson", data: empty });
        map.addLayer({
          id: "stations-empty",
          type: "circle",
          source: "stations-empty",
          minzoom: EMPTY_STATIONS_MIN_ZOOM,
          paint: {
            "circle-color": "#ffffff",
            "circle-radius": 5,
            "circle-stroke-width": 2,
            "circle-stroke-color": AQ_LEVEL_STYLES[0].color,
            "circle-opacity": 0.9,
          },
        });
        map.addLayer({
          id: "stations-clusters-halo",
          type: "circle",
          source: "stations",
          filter: ["has", "point_count"],
          paint: {
            "circle-color": levelColorExpression("worst"),
            "circle-radius": ["step", ["get", "point_count"], 21, 5, 25, 20, 30],
            "circle-opacity": 0.28,
          },
        });
        map.addLayer({
          id: "stations-clusters",
          type: "circle",
          source: "stations",
          filter: ["has", "point_count"],
          paint: {
            "circle-color": levelColorExpression("worst"),
            "circle-radius": ["step", ["get", "point_count"], 13, 5, 16, 20, 20],
            "circle-stroke-width": 2.5,
            "circle-stroke-color": "#ffffff",
          },
        });
        map.addLayer({
          id: "stations-cluster-faces",
          type: "symbol",
          source: "stations",
          filter: ["has", "point_count"],
          layout: {
            "icon-image": faceImageExpression("worst"),
            "icon-size": ["step", ["get", "point_count"], 1, 5, 1.2, 20, 1.5],
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          },
        });
        map.addLayer({
          id: "stations-points",
          type: "circle",
          source: "stations",
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-color": levelColorExpression("level"),
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 8, 12, 11],
            "circle-stroke-width": 2.5,
            "circle-stroke-color": "#ffffff",
          },
        });
        // «Лицо» уровня в круге станции: уровень различим без цвета (FR1.3, WCAG 1.4.1).
        map.addLayer({
          id: "stations-faces",
          type: "symbol",
          source: "stations",
          filter: ["!", ["has", "point_count"]],
          layout: {
            "icon-image": faceImageExpression("level"),
            "icon-size": ["interpolate", ["linear"], ["zoom"], 5, 0.8, 12, 1.1],
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          },
        });
      } else {
        map.addSource("stations", {
          type: "geojson",
          data: "/api/v1/stations",
          cluster: true,
          clusterRadius: 48,
          clusterMaxZoom: 12,
          clusterProperties: { worst: ["max", ["get", "level"]] },
        });
        map.addLayer({
          id: "stations-clusters",
          type: "circle",
          source: "stations",
          filter: ["has", "point_count"],
          paint: {
            "circle-color": levelColorExpression("worst"),
            "circle-radius": ["step", ["get", "point_count"], 18, 10, 24, 50, 30],
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
            "circle-opacity": 0.9,
          },
        });
        map.addLayer({
          id: "stations-cluster-count",
          type: "symbol",
          source: "stations",
          filter: ["has", "point_count"],
          layout: {
            "text-field": ["get", "point_count_abbreviated"],
            "text-size": 13,
            "text-font": ["Noto Sans Medium"],
          },
          paint: { "text-color": "#ffffff" },
        });
        map.addLayer({
          id: "stations-points",
          type: "circle",
          source: "stations",
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-color": levelColorExpression("level"),
            "circle-radius": 9,
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
            "circle-opacity": ["case", ["==", ["get", "status"], "suspended"], 0.55, 1],
          },
        });
        map.addLayer({
          id: "stations-faces",
          type: "symbol",
          source: "stations",
          filter: ["!", ["has", "point_count"]],
          layout: {
            "icon-image": faceImageExpression("level"),
            "icon-size": 0.9,
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          },
          paint: { "icon-opacity": ["case", ["==", ["get", "status"], "suspended"], 0.55, 1] },
        });
      }
      applyStationsVisibility();
    };
    map.on("click", "stations-clusters", async (e: maplibregl.MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const source = map.getSource("stations") as maplibregl.GeoJSONSource;
      const expansionZoom = await source.getClusterExpansionZoom(
        feature.properties?.cluster_id as number,
      );
      map.easeTo({
        center: (feature.geometry as Point).coordinates as [number, number],
        zoom: expansionZoom,
      });
    });
    let stationPopup: maplibregl.Popup | null = null;
    const onStationClick = (e: maplibregl.MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const p = feature.properties ?? {};
      const href = `${stationHrefPrefix}/${p.slug}`;
      const coords = (feature.geometry as Point).coordinates as [number, number];
      let html: string;
      if (typeof p.label === "string") {
        // Главная: уровень словом и цветом, значение и время уже подготовлены сервером.
        const level = Number(p.level ?? 0);
        const line = (v: unknown, cls: string) =>
          typeof v === "string" && v ? `<div class="${cls}">${escapeHtml(v)}</div>` : "";
        html =
          `<div class="font-sans text-sm" data-popup="station"><div class="font-semibold leading-snug">${escapeHtml(String(p.name ?? ""))}</div>` +
          `<div class="mt-1 flex items-center gap-1.5">${faceSvgHtml(level)}<span class="font-medium">${escapeHtml(p.label)}</span></div>` +
          line(p.value, "num text-xs") +
          line(p.time, "text-xs text-muted-foreground") +
          `<a class="mt-1.5 inline-block text-xs font-semibold text-brand underline underline-offset-2" href="${escapeHtml(href)}">${escapeHtml(openLabel)}</a></div>`;
      } else {
        const name = pick(parseJson(p.name) as Record<string, string>, locale);
        const region = pick(parseJson(p.region) as Record<string, string> | null, locale);
        const status = statusLabels[p.status as string] ?? String(p.status ?? "");
        // Уровень (0 — нет свежих данных) и время последнего индекса — FR1.1: «последнее
        // обновление» видно и на карте.
        const level = Number(p.level ?? 0);
        const levelLabel = levelLabels?.[level];
        const indexTime = typeof p.indexTime === "string" ? new Date(p.indexTime) : null;
        const timeText =
          indexTime && timeLabels
            ? (level > 0 ? timeLabels.updated : timeLabels.lastData).replace(
                "{time}",
                periodFmt.format(indexTime),
              )
            : "";
        html =
          `<div class="font-sans text-sm" data-popup="station"><div class="font-semibold">${escapeHtml(name)}</div>` +
          `<div class="text-xs text-muted-foreground">${escapeHtml(region)}${region ? " · " : ""}${escapeHtml(status)}</div>` +
          (levelLabel
            ? `<div class="mt-1 flex items-center gap-1.5">${faceSvgHtml(level)}<span class="font-medium">${escapeHtml(levelLabel)}</span></div>`
            : "") +
          (timeText
            ? `<div class="text-xs text-muted-foreground">${escapeHtml(timeText)}</div>`
            : "") +
          `<a class="mt-1 inline-block text-xs font-medium underline" href="${href}">${escapeHtml(openLabel)}</a></div>`;
      }
      stationPopup?.remove();
      stationPopup = new maplibregl.Popup({ offset: 12, closeButton: false, maxWidth: "260px" })
        .setLngLat(coords)
        .setHTML(html)
        .addTo(map);
    };
    map.on("click", "stations-points", onStationClick);
    map.on("click", "stations-empty", onStationClick);
    for (const layer of ["stations-clusters", "stations-points", "stations-empty"]) {
      map.on("mouseenter", layer, () => {
        hoverLabel.remove();
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", layer, () => {
        map.getCanvas().style.cursor = "";
      });
    }
    map.on("load", addStations);
    map.on("style.load", addStations);
    applyRef.current = applyOverlay;
    applyWeatherRef.current = applyWeather;
    applyWarningsRef.current = applyWarnings;
    applyBoundariesRef.current = applyBoundaries;
    applyStationsVisibilityRef.current = applyStationsVisibility;
    applyStationsDataRef.current = applyStationsData;
    syncDiagnosticsRef.current = syncDiagnostics;

    return () => {
      hoverLabel.remove();
      map.remove();
      mapRef.current = null;
      styleReadyRef.current = false;
      delete container.__maplibreMap;
      delete container.dataset.mapLayers;
    };
  }, []);

  // Стиль, с которым карта создана или последний раз перерисована: повторять его не нужно (без этой
  // проверки стиль сразу после создания карты разбирался бы второй раз).
  const styleKeyRef = useRef(`${theme}|${locale}|${basemap}`);
  useEffect(() => {
    const map = mapRef.current;
    const key = `${theme}|${locale}|${basemap}`;
    if (!map || styleKeyRef.current === key) return;
    styleKeyRef.current = key;
    styleReadyRef.current = false;
    map.setStyle(buildBasemapStyle(theme, locale, basemap), { diff: false });
    // Оверлеи вернёт обработчик style.load (addStations).
  }, [theme, locale, basemap]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: overlay — триггер; актуальное значение читается из overlayRef
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !applyRef.current) return;
    if (styleReadyRef.current) applyRef.current();
    // Иначе слой добавит обработчик style.load (addStations → applyOverlay).
  }, [overlay]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: поля weather — триггеры; объект читается из weatherRef
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !applyWeatherRef.current) return;
    if (styleReadyRef.current) applyWeatherRef.current();
  }, [weather?.tiles, weather?.arrows]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: warningsUrl — триггер; значение читается из warningsRef
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !applyWarningsRef.current) return;
    if (styleReadyRef.current) applyWarningsRef.current();
  }, [warningsUrl]);

  // Ссылка /?layer=warnings: карта показывает области предупреждений целиком (один раз).
  const fittedWarningsRef = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fitWarnings || !warningsUrl || fittedWarningsRef.current) return;
    const ctrl = new AbortController();
    fetch(warningsUrl, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((fc: unknown) => {
        const box = geojsonBounds(fc);
        if (!box) return;
        fittedWarningsRef.current = true;
        const wide = window.matchMedia("(min-width: 768px)").matches;
        map.fitBounds(box, {
          padding: {
            top: wide ? 64 : 112,
            bottom: (wide ? 0 : (insetBottom ?? 0)) + 40,
            left: (wide ? (insetLeft ?? 0) : 0) + 40,
            right: 40,
          },
          maxZoom: 9,
          duration: 0,
        });
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [fitWarnings, warningsUrl, insetBottom, insetLeft]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: поля boundaries — триггеры; объект читается из boundariesRef
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !applyBoundariesRef.current) return;
    if (styleReadyRef.current) applyBoundariesRef.current();
  }, [boundaries?.visible, boundaries?.fill, boundaries?.regionsUrl, boundaries?.districtsUrl]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: stationsVisible — триггер; значение читается из stationsVisibleRef
  useEffect(() => {
    if (mapRef.current && styleReadyRef.current) applyStationsVisibilityRef.current?.();
  }, [stationsVisible]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: stationsData — триггер; значение читается из stationsDataRef
  useEffect(() => {
    if (mapRef.current && styleReadyRef.current) applyStationsDataRef.current?.();
  }, [stationsData]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !cities?.length) return;
    const markers = cities.map((c) =>
      new maplibregl.Marker({
        element: cityMarkerElement(c, c.slug === selectedCity),
        anchor: "bottom",
        // Кончик хвостика (≈7 px ниже маркера) — ровно в точке города.
        offset: [0, -7],
      })
        .setLngLat([c.lon, c.lat])
        .setPopup(
          new maplibregl.Popup({
            offset: CITY_POPUP_OFFSET,
            closeButton: false,
            maxWidth: "240px",
          }).setHTML(cityPopupHtml(c, cityOpenLabel ?? openLabel)),
        )
        .addTo(map),
    );
    // Некрупные города — с приближением; выбранный в шапке виден всегда.
    const minor = markers.filter(
      (_, i) => !cities[i]?.featured && cities[i]?.slug !== selectedCity,
    );
    const toggleMinor = () => {
      const hidden = map.getZoom() < CITY_MINOR_MIN_ZOOM;
      for (const m of minor) m.getElement().hidden = hidden;
    };
    toggleMinor();
    map.on("zoom", toggleMinor);
    citiesShownRef.current = true;
    syncDiagnosticsRef.current?.();
    return () => {
      map.off("zoom", toggleMinor);
      for (const m of markers) m.remove();
      citiesShownRef.current = false;
      // При размонтировании карта уже удалена — диагностику обновлять не на чем.
      if (mapRef.current) syncDiagnosticsRef.current?.();
    };
  }, [cities, selectedCity, cityOpenLabel, openLabel]);

  // Смена города в шапке: перелёт к нему. При открытии карта показывает всю страну.
  const shownCityRef = useRef(selectedCity);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || shownCityRef.current === selectedCity) return;
    shownCityRef.current = selectedCity;
    const city = cities?.find((c) => c.slug === selectedCity);
    if (city) map.flyTo({ center: [city.lon, city.lat], zoom: Math.max(map.getZoom(), 8) });
  }, [selectedCity, cities]);

  if (unsupported) {
    return (
      <section
        className={cn(
          "flex items-center justify-center bg-muted/40 p-4 text-center text-sm text-muted-foreground",
          className,
        )}
        aria-label={ariaLabel ?? "Stations map"}
        role="note"
      >
        {unsupportedLabel ?? "The map requires WebGL2, which this browser does not support."}
      </section>
    );
  }
  return (
    <section
      ref={containerRef}
      className={className}
      aria-label={ariaLabel ?? "Stations map"}
      data-map-layers=""
      data-basemap={basemap}
    />
  );
}
