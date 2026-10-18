import { can } from "@meteo/core";
import { desc, eq } from "@meteo/db";
import { bulletins, users } from "@meteo/db/schema";
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
import { PlusIcon } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getDb } from "@/lib/db";
import { name } from "@/lib/format";
import { getSession, requireAdminSession } from "@/lib/session";
import { loadBulletinFormData } from "./_data";

export const dynamic = "force-dynamic";

const STATUS_VARIANT = { draft: "secondary", queued: "outline", sent: "default" } as const;

export default async function BulletinsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  await requireAdminSession(locale, "content.read");
  const [t, format, session, rows, formData] = await Promise.all([
    getTranslations("bulletins"),
    getFormatter(),
    getSession(),
    getDb()
      .select({
        id: bulletins.id,
        subject: bulletins.subject,
        status: bulletins.status,
        recipients: bulletins.recipients,
        createdAt: bulletins.createdAt,
        sentAt: bulletins.sentAt,
        author: users.name,
      })
      .from(bulletins)
      .leftJoin(users, eq(users.id, bulletins.createdBy))
      .orderBy(desc(bulletins.createdAt))
      .limit(200),
    loadBulletinFormData(),
  ]);
  const canWrite = can(session?.user.role, "content.write");

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground">
            {t("subtitle")} · {t("subscribersCount", { count: formData.subscribersCount })}
          </p>
        </div>
        {canWrite ? (
          <Button render={<Link href="/admin/bulletins/new" />} nativeButton={false}>
            <PlusIcon aria-hidden="true" />
            {t("add")}
          </Button>
        ) : null}
      </div>
      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("fields.subject")}</TableHead>
              <TableHead>{t("fields.status")}</TableHead>
              <TableHead className="text-right">{t("fields.recipients")}</TableHead>
              <TableHead>{t("fields.createdAt")}</TableHead>
              <TableHead>{t("fields.sentAt")}</TableHead>
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
              rows.map((b) => (
                <TableRow key={b.id}>
                  <TableCell>
                    <Link href={`/admin/bulletins/${b.id}`} className="font-medium hover:underline">
                      {name(b.subject, locale) || `#${b.id}`}
                    </Link>
                    <span className="block text-xs text-muted-foreground">{b.author ?? ""}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[b.status]}>{t(`status.${b.status}`)}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{b.recipients}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {format.dateTime(b.createdAt, { dateStyle: "medium" })}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {b.sentAt
                      ? format.dateTime(b.sentAt, { dateStyle: "medium", timeStyle: "short" })
                      : "—"}
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
