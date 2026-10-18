import { symbolPath } from "@meteo/core";
import { cn } from "@meteo/ui/lib/utils";
import { CloudSunIcon } from "lucide-react";

/**
 * Символ погоды FMI SmartSymbol (SVG из apps/web/public/weather-symbols, тема light/dark).
 * Без кода — нейтральная иконка: провайдер не отдал SmartSymbol (например, открытые данные ECMWF).
 */
export function WeatherSymbol({
  code,
  label,
  className,
}: {
  code: number | null | undefined;
  label: string;
  className?: string;
}) {
  const light = symbolPath(code, "light");
  const dark = symbolPath(code, "dark");
  if (!light || !dark) {
    return (
      <span
        role="img"
        aria-label={label}
        title={label}
        className={cn(
          "inline-flex shrink-0 items-center justify-center text-muted-foreground/50",
          className,
        )}
      >
        <CloudSunIcon className="size-[70%]" strokeWidth={1.5} aria-hidden="true" />
      </span>
    );
  }
  return (
    <span className={cn("inline-block shrink-0", className)} title={label}>
      {/* biome-ignore lint/performance/noImgElement: статический SVG из public, оптимизация next/image не нужна */}
      <img src={light} alt={label} className="h-full w-full dark:hidden" loading="lazy" />
      {/* biome-ignore lint/performance/noImgElement: тёмный вариант того же SVG */}
      <img
        src={dark}
        alt=""
        aria-hidden="true"
        className="hidden h-full w-full dark:block"
        loading="lazy"
      />
    </span>
  );
}
