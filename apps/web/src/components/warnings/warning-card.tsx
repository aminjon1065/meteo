import type { Locale } from "@meteo/i18n";
import { cn } from "@meteo/ui/lib/utils";
import { getFormatter, getTranslations } from "next-intl/server";
import { name } from "@/lib/format";
import type { LocalizedWarning } from "@/lib/warnings";
import { SeverityBadge, severityBorderClass } from "./severity-badge";

export interface WarningCardProps {
  warning: LocalizedWarning;
  locale: Locale;
  /** Компактный вид для списков на главной и страницах города. */
  compact?: boolean;
  className?: string;
}

/** Карточка CAP‑предупреждения: уровень, событие, сроки, территория, описание и рекомендации. */
export async function WarningCard({ warning: w, locale, compact, className }: WarningCardProps) {
  const [t, format] = await Promise.all([getTranslations("warnings"), getFormatter()]);
  const dt = (d: Date) =>
    format.dateTime(d, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const period = w.end
    ? t("period", { from: dt(w.start), to: dt(w.end) })
    : t("from", { time: dt(w.start) });
  const regionNames = w.regions.map((r) => name(r.name, locale) || r.code);
  const territory = regionNames.length > 0 ? regionNames : w.areaDescs;
  return (
    <article
      className={cn(
        "flex flex-col gap-2 rounded-xl border border-l-4 bg-card p-4",
        severityBorderClass(w.severity),
        className,
      )}
      lang={w.infoLocale ?? undefined}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <SeverityBadge
          severity={w.severity}
          label={t(`severity.${w.severity}` as "severity.Severe")}
        />
        <span className="font-medium text-foreground">{w.eventName}</span>
        {w.msgType === "Update" ? <span>· {t("updated")}</span> : null}
        {w.upcoming ? <span>· {t("upcoming").toLowerCase()}</span> : null}
      </div>
      <h3 className={cn("font-semibold", compact ? "text-sm" : "text-lg")}>{w.headline}</h3>
      <p className="text-sm text-muted-foreground tabular-nums">
        {period}
        {territory.length ? ` · ${territory.join(", ")}` : ""}
      </p>
      {!compact && w.description ? (
        <p className="text-sm whitespace-pre-line">{w.description}</p>
      ) : null}
      {!compact && w.instruction ? (
        <div className="rounded-lg bg-accent/40 p-3 text-sm">
          <p className="mb-1 text-xs font-medium text-muted-foreground uppercase">
            {t("instruction")}
          </p>
          <p className="whitespace-pre-line">{w.instruction}</p>
        </div>
      ) : null}
      {!compact ? (
        <p className="text-xs text-muted-foreground">
          {t("issued", { time: dt(w.sent) })}
          {w.senderName ? ` · ${t("sender", { sender: w.senderName })}` : ""}
          {" · "}
          {t(`urgency.${w.urgency}` as "urgency.Expected")},{" "}
          {t(`certainty.${w.certainty}` as "certainty.Likely")}
        </p>
      ) : null}
    </article>
  );
}
