"use client";

import type { Locale } from "@meteo/i18n";
import { Button } from "@meteo/ui/components/button";
import { NativeSelect, NativeSelectOption } from "@meteo/ui/components/native-select";
import { cn } from "@meteo/ui/lib/utils";
import type { FeatureCollection, Point } from "geojson";
import {
  ActivityIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  CircleHelpIcon,
  PauseIcon,
  PlayIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { dateFormatter } from "@/lib/date-format";
import { numberFormatter } from "@/lib/number-format";
import type { Basemap } from "./basemap-options";
import { BasemapPicker, useBasemap } from "./basemap-picker";
import type {
  BoundariesLayer,
  CityMarker,
  SilamOverlay,
  StationFeatureProps,
  WeatherOverlay,
} from "./station-map";
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

/** Станция на главной карте: уровень и подписи для попапа уже локализованы на сервере. */
export interface HomeStation extends StationFeatureProps {
  lon: number;
  lat: number;
}

/** Строка легенды уровней опасности: только уровни, которые есть среди показанных предупреждений. */
export interface WarningLegendItem {
  severity: string;
  /** Цифра уровня 1–4 (различает уровни без цвета). */
  number: string;
  label: string;
  color: string;
  foreground: string;
}

export interface WarningsSummary {
  /** Число действующих предупреждений. */
  count: number;
  /** Ожидаемые: начнутся в ближайшие сутки (пунктир на карте). */
  upcoming: number;
  /** GeoJSON действующих и ожидаемых в ближайшие сутки предупреждений. */
  url: string;
  /** Раздел предупреждений (с локалью). */
  href: string;
  /** Цвет самого серьёзного предупреждения (действующего, иначе ожидаемого). */
  color: string | null;
  /**
   * Лента CAP давно не обновлялась или с ошибкой: «предупреждений нет» нельзя показывать как
   * отбой — плашка говорит, что данные могут быть устаревшими.
   */
  stale: boolean;
  legend: WarningLegendItem[];
  /** Подписи уровней опасности для попапа (по CAP severity). */
  severityLabels: Record<string, string>;
  /** Открыто по ссылке /?layer=warnings — карта показывает области предупреждений. */
  focus: boolean;
}

/** Действующие превышения порогов (уведомление портала, FR1.5): готовая строка и ссылка. */
export interface ExceedancesSummary {
  text: string;
  href: string;
}

/** Тема карты: качество воздуха (станции) или погода (города). */
export type Topic = "air" | "weather";
/** Срок: «Сейчас» — измерения и текущая погода, «Прогноз» — SILAM / карты SmartMet с ползунком. */
export type View = "now" | "forecast";

export interface MapViewProps {
  locale: Locale;
  /**
   * Момент отрисовки на сервере (мс): по нему выбирается срок при открытии, чтобы сервер и
   * браузер показали один и тот же кадр и одну подпись времени.
   */
  now: number;
  /** Что показать при открытии (из ?layer=). */
  initial: { topic: Topic; view: View };
  catalog: SilamCatalog;
  /** Слои погоды SmartMet (WMS). */
  weather: WeatherCatalog;
  warnings: WarningsSummary;
  /** Превышения порогов на станциях; null — нет. */
  exceedances: ExceedancesSummary | null;
  /** Прогноз SILAM старше суток с запасом (нового прогона нет). */
  silamStale: boolean;
  stations: HomeStation[];
  /** Погода в городах (точки прогноза SmartMet). */
  cities: CityMarker[];
  /** Город, выбранный в шапке: его маркер выделен, при смене карта перелетает к нему. */
  selectedCity: string | null;
  stationHrefPrefix: string;
  /** Ссылка из попапа области на список станций (с локалью); она же — текстовая альтернатива карте. */
  regionsHref: string;
  /** Страница карт SILAM от FMI для Таджикистана (с локалью). */
  silamFmiHref: string;
  /** Карточки города (серверные компоненты): воздух и погода «сейчас». */
  cards: { air: ReactNode; weather: ReactNode };
  /** Шкала уровней для прогноза SILAM (серверный компонент). */
  forecastLegend: ReactNode;
  labels: {
    title: string;
    topic: string;
    air: string;
    weather: string;
    view: string;
    now: string;
    forecast: string;
    airForecast: string;
    weatherForecast: string;
    open: string;
    cityOpen: string;
    regionStations: string;
    regionOpen: string;
    silamFmi: string;
    pollutant: string;
    time: string;
    run: string;
    play: string;
    pause: string;
    prev: string;
    next: string;
    maxInDomain: string;
    warningsActive: string;
    warningsOpen: string;
    /** «Ожидается N предупреждений» — когда действующих нет. */
    warningsUpcoming: string;
    /** «ещё N ожидается» — после числа действующих. */
    warningsUpcomingMore: string;
    warningsNone: string;
    warningsStale: string;
    warningsStaleShort: string;
    /** «Ожидается» — пометка в попапе. */
    warningUpcoming: string;
    warningsLegend: string;
    warningsLegendUpcoming: string;
    /** Доступное имя области карты. */
    mapRegion: string;
    /** Скрытая ссылка для экранных дикторов: список станций без карты. */
    stationList: string;
    weatherForecastNone: string;
    silamStale: string;
    /** Подписи встроенных элементов MapLibre (map-ui-strings.ts). */
    mapUi: Record<string, string>;
    unsupported: string;
    weatherParam: string;
    weatherRun: string;
    /** «Шкала, {unit}». */
    weatherScale: string;
    weatherParams: Record<WeatherParam, string>;
    weatherUnits: Record<WeatherParamDef["unit"], string>;
    /** «Тип карты» и названия подложек. */
    basemap: { title: string } & Record<Basemap, string>;
  };
}

const PLAY_INTERVAL_MS: Record<Topic, number> = { air: 800, weather: 1200 };

/** Ширина левой колонки (23rem = 368 px) с отступами: страна вписывается правее неё. */
const DESKTOP_INSET_LEFT = 392;
/** Высота нижней карточки на телефоне: страна вписывается над ней. */
const MOBILE_INSET_BOTTOM = 190;

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
 * Переключатель-«таблетка» на нативных радиокнопках: стрелки меняют выбор, Tab — к следующей
 * группе. Кнопка растянута на весь вариант и прозрачна — клик и фокус приходятся на неё саму.
 * `tone` — primary для главного выбора (тема), muted — для второстепенного (срок).
 */
function Segmented<T extends string>({
  name,
  label,
  value,
  options,
  onChange,
  tone = "primary",
}: {
  name: string;
  label: string;
  value: T;
  options: ReadonlyArray<readonly [T, string]>;
  onChange: (v: T) => void;
  tone?: "primary" | "muted";
}) {
  return (
    <fieldset className="inline-flex shrink-0 rounded-full border bg-card/95 p-0.5 shadow-md backdrop-blur min-[400px]:p-1">
      <legend className="sr-only">{label}</legend>
      {options.map(([v, text]) => {
        const checked = v === value;
        return (
          <label
            key={v}
            className={cn(
              "relative inline-flex h-8 cursor-pointer items-center rounded-full px-2 text-xs font-semibold whitespace-nowrap transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring min-[400px]:px-2.5 min-[400px]:text-[13px] md:px-3",
              checked
                ? tone === "primary"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <input
              type="radio"
              name={name}
              value={v}
              checked={checked}
              onChange={() => onChange(v)}
              className="absolute inset-0 cursor-pointer appearance-none rounded-full opacity-0"
            />
            {text}
          </label>
        );
      })}
    </fieldset>
  );
}

/**
 * Главная карта портала. Одна тема за раз: «Воздух» — станции цветом уровня, «Погода» — значки и
 * температура в городах; у каждой «Прогноз» — растровый слой (SILAM / SmartMet) с ползунком времени.
 * Карточка выбранного в шапке города отвечает на главный вопрос; на широком экране она в левой
 * колонке, на телефоне — внизу. Границы областей и контур страны видны всегда, соседние страны
 * приглушены; предупреждения — слоем и плашкой, только когда действуют.
 */
export function MapView({
  locale,
  now,
  initial,
  catalog,
  weather,
  warnings,
  exceedances,
  silamStale,
  stations,
  cities,
  selectedCity,
  stationHrefPrefix,
  regionsHref,
  silamFmiHref,
  cards,
  forecastLegend,
  labels,
}: MapViewProps) {
  const silamAvailable = catalog.run !== null && catalog.pollutants.length > 0;
  const { basemap, available: basemaps, select: selectBasemap } = useBasemap();
  const weatherAvailable = weather.run !== null && weather.times.length > 0;
  const forecastAvailable = (t: Topic) => (t === "air" ? silamAvailable : weatherAvailable);

  const [topic, setTopicState] = useState<Topic>(initial.topic);
  const [view, setViewState] = useState<View>(
    initial.view === "forecast" && forecastAvailable(initial.topic) ? "forecast" : "now",
  );
  const forecastOn = view === "forecast" && forecastAvailable(topic);
  const silamOn = forecastOn && topic === "air";
  const weatherOn = forecastOn && topic === "weather";

  const [code, setCode] = useState(catalog.pollutants[0]?.code ?? "");
  const pollutant = useMemo(
    () => catalog.pollutants.find((p) => p.code === code) ?? catalog.pollutants[0],
    [catalog.pollutants, code],
  );
  const silamFrames = pollutant?.frames ?? [];
  const silamTimes = useMemo(() => silamFrames.map((f) => f.time), [silamFrames]);
  const [param, setParam] = useState<WeatherParam>("temperature");
  const weatherDef = WEATHER_PARAM_DEFS[param];

  const timesFor = (t: Topic) => (t === "weather" ? weather.times : silamTimes);
  /** Сроки активного прогноза — по ним ходит ползунок. */
  const times = timesFor(topic);
  const [index, setIndex] = useState(() => nearestIndex(timesFor(initial.topic), now));
  const [playing, setPlaying] = useState(false);
  const preloaded = useRef(new Set<string>());

  /** Смена темы или срока: ползунок встаёт на ближайший срок к показанному (или к текущему часу). */
  const select = (nextTopic: Topic, nextView: View) => {
    const shown = forecastOn ? times[index] : undefined;
    const at = shown ? new Date(shown).getTime() : Date.now();
    setIndex(nearestIndex(timesFor(nextTopic), at));
    setPlaying(false);
    setTopicState(nextTopic);
    setViewState(nextView === "forecast" && forecastAvailable(nextTopic) ? "forecast" : "now");
  };

  // Адрес отражает выбор (ссылкой можно поделиться): /?layer=silam | weather.
  useEffect(() => {
    const url = new URL(window.location.href);
    const layer = topic === "air" ? (forecastOn ? "silam" : null) : "weather";
    if (layer) url.searchParams.set("layer", layer);
    else url.searchParams.delete("layer");
    if (url.href !== window.location.href) window.history.replaceState(null, "", url);
  }, [topic, forecastOn]);

  // Ползунок остаётся на том же сроке при смене вещества (у всех веществ один набор часов).
  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(0, times.length - 1)));
  }, [times.length]);

  useEffect(() => {
    if (!playing || !forecastOn) return;
    const id = window.setInterval(() => {
      setIndex((i) => (times.length ? (i + 1) % times.length : 0));
    }, PLAY_INTERVAL_MS[topic]);
    return () => window.clearInterval(id);
  }, [playing, forecastOn, topic, times.length]);

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
    silamOn && silamFrame && catalog.run
      ? { url: silamFrame.url, bounds: catalog.run.bounds }
      : null;
  const weatherOverlay: WeatherOverlay | null =
    weatherOn && weather.run && shownTime
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

  const boundaries = useMemo<BoundariesLayer>(
    () => ({
      regionsUrl: "/api/v1/regions",
      districtsUrl: "/api/v1/districts",
      visible: true,
      fill: false,
      href: regionsHref,
      labels: { stations: labels.regionStations, open: labels.regionOpen },
    }),
    [regionsHref, labels.regionStations, labels.regionOpen],
  );
  const stationsData = useMemo<FeatureCollection<Point, StationFeatureProps>>(
    () => ({
      type: "FeatureCollection",
      features: stations.map(({ lon, lat, ...props }) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lon, lat] },
        properties: props,
      })),
    }),
    [stations],
  );

  // dateFormatter, а не Intl: в браузере нет данных Intl для tg, и подпись стала бы английской.
  const timeFmt = useMemo(
    () =>
      dateFormatter(locale, {
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
      dateFormatter(locale, {
        timeZone: "UTC",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }),
    [locale],
  );
  const maxFmt = useMemo(() => numberFormatter(locale, { maximumFractionDigits: 1 }), [locale]);

  const timeLabel = shownTime ? timeFmt.format(new Date(shownTime)) : "—";
  const silamMeta = [
    catalog.run
      ? labels.run.replace("{time}", runFmt.format(new Date(catalog.run.originTime)))
      : null,
    silamFrame?.max !== null && silamFrame?.max !== undefined && pollutant
      ? labels.maxInDomain
          .replace("{value}", maxFmt.format(silamFrame.max))
          .replace("{unit}", pollutant.unit)
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const weatherMeta = weather.run
    ? labels.weatherRun.replace("{time}", runFmt.format(new Date(weather.run.originTime)))
    : "";

  const playback = (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={labels.prev}
        onClick={() => {
          setPlaying(false);
          setIndex((i) => Math.max(0, i - 1));
        }}
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
        onClick={() => {
          setPlaying(false);
          setIndex((i) => Math.min(times.length - 1, i + 1));
        }}
      >
        <ChevronRightIcon />
      </Button>
    </>
  );

  /** Прогноз: выбор вещества/параметра, срок, ползунок, шкала, источник. */
  const forecastPanel = (
    <section
      aria-label={topic === "air" ? labels.airForecast : labels.weatherForecast}
      data-testid="forecast-panel"
      className="flex flex-col gap-2.5"
    >
      <p className="eyebrow hidden md:block">
        {topic === "air" ? labels.airForecast : labels.weatherForecast}
      </p>
      <div className="flex items-center gap-2">
        {topic === "air" && pollutant ? (
          <NativeSelect
            aria-label={labels.pollutant}
            value={pollutant.code}
            onChange={(e) => setCode(e.target.value)}
            className="h-8 w-auto text-sm"
          >
            {catalog.pollutants.map((p) => (
              <NativeSelectOption key={p.code} value={p.code}>
                {p.shortName}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        ) : null}
        {topic === "weather" ? (
          <NativeSelect
            aria-label={labels.weatherParam}
            value={param}
            onChange={(e) => setParam(e.target.value as WeatherParam)}
            className="h-8 w-auto text-sm"
          >
            {WEATHER_PARAMS.map((p) => (
              <NativeSelectOption key={p} value={p}>
                {labels.weatherParams[p]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        ) : null}
        <span className="ml-auto truncate text-sm font-semibold tabular-nums">{timeLabel}</span>
      </div>
      <div className="flex items-center gap-1">
        {playback}
        <input
          type="range"
          aria-label={labels.time}
          aria-valuetext={timeLabel}
          min={0}
          max={Math.max(0, times.length - 1)}
          value={index}
          onChange={(e) => {
            setPlaying(false);
            setIndex(Number(e.target.value));
          }}
          className="ml-1 w-full flex-1 accent-brand"
        />
      </div>
      {topic === "air" ? (
        forecastLegend
      ) : (
        <WeatherLegend
          def={weatherDef}
          locale={locale}
          caption={labels.weatherScale.replace("{unit}", labels.weatherUnits[weatherDef.unit])}
        />
      )}
      <p className="truncate text-[11px] leading-snug text-muted-foreground md:whitespace-normal">
        {topic === "air" ? silamMeta : weatherMeta}
      </p>
      {topic === "air" && silamStale ? (
        <p className="flex items-center gap-1.5 text-[11px] leading-snug font-medium">
          <span className="size-1.5 shrink-0 rounded-full bg-status-stale" aria-hidden="true" />
          {labels.silamStale}
        </p>
      ) : null}
      {topic === "air" ? (
        <a
          href={silamFmiHref}
          className="hidden text-sm font-semibold text-brand underline-offset-4 hover:underline md:inline"
        >
          {labels.silamFmi} →
        </a>
      ) : null}
    </section>
  );

  /** Предупреждения на карте: действующие и ожидаемые в ближайшие сутки. */
  const warningsShown = warnings.count + warnings.upcoming;
  // Плашка видна всегда: «предупреждений нет» — тоже ответ, а при сбое ленты CAP — оговорка,
  // чтобы отсутствие данных не читалось как отбой.
  const warningsState =
    warnings.count > 0
      ? "active"
      : warnings.upcoming > 0
        ? "upcoming"
        : warnings.stale
          ? "stale"
          : "none";
  const warningsNote = [
    warnings.count > 0 && warnings.upcoming > 0 ? labels.warningsUpcomingMore : null,
    warningsShown > 0 && warnings.stale ? labels.warningsStaleShort : null,
  ].filter(Boolean);
  const chipClass =
    "pointer-events-auto inline-flex min-h-9 max-w-full items-center gap-2 rounded-full border bg-card/95 px-3.5 py-1 text-sm shadow-md backdrop-blur hover:bg-card";
  const warningsChip = (
    <a
      href={warnings.href}
      data-testid="warnings-chip"
      data-state={warningsState}
      className={cn(
        chipClass,
        warningsState === "none"
          ? "font-medium text-muted-foreground"
          : "font-semibold text-foreground",
      )}
    >
      {warningsState === "none" ? (
        <CircleCheckIcon className="size-4 shrink-0" aria-hidden="true" />
      ) : warningsState === "stale" ? (
        <CircleHelpIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      ) : (
        <TriangleAlertIcon
          className="size-4 shrink-0"
          style={{ color: warnings.color ?? undefined }}
          aria-hidden="true"
        />
      )}
      <span className="min-w-0">
        {warningsState === "active"
          ? labels.warningsActive
          : warningsState === "upcoming"
            ? labels.warningsUpcoming
            : warningsState === "stale"
              ? labels.warningsStale
              : labels.warningsNone}
        {warningsNote.length > 0 ? (
          <span className="font-normal text-muted-foreground"> · {warningsNote.join(" · ")}</span>
        ) : null}
      </span>
      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </a>
  );
  const exceedancesChip = exceedances ? (
    <a
      href={exceedances.href}
      data-testid="exceedances-chip"
      className={cn(chipClass, "font-semibold")}
    >
      <ActivityIcon className="size-4 shrink-0 text-aq-3" aria-hidden="true" />
      <span className="min-w-0">{exceedances.text}</span>
      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </a>
  ) : null;
  /** Легенда уровней опасности — только когда предупреждения на карте (на широком экране). */
  const warningsLegend =
    warningsShown > 0 && warnings.legend.length > 0 ? (
      <div
        className="pointer-events-auto flex max-w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-card/95 px-3 py-1.5 text-xs shadow-md backdrop-blur"
        data-testid="warnings-legend"
      >
        <span className="font-semibold">{labels.warningsLegend}</span>
        {warnings.legend.map((l) => (
          <span key={l.severity} className="inline-flex items-center gap-1.5">
            <span
              className="inline-flex size-4 items-center justify-center rounded-full text-[10px] leading-none font-bold"
              style={{ background: l.color, color: l.foreground }}
              aria-hidden="true"
            >
              {l.number}
            </span>
            {l.label}
          </span>
        ))}
        {warnings.upcoming > 0 ? (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <span
              className="inline-block h-0 w-4 border-t-2 border-dashed border-current"
              aria-hidden="true"
            />
            {labels.warningsLegendUpcoming}
          </span>
        ) : null}
      </div>
    ) : null;
  /** Карты прогноза темы недоступны (SmartMet WMS не отвечает): короткая пометка вместо пустоты. */
  const forecastNote = topic === "weather" && !weatherAvailable ? labels.weatherForecastNone : null;

  const card = forecastOn ? forecastPanel : topic === "air" ? cards.air : cards.weather;

  return (
    <div className="relative h-full w-full">
      <StationMapLazy
        locale={locale}
        openLabel={labels.open}
        statusLabels={{}}
        stationHrefPrefix={stationHrefPrefix}
        className="h-full w-full"
        stationsData={stationsData}
        stationsVisible={topic === "air" && !forecastOn}
        overlay={overlay}
        weather={weatherOverlay}
        warningsUrl={warningsShown > 0 ? warnings.url : null}
        warningsHref={warnings.href}
        warningsOpenLabel={labels.warningsOpen}
        warningLabels={{ severity: warnings.severityLabels, upcoming: labels.warningUpcoming }}
        fitWarnings={warnings.focus}
        uiStrings={labels.mapUi}
        ariaLabel={labels.mapRegion}
        cities={topic === "weather" && !forecastOn ? cities : null}
        selectedCity={selectedCity}
        cityOpenLabel={labels.cityOpen}
        boundaries={boundaries}
        outlineUrl="/api/v1/regions/outline"
        controls="home"
        basemap={basemap}
        insetLeft={DESKTOP_INSET_LEFT}
        insetBottom={MOBILE_INSET_BOTTOM}
        unsupportedLabel={labels.unsupported}
      />

      <h1 className="sr-only">{labels.title}</h1>
      {/* Текстовая альтернатива карте: те же станции списком (WCAG 1.1.1). */}
      <a
        href={regionsHref}
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:right-3 focus:z-20 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:shadow-md"
      >
        {labels.stationList}
      </a>

      {/* Колонка поверх карты: переключатели темы и срока, под ними карточка. На телефоне колонка
          во всю высоту — карточка прижата к низу (над атрибуцией OSM), справа сверху остаётся
          кнопка геолокации; на широком экране — 320 px слева, страна вписывается правее. */}
      <div className="pointer-events-none absolute inset-x-3 top-3 bottom-9 z-10 flex flex-col gap-2 md:right-auto md:bottom-3 md:w-[23rem]">
        <div className="pointer-events-auto flex flex-wrap items-center gap-1.5 pr-10 min-[400px]:gap-2 md:pr-0">
          <Segmented
            name="map-topic"
            label={labels.topic}
            value={topic}
            options={[
              ["air", labels.air],
              ["weather", labels.weather],
            ]}
            onChange={(t) => select(t, view)}
          />
          {forecastAvailable(topic) ? (
            <Segmented
              name="map-view"
              label={labels.view}
              value={forecastOn ? "forecast" : "now"}
              options={[
                ["now", labels.now],
                ["forecast", labels.forecast],
              ]}
              onChange={(v) => select(topic, v)}
              tone="muted"
            />
          ) : null}
        </div>
        <div className="flex flex-wrap items-start gap-1.5 pr-12 md:hidden">
          {warningsChip}
          {exceedancesChip}
        </div>
        {forecastNote ? (
          <p className="pointer-events-auto w-fit max-w-full rounded-lg border bg-card/95 px-3 py-1.5 text-xs text-muted-foreground shadow-md backdrop-blur">
            {forecastNote}
          </p>
        ) : null}
        <div className="flex-1 md:hidden" />
        {card ? (
          <div className="pointer-events-auto max-h-[55%] min-h-0 shrink-0 overflow-y-auto rounded-xl border bg-card/95 p-3.5 shadow-md backdrop-blur md:max-h-none md:shrink md:p-4">
            {card}
          </div>
        ) : null}
      </div>

      {/* Тип карты: на телефоне — справа под кнопкой геолокации, на широком экране — слева внизу. */}
      <BasemapPicker
        value={basemap}
        available={basemaps}
        onChange={selectBasemap}
        labels={labels.basemap}
        className="absolute top-[52px] right-3 z-10 md:top-auto md:right-auto md:bottom-8 md:left-3"
      />

      <div
        className="pointer-events-none absolute top-3 z-10 hidden w-max max-w-[calc(100%-30rem)] -translate-x-1/2 flex-col items-center gap-1.5 md:flex"
        style={{ left: `calc(50% + ${DESKTOP_INSET_LEFT / 2}px)` }}
      >
        <div className="flex flex-wrap justify-center gap-2">
          {warningsChip}
          {exceedancesChip}
        </div>
        {warningsLegend}
      </div>
    </div>
  );
}
