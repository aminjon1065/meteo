import { can, localDateOf, shiftIsoDate } from "@meteo/core";
import { listEcoBulletins } from "@meteo/db";
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
import { SettingsIcon } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { GenerateForm } from "@/components/admin/eco-bulletins/generate-form";
import { ecoDateValue } from "@/components/eco-bulletins/date";
import { Link } from "@/i18n/navigation";
import { getDb } from "@/lib/db";
import { name } from "@/lib/format";
import { requireAdminSession } from "@/lib/session";
import { loadStationOptions } from "./_data";
import { generateEcoBulletin } from "./actions";

export const dynamic = "force-dynamic";

const STATUS_VARIANT = { draft: "secondary", published: "default" } as const;

export default async function EcoBulletinsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const session = await requireAdminSession(locale, "ecoBulletin.read");
  const [t, format, rows, stations] = await Promise.all([
    getTranslations("ecoBulletin"),
    getFormatter(),
    listEcoBulletins(getDb(), { limit: 200 }),
    loadStationOptions(),
  ]);
  const canWrite = can(session.user.role, "ecoBulletin.write");
  const today = localDateOf(new Date());

  async function generate(raw: unknown) {
    "use server";
    return generateEcoBulletin(locale, raw);
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
        {canWrite ? (
          <Button
            variant="outline"
            render={<Link href="/admin/eco-bulletins/settings" />}
            nativeButton={false}
          >
            <SettingsIcon aria-hidden="true" />
            {t("settings.link")}
          </Button>
        ) : null}
      </div>
      {canWrite ? (
        <GenerateForm
          stations={stations}
          defaultDate={shiftIsoDate(today, -1)}
          maxDate={today}
          action={generate}
        />
      ) : null}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("journal")}</h2>
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("fields.date")}</TableHead>
                <TableHead>{t("fields.station")}</TableHead>
                <TableHead>{t("fields.status")}</TableHead>
                <TableHead>{t("fields.generatedBy")}</TableHead>
                <TableHead>{t("fields.createdAt")}</TableHead>
                <TableHead>{t("fields.publishedAt")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    {t("empty")}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>
                      <Link
                        href={`/admin/eco-bulletins/${b.id}`}
                        className="font-medium hover:underline"
                      >
                        {format.dateTime(ecoDateValue(b.date), { dateStyle: "long" })}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        {name(b.data.city.name, locale)}
                      </span>
                    </TableCell>
                    <TableCell>
                      {b.stationCode}
                      <span className="block text-xs text-muted-foreground">
                        {name(b.stationName, locale)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[b.status]}>{t(`status.${b.status}`)}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {b.generatedBy === "scheduler"
                        ? t("generatedBy.scheduler")
                        : t("generatedBy.manual")}
                      {b.authorName ? ` · ${b.authorName}` : ""}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {format.dateTime(b.createdAt, { dateStyle: "medium", timeStyle: "short" })}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {b.publishedAt
                        ? format.dateTime(b.publishedAt, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>
    </>
  );
}
