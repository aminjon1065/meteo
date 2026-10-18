"use client";

import { AQ_LEVEL_STYLES } from "@meteo/core";
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

type LevelKey = 1 | 2 | 3 | 4 | 5;

/** График измерений станции: периоды 24ч/7д/30д/1г, полосы уровней шкалы, выгрузка CSV. */
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

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !pollutant) return;
    const points = data?.series[0]?.points ?? [];
    const dark = resolvedTheme === "dark";
    const styles = getComputedStyle(document.documentElement);
    const fg = styles.getPropertyValue("--foreground").trim() || (dark ? "#e5ecf6" : "#0f172a");
    const muted = styles.getPropertyValue("--muted-foreground").trim() || "#64748b";
    const border = styles.getPropertyValue("--border").trim() || "#d9e1ec";
    const primary = styles.getPropertyValue("--brand-primary").trim() || "#0e5ea8";
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

    chart.setOption(
      {
        animationDuration: 300,
        grid: { left: 52, right: 16, top: 16, bottom: range === "1y" ? 56 : 32 },
        tooltip: {
          trigger: "axis",
          backgroundColor: dark ? "#111a2b" : "#ffffff",
          borderColor: border,
          textStyle: { color: fg, fontSize: 12 },
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
          axisLine: { lineStyle: { color: border } },
          axisLabel: { color: muted, fontSize: 11, hideOverlap: true },
          splitLine: { show: false },
        },
        yAxis: {
          type: "value",
          max: yMax,
          axisLabel: { color: muted, fontSize: 11 },
          splitLine: { lineStyle: { color: border, type: "dashed" } },
        },
        dataZoom:
          range === "1y"
            ? [
                {
                  type: "slider",
                  height: 20,
                  bottom: 8,
                  borderColor: border,
                  textStyle: { color: muted },
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
            lineStyle: { width: 2, color: primary },
            itemStyle: { color: primary, borderRadius: [3, 3, 0, 0] },
            areaStyle: data?.aggregation === "hour" ? { color: primary, opacity: 0.08 } : undefined,
            connectNulls: false,
            markArea: {
              silent: true,
              data: pollutantBands.map((b) => [
                {
                  yAxis: b.lo,
                  itemStyle: {
                    color: AQ_LEVEL_STYLES[Math.min(5, Math.max(1, b.level)) as LevelKey].color,
                    opacity: dark ? 0.14 : 0.1,
                  },
                  label: {
                    show: true,
                    position: "insideRight",
                    color: muted,
                    fontSize: 10,
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
        <Tabs value={range} onValueChange={(v) => setRange(v as ChartRange)}>
          <TabsList>
            {CHART_RANGES.map((r) => (
              <TabsTrigger key={r} value={r}>
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
            <NativeSelectOption key={p.code} value={p.code}>
              {p.shortName} · {p.unit}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <span className="text-xs text-muted-foreground">
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
      <div className="relative h-72 w-full">
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
    </div>
  );
}
