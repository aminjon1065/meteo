import type { Locale } from "@meteo/i18n";
import { Button } from "@meteo/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@meteo/ui/components/card";
import { headers } from "next/headers";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SignOutButton } from "@/components/admin/sign-out-button";
import { TwoFactorSetup } from "@/components/admin/two-factor-setup";
import { Logo } from "@/components/site/logo";
import { Link, redirect } from "@/i18n/navigation";
import { getAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Настройка TOTP‑2FA: QR‑код, ключ, резервные коды, проверка кода. Для роли admin — обязательный
 * шаг (admin layout перенаправляет сюда, пока 2FA не включена), для остальных — по желанию.
 */
export default async function TwoFactorPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ required?: string }>;
}) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const sp = await searchParams;
  // Без кэша cookie: сразу после включения 2FA статус должен быть актуальным.
  const session = await getAuth().api.getSession({
    headers: await headers(),
    query: { disableCookieCache: true },
  });
  if (!session) {
    redirect({ href: "/admin/login?next=/admin/two-factor", locale });
  }
  const user = (session as NonNullable<typeof session>).user;
  const isAdmin = user.role === "admin";
  const enabled = Boolean(user.twoFactorEnabled);
  const required = isAdmin && !enabled && sp.required === "1";
  const [t, tc] = await Promise.all([getTranslations("twoFactor"), getTranslations("common")]);

  return (
    <main className="flex min-h-dvh items-start justify-center bg-muted/40 p-4 py-10">
      <Card className="w-full max-w-xl">
        <CardHeader className="items-center text-center">
          <Logo className="size-12" />
          <CardTitle>
            <h1>{t("title")}</h1>
          </CardTitle>
          <CardDescription>
            {tc("siteName")} · {user.email}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {required ? (
            <p className="rounded-lg border border-status-stale/60 bg-status-stale/10 p-3 text-sm">
              {t("required")}
            </p>
          ) : null}
          <TwoFactorSetup enabled={enabled} mandatory={isAdmin} />
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4 text-sm">
            {enabled || !isAdmin ? (
              <Button variant="outline" render={<Link href="/admin" />} nativeButton={false}>
                {t("goToAdmin")}
              </Button>
            ) : (
              <span className="text-muted-foreground">{t("mandatoryHint")}</span>
            )}
            <SignOutButton variant="ghost" />
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
