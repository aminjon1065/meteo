import { markdownExcerpt } from "@meteo/core";
import { getPublishedNews } from "@meteo/db";
import { type I18nText, type Locale, locales, localeTags } from "@meteo/i18n";
import { Badge } from "@meteo/ui/components/badge";
import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { MarkdownContent } from "@/components/news/markdown-content";
import { Link } from "@/i18n/navigation";
import { getDb } from "@/lib/db";
import { name } from "@/lib/format";
import { uploadUrl } from "@/lib/uploads";

export const dynamic = "force-dynamic";

/** Перевод и локаль, из которой он взят (для атрибута lang при фолбэке). */
function pickWithLocale(text: I18nText | null | undefined, locale: Locale) {
  if (text?.[locale]?.trim()) return { value: text[locale] as string, locale };
  for (const l of locales) if (text?.[l]?.trim()) return { value: text[l] as string, locale: l };
  return { value: "", locale };
}

function localizedHref(locale: string, path: string): string {
  return `${locale === "tg" ? "" : `/${locale}`}${path}`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale: raw, slug } = await params;
  const locale = raw as Locale;
  const post = await getPublishedNews(getDb(), slug).catch(() => null);
  if (!post) return {};
  const title = name(post.title, locale);
  const description = name(post.excerpt, locale) || markdownExcerpt(name(post.body, locale), 200);
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return {
    title,
    description,
    alternates: {
      canonical: `${base}${localizedHref(locale, `/news/${post.slug}`)}`,
      languages: Object.fromEntries(
        locales.map((l) => [localeTags[l], `${base}${localizedHref(l, `/news/${post.slug}`)}`]),
      ),
    },
    openGraph: {
      type: "article",
      title,
      description,
      locale: localeTags[locale],
      publishedTime: post.publishedAt?.toISOString(),
      modifiedTime: post.updatedAt.toISOString(),
      images: post.cover
        ? [
            {
              url: `${base}${uploadUrl(post.cover.path)}`,
              width: post.cover.width ?? undefined,
              height: post.cover.height ?? undefined,
              alt: name(post.cover.alt, locale) || title,
            },
          ]
        : undefined,
    },
    twitter: { card: post.cover ? "summary_large_image" : "summary", title, description },
  };
}

export default async function NewsArticlePage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = (await params) as { locale: Locale; slug: string };
  setRequestLocale(locale);
  const post = await getPublishedNews(getDb(), slug);
  if (!post) notFound();
  const [t, tc, format] = await Promise.all([
    getTranslations("news"),
    getTranslations("common"),
    getFormatter(),
  ]);
  const title = pickWithLocale(post.title, locale);
  const body = pickWithLocale(post.body, locale);
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: title.value,
    description: name(post.excerpt, locale) || markdownExcerpt(body.value, 200),
    datePublished: post.publishedAt?.toISOString(),
    dateModified: post.updatedAt.toISOString(),
    inLanguage: localeTags[body.locale],
    image: post.cover ? [`${base}${uploadUrl(post.cover.path)}`] : undefined,
    author: { "@type": "Organization", name: tc("agency") },
    publisher: { "@type": "Organization", name: tc("siteName") },
    mainEntityOfPage: `${base}${localizedHref(locale, `/news/${post.slug}`)}`,
  };

  return (
    <article className="container-page flex flex-col gap-6 py-10">
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD собирается из наших данных через JSON.stringify
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <Link
        href="/news"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" aria-hidden="true" />
        {t("back")}
      </Link>
      <header className="flex max-w-3xl flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {post.category ? (
            <Link href={{ pathname: "/news", query: { category: post.category.slug } }}>
              <Badge variant="secondary">{name(post.category.name, locale)}</Badge>
            </Link>
          ) : null}
          {post.publishedAt ? (
            <time dateTime={post.publishedAt.toISOString()}>
              {format.dateTime(post.publishedAt, { dateStyle: "long", timeStyle: "short" })}
            </time>
          ) : null}
        </div>
        <h1
          className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl"
          lang={title.locale}
        >
          {title.value}
        </h1>
        {name(post.excerpt, locale) ? (
          <p className="text-pretty text-lg text-muted-foreground">{name(post.excerpt, locale)}</p>
        ) : null}
      </header>
      {post.cover ? (
        <figure className="max-w-3xl overflow-hidden rounded-xl border">
          {/* biome-ignore lint/performance/noImgElement: файл из каталога загрузок */}
          <img
            src={uploadUrl(post.cover.path)}
            alt={name(post.cover.alt, locale)}
            width={post.cover.width ?? undefined}
            height={post.cover.height ?? undefined}
            className="h-auto w-full"
          />
        </figure>
      ) : null}
      <MarkdownContent markdown={body.value} lang={body.locale} className="max-w-3xl" />
      <footer className="flex max-w-3xl flex-col gap-2 border-t pt-4 text-sm text-muted-foreground">
        {post.authorName ? (
          <p>
            {t("author")}: {post.authorName}
          </p>
        ) : null}
        <p>{t("updated", { time: format.dateTime(post.updatedAt, { dateStyle: "medium" }) })}</p>
        <Link href="/subscribe" className="underline-offset-4 hover:underline">
          {t("subscribeCta")}
        </Link>
      </footer>
    </article>
  );
}
