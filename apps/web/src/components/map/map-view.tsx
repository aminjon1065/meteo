"use client";

import type { Locale } from "@meteo/i18n";
import { Badge } from "@meteo/ui/components/badge";
import { Button } from "@meteo/ui/components/button";
import { Checkbox } from "@meteo/ui/components/checkbox";
import { NativeSelect, NativeSelectOption } from "@meteo/ui/components/native-select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@meteo/ui/components/sheet";
import { cn } from "@meteo/ui/lib/utils";
import { ChevronLeftIcon, ChevronRightIcon, LayersIcon, PauseIcon, PlayIcon } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { BoundariesLayer, SilamOverlay, WeatherOverlay } from "./station-map";
import { StationMapLazy } from "./station-map.lazy";
import {
  WEATHER_AREA,
  WEATHER_MAX_ZOOM,
  WEATHER_MIN_ZOOM,
  WEATHER_PARAM_DEFS,
  WEATHER_PARAMS,
  type WeatherCatalog,
  type WeatherParam,
  type WeatherParamDef,
  weatherTileUrl,
} from "./weather-layers";
import { WeatherLegend } from "./weather-legend";

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

/** Прогнозный растровый слой: одновременно показывается один, у него общий ползунок времени. */
type Forecast = "silam" | "weather";

export interface MapViewProps {
  locale: Locale;
  catalog: SilamCatalog;
  /** Слои погоды SmartMet (WMS). */
  weather: WeatherCatalog;
  warnings: WarningsLayer;
  openLabel: string;
  statusLabels: Record<string, string>;
  stationHrefPrefix: string;
  /** Ссылка из попапа области на список станций (с локалью). */
  regionsHref: string;
  labels: {
    title: string;
    layers: string;
    stations: string;
    regions: string;
    regionsFill: string;
    regionsHint: string;
    regionStations: string;
    regionOpen: string;
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
    weather: string;
    weatherParam: string;
    weatherRun: string;
    weatherHint: string;
    weatherNoData: string;
    /** «Шкала, {unit}». */
    weatherScale: string;
    weatherParams: Record<WeatherParam, string>;
    weatherUnits: Record<WeatherParamDef["unit"], string>;
  };
  /** Легенда уровней (серверный компонент): в панели слоёв. */
  legend: ReactNode;
  /** Та же легенда «фишками» поверх карты — на телефоне, где панели нет. */
  legendChips?: ReactNode;
  /** Слой, включённый при открытии (ссылки «Прогноз SILAM» / «Предупреждения» / «Карта погоды»). */
  initialLayer?: "silam" | "warnings" | "weather";
}

const PLAY_INTERVAL_MS: Record<Forecast, number> = { silam: 800, weather: 1200 };

function nearestIndex(times: string[], at: number): number {
  let best = 0;
  let bestDiff = Number.POSITIVE_INFINITY;
  times.forEach((t, i) => {
    const diff = Math.abs(new Date(t).getTime() - at);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  });
  return best;
}

/**
 * Карта с панелью слоёв: станции, границы регионов (с опциональной заливкой по уровню индекса),
 * прогноз погоды SmartMet (температура, осадки, ветер, облачность) или растровый прогноз SILAM —
 * с ползунком времени, предупреждения CAP.
 */
