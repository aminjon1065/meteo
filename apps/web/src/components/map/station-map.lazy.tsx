"use client";

import { Skeleton } from "@meteo/ui/components/skeleton";
import dynamic from "next/dynamic";
import { DeferUntilVisible } from "@/components/defer-until-visible";
import type { StationMapProps } from "./station-map";

const StationMapDynamic = dynamic(() => import("./station-map").then((m) => m.StationMap), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-xl" />,
});

/**
 * Ленивая загрузка MapLibre (≈300 КБ + глифы подложки и тайлы): чанк и данные запрашиваются,
 * только когда контейнер карты приближается к области просмотра. Размеры задаёт className
 * контейнера, сама карта заполняет его целиком.
 */
export function StationMapLazy({ className, ...props }: StationMapProps) {
  return (
    <DeferUntilVisible
      className={className}
      name="map"
      placeholder={<Skeleton className="h-full w-full rounded-xl" />}
    >
      <StationMapDynamic {...props} className="h-full w-full" />
    </DeferUntilVisible>
  );
}
