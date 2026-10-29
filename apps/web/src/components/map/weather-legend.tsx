import type { Locale } from "@meteo/i18n";
import { cn } from "@meteo/ui/lib/utils";
import { numberFormatter } from "@/lib/number-format";
import type { WeatherParamDef } from "./weather-layers";

/** Позиция подписи под шкалой: у краёв подпись не выходит за пределы панели. */
function tickStyle(left: number): { left: string; transform: string } {
  const shift = left < 4 ? "0" : left > 96 ? "-100%" : "-50%";
  return { left: `${left}%`, transform: `translateX(${shift})` };
}

/**
 * Шкала слоя погоды: классы заливки равной ширины (как в продукте SmartMet) и подписи нижних
 * границ выбранных классов. Цвета — weather-layers.ts.
 */
export function WeatherLegend({
  def,
  locale,
  caption,
  className,
}: {
  def: WeatherParamDef;
  locale: Locale;
  /** Подпись над шкалой, например «Шкала, °C». */
  caption: string;
  className?: string;
}) {
  // Не Intl: в браузере нет его данных для tg, подписи шкалы стали бы английскими после гидратации.
  const fmt = numberFormatter(locale, { maximumFractionDigits: 1 });
  const n = def.legend.length;
  const first = def.legend[0]?.lo;
  const last = def.legend[n - 1]?.lo;
  return (
    <figure className={cn("flex flex-col gap-1", className)}>
      <figcaption className="text-[11px] leading-none text-muted-foreground">{caption}</figcaption>
      <div
        role="img"
        aria-label={`${caption}: ${first !== undefined && first !== null ? fmt.format(first) : ""} … ${last !== undefined && last !== null ? fmt.format(last) : ""}+`}
        className="flex h-2.5 overflow-hidden rounded-sm ring-1 ring-foreground/10"
      >
        {def.legend.map((c) => (
          <span key={String(c.lo)} className="flex-1" style={{ background: c.color }} />
        ))}
      </div>
      <div
        className="relative h-3 text-[10px] leading-none tabular-nums text-muted-foreground"
        aria-hidden="true"
      >
        {def.ticks.map((t) => {
          const i = def.legend.findIndex((c) => c.lo === t);
          if (i < 0) return null;
          return (
            <span key={t} className="absolute top-0" style={tickStyle((i / n) * 100)}>
              {fmt.format(t)}
            </span>
          );
        })}
      </div>
    </figure>
  );
}
