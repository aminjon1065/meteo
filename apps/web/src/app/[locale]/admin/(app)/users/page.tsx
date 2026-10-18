import { asc, count, gt, or, sql } from "@meteo/db";
import { sessions, users } from "@meteo/db/schema";
import type { Locale } from "@meteo/i18n";
import { Badge } from "@meteo/ui/components/badge";
import { Button } from "@meteo/ui/components/button";
import { Input } from "@meteo/ui/components/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@meteo/ui/components/table";
import { SearchIcon, ShieldCheckIcon, ShieldOffIcon } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { CreateUserDialog } from "@/components/admin/users/create-user-dialog";
import { UserActions } from "@/components/admin/users/user-actions";
import { getDb } from "@/lib/db";
import { requireAdminSession } from "@/lib/session";
import {
  banUser,
  createUser,
  removeUser,
  resetUserTwoFactor,
  revokeUserSessions,
  setUserPassword,
  setUserRole,
  unbanUser,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function UsersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const session = await requireAdminSession(locale, "users.manage");
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const db = getDb();
  const [t, tr, format, userRows, sessionRows] = await Promise.all([
    getTranslations("usersAdmin"),
    getTranslations("roles"),
    getFormatter(),
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        banned: users.banned,
        banReason: users.banReason,
        banExpires: users.banExpires,
        twoFactorEnabled: users.twoFactorEnabled,
        locale: users.locale,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(
        q
          ? or(sql`${users.email} ILIKE ${`%${q}%`}`, sql`${users.name} ILIKE ${`%${q}%`}`)
          : undefined,
      )
      .orderBy(asc(users.createdAt)),
    // Активные сессии по пользователям (для колонки «Статус»).
    db
      .select({ userId: sessions.userId, n: count() })
      .from(sessions)
      .where(gt(sessions.expiresAt, new Date()))
      .groupBy(sessions.userId),
  ]);
  const sessionsByUser = new Map(sessionRows.map((r) => [r.userId, r.n]));
  const rows = userRows.map((u) => ({ ...u, sessions: sessionsByUser.get(u.id) ?? 0 }));
  const now = Date.now();
  const roleVariant = (role: string) =>
    role === "admin" ? "default" : role === "operator" ? "secondary" : "outline";

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground">{t("subtitle", { count: rows.length })}</p>
        </div>
        <CreateUserDialog action={createUser.bind(null, locale)} defaultLocale={locale} />
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 text-sm">
        <div className="flex min-w-64 flex-col gap-1">
          <label htmlFor="f-q" className="text-muted-foreground">
            {t("filters.search")}
          </label>
          <Input id="f-q" name="q" defaultValue={q} placeholder={t("filters.placeholder")} />
        </div>
        <Button type="submit" variant="secondary">
          <SearchIcon aria-hidden="true" />
          {t("filters.apply")}
        </Button>
      </form>

      <p className="text-sm text-muted-foreground">{t("mandatory2fa")}</p>

      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("name")}</TableHead>
              <TableHead>{t("role")}</TableHead>
              <TableHead>{t("twoFactor")}</TableHead>
              <TableHead>{t("status")}</TableHead>
              <TableHead>{t("createdAt")}</TableHead>
              <TableHead className="text-right">{t("actions")}</TableHead>
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
              rows.map((u) => {
                const isSelf = u.id === session.user.id;
                const banActive =
                  Boolean(u.banned) && (!u.banExpires || u.banExpires.getTime() > now);
                return (
                  <TableRow key={u.id}>
                    <TableCell>
                      <span className="font-medium">
                        {u.name}
                        {isSelf ? (
                          <span className="ml-1 text-xs text-muted-foreground">· {t("you")}</span>
                        ) : null}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {u.email} · {u.locale.toUpperCase()}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={roleVariant(u.role)}>
                        {tr.has(u.role as "admin") ? tr(u.role as "admin") : u.role}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1 text-xs">
                        {u.twoFactorEnabled ? (
                          <>
                            <ShieldCheckIcon
                              className="size-4 text-status-fresh"
                              aria-hidden="true"
                            />
                            {t("twoFactorOn")}
                          </>
                        ) : (
                          <>
                            <ShieldOffIcon
                              className="size-4 text-muted-foreground"
                              aria-hidden="true"
                            />
                            {u.role === "admin" ? (
                              <span className="text-destructive">{t("twoFactorRequired")}</span>
                            ) : (
                              t("twoFactorOff")
                            )}
                          </>
                        )}
                      </span>
                    </TableCell>
                    <TableCell>
                      {banActive ? (
                        <span className="flex flex-col text-xs">
                          <Badge variant="destructive">{t("blocked")}</Badge>
                          {u.banExpires ? (
                            <span className="text-muted-foreground">
                              {t("blockedUntil", {
                                time: format.dateTime(u.banExpires, { dateStyle: "medium" }),
                              })}
                            </span>
                          ) : null}
                          {u.banReason ? (
                            <span className="text-muted-foreground">{u.banReason}</span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="flex flex-col text-xs">
                          <span>{t("active")}</span>
                          <span className="text-muted-foreground">
                            {t("sessions", { count: u.sessions })}
                          </span>
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {format.dateTime(u.createdAt, { dateStyle: "medium" })}
                    </TableCell>
                    <TableCell className="text-right">
                      <UserActions
                        user={{
                          id: u.id,
                          email: u.email,
                          role: u.role,
                          banned: banActive,
                          twoFactorEnabled: Boolean(u.twoFactorEnabled),
                          isSelf,
                        }}
                        actions={{
                          setRole: setUserRole.bind(null, locale, u.id),
                          setPassword: setUserPassword.bind(null, locale, u.id),
                          ban: banUser.bind(null, locale, u.id),
                          unban: unbanUser.bind(null, locale, u.id),
                          revokeSessions: revokeUserSessions.bind(null, locale, u.id),
                          resetTwoFactor: resetUserTwoFactor.bind(null, locale, u.id),
                          remove: removeUser.bind(null, locale, u.id),
                        }}
                      />
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
