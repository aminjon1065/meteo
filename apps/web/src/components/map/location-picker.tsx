"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import * as maplibregl from "maplibre-gl";
import { useTheme } from "next-themes";
import { useEffect, useRef } from "react";
import { buildBasemapStyle, DUSHANBE, ensurePmtilesProtocol } from "./basemap";

export interface LocationPickerProps {
  lat: number | null;
  lon: number | null;
  onChange: (next: { lat: number; lon: number }) => void;
  locale: string;
  className?: string;
}

function round(v: number): number {
  return Math.round(v * 1e5) / 1e5;
}

/** Выбор координат станции: клик или перетаскивание маркера. */
export function LocationPicker({ lat, lon, onChange, locale, className }: LocationPickerProps) {
  const containerRef = useRef<HTMLElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "dark" ? "dark" : "light";

  // biome-ignore lint/correctness/useExhaustiveDependencies: карта создаётся один раз
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    ensurePmtilesProtocol();
    const hasPoint = lat !== null && lon !== null && Number.isFinite(lat) && Number.isFinite(lon);
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: buildBasemapStyle(theme, locale),
        center: hasPoint ? [lon as number, lat as number] : DUSHANBE,
        zoom: hasPoint ? 12 : 6,
        attributionControl: { compact: true },
      });
    } catch (error) {
      // Без WebGL2 координаты вводятся вручную в полях формы; форма не должна падать.
      console.warn("[map] MapLibre недоступен:", error instanceof Error ? error.message : error);
      return;
    }
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    const marker = new maplibregl.Marker({ draggable: true, color: "#164a7c" });
    markerRef.current = marker;
    if (hasPoint) marker.setLngLat([lon as number, lat as number]).addTo(map);
    marker.on("dragend", () => {
      const { lng, lat: la } = marker.getLngLat();
      onChangeRef.current({ lat: round(la), lon: round(lng) });
    });
    map.on("click", (e: maplibregl.MapMouseEvent) => {
      marker.setLngLat(e.lngLat).addTo(map);
      onChangeRef.current({ lat: round(e.lngLat.lat), lon: round(e.lngLat.lng) });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Внешнее изменение координат (ввод в поля) → маркер
  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker || lat === null || lon === null || Number.isNaN(lat) || Number.isNaN(lon))
      return;
    const current = marker.getLngLat();
    const attached = marker.getElement().isConnected;
    if (attached && Math.abs(current.lat - lat) < 1e-7 && Math.abs(current.lng - lon) < 1e-7)
      return;
    marker.setLngLat([lon, lat]).addTo(map);
    if (!map.getBounds().contains([lon, lat])) {
      map.easeTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 10) });
    }
  }, [lat, lon]);

  useEffect(() => {
    mapRef.current?.setStyle(buildBasemapStyle(theme, locale), { diff: false });
  }, [theme, locale]);

  return <section ref={containerRef} className={className} aria-label="location picker" />;
}
