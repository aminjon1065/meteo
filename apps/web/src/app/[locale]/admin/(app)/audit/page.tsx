import { and, count, desc, eq, gte, lte, sql } from "@meteo/db";
import { auditLog } from "@meteo/db/schema";
import type { Locale } from "@meteo/i18n";
import { Button } from "@meteo/ui/components/button";
import { Input } from "@meteo/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@meteo/ui/components/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@meteo/ui/components/table";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { AuditDetails } from "@/components/admin/audit/audit-details";
import { Link } from "@/i18n/navigation";
import { getDb } from "@/lib/db";
import { requireAdminSession } from "@/lib/session";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 50;

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; entity?: string; from?: string; to?: string; page?: string }>;
}) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  await requireAdminSession(locale, "audit.read");
  const sp = await searchParams;
  const db = getDb();
  const [t, tc, format, entities] = await Promise.all([
    getTranslations("audit"),
    getTranslations("common"),
    getFormatter(),
    db.selectDistinct({ entity: auditLog.entity }).from(auditLog).orderBy(auditLog.entity),
  ]);
  const page = Math.max(1, Number(sp.page) || 1);
  const conditions = [];
  if (sp.q?.trim()) {
    const like = `%${sp.q.trim()}%`;
    conditions.push(
      sql`(${auditLog.action} ILIKE ${like} OR ${auditLog.actorEmail} ILIKE ${like} OR ${auditLog.entityId} ILIKE ${like})`,
    );
  }
  if (sp.entity) conditions.push(eq(auditLog.entity, sp.entity));
  if (sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from))
    conditions.push(gte(auditLog.at, new Date(`${sp.from}T00:00:00+05:00`)));
  if (sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to))
    conditions.push(lte(auditLog.at, new Date(`${sp.to}T23:59:59+05:00`)));
  const where = conditions.length ? and(...conditions) : undefined;
  const [rows, totalRow] = await Promise.all([
    db
      .select()
      .from(auditLog)
      .where(where)
      .orderBy(desc(auditLog.id))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ n: count() }).from(auditLog).where(where),
  ]);
  const total = totalRow[0]?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle", { count: total })}</p>
      </div>
      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4 text-sm"
      >
        <div className="flex min-w-56 flex-1 flex-col gap-1">
          <label htmlFor="f-q" className="text-muted-foreground">
            {t("search")}
          </label>
          <Input id="f-q" name="q" defaultValue={sp.q ?? ""} placeholder={t("searchPlaceholder")} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-entity" className="text-muted-foreground">
            {t("entity")}
          </label>
          <NativeSelect id="f-entity" name="entity" defaultValue={sp.entity ?? ""}>
            <NativeSelectOption value="">—</NativeSelectOption>
            {entities.map((e) => (
              <NativeSelectOption key={e.entity} value={e.entity}>
                {e.entity}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-from" className="text-muted-foreground">
            {t("from")}
          </label>
          <Input id="f-from" type="date" name="from" defaultValue={sp.from ?? ""} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-to" className="text-muted-foreground">
            {t("to")}
          </label>
          <Input id="f-to" type="date" name="to" defaultValue={sp.to ?? ""} />
        </div>
        <Button type="submit" variant="secondary">
          {t("apply")}
        </Button>
      </form>
      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("at")}</TableHead>
              <TableHead>{t("actor")}</TableHead>
              <TableHead>{t("action")}</TableHead>
              <TableHead>{t("entity")}</TableHead>
              <TableHead>IP</TableHead>
              <TableHead className="text-right">{t("details")}</TableHead>
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
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {format.dateTime(r.at, { dateStyle: "short", timeStyle: "medium" })}
                  </TableCell>
                  <TableCell>
                    <span>{r.actorEmail ?? "—"}</span>
                    {r.actorRole ? (
                      <span className="block text-xs text-muted-foreground">{r.actorRole}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.action}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {r.entity}
                    {r.entityId ? (
                      <span className="text-muted-foreground"> #{r.entityId}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {r.ip ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <AuditDetails
                      before={r.before}
                      after={r.after}
                      userAgent={r.userAgent}
                      label={t("details")}
                      beforeLabel={t("before")}
                      afterLabel={t("after")}
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {pages > 1 ? (
        <nav
          className="flex items-center justify-between text-sm text-muted-foreground"
          aria-label={tc("pagination")}
        >
          <span>
            {page} / {pages}
          </span>
          <div className="flex gap-2">
            {page > 1 ? (
              <Button
                variant="outline"
                size="sm"
                render={
                  <Link href={{ pathname: "/admin/audit", query: { ...sp, page: page - 1 } }} />
                }
                nativeButton={false}
              >
                ←
              </Button>
            ) : null}
            {page < pages ? (
              <Button
                variant="outline"
                size="sm"
                render={
                  <Link href={{ pathname: "/admin/audit", query: { ...sp, page: page + 1 } }} />
                }
                nativeButton={false}
              >
                →
              </Button>
            ) : null}
          </div>
        </nav>
      ) : null}
    </>
  );
}
