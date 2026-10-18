"use client";

import type { Locale } from "@meteo/i18n";
import { Badge } from "@meteo/ui/components/badge";
import { Button } from "@meteo/ui/components/button";
import { Checkbox } from "@meteo/ui/components/checkbox";
import { NativeSelect, NativeSelectOption } from "@meteo/ui/components/native-select";
import { ChevronLeftIcon, ChevronRightIcon, PauseIcon, PlayIcon } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { SilamOverlay } from "./station-map";
import { StationMapLazy } from "./station-map.lazy";

export interface SilamFrame {
  time: string;
  url: string;
  max: number | null;
}

export interface SilamCatalog {
  run: { originTime: string; fetchedAt: string; bounds: SilamOverlay["bounds"] } | null;
  pollutants: Array<{ code: string; shortName: string; unit: string; frames: SilamFrame[] }>;
}

export interface WarningsLayer {
  /** Число действующих предупреждений (слой включён по умолчанию, если > 0). */
  count: number;
  /** GeoJSON действующих предупреждений. */
  url: string;
  /** Ссылка на раздел предупреждений (с локалью). */
  href: string;
  legend: Array<{ severity: string; label: string; color: string }>;
}

export interface MapViewProps {
  locale: Locale;
  catalog: SilamCatalog;
  warnings: WarningsLayer;
  openLabel: string;
  statusLabels: Record<string, string>;
  stationHrefPrefix: string;
  labels: {
    title: string;
    layers: string;
    stations: string;
    silam: string;
    warnings: string;
    soon: string;
    legend: string;
    pollutant: string;
    time: string;
    run: string;
    noData: string;
    play: string;
    pause: string;
    prev: string;
    next: string;
    hint: string;
    maxInDomain: string;
    warningsNone: string;
    warningsCount: string;
    warningsOpen: string;
    unsupported: string;
  };
  /** Легенда уровней (серверный компонент) */
  legend: ReactNode;
}

const PLAY_INTERVAL_MS = 800;

function nearestFrameIndex(frames: SilamFrame[], now: number): number {
  let best = 0;
  let bestDiff = Number.POSITIVE_INFINITY;
  frames.forEach((f, i) => {
    const diff = Math.abs(new Date(f.time).getTime() - now);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  });
  return best;
}

