import { and, asc, count, desc, eq, gte, lte } from "@meteo/db";
import { measurements, pollutants, stations } from "@meteo/db/schema";
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
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getDb } from "@/lib/db";
import { name } from "@/lib/format";
import { requireAdminSession } from "@/lib/session";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 50;
const qcVariant: Record<number, "default" | "secondary" | "destructive" | "outline"> = {
  0: "secondary",
  1: "default",
  2: "outline",
  3: "destructive",
  4: "default",
  5: "secondary",
};

export default async function BrowsePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    station?: string;
    pollutant?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  await requireAdminSession(locale, "measurements.read");
  const sp = await searchParams;
  const db = getDb();
  const [t, format, stationRows, pollutantRows] = await Promise.all([
    getTranslations("measurements"),
    getFormatter(),
    db
      .select({ id: stations.id, code: stations.code, name: stations.name })
      .from(stations)
      .orderBy(asc(stations.code)),
    db
      .select({ id: pollutants.id, shortName: pollutants.shortName })
      .from(pollutants)
      .orderBy(asc(pollutants.sortOrder)),
  ]);
  const stationId = Number(sp.station) || 0;
  const pollutantId = Number(sp.pollutant) || 0;
  const page = Math.max(1, Number(sp.page) || 1);
  const conditions = [];
  if (stationId) conditions.push(eq(measurements.stationId, stationId));
  if (pollutantId) conditions.push(eq(measurements.pollutantId, pollutantId));
  if (sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from))
    conditions.push(gte(measurements.time, new Date(`${sp.from}T00:00:00+05:00`)));
  if (sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to))
    conditions.push(lte(measurements.time, new Date(`${sp.to}T23:59:59+05:00`)));
  const where = conditions.length ? and(...conditions) : undefined;

  const [rows, totalRow] = await Promise.all([
    db
      .select({
        time: measurements.time,
        stationCode: stations.code,
        stationName: stations.name,
        pollutant: pollutants.shortName,
        unit: pollutants.unit,
        decimals: pollutants.decimals,
        value: measurements.value,
        qcFlag: measurements.qcFlag,
        qcReason: measurements.qcReason,
        source: measurements.source,
        averagingMin: measurements.averagingMin,
      })
      .from(measurements)
      .innerJoin(stations, eq(stations.id, measurements.stationId))
      .innerJoin(pollutants, eq(pollutants.id, measurements.pollutantId))
      .where(where)
      .orderBy(desc(measurements.time), asc(stations.code), asc(pollutants.sortOrder))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ n: count() }).from(measurements).where(where),
  ]);
  const total = totalRow[0]?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("cards.browse.title")}</h1>
        <p className="text-muted-foreground">{t("browse.total", { count: total })}</p>
      </div>
      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4 text-sm"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="f-station" className="text-muted-foreground">
            {t("entry.station")}
          </label>
          <NativeSelect
            id="f-station"
            name="station"
            defaultValue={stationId ? String(stationId) : ""}
          >
            <NativeSelectOption value="">—</NativeSelectOption>
            {stationRows.map((s) => (
              <NativeSelectOption key={s.id} value={String(s.id)}>
                {s.code} · {name(s.name, locale)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-pollutant" className="text-muted-foreground">
            {t("browse.pollutant")}
          </label>
          <NativeSelect
            id="f-pollutant"
            name="pollutant"
            defaultValue={pollutantId ? String(pollutantId) : ""}
          >
            <NativeSelectOption value="">—</NativeSelectOption>
            {pollutantRows.map((p) => (
              <NativeSelectOption key={p.id} value={String(p.id)}>
                {p.shortName}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-from" className="text-muted-foreground">
            {t("browse.from")}
          </label>
          <Input id="f-from" type="date" name="from" defaultValue={sp.from ?? ""} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-to" className="text-muted-foreground">
            {t("browse.to")}
          </label>
          <Input id="f-to" type="date" name="to" defaultValue={sp.to ?? ""} />
        </div>
        <Button type="submit" variant="secondary">
          {t("browse.apply")}
        </Button>
      </form>
      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("browse.time")}</TableHead>
              <TableHead>{t("entry.station")}</TableHead>
              <TableHead>{t("browse.pollutant")}</TableHead>
              <TableHead className="text-right">{t("browse.value")}</TableHead>
              <TableHead>{t("browse.averaging")}</TableHead>
              <TableHead>{t("browse.qc")}</TableHead>
              <TableHead>{t("browse.source")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  {t("browse.empty")}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow
                  key={`${r.time.toISOString()}-${r.stationCode}-${r.pollutant}-${r.averagingMin}`}
                >
                  <TableCell className="tabular-nums">
                    {format.dateTime(r.time, { dateStyle: "short", timeStyle: "short" })}
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-xs">{r.stationCode}</span>{" "}
                    <span className="text-muted-foreground">{name(r.stationName, locale)}</span>
                  </TableCell>
                  <TableCell>{r.pollutant}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.value !== null
                      ? format.number(r.value, { maximumFractionDigits: r.decimals })
                      : "—"}{" "}
                    <span className="text-muted-foreground">{r.unit}</span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.averagingMin} {t("browse.min")}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={qcVariant[r.qcFlag] ?? "secondary"}
                      title={r.qcReason ?? undefined}
                    >
                      {t(`qc.${r.qcFlag}` as "qc.0")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {t(`source.${r.source}` as "source.1")}
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
                  <Link
                    href={{
                      pathname: "/admin/measurements/browse",
                      query: { ...sp, page: page - 1 },
                    }}
                  />
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
                  <Link
                    href={{
                      pathname: "/admin/measurements/browse",
                      query: { ...sp, page: page + 1 },
                    }}
                  />
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
