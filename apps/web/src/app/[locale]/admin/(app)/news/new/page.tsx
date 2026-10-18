import { can } from "@meteo/core";
import type { Locale } from "@meteo/i18n";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { NewsForm } from "@/components/admin/news/news-form";
import { requireAdminSession } from "@/lib/session";
import type { NewsInput } from "@/lib/validation/news";
import { loadNewsFormOptions } from "../_data";
import { createPost } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewPostPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const session = await requireAdminSession(locale, "content.write");
  const [t, options] = await Promise.all([getTranslations("newsAdmin"), loadNewsFormOptions()]);

  async function action(raw: NewsInput) {
    "use server";
    return createPost(locale, raw);
  }

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("new")}</h1>
        <p className="text-muted-foreground">{t("hints.new")}</p>
      </div>
      <NewsForm
        options={options}
        action={action}
        canPublish={can(session.user.role, "content.publish")}
      />
    </>
  );
}
