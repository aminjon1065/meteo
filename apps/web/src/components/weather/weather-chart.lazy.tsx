"use client";

import { Skeleton } from "@meteo/ui/components/skeleton";
import dynamic from "next/dynamic";
import { DeferUntilVisible } from "@/components/defer-until-visible";
import type { WeatherChartProps } from "./weather-chart";

const WeatherChartDynamic = dynamic(() => import("./weather-chart").then((m) => m.WeatherChart), {
  ssr: false,
  loading: () => <Skeleton className="h-64 w-full" />,
});

/** ECharts подгружается, когда блок графика приближается к области просмотра. */
export function WeatherChartLazy(props: WeatherChartProps) {
  return (
    <DeferUntilVisible
      name="weather-chart"
      className="min-h-64"
      placeholder={<Skeleton className="h-64 w-full" />}
    >
      <WeatherChartDynamic {...props} />
    </DeferUntilVisible>
  );
}
