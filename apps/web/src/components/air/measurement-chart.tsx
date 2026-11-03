"use client";

import { buttonVariants } from "@meteo/ui/components/button";
import { NativeSelect, NativeSelectOption } from "@meteo/ui/components/native-select";
import { Skeleton } from "@meteo/ui/components/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@meteo/ui/components/tabs";
import { cn } from "@meteo/ui/lib/utils";
import { BarChart, LineChart } from "echarts/charts";
import {
  DataZoomComponent,
  GridComponent,
  MarkAreaComponent,
  TooltipComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { DownloadIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef, useState } from "react";
import { calendarNames, dateFormatter } from "@/lib/date-format";
import {
  type Aggregation,
  aggregationFor,
  RANGE_AGGREGATIONS,
  RANGES,
  RAW_RANGES,
} from "@/lib/measurement-ranges";
import { numberFormatter } from "@/lib/number-format";

echarts.use([
  LineChart,
  BarChart,
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  MarkAreaComponent,
  CanvasRenderer,
]);

export const CHART_RANGES = RANGES;
export type ChartRange = (typeof CHART_RANGES)[number];

export interface ChartPollutant {
  code: string;
  shortName: string;
  unit: string;
  decimals: number;
  /** Подсказка (полное название и пояснение) — в список выбора. */
  hint?: string;
}

export interface ChartBand {
  level: number;
  lo: number;
  hi: number | null;
}

export interface MeasurementChartProps {
  stationSlug: string;
  pollutants: ChartPollutant[];
  bands: Record<string, ChartBand[]>;
  locale: string;
  labels: {
    ranges: Record<ChartRange, string>;
    pollutant: string;
    downloadCsv: string;
    noData: string;
    loading: string;
    hourly: string;
    daily: string;
    monthly: string;
    /** Подпись группы «Осреднение» и названия вариантов. */
    aggregation: string;
    aggregations: Record<Aggregation, string>;
    downloadRaw: string;
    dataTable: string;
    columns: { time: string; mean: string; min: string; max: string; samples: string };
    levels: Record<string, string>;
    /** Подпись под графиком с плейсхолдером {pollutant}. */
    hint?: string;
    title?: string;
  };
}

interface SeriesResponse {
  aggregation: Aggregation;
  series: Array<{
    pollutant: ChartPollutant;
    points: Array<{
      t: string;
      v: number | null;
      min: number | null;
      max: number | null;
      n: number;
    }>;
  }>;
}

type LevelKey = 1 | 2 | 3 | 4 | 5 | 6;

type ChartLocale = NonNullable<NonNullable<Parameters<typeof echarts.init>[2]>["locale"]>;

/** Токены темы для холста: полосы уровней — тинты, линия — синий Агентства, оси — приглушённые. */
function readTokens() {
  const styles = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
  return {
    fg: read("--foreground", "#142238"),
    muted: read("--muted-foreground", "#4e5f78"),
    border: read("--border", "#d5deea"),
    primary: read("--brand-primary", "#164a7c"),
    popover: read("--popover", "#ffffff"),
    tints: {
      1: read("--aq-1-tint", "#e6f4ea"),
      2: read("--aq-2-tint", "#fbf3d6"),
      3: read("--aq-3-tint", "#fde9d6"),
      4: read("--aq-4-tint", "#fbe0e3"),
      5: read("--aq-5-tint", "#ede1fa"),
      6: read("--aq-6-tint", "#f3dbe2"),
    } as Record<LevelKey, string>,
  };
}

/** Порог числа точек, после которого под графиком появляется ползунок масштаба. */
const ZOOM_MIN_POINTS = 200;

/** Подпись времени точки в подсказке и таблице: час — с временем, месяц — «Октябрь 2026». */
function pointFormatter(locale: string, aggregation: Aggregation | undefined) {
  if (aggregation === "month") return dateFormatter(locale, { month: "long", year: "numeric" });
  return dateFormatter(locale, {
    dateStyle: "medium",
    timeStyle: aggregation === "hour" ? "short" : undefined,
  });
}

/**
 * График измерений станции: периоды 24ч/7д/30д/год/всё время, осреднение по часам/суткам/месяцам
 * (варианты зависят от периода), полосы уровней шкалы тинтами, таблица значений как текстовая
 * альтернатива графику, выгрузка CSV (средние с флагом качества или исходные значения).
 */
export function MeasurementChart({
  stationSlug,
  pollutants,
  bands,
  locale,
  labels,
}: MeasurementChartProps) {
  const [range, setRange] = useState<ChartRange>("24h");
  const [aggregation, setAggregation] = useState<Aggregation>(aggregationFor("24h"));
  const [code, setCode] = useState<string>(pollutants[0]?.code ?? "");
  const [data, setData] = useState<SeriesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [tableOpen, setTableOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const { resolvedTheme } = useTheme();
  const pollutant = useMemo(
    () => pollutants.find((p) => p.code === code) ?? pollutants[0],
    [pollutants, code],
  );
  const aggregations = RANGE_AGGREGATIONS[range];

  useEffect(() => {
    if (!pollutant) return;
    const controller = new AbortController();
    setLoading(true);
    fetch(
      `/api/v1/stations/${stationSlug}/measurements?range=${range}&agg=${aggregation}&pollutant=${pollutant.code}`,
      { signal: controller.signal },
    )
      .then((r) =>
        r.ok ? (r.json() as Promise<SeriesResponse>) : Promise.reject(new Error(String(r.status))),
      )
      .then((json) => {
        setData(json);
        setLoading(false);
      })
      .catch((error: unknown) => {
        if ((error as { name?: string }).name !== "AbortError") setLoading(false);
      });
    return () => controller.abort();
  }, [stationSlug, range, aggregation, pollutant]);

  useEffect(() => {
    if (!containerRef.current) return;
    // Месяцы и дни недели на оси времени: у ECharts свои словари, по умолчанию английские
    // (недостающие строки ECharts берёт из своего английского).
    const chartLocale = { time: calendarNames(locale) } as unknown as ChartLocale;
    const chart = echarts.init(containerRef.current, undefined, {
      renderer: "canvas",
      locale: chartLocale,
    });
    chartRef.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(containerRef.current);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, [locale]);

  const points = data?.series[0]?.points ?? [];
  const zoom = points.length > ZOOM_MIN_POINTS;

  // biome-ignore lint/correctness/useExhaustiveDependencies: смена темы меняет CSS‑токены, которые эффект читает из DOM
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !pollutant) return;
    const tokens = readTokens();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const pollutantBands = bands[pollutant.code] ?? [];
    const maxValue = Math.max(0, ...points.map((p) => p.max ?? p.v ?? 0));
    const thirdBandTop = pollutantBands[Math.min(2, pollutantBands.length - 1)]?.hi ?? 0;
    const yMax = pollutantBands.length
      ? Math.ceil(Math.max(maxValue * 1.15, thirdBandTop * 1.1))
      : undefined;
    // Не Intl: в браузере нет его данных для tg, дата в подсказке была бы английской.
    const fmt = pointFormatter(locale, data?.aggregation);
    // Числа тоже не через Intl/ECharts: в браузере у tg было бы «1,000» и «0.5».
    const numFmt = numberFormatter(locale, { maximumFractionDigits: pollutant.decimals });
    const axisFmt = numberFormatter(locale);
    const fontFamily = getComputedStyle(document.body).fontFamily;

    chart.setOption(
      {
        animationDuration: reduced ? 0 : 300,
        textStyle: { fontFamily },
        grid: { left: 48, right: 12, top: 12, bottom: zoom ? 56 : 30 },
        tooltip: {
          trigger: "axis",
          backgroundColor: tokens.popover,
          borderColor: tokens.border,
          textStyle: { color: tokens.fg, fontSize: 12, fontFamily },
          formatter: (params: unknown) => {
            const p = (Array.isArray(params) ? params[0] : params) as
              | { data?: [number, number | null] }
              | undefined;
            const [ts, v] = p?.data ?? [0, null];
            return `${fmt.format(new Date(ts))}<br/><b>${v === null ? "—" : numFmt.format(v)}</b> ${pollutant.unit}`;
          },
        },
        xAxis: {
          type: "time",
          axisLine: { lineStyle: { color: tokens.border } },
          axisTick: { show: false },
          axisLabel: { color: tokens.muted, fontSize: 11, hideOverlap: true },
          splitLine: { show: false },
        },
        yAxis: {
          type: "value",
          max: yMax,
          axisLabel: {
            color: tokens.muted,
            fontSize: 11,
            formatter: (value: number) => axisFmt.format(value),
          },
          splitLine: { lineStyle: { color: tokens.border, type: "dashed" } },
        },
        dataZoom: zoom
          ? [
              {
                type: "slider",
                height: 20,
                bottom: 8,
                borderColor: tokens.border,
                textStyle: { color: tokens.muted },
              },
            ]
          : [],
        series: [
          {
            type: data?.aggregation === "hour" || !data ? "line" : "bar",
            data: points.map((p) => [new Date(p.t).getTime(), p.v]),
            smooth: 0.2,
            showSymbol: points.length < 60,
            symbolSize: 6,
            lineStyle: { width: 2.5, color: tokens.primary },
            itemStyle: { color: tokens.primary, borderRadius: [3, 3, 0, 0] },
            connectNulls: false,
            z: 3,
            markArea: {
              silent: true,
              data: pollutantBands.map((b) => [
                {
                  yAxis: b.lo,
                  itemStyle: {
                    color: tokens.tints[Math.min(6, Math.max(1, b.level)) as LevelKey],
                    opacity: 1,
                  },
                  label: {
                    show: true,
                    position: "insideRight",
                    color: tokens.muted,
                    fontSize: 10,
                    fontFamily,
                    formatter: labels.levels[String(b.level)] ?? String(b.level),
                  },
                },
                { yAxis: b.hi ?? yMax ?? maxValue * 1.2 },
              ]),
            },
          },
        ],
      },
      { notMerge: true },
    );
  }, [data, pollutant, bands, resolvedTheme, locale, labels.levels, zoom]);

  const query = `range=${range}&agg=${aggregation}`;
  const csvHref = `/api/v1/stations/${stationSlug}/measurements?${query}&format=csv`;
  const rawHref = RAW_RANGES.includes(range)
    ? `/api/v1/stations/${stationSlug}/measurements?range=${range}&agg=raw&format=csv`
    : null;
  const empty = !loading && points.length === 0;
  const caption =
    data?.aggregation === "month"
      ? labels.monthly
      : data?.aggregation === "day"
        ? labels.daily
        : labels.hourly;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          value={range}
          onValueChange={(v) => {
            const next = v as ChartRange;
            setRange(next);
            setAggregation(aggregationFor(next));
          }}
          className="max-w-full overflow-x-auto"
        >
          <TabsList aria-label={labels.title} className="bg-surface-2">
            {CHART_RANGES.map((r) => (
              <TabsTrigger key={r} value={r} className="px-3 data-active:bg-card">
                {labels.ranges[r]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <NativeSelect
          aria-label={labels.pollutant}
          value={pollutant?.code ?? ""}
          onChange={(e) => setCode(e.target.value)}
          className="w-44"
        >
          {pollutants.map((p) => (
            <NativeSelectOption key={p.code} value={p.code} title={p.hint}>
              {p.shortName} · {p.unit}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        {aggregations.length > 1 ? (
          <Tabs value={aggregation} onValueChange={(v) => setAggregation(v as Aggregation)}>
            <TabsList aria-label={labels.aggregation} className="bg-surface-2">
              {aggregations.map((a) => (
                <TabsTrigger key={a} value={a} className="px-2.5 data-active:bg-card">
                  {labels.aggregations[a]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        ) : null}
        <span className="text-caption text-muted-foreground">{caption}</span>
        <a
          href={csvHref}
          download
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "ml-auto")}
        >
          <DownloadIcon aria-hidden="true" />
          {labels.downloadCsv}
        </a>
      </div>
      <div className="relative h-64 w-full sm:h-72">
        {loading && !data ? <Skeleton className="absolute inset-0" /> : null}
        {empty ? (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            {labels.noData}
          </p>
        ) : null}
        <div
          ref={containerRef}
          className="h-full w-full"
          role="img"
          aria-label={
            pollutant
              ? `${pollutant.shortName}, ${labels.ranges[range]}, ${caption}`
              : labels.loading
          }
        />
      </div>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        {labels.hint && pollutant ? (
          <p className="text-caption text-muted-foreground">
            {labels.hint.replace("{pollutant}", pollutant.shortName)}
          </p>
        ) : null}
        {rawHref ? (
          <a
            href={rawHref}
            download
            className="ml-auto text-caption font-semibold text-brand hover:underline"
          >
            {labels.downloadRaw}
          </a>
        ) : null}
      </div>
      {pollutant && points.length > 0 ? (
        <details
          className="text-sm"
          onToggle={(e) => setTableOpen((e.currentTarget as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer font-semibold">{labels.dataTable}</summary>
          {tableOpen ? (
            <DataTable
              points={points}
              unit={pollutant.unit}
              decimals={pollutant.decimals}
              locale={locale}
              aggregation={data?.aggregation}
              columns={labels.columns}
            />
          ) : null}
        </details>
      ) : null}
    </div>
  );
}

/** Таблица значений ряда — текстовая альтернатива графику (WCAG 1.1.1), новые точки сверху. */
function DataTable({
  points,
  unit,
  decimals,
  locale,
  aggregation,
  columns,
}: {
  points: SeriesResponse["series"][number]["points"];
  unit: string;
  decimals: number;
  locale: string;
  aggregation: Aggregation | undefined;
  columns: MeasurementChartProps["labels"]["columns"];
}) {
  const fmt = pointFormatter(locale, aggregation);
  const numFmt = numberFormatter(locale, { maximumFractionDigits: decimals });
  const n = (v: number | null) => (v === null ? "—" : numFmt.format(v));
  return (
    <div className="mt-2 max-h-80 overflow-auto rounded-lg border">
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 bg-surface-2">
          <tr>
            <th scope="col" className="px-3 py-1.5 font-semibold">
              {columns.time}
            </th>
            <th scope="col" className="px-3 py-1.5 text-right font-semibold">
              {columns.mean}, {unit}
            </th>
            <th scope="col" className="px-3 py-1.5 text-right font-semibold">
              {columns.min}
            </th>
            <th scope="col" className="px-3 py-1.5 text-right font-semibold">
              {columns.max}
            </th>
            <th scope="col" className="px-3 py-1.5 text-right font-semibold">
              {columns.samples}
            </th>
          </tr>
        </thead>
        <tbody>
          {[...points].reverse().map((p) => (
            <tr key={p.t} className="border-t">
              <td className="px-3 py-1">{fmt.format(new Date(p.t))}</td>
              <td className="num px-3 py-1 text-right">{n(p.v)}</td>
              <td className="num px-3 py-1 text-right">{n(p.min)}</td>
              <td className="num px-3 py-1 text-right">{n(p.max)}</td>
              <td className="num px-3 py-1 text-right">{p.n}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
