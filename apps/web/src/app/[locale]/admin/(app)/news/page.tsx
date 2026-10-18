import { can } from "@meteo/core";
import { and, asc, count, desc, eq, or, sql } from "@meteo/db";
import { newsCategories, newsPosts, users } from "@meteo/db/schema";
import type { Locale } from "@meteo/i18n";
import { Badge } from "@meteo/ui/components/badge";
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
import { FolderTreeIcon, PlusIcon, SearchIcon } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getDb } from "@/lib/db";
import { name } from "@/lib/format";
import { getSession, requireAdminSession } from "@/lib/session";
import { newsStatuses } from "@/lib/validation/news";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 25;

const STATUS_VARIANT = {
  draft: "secondary",
  published: "default",
  archived: "outline",
} as const;

export default async function NewsAdminPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  await requireAdminSession(locale, "content.read");
  const sp = await searchParams;
  const [t, tc, format, session] = await Promise.all([
    getTranslations("newsAdmin"),
    getTranslations("common"),
    getFormatter(),
    getSession(),
  ]);
  const canWrite = can(session?.user.role, "content.write");
  const db = getDb();
  const q = sp.q?.trim() ?? "";
  const status = (newsStatuses as readonly string[]).includes(sp.status ?? "")
    ? (sp.status as "draft")
    : "";
  const page = Math.max(1, Number(sp.page) || 1);
  const conditions = [];
  if (q) {
    const like = `%${q}%`;
    conditions.push(
      or(
        sql`${newsPosts.slug} ILIKE ${like}`,
        sql`${newsPosts.title}->>'tg' ILIKE ${like}`,
        sql`${newsPosts.title}->>'ru' ILIKE ${like}`,
        sql`${newsPosts.title}->>'en' ILIKE ${like}`,
      ),
    );
  }
  if (status) conditions.push(eq(newsPosts.status, status));
  const where = conditions.length ? and(...conditions) : undefined;
  const [rows, totalRow] = await Promise.all([
    db
      .select({
        id: newsPosts.id,
        slug: newsPosts.slug,
        title: newsPosts.title,
        status: newsPosts.status,
        pinned: newsPosts.pinned,
        publishedAt: newsPosts.publishedAt,
        updatedAt: newsPosts.updatedAt,
        category: newsCategories.name,
        author: users.name,
      })
      .from(newsPosts)
      .leftJoin(newsCategories, eq(newsCategories.id, newsPosts.categoryId))
      .leftJoin(users, eq(users.id, newsPosts.authorId))
      .where(where)
      .orderBy(desc(newsPosts.updatedAt), asc(newsPosts.id))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ n: count() }).from(newsPosts).where(where),
  ]);
  const total = totalRow[0]?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground">{t("subtitle", { count: total })}</p>
        </div>
        <div className="flex gap-2">
          {canWrite ? (
            <Button
              variant="outline"
              render={<Link href="/admin/news/categories" />}
              nativeButton={false}
            >
              <FolderTreeIcon aria-hidden="true" />
              {t("categories.title")}
            </Button>
          ) : null}
          {canWrite ? (
            <Button render={<Link href="/admin/news/new" />} nativeButton={false}>
              <PlusIcon aria-hidden="true" />
              {t("add")}
            </Button>
          ) : null}
        </div>
      </div>

      <form className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4" method="get">
        <div className="flex min-w-56 flex-1 flex-col gap-1 text-sm">
          <label htmlFor="f-q" className="text-muted-foreground">
            {tc("actions.search")}
          </label>
          <div className="relative">
            <SearchIcon
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="f-q"
              name="q"
              defaultValue={q}
              className="pl-8"
              placeholder={t("searchPlaceholder")}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor="f-status" className="text-muted-foreground">
            {t("fields.status")}
          </label>
          <NativeSelect id="f-status" name="status" defaultValue={status}>
            <NativeSelectOption value="">{t("filters.allStatuses")}</NativeSelectOption>
            {newsStatuses.map((s) => (
              <NativeSelectOption key={s} value={s}>
                {t(`status.${s}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit" variant="secondary">
          {t("filters.apply")}
        </Button>
      </form>

      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("fields.title")}</TableHead>
              <TableHead>{t("fields.category")}</TableHead>
              <TableHead>{t("fields.status")}</TableHead>
              <TableHead>{t("fields.publishedAt")}</TableHead>
              <TableHead>{t("fields.author")}</TableHead>
              <TableHead>{t("fields.updatedAt")}</TableHead>
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
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Link href={`/admin/news/${row.id}`} className="font-medium hover:underline">
                      {name(row.title, locale) || row.slug}
                    </Link>
                    <span className="block font-mono text-xs text-muted-foreground">
                      {row.slug}
                      {row.pinned ? " · 📌" : ""}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {name(row.category, locale) || "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[row.status]}>{t(`status.${row.status}`)}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {row.publishedAt
                      ? format.dateTime(row.publishedAt, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })
                      : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{row.author ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {format.dateTime(row.updatedAt, { dateStyle: "medium" })}
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
          aria-label="pagination"
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
                  <Link href={{ pathname: "/admin/news", query: { ...sp, page: page - 1 } }} />
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
                  <Link href={{ pathname: "/admin/news", query: { ...sp, page: page + 1 } }} />
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
