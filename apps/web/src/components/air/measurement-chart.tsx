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

echarts.use([
  LineChart,
  BarChart,
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  MarkAreaComponent,
  CanvasRenderer,
]);

export const CHART_RANGES = ["24h", "7d", "30d", "1y"] as const;
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
    levels: Record<string, string>;
    /** Подпись под графиком с плейсхолдером {pollutant}. */
    hint?: string;
    title?: string;
  };
}

interface SeriesResponse {
  aggregation: "hour" | "day";
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

/** График измерений станции: периоды 24ч/7д/30д/1г, полосы уровней шкалы тинтами, выгрузка CSV. */
export function MeasurementChart({
  stationSlug,
  pollutants,
  bands,
  locale,
  labels,
}: MeasurementChartProps) {
  const [range, setRange] = useState<ChartRange>("24h");
  const [code, setCode] = useState<string>(pollutants[0]?.code ?? "");
  const [data, setData] = useState<SeriesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const { resolvedTheme } = useTheme();
  const pollutant = useMemo(
    () => pollutants.find((p) => p.code === code) ?? pollutants[0],
    [pollutants, code],
  );

  useEffect(() => {
    if (!pollutant) return;
    const controller = new AbortController();
    setLoading(true);
    fetch(
      `/api/v1/stations/${stationSlug}/measurements?range=${range}&pollutant=${pollutant.code}`,
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
  }, [stationSlug, range, pollutant]);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = echarts.init(containerRef.current, undefined, { renderer: "canvas" });
    chartRef.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(containerRef.current);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: смена темы меняет CSS‑токены, которые эффект читает из DOM
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !pollutant) return;
    const points = data?.series[0]?.points ?? [];
    const tokens = readTokens();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const pollutantBands = bands[pollutant.code] ?? [];
    const maxValue = Math.max(0, ...points.map((p) => p.max ?? p.v ?? 0));
    const thirdBandTop = pollutantBands[Math.min(2, pollutantBands.length - 1)]?.hi ?? 0;
    const yMax = pollutantBands.length
      ? Math.ceil(Math.max(maxValue * 1.15, thirdBandTop * 1.1))
      : undefined;
    const fmt = new Intl.DateTimeFormat(locale, {
      timeZone: "Asia/Dushanbe",
      dateStyle: "medium",
      timeStyle: data?.aggregation === "hour" ? "short" : undefined,
    });
    const numFmt = new Intl.NumberFormat(locale, { maximumFractionDigits: pollutant.decimals });
    const fontFamily = getComputedStyle(document.body).fontFamily;

    chart.setOption(
      {
        animationDuration: reduced ? 0 : 300,
        textStyle: { fontFamily },
        grid: { left: 48, right: 12, top: 12, bottom: range === "1y" ? 56 : 30 },
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
          axisLabel: { color: tokens.muted, fontSize: 11 },
          splitLine: { lineStyle: { color: tokens.border, type: "dashed" } },
        },
        dataZoom:
          range === "1y"
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
            type: data?.aggregation === "day" ? "bar" : "line",
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
  }, [data, pollutant, bands, resolvedTheme, locale, labels.levels, range]);

  const csvHref = `/api/v1/stations/${stationSlug}/measurements?range=${range}&format=csv`;
  const empty = !loading && (data?.series[0]?.points.length ?? 0) === 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          value={range}
          onValueChange={(v) => setRange(v as ChartRange)}
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
        <span className="text-caption text-muted-foreground">
          {data?.aggregation === "day" ? labels.daily : labels.hourly}
        </span>
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
            pollutant ? `${pollutant.shortName}, ${labels.ranges[range]}` : labels.loading
          }
        />
      </div>
      {labels.hint && pollutant ? (
        <p className="text-caption text-muted-foreground">
          {labels.hint.replace("{pollutant}", pollutant.shortName)}
        </p>
      ) : null}
    </div>
  );
}
