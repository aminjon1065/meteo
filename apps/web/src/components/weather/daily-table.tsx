import type { ForecastPoint } from "@meteo/db";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@meteo/ui/components/table";
import { getFormatter, getTranslations } from "next-intl/server";
import { symbolLabel } from "@/lib/weather";
import { hasSymbol, WeatherSymbol } from "./weather-symbol";

/** Таблица прогноза по дням: символ, макс/мин, осадки, ветер. */
export async function DailyTable({ days }: { days: ForecastPoint[] }) {
  const [t, ts, format] = await Promise.all([
    getTranslations("weather"),
    getTranslations("weatherSymbols"),
    getFormatter(),
  ]);
  if (days.length === 0) return null;
  const n = (v: number | null | undefined, digits = 0) =>
    v === null || v === undefined ? "—" : format.number(v, { maximumFractionDigits: digits });
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("day")}</TableHead>
          <TableHead />
          <TableHead className="text-right">{t("max")}</TableHead>
          <TableHead className="text-right">{t("min")}</TableHead>
          <TableHead className="text-right">{t("precip")}</TableHead>
          <TableHead className="text-right">{t("wind")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {days.map((d) => {
          const label = symbolLabel(ts, d.params.symbol);
          return (
            <TableRow key={d.time.toISOString()}>
              <TableCell className="whitespace-nowrap">
                <span className="font-medium">{format.dateTime(d.time, { weekday: "short" })}</span>
                <span className="ml-2 text-muted-foreground">
                  {format.dateTime(d.time, { day: "numeric", month: "short" })}
                </span>
              </TableCell>
              <TableCell>
                <span className="flex items-center gap-2">
                  {hasSymbol(d.params.symbol) ? (
                    <WeatherSymbol code={d.params.symbol} label={label} className="size-8" />
                  ) : null}
                  {hasSymbol(d.params.symbol) ? (
                    <span className="text-muted-foreground">{label}</span>
                  ) : (
                    <span className="text-muted-foreground/60">—</span>
                  )}
                </span>
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums">
                {n(d.params.tmax)}°
              </TableCell>
              <TableCell className="text-right text-muted-foreground tabular-nums">
                {n(d.params.tmin)}°
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {d.params.precipSum ? `${n(d.params.precipSum, 1)} ${t("mm")}` : "—"}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {d.params.ws !== null && d.params.ws !== undefined
                  ? `${n(d.params.ws, 1)} ${t("ms")}`
                  : "—"}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
