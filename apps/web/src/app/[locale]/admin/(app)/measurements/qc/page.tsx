import { and, asc, count, desc, eq, inArray, sql } from "@meteo/db";
import { measurements, pollutants, stations } from "@meteo/db/schema";
import type { Locale } from "@meteo/i18n";
import { Badge } from "@meteo/ui/components/badge";
import { Button } from "@meteo/ui/components/button";
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
import { QcRowActions } from "@/components/admin/qc/qc-row-actions";
import { Link } from "@/i18n/navigation";
import { getDb } from "@/lib/db";
import { name } from "@/lib/format";
import { requireAdminSession } from "@/lib/session";
import { resolveMeasurement } from "./actions";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 50;

export default async function QcQueuePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ station?: string; flag?: string; page?: string; locked?: string }>;
}) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  await requireAdminSession(locale, "measurements.qc");
  const sp = await searchParams;
  const db = getDb();
  const [t, tm, format, stationRows] = await Promise.all([
    getTranslations("qc"),
    getTranslations("measurements"),
    getFormatter(),
    db
      .select({ id: stations.id, code: stations.code, name: stations.name })
      .from(stations)
      .orderBy(asc(stations.code)),
  ]);
  const stationId = Number(sp.station) || 0;
  const flag = sp.flag === "3" ? 3 : sp.flag === "2" ? 2 : 0;
  const showLocked = sp.locked === "1";
  const page = Math.max(1, Number(sp.page) || 1);
  const conditions = [
    showLocked ? eq(measurements.qcLocked, true) : eq(measurements.qcLocked, false),
  ];
  conditions.push(flag ? eq(measurements.qcFlag, flag) : inArray(measurements.qcFlag, [2, 3]));
  if (stationId) conditions.push(eq(measurements.stationId, stationId));
  const where = and(...conditions);

  const prevValue = sql<
    number | null
  >`(select m2.value from measurements m2 where m2.station_id = ${measurements.stationId} and m2.pollutant_id = ${measurements.pollutantId} and m2.time < ${measurements.time} and m2.qc_flag in (1,4) order by m2.time desc limit 1)`;
  const nextValue = sql<
    number | null
  >`(select m2.value from measurements m2 where m2.station_id = ${measurements.stationId} and m2.pollutant_id = ${measurements.pollutantId} and m2.time > ${measurements.time} and m2.qc_flag in (1,4) order by m2.time asc limit 1)`;
  const [rows, totalRow] = await Promise.all([
    db
      .select({
        time: measurements.time,
        stationId: measurements.stationId,
        pollutantId: measurements.pollutantId,
        averagingMin: measurements.averagingMin,
        value: measurements.value,
        originalValue: measurements.originalValue,
        qcFlag: measurements.qcFlag,
        qcReason: measurements.qcReason,
        stationCode: stations.code,
        stationName: stations.name,
        pollutant: pollutants.shortName,
        unit: pollutants.unit,
        decimals: pollutants.decimals,
        prevValue,
        nextValue,
      })
      .from(measurements)
      .innerJoin(stations, eq(stations.id, measurements.stationId))
      .innerJoin(pollutants, eq(pollutants.id, measurements.pollutantId))
      .where(where)
      .orderBy(desc(measurements.time))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ n: count() }).from(measurements).where(where),
  ]);
  const total = totalRow[0]?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const reasonLabel = (reason: string | null) => {
    if (!reason) return "—";
    const [code, detail] = reason.split(":", 2);
    const key = `reasons.${code}`;
    return t.has(key as "reasons.range")
      ? `${t(key as "reasons.range")}${detail ? ` (${detail})` : ""}`
      : reason;
  };

  async function resolve(key: unknown, decision: unknown) {
    "use server";
    return resolveMeasurement(locale, key, decision);
  }

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
        <div className="flex flex-col gap-1">
          <label htmlFor="f-station" className="text-muted-foreground">
            {tm("entry.station")}
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
          <label htmlFor="f-flag" className="text-muted-foreground">
            {tm("browse.qc")}
          </label>
          <NativeSelect id="f-flag" name="flag" defaultValue={flag ? String(flag) : ""}>
            <NativeSelectOption value="">{t("filters.suspectAndInvalid")}</NativeSelectOption>
            <NativeSelectOption value="2">{tm("qc.2")}</NativeSelectOption>
            <NativeSelectOption value="3">{tm("qc.3")}</NativeSelectOption>
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-locked" className="text-muted-foreground">
            {t("filters.resolved")}
          </label>
          <NativeSelect id="f-locked" name="locked" defaultValue={showLocked ? "1" : "0"}>
            <NativeSelectOption value="0">{t("filters.pending")}</NativeSelectOption>
            <NativeSelectOption value="1">{t("filters.resolvedOnly")}</NativeSelectOption>
          </NativeSelect>
        </div>
        <Button type="submit" variant="secondary">
          {tm("browse.apply")}
        </Button>
      </form>
      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tm("browse.time")}</TableHead>
              <TableHead>{tm("entry.station")}</TableHead>
              <TableHead>{tm("browse.pollutant")}</TableHead>
              <TableHead className="text-right">{tm("browse.value")}</TableHead>
              <TableHead className="text-right">{t("context")}</TableHead>
              <TableHead>{tm("browse.qc")}</TableHead>
              <TableHead>{t("reason")}</TableHead>
              {!showLocked ? <TableHead className="text-right">{t("actions")}</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                  {t("empty")}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow
                  key={`${r.time.toISOString()}-${r.stationId}-${r.pollutantId}-${r.averagingMin}`}
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
                    <span className="font-semibold">
                      {r.value !== null
                        ? format.number(r.value, { maximumFractionDigits: r.decimals })
                        : "—"}
                    </span>{" "}
                    <span className="text-muted-foreground">{r.unit}</span>
                    {r.originalValue !== null && r.originalValue !== r.value ? (
                      <span className="block text-xs text-muted-foreground line-through">
                        {format.number(r.originalValue, { maximumFractionDigits: r.decimals })}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {r.prevValue !== null
                      ? format.number(r.prevValue, { maximumFractionDigits: r.decimals })
                      : "—"}{" "}
                    →{" "}
                    {r.nextValue !== null
                      ? format.number(r.nextValue, { maximumFractionDigits: r.decimals })
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        r.qcFlag === 3 ? "destructive" : r.qcFlag === 2 ? "outline" : "default"
                      }
                    >
                      {tm(`qc.${r.qcFlag}` as "qc.0")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {reasonLabel(r.qcReason)}
                  </TableCell>
                  {!showLocked ? (
                    <TableCell className="text-right">
                      <QcRowActions
                        rowKey={{
                          time: r.time.toISOString(),
                          stationId: r.stationId,
                          pollutantId: r.pollutantId,
                          averagingMin: r.averagingMin,
                        }}
                        value={r.value}
                        unit={r.unit}
                        resolve={resolve}
                      />
                    </TableCell>
                  ) : null}
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
                    href={{ pathname: "/admin/measurements/qc", query: { ...sp, page: page - 1 } }}
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
                    href={{ pathname: "/admin/measurements/qc", query: { ...sp, page: page + 1 } }}
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
