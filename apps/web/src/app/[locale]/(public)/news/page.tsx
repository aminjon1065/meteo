import { listNewsCategories, listPublishedNews, type NewsPostRow } from "@meteo/db";
import type { Locale } from "@meteo/i18n";
import { Button } from "@meteo/ui/components/button";
import { cn } from "@meteo/ui/lib/utils";
import { NewspaperIcon, RssIcon } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { NewsCard } from "@/components/news/news-card";
import { Link } from "@/i18n/navigation";
import { getDb } from "@/lib/db";
import { name } from "@/lib/format";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 12;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: "news" });
  return { title: t("title"), description: t("intro") };
}

export default async function NewsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ category?: string; page?: string }>;
}) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const db = getDb();
  const [t, tc, categories, list] = await Promise.all([
    getTranslations("news"),
    getTranslations("common"),
    listNewsCategories(db).catch(() => []),
    listPublishedNews(db, { page, pageSize: PAGE_SIZE, categorySlug: sp.category }).catch(() => ({
      rows: [] as NewsPostRow[],
      total: 0,
    })),
  ]);
  const pages = Math.max(1, Math.ceil(list.total / PAGE_SIZE));
  const chip = (active: boolean) =>
    cn(
      "rounded-full border px-3 py-1 text-sm transition-colors hover:bg-accent",
      active ? "bg-accent text-accent-foreground" : "bg-card",
    );

  return (
    <div className="container-page flex flex-col gap-8 py-10">
      <div className="flex flex-col gap-3">
        <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight">
          <NewspaperIcon className="size-8 text-brand" aria-hidden="true" />
          {t("title")}
        </h1>
        <p className="max-w-3xl text-muted-foreground">{t("intro")}</p>
      </div>

      <nav className="flex flex-wrap items-center gap-2" aria-label={t("category")}>
        <Link href="/news" className={chip(!sp.category)}>
          {t("allCategories")}
        </Link>
        {categories.map((c) => (
          <Link
            key={c.id}
            href={{ pathname: "/news", query: { category: c.slug } }}
            className={chip(sp.category === c.slug)}
          >
            {name(c.name, locale)}
          </Link>
        ))}
        <a
          href={`/api/v1/news/rss.xml?locale=${locale}`}
          className="ml-auto inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          <RssIcon className="size-4" aria-hidden="true" />
          {t("rss")}
        </a>
      </nav>

      {list.rows.length === 0 ? (
        <p className="rounded-lg border bg-card p-6 text-center text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {list.rows.map((post) => (
            <NewsCard key={post.id} post={post} locale={locale} />
          ))}
        </div>
      )}

      {pages > 1 ? (
        <nav
          className="flex items-center justify-between text-sm text-muted-foreground"
          aria-label={tc("pagination")}
        >
          <span>{t("page", { page, pages })}</span>
          <div className="flex gap-2">
            {page > 1 ? (
              <Button
                variant="outline"
                size="sm"
                render={<Link href={{ pathname: "/news", query: { ...sp, page: page - 1 } }} />}
                nativeButton={false}
              >
                ← {t("prev")}
              </Button>
            ) : null}
            {page < pages ? (
              <Button
                variant="outline"
                size="sm"
                render={<Link href={{ pathname: "/news", query: { ...sp, page: page + 1 } }} />}
                nativeButton={false}
              >
                {t("next")} →
              </Button>
            ) : null}
          </div>
        </nav>
      ) : null}

      <p className="text-sm text-muted-foreground">
        <Link href="/subscribe" className="underline-offset-4 hover:underline">
          {t("subscribeCta")}
        </Link>
      </p>
    </div>
  );
}
