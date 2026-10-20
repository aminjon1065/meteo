import { symbolPath } from "@meteo/core";
import { cn } from "@meteo/ui/lib/utils";

/**
 * Символ погоды FMI SmartSymbol (SVG из apps/web/public/weather-symbols, тема light/dark).
 * Без кода символа ничего не рисуется: провайдер не отдал SmartSymbol (открытые данные ECMWF),
 * и на месте иконки остаётся текстовое описание рядом, а не пустая картинка.
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
  if (!light || !dark) return null;
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

/** Есть ли у кода символа картинка (чтобы решить, нужен ли текст вместо неё). */
export function hasSymbol(code: number | null | undefined): boolean {
  return Boolean(symbolPath(code, "light"));
}