/** Карта с панелью слоёв: станции, растровый прогноз SILAM с выбором вещества и ползунком времени. */
export function MapView({
  locale,
  catalog,
  warnings,
  openLabel,
  statusLabels,
  stationHrefPrefix,
  labels,
  legend,
}: MapViewProps) {
  const available = catalog.run !== null && catalog.pollutants.length > 0;
  const [silamOn, setSilamOn] = useState(false);
  const [warningsOn, setWarningsOn] = useState(warnings.count > 0);
  const [code, setCode] = useState(catalog.pollutants[0]?.code ?? "");
  const pollutant = useMemo(
    () => catalog.pollutants.find((p) => p.code === code) ?? catalog.pollutants[0],
    [catalog.pollutants, code],
  );
  const frames = pollutant?.frames ?? [];
  const [index, setIndex] = useState(() => nearestFrameIndex(frames, Date.now()));
  const [playing, setPlaying] = useState(false);
  const preloaded = useRef(new Set<string>());

  // Ползунок остаётся на том же часе при смене вещества (у всех веществ один набор часов).
  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(0, frames.length - 1)));
  }, [frames.length]);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setIndex((i) => (frames.length ? (i + 1) % frames.length : 0));
    }, PLAY_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [playing, frames.length]);

  // Предзагрузка кадров выбранного вещества, чтобы перемотка была плавной.
  useEffect(() => {
    if (!silamOn || !pollutant) return;
    for (const f of pollutant.frames) {
      if (preloaded.current.has(f.url)) continue;
      preloaded.current.add(f.url);
      const img = new Image();
      img.src = f.url;
    }
  }, [silamOn, pollutant]);

  const frame = frames[index];
  const overlay: SilamOverlay | null =
    silamOn && available && frame && catalog.run
      ? { url: frame.url, bounds: catalog.run.bounds }
      : null;
  const timeFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        timeZone: "Asia/Dushanbe",
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }),
    [locale],
  );
  const runFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        timeZone: "UTC",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }),
    [locale],
  );

  return (
    <div className="relative h-full w-full">
      <StationMapLazy
        locale={locale}
        openLabel={openLabel}
        statusLabels={statusLabels}
        stationHrefPrefix={stationHrefPrefix}
        className="h-full w-full"
        overlay={overlay}
        warningsUrl={warningsOn ? warnings.url : null}
        warningsHref={warnings.href}
        warningsOpenLabel={labels.warningsOpen}
        unsupportedLabel={labels.unsupported}
      />
      <aside className="absolute top-4 left-4 z-10 flex w-72 max-w-[calc(100%-2rem)] flex-col gap-3 rounded-xl border bg-background/90 p-4 text-sm shadow-md backdrop-blur">
        <h1 className="font-semibold">{labels.title}</h1>
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground uppercase">{labels.layers}</p>
          <div className="flex items-center gap-2">
            <Checkbox id="layer-stations" checked disabled />
            <label htmlFor="layer-stations">{labels.stations}</label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="layer-silam"
              checked={silamOn}
              disabled={!available}
              onCheckedChange={(checked) => {
                setSilamOn(checked === true);
                if (!checked) setPlaying(false);
              }}
            />
            <label htmlFor="layer-silam" className="flex-1">
              {labels.silam}
            </label>
            {!available ? <Badge variant="secondary">{labels.soon}</Badge> : null}
          </div>
          {silamOn && available && pollutant ? (
            <div className="flex flex-col gap-2 rounded-lg border bg-card/60 p-2">
              <NativeSelect
                aria-label={labels.pollutant}
                value={pollutant.code}
                onChange={(e) => setCode(e.target.value)}
                className="h-8 text-xs"
              >
                {catalog.pollutants.map((p) => (
                  <NativeSelectOption key={p.code} value={p.code}>
                    {p.shortName} · {p.unit}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={labels.prev}
                  onClick={() => setIndex((i) => Math.max(0, i - 1))}
                >
                  <ChevronLeftIcon />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={playing ? labels.pause : labels.play}
                  aria-pressed={playing}
                  onClick={() => setPlaying((p) => !p)}
                >
                  {playing ? <PauseIcon /> : <PlayIcon />}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={labels.next}
                  onClick={() => setIndex((i) => Math.min(frames.length - 1, i + 1))}
                >
                  <ChevronRightIcon />
                </Button>
                <span className="ml-1 flex-1 text-xs tabular-nums">
                  {frame ? timeFmt.format(new Date(frame.time)) : "—"}
                </span>
              </div>
              <input
                type="range"
                aria-label={labels.time}
                min={0}
                max={Math.max(0, frames.length - 1)}
                value={index}
                onChange={(e) => {
                  setPlaying(false);
                  setIndex(Number(e.target.value));
                }}
                className="w-full accent-brand"
              />
              <p className="text-[11px] leading-snug text-muted-foreground">
                {frame?.max !== null && frame?.max !== undefined
                  ? `${labels.maxInDomain.replace("{value}", String(Math.round(frame.max * 10) / 10)).replace("{unit}", pollutant.unit)} · `
                  : ""}
                {catalog.run
                  ? labels.run.replace("{time}", runFmt.format(new Date(catalog.run.originTime)))
                  : ""}
              </p>
              <p className="text-[11px] leading-snug text-muted-foreground">{labels.hint}</p>
            </div>
          ) : null}
          {!available ? (
            <p className="text-xs leading-snug text-muted-foreground">{labels.noData}</p>
          ) : null}
          <div className="flex items-center gap-2">
            <Checkbox
              id="layer-warnings"
              checked={warningsOn}
              onCheckedChange={(checked) => setWarningsOn(checked === true)}
            />
            <label htmlFor="layer-warnings" className="flex-1">
              {labels.warnings}
            </label>
            <Badge variant={warnings.count > 0 ? "destructive" : "secondary"}>
              {labels.warningsCount}
            </Badge>
          </div>
          {warningsOn ? (
            <div className="flex flex-col gap-1 rounded-lg border bg-card/60 p-2 text-xs">
              {warnings.count === 0 ? (
                <p className="text-muted-foreground">{labels.warningsNone}</p>
              ) : null}
              <ul className="flex flex-wrap gap-x-3 gap-y-1">
                {warnings.legend.map((l) => (
                  <li key={l.severity} className="flex items-center gap-1.5">
                    <span
                      className="inline-block size-2.5 rounded-full"
                      style={{ background: l.color }}
                      aria-hidden="true"
                    />
                    {l.label}
                  </li>
                ))}
              </ul>
              <a
                href={warnings.href}
                className="text-muted-foreground underline-offset-4 hover:underline"
              >
                {labels.warningsOpen}
              </a>
            </div>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground uppercase">{labels.legend}</p>
          {legend}
        </div>
      </aside>
    </div>
  );
}
