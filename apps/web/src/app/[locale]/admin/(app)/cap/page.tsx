import { CAP_MSG_TYPES, CAP_STATUSES, type CapMsgType, type CapStatus } from "@meteo/core";
import { getCapSyncState, listCapAlertsAdmin, loadWarnings } from "@meteo/db";
import type { Locale } from "@meteo/i18n";
import { Badge } from "@meteo/ui/components/badge";
import { Button } from "@meteo/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@meteo/ui/components/card";
import { NativeSelect, NativeSelectOption } from "@meteo/ui/components/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@meteo/ui/components/table";
import { BookAIcon, FileCodeIcon } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { SeverityBadge } from "@/components/warnings/severity-badge";
import { Link } from "@/i18n/navigation";
import { getDb } from "@/lib/db";
import { requireAdminSession } from "@/lib/session";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 50;

export default async function CapAlertsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string; type?: string; page?: string }>;
}) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  await requireAdminSession(locale, "alerts.manage");
  const sp = await searchParams;
  const status = (CAP_STATUSES as readonly string[]).includes(sp.status ?? "")
    ? (sp.status as CapStatus)
    : undefined;
  const msgType = (CAP_MSG_TYPES as readonly string[]).includes(sp.type ?? "")
    ? (sp.type as CapMsgType)
    : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const db = getDb();
  const now = new Date();
  const [t, tw, format, state, list, published] = await Promise.all([
    getTranslations("capAdmin"),
    getTranslations("warnings"),
    getFormatter(),
    getCapSyncState(db),
    listCapAlertsAdmin(db, { page, pageSize: PAGE_SIZE, status, msgType }),
    loadWarnings(db, { now, horizonDays: 14 }),
  ]);
  const publishedIds = new Set(published.map((w) => w.id));
  const pages = Math.max(1, Math.ceil(list.total / PAGE_SIZE));
  const syncLabel = state?.status ? t(`sync.${state.status}` as "sync.ok") : t("sync.never");
  const syncVariant =
    state?.status === "ok" || state?.status === "not-modified"
      ? ("default" as const)
      : state?.status === "partial" || state?.status === "disabled"
        ? ("secondary" as const)
        : ("destructive" as const);

  function stateOf(row: (typeof list.rows)[number]) {
    if (publishedIds.has(row.id)) return { label: t("published"), variant: "default" as const };
    if (row.supersededBy !== null) return { label: t("superseded"), variant: "secondary" as const };
    if (row.status !== "Actual" || (row.msgType !== "Alert" && row.msgType !== "Update"))
      return { label: t("notPublished"), variant: "outline" as const };
    if (row.expires && row.expires <= now)
      return { label: t("expired"), variant: "outline" as const };
    return { label: t("notPublished"), variant: "outline" as const };
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button variant="outline" render={<Link href="/admin/cap/events" />} nativeButton={false}>
          <BookAIcon aria-hidden="true" />
          {t("events")}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2 text-base">
            {t("sync.title")}
            <Badge variant={syncVariant}>{syncLabel}</Badge>
          </CardTitle>
          <CardDescription>
            {state?.at ? format.relativeTime(new Date(state.at)) : t("sync.never")}
            {state?.url ? ` · ${t("sync.source")}: ${state.url}` : ""}
            {typeof state?.inserted === "number"
              ? ` · ${t("sync.inserted", { count: state.inserted })}`
              : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {state?.errors && state.errors.length > 0 ? (
            <details className="text-destructive">
              <summary className="cursor-pointer">
                {t("sync.errors")} ({state.errors.length})
              </summary>
              <ul className="mt-1 grid gap-1 font-mono text-xs">
                {state.errors.map((e) => (
                  <li key={`${e.source}:${e.error}`}>
                    {e.source}: {e.error}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          <p className="text-xs text-muted-foreground">{t("sync.runHint")}</p>
        </CardContent>
      </Card>

      <form className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4" method="get">
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor="f-status" className="text-muted-foreground">
            {t("fields.status")}
          </label>
          <NativeSelect id="f-status" name="status" defaultValue={status ?? ""}>
            <NativeSelectOption value="">{t("filters.allStatuses")}</NativeSelectOption>
            {CAP_STATUSES.map((s) => (
              <NativeSelectOption key={s} value={s}>
                {tw(`status.${s}` as "status.Actual")}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor="f-type" className="text-muted-foreground">
            {t("fields.type")}
          </label>
          <NativeSelect id="f-type" name="type" defaultValue={msgType ?? ""}>
            <NativeSelectOption value="">{t("filters.allTypes")}</NativeSelectOption>
            {CAP_MSG_TYPES.map((m) => (
              <NativeSelectOption key={m} value={m}>
                {tw(`msgType.${m}` as "msgType.Alert")}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit" variant="secondary">
          {t("filters.apply")}
        </Button>
        <span className="ml-auto text-sm text-muted-foreground">
          {t("total", { count: list.total })}
        </span>
      </form>

      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("fields.sent")}</TableHead>
              <TableHead>{t("fields.identifier")}</TableHead>
              <TableHead>{t("fields.type")}</TableHead>
              <TableHead>{t("fields.status")}</TableHead>
              <TableHead>{t("fields.severity")}</TableHead>
              <TableHead>{t("fields.event")}</TableHead>
              <TableHead>{t("fields.regions")}</TableHead>
              <TableHead>{t("fields.expires")}</TableHead>
              <TableHead>{t("xml")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                  {t("empty")}
                </TableCell>
              </TableRow>
            ) : (
              list.rows.map((row) => {
                const st = stateOf(row);
                return (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                      {format.dateTime(row.sent, { dateStyle: "short", timeStyle: "short" })}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/admin/cap/${row.id}`}
                        className="font-mono text-xs font-medium hover:underline"
                      >
                        {row.identifier}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        {row.languages.join(", ")}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {tw(`msgType.${row.msgType}` as "msgType.Alert")}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <Badge variant={row.status === "Actual" ? "outline" : "secondary"}>
                          {tw(`status.${row.status}` as "status.Actual")}
                        </Badge>
                        <Badge variant={st.variant}>{st.label}</Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      {row.severity ? (
                        <SeverityBadge
                          severity={row.severity}
                          label={tw(`severity.${row.severity}` as "severity.Severe")}
                        />
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">{row.event ?? "—"}</span>
                      {row.headline ? (
                        <span className="block max-w-72 truncate text-xs text-muted-foreground">
                          {row.headline}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.regionCodes.join(", ") || "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                      {row.expires
                        ? format.dateTime(row.expires, { dateStyle: "short", timeStyle: "short" })
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <a
                        href={`/api/admin/cap/${row.id}/xml`}
                        target="_blank"
                        rel="noopener"
                        className="inline-flex items-center gap-1 text-xs underline-offset-4 hover:underline"
                      >
                        <FileCodeIcon className="size-3.5" aria-hidden="true" />
                        XML
                      </a>
                    </TableCell>
                  </TableRow>
                );
              })
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
                  <Link href={{ pathname: "/admin/cap", query: { ...sp, page: page - 1 } }} />
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
                  <Link href={{ pathname: "/admin/cap", query: { ...sp, page: page + 1 } }} />
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
