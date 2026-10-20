import { markdownExcerpt } from "@meteo/core";
import type { NewsPostRow } from "@meteo/db";
import type { Locale } from "@meteo/i18n";
import { cn } from "@meteo/ui/lib/utils";
import { PinIcon } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { name } from "@/lib/format";
import { uploadUrl } from "@/lib/uploads";

/** Анонс новости в редакционном списке: дата · рубрика, заголовок, краткий текст, обложка справа. */
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
        "grid gap-x-5 gap-y-1.5 border-t-2 border-foreground pt-3.5 pb-3",
        post.cover && "sm:grid-cols-[1fr_9rem]",
        className,
      )}
    >
      <div className="grid content-start gap-1.5">
        <p className="flex flex-wrap items-center gap-x-1.5 text-caption text-muted-foreground">
          {post.publishedAt ? (
            <time dateTime={post.publishedAt.toISOString()}>
              {format.dateTime(post.publishedAt, { day: "numeric", month: "long" })}
            </time>
          ) : null}
          {post.category ? <span>· {name(post.category.name, locale)}</span> : null}
          {post.pinned ? (
            <span className="inline-flex items-center gap-1 font-medium text-brand">
              <PinIcon className="size-3" aria-hidden="true" />
              {t("pinned")}
            </span>
          ) : null}
        </p>
        <h2 className="text-h3 leading-snug">
          <Link href={`/news/${post.slug}`} className="hover:underline">
            {name(post.title, locale)}
          </Link>
        </h2>
        {excerpt ? <p className="text-sm text-muted-foreground">{excerpt}</p> : null}
      </div>
      {post.cover ? (
        <Link
          href={`/news/${post.slug}`}
          className="row-start-1 block sm:col-start-2"
          tabIndex={-1}
          aria-hidden="true"
        >
          {/* biome-ignore lint/performance/noImgElement: файлы из каталога загрузок, без оптимизации next/image */}
          <img
            src={uploadUrl(post.cover.path)}
            alt={name(post.cover.alt, locale)}
            width={post.cover.width ?? undefined}
            height={post.cover.height ?? undefined}
            loading="lazy"
            className="aspect-[4/3] w-full rounded-lg object-cover"
          />
        </Link>
      ) : null}
    </article>
  );
}
