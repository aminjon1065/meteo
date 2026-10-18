import type { Locale } from "@meteo/i18n";
import { Button } from "@meteo/ui/components/button";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SignOutButton } from "@/components/admin/sign-out-button";
import { Link } from "@/i18n/navigation";

// CSP с nonce требует динамического рендера (docs/security-checklist.md).
export const dynamic = "force-dynamic";

export default async function ForbiddenPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const t = await getTranslations("auth");
  const tn = await getTranslations("notFound");
  return (
    <main className="container-page flex min-h-dvh flex-col items-center justify-center gap-4 text-center">
      <p className="font-mono text-6xl font-semibold text-muted-foreground">403</p>
      <h1 className="text-2xl font-semibold">{t("forbidden")}</h1>
      <p className="max-w-md text-muted-foreground">{t("forbiddenHint")}</p>
      <div className="flex gap-2">
        <Button variant="outline" render={<Link href="/" />} nativeButton={false}>
          {tn("backHome")}
        </Button>
        <SignOutButton />
      </div>
    </main>
  );
}
