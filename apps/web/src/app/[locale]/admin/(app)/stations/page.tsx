import { can } from "@meteo/core";
import { and, asc, count, desc, eq, or, sql } from "@meteo/db";
import { regions, stationPollutants, stations } from "@meteo/db/schema";
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
import { PlusIcon, SearchIcon } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { StationStatusBadge } from "@/components/admin/stations/station-status-badge";
import { Link } from "@/i18n/navigation";
import { getDb } from "@/lib/db";
import { name } from "@/lib/format";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 25;

export default async function StationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; status?: string; region?: string; page?: string }>;
}) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const sp = await searchParams;
  const [t, tc, format, session] = await Promise.all([
    getTranslations("stations"),
    getTranslations("common"),
    getFormatter(),
    getSession(),
  ]);
  const canWrite = can(session?.user.role, "stations.write");
  const db = getDb();

  const q = sp.q?.trim() ?? "";
  const status =
    sp.status && ["active", "suspended", "decommissioned"].includes(sp.status) ? sp.status : "";
  const regionId = sp.region ? Number(sp.region) : 0;
  const page = Math.max(1, Number(sp.page) || 1);

  const conditions = [];
  if (q) {
    const like = `%${q}%`;
    conditions.push(
      or(
        sql`${stations.code} ILIKE ${like}`,
        sql`${stations.slug} ILIKE ${like}`,
        sql`${stations.name}->>'tg' ILIKE ${like}`,
        sql`${stations.name}->>'ru' ILIKE ${like}`,
        sql`${stations.name}->>'en' ILIKE ${like}`,
      ),
    );
  }
  if (status) conditions.push(eq(stations.status, status as "active"));
  if (regionId) conditions.push(eq(stations.regionId, regionId));
  const where = conditions.length ? and(...conditions) : undefined;

  const [rows, totalRow, regionRows] = await Promise.all([
    db
      .select({
        id: stations.id,
        code: stations.code,
        slug: stations.slug,
        name: stations.name,
        kind: stations.kind,
        status: stations.status,
        updatedAt: stations.updatedAt,
        region: regions.name,
        pollutantsCount: sql<number>`(select count(*) from ${stationPollutants} sp where sp.station_id = ${stations.id} and sp.active)`,
      })
      .from(stations)
      .leftJoin(regions, eq(regions.id, stations.regionId))
      .where(where)
      .orderBy(desc(sql`${stations.status} = 'active'`), asc(stations.code))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ n: count() }).from(stations).where(where),
    db.select({ id: regions.id, name: regions.name }).from(regions).orderBy(asc(regions.sortOrder)),
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
        {canWrite ? (
          <Button render={<Link href="/admin/stations/new" />} nativeButton={false}>
            <PlusIcon aria-hidden="true" />
            {t("add")}
          </Button>
        ) : null}
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
            <NativeSelectOption value="active">{t("status.active")}</NativeSelectOption>
            <NativeSelectOption value="suspended">{t("status.suspended")}</NativeSelectOption>
            <NativeSelectOption value="decommissioned">
              {t("status.decommissioned")}
            </NativeSelectOption>
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor="f-region" className="text-muted-foreground">
            {t("fields.region")}
          </label>
          <NativeSelect id="f-region" name="region" defaultValue={regionId ? String(regionId) : ""}>
            <NativeSelectOption value="">{t("filters.allRegions")}</NativeSelectOption>
            {regionRows.map((r) => (
              <NativeSelectOption key={r.id} value={String(r.id)}>
                {name(r.name, locale)}
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
              <TableHead>{t("fields.code")}</TableHead>
              <TableHead>{t("fields.name")}</TableHead>
              <TableHead>{t("fields.region")}</TableHead>
              <TableHead>{t("fields.kind")}</TableHead>
              <TableHead>{t("fields.status")}</TableHead>
              <TableHead className="text-right">{t("fields.pollutants")}</TableHead>
              <TableHead>{t("fields.updatedAt")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  {t("empty")}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-xs">{row.code}</TableCell>
                  <TableCell>
                    <Link
                      href={`/admin/stations/${row.id}`}
                      className="font-medium hover:underline"
                    >
                      {name(row.name, locale) || row.slug}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {name(row.region, locale) || "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{t(`kind.${row.kind}`)}</Badge>
                  </TableCell>
                  <TableCell>
                    <StationStatusBadge status={row.status} label={t(`status.${row.status}`)} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{row.pollutantsCount}</TableCell>
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
                  <Link href={{ pathname: "/admin/stations", query: { ...sp, page: page - 1 } }} />
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
                  <Link href={{ pathname: "/admin/stations", query: { ...sp, page: page + 1 } }} />
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
