"use client";

import { Skeleton } from "@meteo/ui/components/skeleton";
import dynamic from "next/dynamic";
import { DeferUntilVisible } from "@/components/defer-until-visible";
import type { MeasurementChartProps } from "./measurement-chart";

const MeasurementChartDynamic = dynamic(
  () => import("./measurement-chart").then((m) => m.MeasurementChart),
  { ssr: false, loading: () => <Skeleton className="h-72 w-full" /> },
);

/** ECharts подгружается, когда блок графика приближается к области просмотра. */
export function MeasurementChartLazy(props: MeasurementChartProps) {
  return (
    <DeferUntilVisible
      name="chart"
      className="min-h-72"
      placeholder={<Skeleton className="h-72 w-full" />}
    >
      <MeasurementChartDynamic {...props} />
    </DeferUntilVisible>
  );
}
