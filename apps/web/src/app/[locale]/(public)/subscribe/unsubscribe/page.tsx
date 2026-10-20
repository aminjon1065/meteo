import { eq } from "@meteo/db";
import { subscribers } from "@meteo/db/schema";
import type { Locale } from "@meteo/i18n";
import { Button } from "@meteo/ui/components/button";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function UnsubscribePage({
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
  let state: "done" | "invalid" = "invalid";
  if (token && /^[a-f0-9]{40}$/.test(token)) {
    const db = getDb();
    const sub = await db.query.subscribers.findFirst({
      where: eq(subscribers.unsubscribeToken, token),
    });
    if (sub) {
      const { pending: _pending, ...topics } = sub.topics;
      await db
        .update(subscribers)
        .set({ status: "unsubscribed", unsubscribedAt: new Date(), topics })
        .where(eq(subscribers.id, sub.id));
      state = "done";
    }
  }
  return (
    <div className="container-page flex max-w-xl flex-col items-center gap-4 py-20 text-center">
      <h1 className="text-h1">{t(`unsubscribe.${state}.title`)}</h1>
      <p className="text-muted-foreground">{t(`unsubscribe.${state}.text`)}</p>
      <Button render={<Link href="/" />} nativeButton={false}>
        {t("backHome")}
      </Button>
    </div>
  );
}
