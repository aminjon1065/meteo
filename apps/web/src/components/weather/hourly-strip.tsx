import type { ForecastPoint } from "@meteo/db";
import { getFormatter, getTranslations } from "next-intl/server";
import { symbolLabel } from "@/lib/weather";
import { hasSymbol, WeatherSymbol } from "./weather-symbol";

/** Лента ближайших часов: время, символ, температура, осадки (горизонтальная прокрутка). */
export async function HourlyStrip({ points }: { points: ForecastPoint[] }) {
  const [t, ts, format] = await Promise.all([
    getTranslations("weather"),
    getTranslations("weatherSymbols"),
    getFormatter(),
  ]);
  if (points.length === 0) return null;
  return (
    <ol
      className="flex snap-x gap-2 overflow-x-auto pb-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      aria-label={t("next24h")}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: горизонтальная прокрутка ленты с клавиатуры (axe scrollable-region-focusable)
      tabIndex={0}
    >
      {points.map((p, i) => {
        const label = symbolLabel(ts, p.params.symbol);
        const isMidnight = (((p.time.getTime() / 3_600_000 + 5) % 24) + 24) % 24 === 0;
        return (
          <li
            key={p.time.toISOString()}
            className="flex min-w-[4.5rem] snap-start flex-col items-center gap-1 rounded-xl border bg-card px-2 py-2 text-center"
          >
            <span className="text-caption text-muted-foreground">
              {i === 0
                ? t("now")
                : isMidnight
                  ? format.dateTime(p.time, { weekday: "short" })
                  : format.dateTime(p.time, { hour: "2-digit", minute: "2-digit" })}
            </span>
            {hasSymbol(p.params.symbol) ? (
              <WeatherSymbol code={p.params.symbol} label={label} className="size-9" />
            ) : null}
            <span className="num font-heading text-base font-bold">
              {p.params.t === null || p.params.t === undefined
                ? "—"
                : `${format.number(p.params.t, { maximumFractionDigits: 0 })}°`}
            </span>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {p.params.precip
                ? `${format.number(p.params.precip, { maximumFractionDigits: 1 })} ${t("mm")}`
                : " "}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
