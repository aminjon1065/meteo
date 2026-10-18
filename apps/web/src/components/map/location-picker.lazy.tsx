"use client";

import { Skeleton } from "@meteo/ui/components/skeleton";
import dynamic from "next/dynamic";

export const LocationPickerLazy = dynamic(
  () => import("./location-picker").then((m) => m.LocationPicker),
  {
    ssr: false,
    loading: () => <Skeleton className="h-full w-full rounded-xl" />,
  },
);
