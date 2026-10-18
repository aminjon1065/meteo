import { asc, count, desc, eq } from "@meteo/db";
import { alertEvents, alertRules, pollutants, regions, stations } from "@meteo/db/schema";
import type { Locale } from "@meteo/i18n";
import { Badge } from "@meteo/ui/components/badge";
import { Button } from "@meteo/ui/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@meteo/ui/components/table";
import { BellRingIcon, PlusIcon } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getDb } from "@/lib/db";
import { name } from "@/lib/format";
import { requireAdminSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AlertRulesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  await requireAdminSession(locale, "alerts.manage");
  const db = getDb();
  const [t, rules, active] = await Promise.all([
    getTranslations("alerts"),
    db
      .select({
        id: alertRules.id,
        name: alertRules.name,
        scope: alertRules.scope,
        kind: alertRules.kind,
        threshold: alertRules.threshold,
        averagingMin: alertRules.averagingMin,
        channels: alertRules.channels,
        enabled: alertRules.enabled,
        pollutant: pollutants.shortName,
        unit: pollutants.unit,
        station: stations.name,
        region: regions.name,
      })
      .from(alertRules)
      .leftJoin(pollutants, eq(pollutants.id, alertRules.pollutantId))
      .leftJoin(stations, eq(stations.id, alertRules.stationId))
      .leftJoin(regions, eq(regions.id, alertRules.regionId))
      .orderBy(desc(alertRules.enabled), asc(alertRules.name)),
    db.select({ n: count() }).from(alertEvents).where(eq(alertEvents.status, "active")),
  ]);
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            render={<Link href="/admin/alerts/events" />}
            nativeButton={false}
          >
            <BellRingIcon aria-hidden="true" />
            {t("events.title")} ({active[0]?.n ?? 0})
          </Button>
          <Button render={<Link href="/admin/alerts/new" />} nativeButton={false}>
            <PlusIcon aria-hidden="true" />
            {t("add")}
          </Button>
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("fields.name")}</TableHead>
              <TableHead>{t("fields.condition")}</TableHead>
              <TableHead>{t("fields.scope")}</TableHead>
              <TableHead>{t("fields.channels")}</TableHead>
              <TableHead>{t("fields.status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  {t("empty")}
                </TableCell>
              </TableRow>
            ) : (
              rules.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link href={`/admin/alerts/${r.id}`} className="font-medium hover:underline">
                      {r.name}
                    </Link>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {r.kind === "pollutant"
                      ? `${r.pollutant ?? "?"} ≥ ${r.threshold} ${r.unit ?? ""} · ${t(`averaging.${r.averagingMin}` as "averaging.60")}`
                      : t("conditionIndex", { level: r.threshold })}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.scope === "all"
                      ? t("scope.all")
                      : r.scope === "station"
                        ? name(r.station, locale)
                        : name(r.region, locale)}
                  </TableCell>
                  <TableCell className="flex gap-1">
                    {r.channels.map((c) => (
                      <Badge key={c} variant="outline">
                        {t(`channels.${c}`)}
                      </Badge>
                    ))}
                  </TableCell>
                  <TableCell>
                    <Badge variant={r.enabled ? "default" : "secondary"}>
                      {r.enabled ? t("enabled") : t("disabled")}
                    </Badge>
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
