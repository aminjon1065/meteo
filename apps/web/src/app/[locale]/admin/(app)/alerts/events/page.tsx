import { desc, eq } from "@meteo/db";
import { alertEvents, alertRules, stations } from "@meteo/db/schema";
import type { Locale } from "@meteo/i18n";
import { Badge } from "@meteo/ui/components/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@meteo/ui/components/table";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { ResolveEventButton } from "@/components/admin/alerts/resolve-event-button";
import { getDb } from "@/lib/db";
import { name } from "@/lib/format";
import { requireAdminSession } from "@/lib/session";
import { resolveEvent } from "../actions";

export const dynamic = "force-dynamic";

export default async function AlertEventsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  await requireAdminSession(locale, "alerts.manage");
  const [t, format, rows] = await Promise.all([
    getTranslations("alerts"),
    getFormatter(),
    getDb()
      .select({
        id: alertEvents.id,
        startedAt: alertEvents.startedAt,
        endedAt: alertEvents.endedAt,
        peakValue: alertEvents.peakValue,
        level: alertEvents.level,
        status: alertEvents.status,
        notifiedAt: alertEvents.notifiedAt,
        rule: alertRules.name,
        station: stations.name,
        stationCode: stations.code,
      })
      .from(alertEvents)
      .innerJoin(alertRules, eq(alertRules.id, alertEvents.ruleId))
      .innerJoin(stations, eq(stations.id, alertEvents.stationId))
      .orderBy(desc(alertEvents.status), desc(alertEvents.startedAt))
      .limit(200),
  ]);
  async function resolve(id: number) {
    "use server";
    return resolveEvent(locale, id);
  }
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("events.title")}</h1>
        <p className="text-muted-foreground">{t("events.subtitle")}</p>
      </div>
      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("events.started")}</TableHead>
              <TableHead>{t("events.ended")}</TableHead>
              <TableHead>{t("fields.name")}</TableHead>
              <TableHead>{t("fields.station")}</TableHead>
              <TableHead className="text-right">{t("events.peak")}</TableHead>
              <TableHead>{t("events.notified")}</TableHead>
              <TableHead>{t("fields.status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  {t("events.empty")}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="tabular-nums">
                    {format.dateTime(e.startedAt, { dateStyle: "short", timeStyle: "short" })}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {e.endedAt
                      ? format.dateTime(e.endedAt, { dateStyle: "short", timeStyle: "short" })
                      : "—"}
                  </TableCell>
                  <TableCell>{e.rule}</TableCell>
                  <TableCell>
                    <span className="font-mono text-xs">{e.stationCode}</span>{" "}
                    {name(e.station, locale)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {e.peakValue !== null
                      ? format.number(e.peakValue, { maximumFractionDigits: 1 })
                      : (e.level ?? "—")}
                  </TableCell>
                  <TableCell>{e.notifiedAt ? t("events.yes") : "—"}</TableCell>
                  <TableCell className="flex items-center gap-2">
                    <Badge variant={e.status === "active" ? "destructive" : "secondary"}>
                      {t(`events.status.${e.status}`)}
                    </Badge>
                    {e.status === "active" ? (
                      <ResolveEventButton id={e.id} resolve={resolve} label={t("events.resolve")} />
                    ) : null}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
