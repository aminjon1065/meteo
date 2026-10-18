import { can } from "@meteo/core";
import { and, count, desc, eq, gte, inArray } from "@meteo/db";
import { importBatches, measurements } from "@meteo/db/schema";
import type { Locale } from "@meteo/i18n";
import { Badge } from "@meteo/ui/components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@meteo/ui/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@meteo/ui/components/table";
import { FileUpIcon, KeyboardIcon, ShieldCheckIcon, TableIcon } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getDb } from "@/lib/db";
import { requireAdminSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function MeasurementsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const session = await requireAdminSession(locale, "measurements.read");
  const canWrite = can(session.user.role, "measurements.write");
  const db = getDb();
  const [t, format, last7, batches, qcPending] = await Promise.all([
    getTranslations("measurements"),
    getFormatter(),
    db
      .select({ n: count() })
      .from(measurements)
      .where(gte(measurements.time, new Date(Date.now() - 7 * 86_400_000))),
    db.select().from(importBatches).orderBy(desc(importBatches.createdAt)).limit(10),
    db
      .select({ n: count() })
      .from(measurements)
      .where(and(inArray(measurements.qcFlag, [2, 3]), eq(measurements.qcLocked, false))),
  ]);
  const cards = [
    {
      href: "/admin/measurements/entry",
      icon: KeyboardIcon,
      title: t("cards.entry.title"),
      text: t("cards.entry.text"),
      write: true,
    },
    {
      href: "/admin/measurements/import",
      icon: FileUpIcon,
      title: t("cards.import.title"),
      text: t("cards.import.text"),
      write: true,
    },
    {
      href: "/admin/measurements/qc",
      icon: ShieldCheckIcon,
      title: t("cards.qc.title"),
      text: t("cards.qc.text", { count: qcPending[0]?.n ?? 0 }),
      write: true,
    },
    {
      href: "/admin/measurements/browse",
      icon: TableIcon,
      title: t("cards.browse.title"),
      text: t("cards.browse.text"),
      write: false,
    },
  ].filter((c) => !c.write || canWrite);

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">
          {t("subtitle")} · {t("last7d", { count: last7[0]?.n ?? 0 })}
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map(({ href, icon: Icon, title, text }) => (
          <Link key={href} href={href} className="group">
            <Card className="h-full transition-colors group-hover:bg-accent/40">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Icon className="size-4 text-brand" aria-hidden="true" />
                  {title}
                </CardTitle>
                <CardDescription>{text}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("recentBatches")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("import.file")}</TableHead>
                <TableHead className="text-right">{t("import.summary.total")}</TableHead>
                <TableHead className="text-right">{t("import.summary.ok")}</TableHead>
                <TableHead className="text-right">{t("import.summary.rejected")}</TableHead>
                <TableHead>{t("batchStatus.label")}</TableHead>
                <TableHead>{t("createdAt")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    {t("noBatches")}
                  </TableCell>
                </TableRow>
              ) : (
                batches.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">{b.fileName}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.rowsTotal}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.rowsOk}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.rowsRejected}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          b.status === "applied"
                            ? "default"
                            : b.status === "rejected"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {t(`batchStatus.${b.status}`)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {format.dateTime(b.createdAt, { dateStyle: "medium", timeStyle: "short" })}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