export function MapView({
  locale,
  catalog,
  weather,
  warnings,
  openLabel,
  statusLabels,
  stationHrefPrefix,
  regionsHref,
  labels,
  legend,
  legendChips,
  initialLayer,
}: MapViewProps) {
  const [layersOpen, setLayersOpen] = useState(false);
  const silamAvailable = catalog.run !== null && catalog.pollutants.length > 0;
  const weatherAvailable = weather.run !== null && weather.times.length > 0;
  const [active, setActive] = useState<Forecast | null>(() =>
    initialLayer === "silam" && silamAvailable
      ? "silam"
      : initialLayer === "weather" && weatherAvailable
        ? "weather"
        : null,
  );
  const silamOn = active === "silam";
  const weatherOn = active === "weather";
  const [warningsOn, setWarningsOn] = useState(warnings.count > 0 || initialLayer === "warnings");
  const [regionsOn, setRegionsOn] = useState(true);
  const [regionsFill, setRegionsFill] = useState(false);
  const boundaries = useMemo<BoundariesLayer>(
    () => ({
      regionsUrl: "/api/v1/regions",
      districtsUrl: "/api/v1/districts",
      visible: regionsOn,
      fill: regionsFill,
      href: regionsHref,
      labels: { stations: labels.regionStations, open: labels.regionOpen },
    }),
    [regionsOn, regionsFill, regionsHref, labels.regionStations, labels.regionOpen],
  );
  const [code, setCode] = useState(catalog.pollutants[0]?.code ?? "");
  const pollutant = useMemo(
    () => catalog.pollutants.find((p) => p.code === code) ?? catalog.pollutants[0],
    [catalog.pollutants, code],
  );
  const silamFrames = pollutant?.frames ?? [];
  const silamTimes = useMemo(() => silamFrames.map((f) => f.time), [silamFrames]);
  const [param, setParam] = useState<WeatherParam>("temperature");
  const weatherDef = WEATHER_PARAM_DEFS[param];

  /** Сроки активного слоя — по ним ходит ползунок. */
  const times = weatherOn ? weather.times : silamTimes;
  const [index, setIndex] = useState(() =>
    nearestIndex(active === "weather" ? weather.times : silamTimes, Date.now()),
  );
  const [playing, setPlaying] = useState(false);
  const preloaded = useRef(new Set<string>());

  /** Переключение прогнозного слоя: ползунок встаёт на ближайший срок к показанному. */
  const switchForecast = (next: Forecast | null) => {
    const shown = times[index];
    const nextTimes = next === "weather" ? weather.times : next === "silam" ? silamTimes : [];
    setIndex(nearestIndex(nextTimes, shown ? new Date(shown).getTime() : Date.now()));
    setPlaying(false);
    setActive(next);
  };

  // Ползунок остаётся на том же сроке при смене вещества (у всех веществ один набор часов).
  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(0, times.length - 1)));
  }, [times.length]);

  useEffect(() => {
    if (!playing || !active) return;
    const id = window.setInterval(() => {
      setIndex((i) => (times.length ? (i + 1) % times.length : 0));
    }, PLAY_INTERVAL_MS[active]);
    return () => window.clearInterval(id);
  }, [playing, active, times.length]);

  // Предзагрузка кадров SILAM выбранного вещества, чтобы перемотка была плавной.
  useEffect(() => {
    if (!silamOn || !pollutant) return;
    for (const f of pollutant.frames) {
      if (preloaded.current.has(f.url)) continue;
      preloaded.current.add(f.url);
      const img = new Image();
      img.src = f.url;
    }
  }, [silamOn, pollutant]);

  const shownTime = times[index];
  const silamFrame = silamOn ? silamFrames[index] : undefined;
  const overlay: SilamOverlay | null =
    silamOn && silamAvailable && silamFrame && catalog.run
      ? { url: silamFrame.url, bounds: catalog.run.bounds }
      : null;
  const weatherOverlay: WeatherOverlay | null =
    weatherOn && weatherAvailable && weather.run && shownTime
      ? {
          tiles: weatherTileUrl(weather.run.originTime, weatherDef.base, shownTime),
          arrows: weatherDef.arrows
            ? weatherTileUrl(weather.run.originTime, weatherDef.arrows, shownTime)
            : null,
          bounds: WEATHER_AREA,
          minzoom: WEATHER_MIN_ZOOM,
          maxzoom: WEATHER_MAX_ZOOM,
        }
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

  // Время и даты форматирует Intl: в Node и браузере ICU разный (например, у tg), поэтому у этих
  // подписей suppressHydrationWarning — после первого обновления остаётся формат браузера.
  const timeLabel = shownTime ? timeFmt.format(new Date(shownTime)) : "—";
  const silamMeta = [
    silamFrame?.max !== null && silamFrame?.max !== undefined && pollutant
      ? labels.maxInDomain
          .replace("{value}", String(Math.round(silamFrame.max * 10) / 10))
          .replace("{unit}", pollutant.unit)
      : null,
    catalog.run
      ? labels.run.replace("{time}", runFmt.format(new Date(catalog.run.originTime)))
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const weatherMeta = weather.run
    ? labels.weatherRun.replace("{time}", runFmt.format(new Date(weather.run.originTime)))
    : "";
  const weatherScale = labels.weatherScale.replace("{unit}", labels.weatherUnits[weatherDef.unit]);

  const pollutantSelect = (className?: string) =>
    pollutant ? (
      <NativeSelect
        aria-label={labels.pollutant}
        value={pollutant.code}
        onChange={(e) => setCode(e.target.value)}
        className={cn("h-8 text-xs", className)}
      >
        {catalog.pollutants.map((p) => (
          <NativeSelectOption key={p.code} value={p.code}>
            {p.shortName} · {p.unit}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    ) : null;

  const paramSelect = (className?: string) => (
    <NativeSelect
      aria-label={labels.weatherParam}
      value={param}
      onChange={(e) => setParam(e.target.value as WeatherParam)}
      className={cn("h-8 text-xs", className)}
    >
      {WEATHER_PARAMS.map((p) => (
        <NativeSelectOption key={p} value={p}>
          {labels.weatherParams[p]}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );

  const playback = (
    <>
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
        onClick={() => setIndex((i) => Math.min(times.length - 1, i + 1))}
      >
        <ChevronRightIcon />
      </Button>
    </>
  );

  const slider = (className?: string) => (
    <input
      type="range"
      aria-label={labels.time}
      min={0}
      max={Math.max(0, times.length - 1)}
      value={index}
      onChange={(e) => {
        setPlaying(false);
        setIndex(Number(e.target.value));
      }}
      className={cn("w-full accent-brand", className)}
    />
  );

  /** Выбор вещества/параметра, время, ползунок, шкала и подписи активного прогноза (панель). */
  const forecastControls = (kind: Forecast) => (
    <div className="flex flex-col gap-2 rounded-lg bg-surface-2 p-2">
      {kind === "silam" ? pollutantSelect() : paramSelect()}
      <div className="flex items-center gap-1">
        {playback}
        <span className="ml-1 flex-1 text-xs tabular-nums" suppressHydrationWarning>
          {timeLabel}
        </span>
      </div>
      {slider()}
      {kind === "weather" ? (
        <WeatherLegend def={weatherDef} locale={locale} caption={weatherScale} />
      ) : null}
      <p className="text-[11px] leading-snug text-muted-foreground" suppressHydrationWarning>
        {kind === "silam" ? silamMeta : weatherMeta}
      </p>
      <p className="text-[11px] leading-snug text-muted-foreground">
        {kind === "silam" ? labels.hint : labels.weatherHint}
      </p>
    </div>
  );

  /**
   * Переключатели слоёв. `inline` — управление прогнозом прямо под переключателем (панель на
   * широком экране); на телефоне оно в карточке внизу карты. `idp` — префикс id, чтобы подписи не
   * путались между панелью и шторкой.
   */
  const layerToggles = (idp: string, inline: boolean) => (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Checkbox id={`${idp}-stations`} checked disabled />
        <label htmlFor={`${idp}-stations`}>{labels.stations}</label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id={`${idp}-regions`}
          checked={regionsOn}
          onCheckedChange={(checked) => setRegionsOn(checked === true)}
        />
        <label htmlFor={`${idp}-regions`} className="flex-1">
          {labels.regions}
        </label>
      </div>
      {regionsOn ? (
        <div className="flex flex-col gap-1.5 rounded-lg bg-surface-2 p-2 text-xs">
          <div className="flex items-center gap-2">
            <Checkbox
              id={`${idp}-regions-fill`}
              checked={regionsFill}
              onCheckedChange={(checked) => setRegionsFill(checked === true)}
            />
            <label htmlFor={`${idp}-regions-fill`} className="flex-1">
              {labels.regionsFill}
            </label>
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground">{labels.regionsHint}</p>
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <Checkbox
          id={`${idp}-weather`}
          checked={weatherOn}
          disabled={!weatherAvailable}
          onCheckedChange={(checked) => switchForecast(checked === true ? "weather" : null)}
        />
        <label htmlFor={`${idp}-weather`} className="flex-1">
          {labels.weather}
        </label>
        {!weatherAvailable ? <Badge variant="secondary">{labels.soon}</Badge> : null}
      </div>
      {inline && weatherOn && weatherAvailable ? forecastControls("weather") : null}
      {!weatherAvailable ? (
        <p className="text-xs leading-snug text-muted-foreground">{labels.weatherNoData}</p>
      ) : null}
      <div className="flex items-center gap-2">
        <Checkbox
          id={`${idp}-silam`}
          checked={silamOn}
          disabled={!silamAvailable}
          onCheckedChange={(checked) => switchForecast(checked === true ? "silam" : null)}
        />
        <label htmlFor={`${idp}-silam`} className="flex-1">
          {labels.silam}
        </label>
        {!silamAvailable ? <Badge variant="secondary">{labels.soon}</Badge> : null}
      </div>
      {inline && silamOn && silamAvailable && pollutant ? forecastControls("silam") : null}
      {!silamAvailable ? (
        <p className="text-xs leading-snug text-muted-foreground">{labels.noData}</p>
      ) : null}
      <div className="flex items-center gap-2">
        <Checkbox
          id={`${idp}-warnings`}
          checked={warningsOn}
          onCheckedChange={(checked) => setWarningsOn(checked === true)}
        />
        <label htmlFor={`${idp}-warnings`} className="flex-1">
          {labels.warnings}
        </label>
        <Badge variant={warnings.count > 0 ? "destructive" : "secondary"}>
          {labels.warningsCount}
        </Badge>
      </div>
      {warningsOn ? (
        <div className="flex flex-col gap-1 rounded-lg bg-surface-2 p-2 text-xs">
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
  );

  // Слои, включённые сверх станций, — число на кнопке «Слои» на телефоне.
  const extraLayers = [regionsOn, active !== null, warningsOn].filter(Boolean).length;
  const mobileForecast =
    (silamOn && silamAvailable && pollutant) || (weatherOn && weatherAvailable);

  return (
    <div className="relative h-full w-full">
      <StationMapLazy
        locale={locale}
        openLabel={openLabel}
        statusLabels={statusLabels}
        stationHrefPrefix={stationHrefPrefix}
        className="h-full w-full"
        overlay={overlay}
        weather={weatherOverlay}
        warningsUrl={warningsOn ? warnings.url : null}
        warningsHref={warnings.href}
        warningsOpenLabel={labels.warningsOpen}
        boundaries={boundaries}
        unsupportedLabel={labels.unsupported}
      />

      {/* Широкий экран: панель слоёв слева сверху. */}
      <aside className="absolute top-3 left-3 z-10 hidden max-h-[calc(100%-1.5rem)] w-72 max-w-[calc(100%-1.5rem)] flex-col gap-3 overflow-y-auto rounded-xl border bg-card/95 p-3.5 text-sm shadow-md backdrop-blur md:flex">
        <h1 className="font-heading text-base font-bold">{labels.title}</h1>
        <div className="flex flex-col gap-2">
          <p className="eyebrow">{labels.layers}</p>
          {layerToggles("layer", true)}
        </div>
        <div className="flex flex-col gap-2">
          <p className="eyebrow">{labels.legend}</p>
          {legend}
        </div>
      </aside>

      {/* Телефон: карта на весь экран, слои — в нижней шторке, прогноз и легенда — внизу карты. */}
      <h1 className="sr-only md:hidden">{labels.title}</h1>
      <div className="absolute top-3 left-3 z-10 md:hidden">
        <Sheet open={layersOpen} onOpenChange={setLayersOpen}>
          <SheetTrigger
            aria-haspopup="dialog"
            className="inline-flex h-10 items-center gap-2 rounded-full border bg-card/95 px-3.5 text-sm font-semibold text-foreground shadow-md backdrop-blur hover:bg-muted"
          >
            <LayersIcon className="size-4" aria-hidden="true" />
            {labels.layers}
            {extraLayers > 0 ? (
              <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground tabular-nums">
                {extraLayers}
              </span>
            ) : null}
          </SheetTrigger>
          <SheetContent
            side="bottom"
            className="max-h-[85dvh] overflow-y-auto rounded-t-2xl pb-[max(1rem,env(safe-area-inset-bottom))]"
          >
            <SheetHeader>
              <SheetTitle>{labels.layers}</SheetTitle>
            </SheetHeader>
            <div className="flex flex-col gap-5 px-4 text-base">
              {layerToggles("sheet-layer", false)}
              <div className="flex flex-col gap-2">
                <p className="eyebrow">{labels.legend}</p>
                {legend}
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
      {/* Над нижней строкой карты: масштаб и атрибуция OpenStreetMap (обязательна по лицензии)
          остаются видны. */}
      <div className="pointer-events-none absolute right-3 bottom-10 left-3 z-10 flex flex-col gap-2 md:hidden">
        {mobileForecast ? (
          <section
            aria-label={weatherOn ? labels.weather : labels.silam}
            className="pointer-events-auto flex flex-col gap-1.5 rounded-xl border bg-card/95 p-2.5 shadow-md backdrop-blur"
          >
            <div className="flex items-center gap-2">
              {weatherOn ? paramSelect("w-auto shrink-0") : pollutantSelect("w-auto shrink-0")}
              <span
                className="ml-auto truncate text-xs font-medium tabular-nums"
                suppressHydrationWarning
              >
                {timeLabel}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {playback}
              {slider("ml-1 flex-1")}
            </div>
            {weatherOn ? (
              <WeatherLegend def={weatherDef} locale={locale} caption={weatherScale} />
            ) : null}
            {(weatherOn ? weatherMeta : silamMeta) ? (
              <p
                className="truncate text-[11px] leading-snug text-muted-foreground"
                suppressHydrationWarning
              >
                {weatherOn ? weatherMeta : silamMeta}
              </p>
            ) : null}
          </section>
        ) : null}
        {legendChips}
      </div>
    </div>
  );
}
