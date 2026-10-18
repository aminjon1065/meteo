import type { StationIngestSummary } from "@meteo/db/schema";
import { Badge } from "@meteo/ui/components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@meteo/ui/components/card";
import { cn } from "@meteo/ui/lib/utils";
import { SatelliteDishIcon } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export interface StationIngestCardProps {
  stationCode: string;
  lastIngestAt: Date | null;
  lastIngestSource: "api" | "pull" | null;
  summary: StationIngestSummary | null;
  /** Данные старше порога (минуты) считаются устаревшими. */
  staleAfterMin: number;
  hasApiKey: boolean;
}

/** Карточка «Автоматический приём данных»: когда, откуда и сколько принято в последний раз. */
export async function StationIngestCard(props: StationIngestCardProps) {
  const [t, format] = await Promise.all([getTranslations("stations.ingest"), getFormatter()]);
  const now = Date.now();
  const stale =
    props.lastIngestAt !== null &&
    now - props.lastIngestAt.getTime() > props.staleAfterMin * 60_000;
  const state = !props.lastIngestAt ? "never" : stale ? "stale" : "fresh";
  const tone: Record<typeof state, string> = {
    fresh: "border-status-fresh/30 bg-status-fresh/15 text-status-fresh-text",
    stale: "border-status-stale/30 bg-status-stale/15 text-status-stale-text",
    never: "bg-muted text-muted-foreground",
  };
  const s = props.summary;
  return (
    <Card data-testid="station-ingest-card">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <SatelliteDishIcon className="size-4" aria-hidden="true" />
            {t("title")}
          </span>
          <Badge variant="outline" className={cn("font-medium", tone[state])}>
            {t(`state.${state}`)}
          </Badge>
        </CardTitle>
        <CardDescription>
          {props.lastIngestAt
            ? t("lastAt", {
                relative: format.relativeTime(props.lastIngestAt),
                time: format.dateTime(props.lastIngestAt, {
                  dateStyle: "medium",
                  timeStyle: "short",
                }),
                source: t(`source.${props.lastIngestSource ?? "api"}`),
              })
            : t("never")}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {s ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">{t("accepted")}</dt>
              <dd className="font-semibold tabular-nums">{s.accepted}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("rejected")}</dt>
              <dd
                className={cn("font-semibold tabular-nums", s.rejected > 0 && "text-destructive")}
              >
                {s.rejected}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("invalidRange")}</dt>
              <dd className="font-semibold tabular-nums">{s.invalidRange}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("pollutants")}</dt>
              <dd className="font-mono text-xs">{s.pollutants.join(", ") || "—"}</dd>
            </div>
            <div className="col-span-2 sm:col-span-4">
              <dt className="text-xs text-muted-foreground">{t("period")}</dt>
              <dd className="tabular-nums">
                {s.from && s.to
                  ? `${format.dateTime(new Date(s.from), { dateStyle: "short", timeStyle: "short" })} — ${format.dateTime(new Date(s.to), { dateStyle: "short", timeStyle: "short" })}`
                  : "—"}
                {s.file ? (
                  <span className="ml-2 font-mono text-xs text-muted-foreground">{s.file}</span>
                ) : null}
                {s.agent ? (
                  <span className="ml-2 font-mono text-xs text-muted-foreground">{s.agent}</span>
                ) : null}
              </dd>
            </div>
          </dl>
        ) : null}
        <p className="text-xs text-muted-foreground">
          {t("endpoint")} <code className="font-mono">POST /api/v1/ingest/{props.stationCode}</code>
          {props.hasApiKey ? "" : ` — ${t("noKey")}`}
          {" · "}
          <Link href="/data/api" className="underline-offset-4 hover:underline">
            {t("docs")}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
