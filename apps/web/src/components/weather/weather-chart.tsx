"use client";

import { BarChart, LineChart } from "echarts/charts";
import { GridComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useTheme } from "next-themes";
import { useEffect, useRef } from "react";

echarts.use([
  LineChart,
  BarChart,
  GridComponent,
  TooltipComponent,
  MarkLineComponent,
  CanvasRenderer,
]);

export interface WeatherChartPoint {
  t: string;
  temp: number | null;
  precip: number | null;
}

export interface WeatherChartProps {
  points: WeatherChartPoint[];
  locale: string;
  labels: { temperature: string; precip: string };
  className?: string;
}

/** Почасовой график: температура (линия) и осадки за час (столбцы), местное время. */
export function WeatherChart({ points, locale, labels, className }: WeatherChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const { resolvedTheme } = useTheme();

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
    if (!chart) return;
    const styles = getComputedStyle(document.documentElement);
    const fg = styles.getPropertyValue("--foreground").trim() || "#142238";
    const muted = styles.getPropertyValue("--muted-foreground").trim() || "#4e5f78";
    const border = styles.getPropertyValue("--border").trim() || "#d5deea";
    const popover = styles.getPropertyValue("--popover").trim() || "#ffffff";
    const tempColor = styles.getPropertyValue("--brand-accent").trim() || "#c98a1f";
    const precipColor = styles.getPropertyValue("--brand-primary").trim() || "#164a7c";
    const fontFamily = getComputedStyle(document.body).fontFamily;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const fmt = new Intl.DateTimeFormat(locale, {
      timeZone: "Asia/Dushanbe",
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
    const dayFmt = new Intl.DateTimeFormat(locale, {
      timeZone: "Asia/Dushanbe",
      weekday: "short",
      day: "numeric",
    });
    const hourFmt = new Intl.DateTimeFormat(locale, {
      timeZone: "Asia/Dushanbe",
      hour: "2-digit",
      minute: "2-digit",
    });
    // Полуночи (местные) — вертикальные разделители суток.
    const midnights: number[] = [];
    for (const p of points) {
      const ts = new Date(p.t).getTime();
      if ((((ts / 3_600_000 + 5) % 24) + 24) % 24 === 0) midnights.push(ts);
    }
    const temps = points.map((p) => p.temp).filter((v): v is number => v !== null);
    const tMin = temps.length ? Math.floor(Math.min(...temps) / 5) * 5 - 5 : undefined;
    const tMax = temps.length ? Math.ceil(Math.max(...temps) / 5) * 5 + 5 : undefined;
    const maxPrecip = Math.max(1, ...points.map((p) => p.precip ?? 0));

    chart.setOption(
      {
        animationDuration: reduced ? 0 : 300,
        textStyle: { fontFamily },
        grid: { left: 44, right: 44, top: 20, bottom: 32 },
        tooltip: {
          trigger: "axis",
          backgroundColor: popover,
          borderColor: border,
          textStyle: { color: fg, fontSize: 12, fontFamily },
          formatter: (params: unknown) => {
            const list = (Array.isArray(params) ? params : [params]) as Array<{
              seriesName: string;
              data: [number, number | null];
            }>;
            const ts = list[0]?.data[0] ?? 0;
            const lines = list.map((p) => {
              const v = p.data[1];
              const unit = p.seriesName === labels.temperature ? " °C" : " mm";
              return `${p.seriesName}: <b>${v === null ? "—" : v}</b>${unit}`;
            });
            return `${fmt.format(new Date(ts))}<br/>${lines.join("<br/>")}`;
          },
        },
        xAxis: {
          type: "time",
          axisLine: { lineStyle: { color: border } },
          axisLabel: {
            color: muted,
            fontSize: 11,
            hideOverlap: true,
            formatter: (value: number) => {
              const d = new Date(value);
              return (((value / 3_600_000 + 5) % 24) + 24) % 24 === 0
                ? dayFmt.format(d)
                : hourFmt.format(d);
            },
          },
          splitLine: { show: false },
        },
        yAxis: [
          {
            type: "value",
            name: "°C",
            min: tMin,
            max: tMax,
            axisLabel: { color: muted, fontSize: 11 },
            nameTextStyle: { color: muted, fontSize: 10 },
            splitLine: { lineStyle: { color: border, type: "dashed" } },
          },
          {
            type: "value",
            name: "mm",
            min: 0,
            max: Math.ceil(maxPrecip * 2),
            axisLabel: { color: muted, fontSize: 11 },
            nameTextStyle: { color: muted, fontSize: 10 },
            splitLine: { show: false },
          },
        ],
        series: [
          {
            name: labels.precip,
            type: "bar",
            yAxisIndex: 1,
            data: points.map((p) => [new Date(p.t).getTime(), p.precip]),
            itemStyle: { color: precipColor, opacity: 0.55, borderRadius: [2, 2, 0, 0] },
            barMaxWidth: 10,
          },
          {
            name: labels.temperature,
            type: "line",
            yAxisIndex: 0,
            data: points.map((p) => [new Date(p.t).getTime(), p.temp]),
            smooth: 0.3,
            showSymbol: false,
            lineStyle: { width: 2.5, color: tempColor },
            itemStyle: { color: tempColor },
            areaStyle: { color: tempColor, opacity: 0.08 },
            markLine: {
              silent: true,
              symbol: "none",
              lineStyle: { color: border, type: "solid", width: 1 },
              label: { show: false },
              data: midnights.map((ts) => ({ xAxis: ts })),
            },
          },
        ],
      },
      { notMerge: true },
    );
  }, [points, resolvedTheme, locale, labels]);

  return (
    <div
      ref={containerRef}
      className={className ?? "h-64 w-full"}
      role="img"
      aria-label={`${labels.temperature}, ${labels.precip}`}
    />
  );
}
