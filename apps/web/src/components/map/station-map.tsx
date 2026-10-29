"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { AQ_LEVEL_STYLES } from "@meteo/core";
import { type Locale, pick } from "@meteo/i18n";
import { cn } from "@meteo/ui/lib/utils";
import type { Point } from "geojson";
import * as maplibregl from "maplibre-gl";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import { dateFormatter } from "@/lib/date-format";
import { buildBasemapStyle, ensurePmtilesProtocol, TAJIKISTAN_BOUNDS } from "./basemap";

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

export interface StationMapProps {
  locale: Locale;
  /** Растровый слой SILAM поверх подложки (null — выключен). */
  overlay?: SilamOverlay | null;
  /** Слой погоды SmartMet (null — выключен). */
  weather?: WeatherOverlay | null;
  /** GeoJSON действующих CAP‑предупреждений (/api/v1/alerts?format=geojson); null — слой выключен. */
  warningsUrl?: string | null;
  /** Ссылка и подпись кнопки в попапе предупреждения. */
  warningsHref?: string;
  warningsOpenLabel?: string;
  /** Границы областей и районов (FR6.3); null — слой не добавляется. */
  boundaries?: BoundariesLayer | null;
  /** Текст ссылки в попапе. */
  openLabel: string;
  /** Подписи статусов для попапа. */
  statusLabels: Record<string, string>;
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
  "warnings-line",
] as const;

/** Районы рисуются с зума 8; их GeoJSON запрашивается чуть раньше, чтобы контуры не «догоняли» карту. */
const DISTRICTS_MIN_ZOOM = 8;
const DISTRICTS_PREFETCH_ZOOM = 7;

const HOVERED: maplibregl.ExpressionSpecification = ["boolean", ["feature-state", "hover"], false];

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

