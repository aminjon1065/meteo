import { count, desc, eq } from "@meteo/db";
import { subscribers } from "@meteo/db/schema";
import type { Locale } from "@meteo/i18n";
import { Badge } from "@meteo/ui/components/badge";
import { buttonVariants } from "@meteo/ui/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@meteo/ui/components/table";
import { cn } from "@meteo/ui/lib/utils";
import { DownloadIcon } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { getDb } from "@/lib/db";
import { requireAdminSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SubscribersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  await requireAdminSession(locale, "subscribers.manage");
  const sp = await searchParams;
  const db = getDb();
  const status =
    sp.status && ["pending", "confirmed", "unsubscribed"].includes(sp.status)
      ? (sp.status as "pending")
      : undefined;
  const [t, format, rows, totals] = await Promise.all([
    getTranslations("subscribersAdmin"),
    getFormatter(),
    db
      .select()
      .from(subscribers)
      .where(status ? eq(subscribers.status, status) : undefined)
      .orderBy(desc(subscribers.createdAt))
      .limit(500),
    db
      .select({ status: subscribers.status, n: count() })
      .from(subscribers)
      .groupBy(subscribers.status),
  ]);
  const totalBy = Object.fromEntries(totals.map((x) => [x.status, x.n]));
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground">
            {t("confirmed")}: {totalBy.confirmed ?? 0} · {t("pending")}: {totalBy.pending ?? 0} ·{" "}
            {t("unsubscribed")}: {totalBy.unsubscribed ?? 0}
          </p>
        </div>
        <a
          href="/api/admin/subscribers.csv"
          download
          className={cn(buttonVariants({ variant: "outline" }))}
        >
          <DownloadIcon aria-hidden="true" />
          {t("export")}
        </a>
      </div>
      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>E-mail</TableHead>
              <TableHead>{t("locale")}</TableHead>
              <TableHead>{t("status")}</TableHead>
              <TableHead>{t("topics")}</TableHead>
              <TableHead>{t("createdAt")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  {t("empty")}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.email}</TableCell>
                  <TableCell className="uppercase">{s.locale}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        s.status === "confirmed"
                          ? "default"
                          : s.status === "pending"
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {t(s.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {s.topics.all
                      ? t("allStations")
                      : `${t("stationsCount", { count: s.topics.stations?.length ?? 0 })}`}
                    {s.topics.newsletter ? ` · ${t("newsletter")}` : ""}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {format.dateTime(s.createdAt, { dateStyle: "medium" })}
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
