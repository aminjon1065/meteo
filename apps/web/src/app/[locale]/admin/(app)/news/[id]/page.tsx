import { can, utcToDushanbeLocal } from "@meteo/core";
import { getNewsById } from "@meteo/db";
import type { Locale } from "@meteo/i18n";
import { Badge } from "@meteo/ui/components/badge";
import { ExternalLinkIcon } from "lucide-react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { NewsForm } from "@/components/admin/news/news-form";
import { PostActions } from "@/components/admin/news/post-actions";
import { Link } from "@/i18n/navigation";
import { getDb } from "@/lib/db";
import { name } from "@/lib/format";
import { requireAdminSession } from "@/lib/session";
import { uploadUrl } from "@/lib/uploads";
import type { NewsInput, NewsStatus } from "@/lib/validation/news";
import { loadNewsFormOptions } from "../_data";
import { deletePost, setPostStatus, updatePost } from "../actions";

export const dynamic = "force-dynamic";

const STATUS_VARIANT = {
  draft: "secondary",
  published: "default",
  archived: "outline",
} as const;

export default async function EditPostPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id: rawId } = (await params) as { locale: Locale; id: string };
  setRequestLocale(locale);
  const session = await requireAdminSession(locale, "content.read");
  const id = Number(rawId);
  if (!Number.isInteger(id)) notFound();
  const post = await getNewsById(getDb(), id);
  if (!post) notFound();
  const [t, options] = await Promise.all([getTranslations("newsAdmin"), loadNewsFormOptions()]);
  const canWrite = can(session.user.role, "content.write");
  const canPublish = can(session.user.role, "content.publish");
  const publishedLocal = post.publishedAt ? utcToDushanbeLocal(post.publishedAt) : null;

  const initial: Partial<NewsInput> & { id: number } = {
    id: post.id,
    slug: post.slug,
    title: { tg: post.title.tg ?? "", ru: post.title.ru ?? "", en: post.title.en ?? "" },
    excerpt: { tg: post.excerpt?.tg ?? "", ru: post.excerpt?.ru ?? "", en: post.excerpt?.en ?? "" },
    body: { tg: post.body.tg ?? "", ru: post.body.ru ?? "", en: post.body.en ?? "" },
    categoryId: (post.category?.id ?? "") as unknown as number,
    coverId: (post.cover?.id ?? "") as unknown as number,
    status: post.status,
    publishedAt: publishedLocal ? `${publishedLocal.date}T${publishedLocal.time}` : "",
    pinned: post.pinned,
  };

  async function action(raw: NewsInput) {
    "use server";
    return updatePost(locale, id, raw);
  }
  async function setStatus(status: NewsStatus) {
    "use server";
    return setPostStatus(locale, id, status);
  }
  async function remove() {
    "use server";
    return deletePost(locale, id);
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {name(post.title, locale) || post.slug}
          </h1>
          <p className="font-mono text-sm text-muted-foreground">{post.slug}</p>
        </div>
        <Badge variant={STATUS_VARIANT[post.status]}>{t(`status.${post.status}`)}</Badge>
        {post.status === "published" ? (
          <Link
            href={`/news/${post.slug}`}
            className="inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline"
          >
            <ExternalLinkIcon className="size-4" aria-hidden="true" />
            {t("viewOnSite")}
          </Link>
        ) : null}
        {canWrite ? (
          <div className="ml-auto">
            <PostActions
              status={post.status}
              canPublish={canPublish}
              setStatus={setStatus}
              remove={remove}
            />
          </div>
        ) : null}
      </div>
      {canWrite ? (
        <NewsForm
          options={options}
          initial={initial}
          initialCover={post.cover ? { id: post.cover.id, url: uploadUrl(post.cover.path) } : null}
          action={action}
          canPublish={canPublish}
        />
      ) : (
        <p className="text-muted-foreground">{t("readOnly")}</p>
      )}
    </>
  );
}