function boundaryLineColor(): string {
  return "#3b4a63";
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

/** Карта станций: кластеры, маркеры по уровню, попапы, границы регионов. Данные — /api/v1/*. */
export function StationMap({
  locale,
  openLabel,
  statusLabels,
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
  boundaries,
  unsupportedLabel,
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
  const applyRef = useRef<(() => void) | null>(null);
  const applyWeatherRef = useRef<(() => void) | null>(null);
  const applyWarningsRef = useRef<(() => void) | null>(null);
  const applyBoundariesRef = useRef<(() => void) | null>(null);
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
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: buildBasemapStyle(theme, locale),
        ...(center
          ? { center, zoom: zoom ?? 10 }
          : { bounds: TAJIKISTAN_BOUNDS, fitBoundsOptions: { padding: compact ? 20 : 40 } }),
        attributionControl: { compact: true },
        cooperativeGestures: compact,
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
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    if (!compact) {
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
      if (isVisible("stations-points")) layers.push("stations");
      if (isVisible("silam-raster")) layers.push("silam");
      if (isVisible("weather-raster")) layers.push("weather");
      if (isVisible("warnings-fill")) layers.push("warnings");
      if (isVisible("regions-line")) layers.push("regions");
      if (isVisible("regions-fill") && boundariesRef.current?.fill) layers.push("regions-fill");
      if (isVisible("districts-line")) layers.push("districts");
      container.dataset.mapLayers = layers.join(" ");
    };

    const applyOverlay = () => {
      const o = overlayRef.current;
      const existing = map.getSource("silam") as maplibregl.ImageSource | undefined;
      if (!o) {
        if (map.getLayer("silam-raster"))
          map.setLayoutProperty("silam-raster", "visibility", "none");
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
        for (const id of ["warnings-fill", "warnings-line"]) {
          if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
        }
        syncDiagnostics();
        return;
      }
      if (existing) {
        existing.setData(url);
        for (const id of ["warnings-fill", "warnings-line"]) {
          if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "visible");
        }
        syncDiagnostics();
        return;
      }
      map.addSource("warnings", { type: "geojson", data: url });
      map.addLayer(
        {
          id: "warnings-fill",
          type: "fill",
          source: "warnings",
          paint: { "fill-color": ["get", "color"], "fill-opacity": 0.28 },
        },
        beforeIdFor("warnings-fill"),
      );
      map.addLayer(
        {
          id: "warnings-line",
          type: "line",
          source: "warnings",
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
        layers: ["stations-points", "stations-clusters"].filter((l) => map.getLayer(l)),
      });
      if (onStation.length > 0) return;
      const feature = e.features?.[0];
      if (!feature) return;
      const p = feature.properties ?? {};
      const start = p.start ? periodFmt.format(new Date(String(p.start))) : "";
      const end = p.end ? periodFmt.format(new Date(String(p.end))) : "";
      const href = String(p.href ?? warningsHref ?? "/warnings");
      new maplibregl.Popup({ offset: 8, closeButton: false, maxWidth: "280px" })
        .setLngLat(e.lngLat)
        .setHTML(
          `<div class="font-sans text-sm"><div class="flex items-center gap-1.5"><span class="inline-block size-2.5 rounded-full" style="background:${escapeHtml(String(p.color ?? "#999"))}"></span><span class="text-xs text-muted-foreground">${escapeHtml(String(p.event ?? ""))}</span></div>` +
            `<div class="font-semibold">${escapeHtml(String(p.headline ?? ""))}</div>` +
            `<div class="text-xs text-muted-foreground">${escapeHtml(start)}${end ? ` — ${escapeHtml(end)}` : ""}</div>` +
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
              "line-color": boundaryLineColor(),
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
              "line-color": boundaryLineColor(),
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
        layers: ["stations-points", "stations-clusters", "warnings-fill"].filter((l) =>
          map.getLayer(l),
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

    const addStations = () => {
      styleReadyRef.current = true;
      applyOverlay();
      applyWeather();
      applyWarnings();
      applyBoundaries();
      if (map.getSource("stations")) {
        syncDiagnostics();
        return;
      }
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
      syncDiagnostics();
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
    map.on("click", "stations-points", (e: maplibregl.MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const p = feature.properties ?? {};
      const name = pick(parseJson(p.name) as Record<string, string>, locale);
      const region = pick(parseJson(p.region) as Record<string, string> | null, locale);
      const status = statusLabels[p.status as string] ?? String(p.status ?? "");
      const href = `${stationHrefPrefix}/${p.slug}`;
      const coords = (feature.geometry as Point).coordinates as [number, number];
      new maplibregl.Popup({ offset: 12, closeButton: false, maxWidth: "260px" })
        .setLngLat(coords)
        .setHTML(
          `<div class="font-sans text-sm"><div class="font-semibold">${escapeHtml(name)}</div>` +
            `<div class="text-xs text-muted-foreground">${escapeHtml(region)}${region ? " · " : ""}${escapeHtml(status)}</div>` +
            `<a class="mt-1 inline-block text-xs font-medium underline" href="${href}">${escapeHtml(openLabel)}</a></div>`,
        )
        .addTo(map);
    });
    for (const layer of ["stations-clusters", "stations-points"]) {
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

    return () => {
      hoverLabel.remove();
      map.remove();
      mapRef.current = null;
      styleReadyRef.current = false;
      delete container.__maplibreMap;
      delete container.dataset.mapLayers;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    styleReadyRef.current = false;
    map.setStyle(buildBasemapStyle(theme, locale), { diff: false });
    // Оверлеи вернёт обработчик style.load (addStations).
  }, [theme, locale]);

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: поля boundaries — триггеры; объект читается из boundariesRef
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !applyBoundariesRef.current) return;
    if (styleReadyRef.current) applyBoundariesRef.current();
  }, [boundaries?.visible, boundaries?.fill, boundaries?.regionsUrl, boundaries?.districtsUrl]);

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
    />
  );
}
