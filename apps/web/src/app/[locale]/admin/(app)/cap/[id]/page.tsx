import { asc, eq, inArray } from "@meteo/db";
import { capAlerts, capAreas, capInfos, warningRegions } from "@meteo/db/schema";
import type { Locale } from "@meteo/i18n";
import { Badge } from "@meteo/ui/components/badge";
import { Button } from "@meteo/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@meteo/ui/components/card";
import { ArrowLeftIcon, FileCodeIcon } from "lucide-react";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { SeverityBadge } from "@/components/warnings/severity-badge";
import { Link } from "@/i18n/navigation";
import { getDb } from "@/lib/db";
import { name } from "@/lib/format";
import { requireAdminSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function CapAlertDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id: rawId } = (await params) as { locale: Locale; id: string };
  setRequestLocale(locale);
  await requireAdminSession(locale, "alerts.manage");
  const id = Number(rawId);
  if (!Number.isInteger(id)) notFound();
  const db = getDb();
  const alert = await db.query.capAlerts.findFirst({ where: eq(capAlerts.id, id) });
  if (!alert) notFound();
  const [t, tw, format, infos, supersededBy] = await Promise.all([
    getTranslations("capAdmin"),
    getTranslations("warnings"),
    getFormatter(),
    db.select().from(capInfos).where(eq(capInfos.alertId, id)).orderBy(asc(capInfos.id)),
    alert.supersededBy
      ? db
          .select({
            id: capAlerts.id,
            identifier: capAlerts.identifier,
            msgType: capAlerts.msgType,
          })
          .from(capAlerts)
          .where(eq(capAlerts.id, alert.supersededBy))
          .then((r) => r[0] ?? null)
      : null,
  ]);
  const areas = infos.length
    ? await db
        .select({
          id: capAreas.id,
          infoId: capAreas.infoId,
          areaDesc: capAreas.areaDesc,
          geocodes: capAreas.geocodes,
          hasGeom: capAreas.geom,
          regionCode: warningRegions.code,
          regionName: warningRegions.name,
        })
        .from(capAreas)
        .leftJoin(warningRegions, eq(warningRegions.id, capAreas.warningRegionId))
        .where(
          inArray(
            capAreas.infoId,
            infos.map((i) => i.id),
          ),
        )
        .orderBy(asc(capAreas.id))
    : [];
  const dt = (d: Date | null) =>
    d ? format.dateTime(d, { dateStyle: "medium", timeStyle: "short" }) : "—";

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("detail")}</h1>
          <p className="font-mono text-sm text-muted-foreground">{alert.identifier}</p>
        </div>
        <Badge variant="outline">{tw(`msgType.${alert.msgType}` as "msgType.Alert")}</Badge>
        <Badge variant={alert.status === "Actual" ? "default" : "secondary"}>
          {tw(`status.${alert.status}` as "status.Actual")}
        </Badge>
        <div className="ml-auto flex gap-2">
          <a
            href={`/api/admin/cap/${alert.id}/xml`}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline"
          >
            <FileCodeIcon className="size-4" aria-hidden="true" />
            {t("xml")}
          </a>
          <Button variant="outline" render={<Link href="/admin/cap" />} nativeButton={false}>
            <ArrowLeftIcon aria-hidden="true" />
            {t("back")}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="grid gap-x-6 gap-y-2 pt-6 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">{t("fields.sender")}</dt>
            <dd>{alert.sender}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("fields.sent")}</dt>
            <dd>{dt(alert.sent)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("fields.received")}</dt>
            <dd>{dt(alert.receivedAt)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("fields.scope")}</dt>
            <dd>{alert.scope}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("fields.source")}</dt>
            <dd className="break-all">
              {alert.sourceUrl ? (
                alert.sourceUrl.startsWith("http") ? (
                  <a
                    href={alert.sourceUrl}
                    className="underline-offset-4 hover:underline"
                    rel="noopener"
                  >
                    {alert.sourceUrl}
                  </a>
                ) : (
                  alert.sourceUrl
                )
              ) : (
                (alert.source ?? "—")
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("references")}</dt>
            <dd className="font-mono text-xs break-all">{alert.references ?? "—"}</dd>
          </div>
          {supersededBy ? (
            <div>
              <dt className="text-xs text-muted-foreground">{t("supersededByLink")}</dt>
              <dd>
                <Link
                  href={`/admin/cap/${supersededBy.id}`}
                  className="font-mono text-xs hover:underline"
                >
                  {supersededBy.identifier}
                </Link>{" "}
                <Badge variant="secondary">
                  {supersededBy.msgType === "Cancel" ? t("cancelled") : t("superseded")}
                </Badge>
              </dd>
            </div>
          ) : null}
          {alert.note ? (
            <div className="sm:col-span-2 lg:col-span-3">
              <dt className="text-xs text-muted-foreground">{t("fields.note")}</dt>
              <dd>{alert.note}</dd>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <h2 className="text-lg font-semibold">
        {t("infos")} ({infos.length})
      </h2>
      <div className="grid gap-4 lg:grid-cols-2">
        {infos.map((info) => (
          <Card key={info.id} lang={info.locale ?? undefined}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                <Badge variant="outline">{info.language}</Badge>
                <SeverityBadge
                  severity={info.severity}
                  label={tw(`severity.${info.severity}` as "severity.Severe")}
                />
                <span>{info.event}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              {info.headline ? <p className="font-medium">{info.headline}</p> : null}
              <p className="text-xs text-muted-foreground">
                {tw(`urgency.${info.urgency}` as "urgency.Expected")} ·{" "}
                {tw(`certainty.${info.certainty}` as "certainty.Likely")} ·{" "}
                {info.categories.join(", ")}
              </p>
              <dl className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <dt className="text-muted-foreground">effective</dt>
                  <dd>{dt(info.effective)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">onset</dt>
                  <dd>{dt(info.onset)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">expires</dt>
                  <dd>{dt(info.expires)}</dd>
                </div>
              </dl>
              {info.description ? <p className="whitespace-pre-line">{info.description}</p> : null}
              {info.instruction ? (
                <p className="rounded-lg bg-accent/40 p-2 whitespace-pre-line">
                  {info.instruction}
                </p>
              ) : null}
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase">{t("areas")}</p>
                <ul className="mt-1 grid gap-1">
                  {areas
                    .filter((a) => a.infoId === info.id)
                    .map((a) => (
                      <li key={a.id} className="flex flex-wrap items-center gap-2">
                        <span>{a.areaDesc}</span>
                        {a.regionCode ? (
                          <Badge variant="secondary">
                            {a.regionCode} · {name(a.regionName, locale)}
                          </Badge>
                        ) : null}
                        {a.hasGeom ? <Badge variant="outline">geometry</Badge> : null}
                        {a.geocodes.length ? (
                          <span className="font-mono text-xs text-muted-foreground">
                            {a.geocodes.map((g) => `${g.valueName}=${g.value}`).join(" ")}
                          </span>
                        ) : null}
                      </li>
                    ))}
                </ul>
              </div>
              {info.parameters.length > 0 ? (
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase">
                    {t("parameters")}
                  </p>
                  <ul className="mt-1 font-mono text-xs">
                    {info.parameters.map((p) => (
                      <li key={`${p.valueName}=${p.value}`}>
                        {p.valueName} = {p.value}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>

      <details className="rounded-xl border bg-card">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">{t("rawXml")}</summary>
        <pre className="max-h-[32rem] overflow-auto border-t p-4 text-xs leading-relaxed">
          {alert.rawXml}
        </pre>
      </details>
    </>
  );
}
