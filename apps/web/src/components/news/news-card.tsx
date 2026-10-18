import { markdownExcerpt } from "@meteo/core";
import type { NewsPostRow } from "@meteo/db";
import type { Locale } from "@meteo/i18n";
import { Badge } from "@meteo/ui/components/badge";
import { cn } from "@meteo/ui/lib/utils";
import { PinIcon } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { name } from "@/lib/format";
import { uploadUrl } from "@/lib/uploads";

/** Анонс новости: обложка, рубрика, дата, заголовок и краткий текст. */
export async function NewsCard({
  post,
  locale,
  className,
}: {
  post: NewsPostRow;
  locale: Locale;
  className?: string;
}) {
  const [t, format] = await Promise.all([getTranslations("news"), getFormatter()]);
  const excerpt = name(post.excerpt, locale) || markdownExcerpt(name(post.body, locale), 180);
  return (
    <article
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border bg-card transition-shadow hover:shadow-md",
        className,
      )}
    >
      {post.cover ? (
        <Link href={`/news/${post.slug}`} className="block" tabIndex={-1} aria-hidden="true">
          {/* biome-ignore lint/performance/noImgElement: файлы из каталога загрузок, без оптимизации next/image */}
          <img
            src={uploadUrl(post.cover.path)}
            alt={name(post.cover.alt, locale)}
            width={post.cover.width ?? undefined}
            height={post.cover.height ?? undefined}
            loading="lazy"
            className="aspect-video w-full object-cover"
          />
        </Link>
      ) : null}
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {post.category ? (
            <Badge variant="secondary">{name(post.category.name, locale)}</Badge>
          ) : null}
          {post.publishedAt ? (
            <time dateTime={post.publishedAt.toISOString()}>
              {format.dateTime(post.publishedAt, { dateStyle: "long" })}
            </time>
          ) : null}
          {post.pinned ? (
            <span className="inline-flex items-center gap-1">
              <PinIcon className="size-3" aria-hidden="true" />
              {t("pinned")}
            </span>
          ) : null}
        </div>
        <h2 className="text-lg font-semibold leading-snug">
          <Link href={`/news/${post.slug}`} className="hover:underline">
            {name(post.title, locale)}
          </Link>
        </h2>
        {excerpt ? <p className="text-sm text-muted-foreground">{excerpt}</p> : null}
        <Link
          href={`/news/${post.slug}`}
          className="mt-auto pt-1 text-sm font-medium text-brand underline-offset-4 hover:underline"
        >
          {t("readMore")} →
        </Link>
      </div>
    </article>
  );
}
