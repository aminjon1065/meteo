import { asc, count, eq } from "@meteo/db";
import { newsCategories, newsPosts } from "@meteo/db/schema";
import type { Locale } from "@meteo/i18n";
import { Button } from "@meteo/ui/components/button";
import { ArrowLeftIcon } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CategoriesEditor } from "@/components/admin/news/categories-editor";
import { Link } from "@/i18n/navigation";
import { getDb } from "@/lib/db";
import { requireAdminSession } from "@/lib/session";
import { deleteCategory, saveCategory } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewsCategoriesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  await requireAdminSession(locale, "content.write");
  const [t, rows] = await Promise.all([
    getTranslations("newsAdmin"),
    getDb()
      .select({
        id: newsCategories.id,
        slug: newsCategories.slug,
        name: newsCategories.name,
        sortOrder: newsCategories.sortOrder,
        posts: count(newsPosts.id),
      })
      .from(newsCategories)
      .leftJoin(newsPosts, eq(newsPosts.categoryId, newsCategories.id))
      .groupBy(newsCategories.id)
      .orderBy(asc(newsCategories.sortOrder), asc(newsCategories.id)),
  ]);

  async function save(raw: unknown) {
    "use server";
    return saveCategory(locale, raw);
  }
  async function remove(id: number) {
    "use server";
    return deleteCategory(locale, id);
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("categories.title")}</h1>
          <p className="text-muted-foreground">{t("categories.subtitle")}</p>
        </div>
        <Button variant="outline" render={<Link href="/admin/news" />} nativeButton={false}>
          <ArrowLeftIcon aria-hidden="true" />
          {t("title")}
        </Button>
      </div>
      <CategoriesEditor rows={rows} save={save} remove={remove} />
    </>
  );
}
