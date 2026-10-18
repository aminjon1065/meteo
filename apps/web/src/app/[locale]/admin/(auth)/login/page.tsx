import type { Locale } from "@meteo/i18n";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@meteo/ui/components/card";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LoginForm } from "@/components/admin/login-form";
import { Logo } from "@/components/site/logo";
import { redirect } from "@/i18n/navigation";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const { next } = await searchParams;
  const session = await getSession();
  if (session) {
    redirect({ href: "/admin", locale });
  }
  const t = await getTranslations("auth");
  const tc = await getTranslations("common");
  const safeNext = next?.startsWith("/") && !next.startsWith("//") ? next : undefined;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <Logo className="size-12" />
          <CardTitle>
            <h1>{t("signInTitle")}</h1>
          </CardTitle>
          <CardDescription>
            {tc("siteName")} · {t("signInSubtitle")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm next={safeNext} />
        </CardContent>
      </Card>
    </main>
  );
}
