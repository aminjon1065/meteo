"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { AQ_LEVEL_STYLES } from "@meteo/core";
import { type Locale, pick } from "@meteo/i18n";
import { cn } from "@meteo/ui/lib/utils";
import type { Point } from "geojson";
import * as maplibregl from "maplibre-gl";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import { buildBasemapStyle, ensurePmtilesProtocol, TAJIKISTAN_BOUNDS } from "./basemap";

export interface SilamOverlay {
  /** URL PNG‑слоя (/silam/…) */
  url: string;
  /** Внешние границы растра (градусы) */
  bounds: { west: number; south: number; east: number; north: number };
}

export interface StationMapProps {
  locale: Locale;
  /** Растровый слой SILAM поверх подложки (null — выключен). */
  overlay?: SilamOverlay | null;
  /** GeoJSON действующих CAP‑предупреждений (/api/v1/alerts?format=geojson); null — слой выключен. */
  warningsUrl?: string | null;
  /** Ссылка и подпись кнопки в попапе предупреждения. */
  warningsHref?: string;
  warningsOpenLabel?: string;
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
    AQ_LEVEL_STYLES[0].color,
  ];
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

/** Карта станций: кластеры, маркеры по уровню, попапы. Данные — /api/v1/stations. */
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
  warningsUrl,
  warningsHref,
  warningsOpenLabel,
  unsupportedLabel,
}: StationMapProps) {
  const containerRef = useRef<HTMLElement>(null);
  const [unsupported, setUnsupported] = useState(false);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<SilamOverlay | null>(overlay ?? null);
  overlayRef.current = overlay ?? null;
  const warningsRef = useRef<string | null>(warningsUrl ?? null);
  warningsRef.current = warningsUrl ?? null;
  const applyRef = useRef<(() => void) | null>(null);
  const applyWarningsRef = useRef<(() => void) | null>(null);
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
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    if (!compact) {
      map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
      map.addControl(new maplibregl.FullscreenControl(), "top-right");
      map.addControl(
        new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true } }),
        "top-right",
      );
    }

    const applyOverlay = () => {
      const o = overlayRef.current;
      const existing = map.getSource("silam") as maplibregl.ImageSource | undefined;
      if (!o) {
        if (map.getLayer("silam-raster"))
          map.setLayoutProperty("silam-raster", "visibility", "none");
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
        // Под подписями подложки, под предупреждениями и станциями: первый symbol‑слой стиля.
        const firstSymbol = map.getLayer("warnings-fill")
          ? "warnings-fill"
          : map.getStyle().layers.find((l) => l.type === "symbol")?.id;
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
          firstSymbol,
        );
      } else {
        existing.updateImage({ url: o.url, coordinates });
        map.setLayoutProperty("silam-raster", "visibility", "visible");
      }
    };

    const periodFmt = new Intl.DateTimeFormat(locale, {
      timeZone: "Asia/Dushanbe",
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
        return;
      }
      if (existing) {
        existing.setData(url);
        for (const id of ["warnings-fill", "warnings-line"]) {
          if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "visible");
        }
        return;
      }
      map.addSource("warnings", { type: "geojson", data: url });
      const firstSymbol = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
      map.addLayer(
        {
          id: "warnings-fill",
          type: "fill",
          source: "warnings",
          paint: { "fill-color": ["get", "color"], "fill-opacity": 0.28 },
        },
        firstSymbol,
      );
      map.addLayer(
        {
          id: "warnings-line",
          type: "line",
          source: "warnings",
          paint: { "line-color": ["get", "color"], "line-width": 2, "line-opacity": 0.9 },
        },
        firstSymbol,
      );
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
    };

    const addStations = () => {
      applyOverlay();
      applyWarnings();
      if (map.getSource("stations")) return;
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
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", layer, () => {
          map.getCanvas().style.cursor = "";
        });
      }
    };
    map.on("load", addStations);
    map.on("style.load", addStations);
    applyRef.current = applyOverlay;
    applyWarningsRef.current = applyWarnings;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setStyle(buildBasemapStyle(theme, locale), { diff: false });
  }, [theme, locale]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: overlay — триггер; актуальное значение читается из overlayRef
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !applyRef.current) return;
    if (map.isStyleLoaded()) applyRef.current();
    // Иначе слой добавит обработчик style.load (addStations → applyOverlay).
  }, [overlay]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: warningsUrl — триггер; значение читается из warningsRef
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !applyWarningsRef.current) return;
    if (map.isStyleLoaded()) applyWarningsRef.current();
  }, [warningsUrl]);

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
    <section ref={containerRef} className={className} aria-label={ariaLabel ?? "Stations map"} />
  );
}
