import type { Locale } from "@meteo/i18n";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { BulletinForm } from "@/components/admin/bulletins/bulletin-form";
import { requireAdminSession } from "@/lib/session";
import type { BulletinInput } from "@/lib/validation/news";
import { loadBulletinFormData } from "../_data";
import { createBulletin } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewBulletinPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  await requireAdminSession(locale, "content.write");
  const [t, data] = await Promise.all([getTranslations("bulletins"), loadBulletinFormData()]);

  async function action(raw: BulletinInput) {
    "use server";
    return createBulletin(locale, raw);
  }

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("new")}</h1>
        <p className="text-muted-foreground">
          {t("subscribersCount", { count: data.subscribersCount })}
        </p>
      </div>
      <BulletinForm posts={data.posts} action={action} />
    </>
  );
}
