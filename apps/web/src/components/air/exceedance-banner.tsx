import type { Locale } from "@meteo/i18n";
import { Alert, AlertDescription, AlertTitle } from "@meteo/ui/components/alert";
import { TriangleAlertIcon } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { loadActiveExceedances } from "@/lib/exceedances";
import { name } from "@/lib/format";

/** Баннер действующих превышений порогов (правила с каналом «портал»). */
export async function ExceedanceBanner({
  locale,
  stationId,
}: {
  locale: Locale;
  stationId?: number;
}) {
  const [t, format, events] = await Promise.all([
    getTranslations("exceedances"),
    getFormatter(),
    loadActiveExceedances(stationId),
  ]);
  const visible = events.filter((e) => e.channels.includes("portal"));
  if (visible.length === 0) return null;
  return (
    <Alert variant="destructive" className="border-aq-4/50 bg-aq-4/10">
      <TriangleAlertIcon />
      <AlertTitle>{t("title", { count: visible.length })}</AlertTitle>
      <AlertDescription>
        <ul className="grid gap-1">
          {visible.map((e) => (
            <li key={e.id}>
              <Link href={`/air/stations/${e.stationSlug}`} className="font-medium underline">
                {name(e.stationName, locale)}
              </Link>
              {": "}
              {e.kind === "pollutant"
                ? t("pollutant", {
                    pollutant: e.pollutant ?? "",
                    value: format.number(e.lastValue ?? e.peakValue ?? 0, {
                      maximumFractionDigits: 1,
                    }),
                    unit: e.unit ?? "",
                    threshold: e.threshold,
                  })
                : t("index", { level: e.level ?? e.threshold })}
              {" · "}
              <span className="text-muted-foreground">
                {t("since", {
                  time: format.dateTime(e.startedAt, { timeStyle: "short", dateStyle: "short" }),
                })}
              </span>
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
