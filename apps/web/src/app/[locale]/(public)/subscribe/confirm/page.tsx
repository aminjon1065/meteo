import { eq } from "@meteo/db";
import { subscribers } from "@meteo/db/schema";
import type { Locale } from "@meteo/i18n";
import { Button } from "@meteo/ui/components/button";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ConfirmPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const { token } = await searchParams;
  const t = await getTranslations("subscribe");
  let state: "confirmed" | "already" | "invalid" = "invalid";
  if (token && /^[a-f0-9]{40}$/.test(token)) {
    const db = getDb();
    const sub = await db.query.subscribers.findFirst({
      where: eq(subscribers.confirmToken, token),
    });
    if (sub) {
      if (sub.status === "confirmed") state = "already";
      else {
        await db
          .update(subscribers)
          .set({ status: "confirmed", confirmedAt: new Date() })
          .where(eq(subscribers.id, sub.id));
        state = "confirmed";
      }
    }
  }
  return (
    <div className="container-page flex max-w-xl flex-col items-center gap-4 py-20 text-center">
      <h1 className="text-2xl font-semibold">{t(`confirm.${state}.title`)}</h1>
      <p className="text-muted-foreground">{t(`confirm.${state}.text`)}</p>
      <Button render={<Link href="/" />} nativeButton={false}>
        {t("backHome")}
      </Button>
    </div>
  );
}
