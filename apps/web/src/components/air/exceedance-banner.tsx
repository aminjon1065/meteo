import { displayScaleFor, toDisplayValue } from "@meteo/core";
import type { Locale } from "@meteo/i18n";
import { Alert, AlertDescription, AlertTitle } from "@meteo/ui/components/alert";
import { TriangleAlertIcon } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { loadActiveExceedances } from "@/lib/exceedances";
import { name } from "@/lib/format";
import { getConcentrationDisplayMode } from "@/lib/settings";

/** Баннер действующих превышений порогов (правила с каналом «портал»). */
export async function ExceedanceBanner({
  locale,
  stationId,
}: {
  locale: Locale;
  stationId?: number;
}) {
  const [t, format, events, mode] = await Promise.all([
    getTranslations("exceedances"),
    getFormatter(),
    loadActiveExceedances(stationId),
    getConcentrationDisplayMode(),
  ]);
  const visible = events.filter((e) => e.channels.includes("portal"));
  if (visible.length === 0) return null;
  return (
    <Alert variant="destructive" className="border-aq-4/50 bg-aq-4/10">
      <TriangleAlertIcon />
      <AlertTitle>{t("title", { count: visible.length })}</AlertTitle>
      <AlertDescription>
        <ul className="grid gap-1">
          {visible.map((e) => {
            // Концентрация и порог — в единице отображения портала (µg/m³ или mg/m³).
            const scale = displayScaleFor(e.unit ?? "µg/m³", e.decimals ?? 1, mode);
            return (
              <li key={e.id}>
                <Link href={`/air/stations/${e.stationSlug}`} className="font-medium underline">
                  {name(e.stationName, locale)}
                </Link>
                {": "}
                {e.kind === "pollutant"
                  ? t("pollutant", {
                      pollutant: e.pollutant ?? "",
                      value: format.number(
                        toDisplayValue(e.lastValue ?? e.peakValue ?? 0, scale) ?? 0,
                        {
                          maximumFractionDigits: scale.decimals,
                        },
                      ),
                      unit: scale.unit,
                      threshold: format.number(toDisplayValue(e.threshold, scale) ?? e.threshold, {
                        maximumFractionDigits: scale.decimals,
                      }),
                    })
                  : t("index", { level: e.level ?? e.threshold })}
                {" · "}
                <span className="text-muted-foreground">
                  {t("since", {
                    time: format.dateTime(e.startedAt, { timeStyle: "short", dateStyle: "short" }),
                  })}
                </span>
              </li>
            );
          })}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
